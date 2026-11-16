// Build the versioned static search artifact from the committed source dumps.
//
// Inputs:  data/source/*.json   (written by scripts/fetch-source.mjs, committed)
// Outputs: data/search/search-artifact.json  (stories, embeddings, version hash)
//          data/search/search.db        (SQLite FTS5 index for serving)
//          data/search/validation-report.json (coverage and vocabulary drift)
//          data/search/build-meta.json  (timestamps, gitignored)
//
// The artifact is byte-reproducible: no timestamps inside it, vectors rounded
// to six decimals, rows sorted by id. CI rebuilds it and fails if the commit
// and the rebuild disagree.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cleanText, isPlaceholderRow, normalizeStoryRow, publishProblems, searchableText } from '../src/pipeline/normalize.mjs';
import { suppressionReasons, filmSuppressionReasons } from '../src/pipeline/parent-facing.mjs';
import { attachAll, attachAllFilms, buildArtworkIndex, collectSeriesPosters } from '../src/pipeline/artwork.mjs';
import { joinSeriesDescriptions } from '../src/pipeline/series-descriptions.mjs';
import { duplicateFilmIdProblems, filmCatalogByTmdbId, filmRowProblems, normalizeFilmRow } from '../src/pipeline/films.mjs';
import { classifyAppleUrl, validateAppleRegistry } from '../src/links/apple-tv.mjs';
import { createEmbedder, stableVector } from '../src/search/embedder.mjs';
import { populateDb } from '../src/search/store.mjs';
import Database from 'better-sqlite3';

const SOURCE_DIR = path.resolve('data/source');
const OUT_DIR = path.resolve('data/search');
const PUBLIC_DIR = path.resolve('public');

// The verbatim notice TMDB requires, and the official logo asset (downloaded
// from themoviedb.org/about/logos-attribution). The build fails when artwork
// mode is on and either is missing from the site.
export const TMDB_NOTICE = 'This website uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.';

/** Serving and build default to TMDB artwork; ARTWORK_MODE=text reverts to Phase 1 cards. */
export function artworkMode() {
  return process.env.ARTWORK_MODE === 'text' ? 'text' : 'tmdb';
}

/**
 * Attribution gate: when artwork mode is on, the site must carry the TMDB
 * logo and the verbatim notice in its About/Credits section. Missing either
 * fails the build, per the approved Artwork Terms Findings.
 */
function checkAttribution(mode) {
  if (mode !== 'tmdb') return { checked: false, mode };
  const htmlPath = path.join(PUBLIC_DIR, 'index.html');
  const logoPath = path.join(PUBLIC_DIR, 'tmdb-logo.svg');
  const problems = [];
  if (!existsSync(logoPath)) {
    problems.push('public/tmdb-logo.svg is missing (official logo from themoviedb.org/about/logos-attribution)');
  } else if (!readFileSync(logoPath, 'utf8').includes('<svg')) {
    problems.push('public/tmdb-logo.svg does not look like an SVG logo');
  }
  if (!existsSync(htmlPath)) {
    problems.push('public/index.html is missing');
  } else {
    const html = readFileSync(htmlPath, 'utf8');
    if (!html.includes(TMDB_NOTICE)) {
      problems.push(`public/index.html does not carry the verbatim TMDB notice: "${TMDB_NOTICE}"`);
    }
  }
  if (problems.length) throw new Error(`attribution check failed (artwork mode ${mode}):\n  ${problems.join('\n  ')}`);
  return { checked: true, mode };
}

function readSourceFiles() {
  // Workbook sheet dumps only. The artwork and Apple link dumps are consumed
  // separately below and are excluded here so the artifact manifest keeps
  // describing sheets.
  const NON_SHEET = new Set(['tmdb-artwork.json', 'apple-links.json']);
  const files = readdirSync(SOURCE_DIR).filter((f) => f.endsWith('.json') && f !== 'manifest.json' && !NON_SHEET.has(f));
  return files.map((f) => JSON.parse(readFileSync(path.join(SOURCE_DIR, f), 'utf8')));
}

function collectStories(sources) {
  const stories = [];
  const errors = [];
  for (const src of sources) {
    if (src.kind !== 'stories') continue;
    const provenance = {
      workbookId: src.workbookId,
      workbookName: src.workbookName,
      sheetId: src.sheetId,
      sheetName: src.sheetName,
      defaultSeriesTitle: src.defaultSeriesTitle,
    };
    for (const raw of src.rows) {
      const story = normalizeStoryRow(raw, provenance);
      if (!story.seriesTitle || !story.episodeNumber) {
        errors.push(`${src.sheetId}: row missing series or episode number: ${cleanText(raw.episode_title)}`);
        continue;
      }
      if (!story.situation && !story.displaySynopsis) {
        errors.push(`${src.sheetId}: ${story.id} has neither situation nor synopsis`);
        continue;
      }
      stories.push(story);
    }
  }
  if (errors.length) {
    throw new Error(`story normalization failed:\n  ${errors.join('\n  ')}`);
  }
  return stories;
}

/**
 * Normalizes the standalone-film rows (kind 'films' sheets). Gates:
 *   - exactly one row per TMDB id — a duplicate film id fails the build
 *   - link_status=verified on every row — the honest-link rule: nothing
 *     indexes on an unverified Apple link
 *   - every film joins the Titles catalog by TMDB id, so the card subtitle
 *     can disambiguate same-named films by release year
 *   - a known evidence tier, carried as internal metadata only
 * Empty coping or emotion is faithful upstream absence and is never a gate.
 */
function collectFilms(sources, catalog) {
  const films = [];
  const errors = [];
  for (const src of sources) {
    if (src.kind !== 'films') continue;
    const provenance = {
      workbookId: src.workbookId,
      workbookName: src.workbookName,
      sheetId: src.sheetId,
      sheetName: src.sheetName,
    };
    for (const raw of src.rows) {
      const film = normalizeFilmRow(raw, provenance, catalog.get(cleanText(raw.tmdb_id)));
      const problems = filmRowProblems(film);
      if (problems.length) {
        errors.push(`${src.sheetId}: ${cleanText(raw.film_title) || '(untitled row)'} — ${problems.join('; ')}`);
        continue;
      }
      films.push(film);
    }
  }
  if (errors.length) {
    throw new Error(`film normalization failed:\n  ${errors.join('\n  ')}`);
  }
  const dupes = duplicateFilmIdProblems(films);
  if (dupes.length) {
    throw new Error(`duplicate film ids (one row per film):\n  ${dupes.join('\n  ')}`);
  }
  return films;
}

/** Structural checks that must hold for every row, plus enum post-normalization. */
function validateStories(stories) {
  const problems = [];
  for (const s of stories) {
    if (s.emotionUnknown.length) {
      problems.push(`${s.id}: unknown emotion terms (add a synonym mapping or widen the vocabulary): ${s.emotionUnknown.join(', ')}`);
    }
  }
  if (problems.length) {
    throw new Error(`validation failed:\n  ${problems.join('\n  ')}`);
  }
}

/** House style scan. Em dashes in curated source rows are reported, never silently rewritten. */
function scanDashes(stories) {
  const fields = ['situation', 'coping', 'synopsis', 'perStorySynopsis'];
  const bySource = new Map();
  for (const s of stories) {
    for (const field of fields) {
      const text = s[field];
      if (text && /[\u2013\u2014]/.test(text)) {
        const key = `${s.provenance.workbookId}/${s.provenance.sheetId}`;
        if (!bySource.has(key)) bySource.set(key, new Set());
        bySource.get(key).add(s.id);
      }
    }
  }
  return [...bySource.entries()]
    .map(([source, ids]) => ({ source, rowsWithDashes: [...ids].sort() }))
    .sort((a, b) => a.source.localeCompare(b.source));
}

function coverageReport(stories, sources) {
  const catalog = sources.find((s) => s.kind === 'catalog' && s.sheetName === 'Titles');
  const episodes = sources.find((s) => s.kind === 'catalog' && s.sheetName === 'Episodes');
  const bySeries = new Map();
  for (const s of stories) {
    if (!bySeries.has(s.seriesTitle)) bySeries.set(s.seriesTitle, { storyRows: 0, withSituation: 0, withPerStorySynopsis: 0 });
    const agg = bySeries.get(s.seriesTitle);
    agg.storyRows += 1;
    if (s.situation) agg.withSituation += 1;
    if (s.perStorySynopsis) agg.withPerStorySynopsis += 1;
  }
  return {
    catalogTitles: catalog ? catalog.rowCount : null,
    catalogEpisodeRows: episodes ? episodes.rowCount : null,
    storyRows: stories.length,
    series: Object.fromEntries([...bySeries.entries()].sort(([a], [b]) => a.localeCompare(b))),
    missingSituation: stories.filter((s) => !s.situation).length,
    missingAgeBand: stories.filter((s) => !s.ageBand).length,
    missingVibe: stories.filter((s) => !s.vibe).length,
  };
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const sources = readSourceFiles();
  const titlesDump = sources.find((s) => s.kind === 'catalog' && s.sheetName === 'Titles');
  const episodesDump = sources.find((s) => s.kind === 'catalog' && s.sheetName === 'Episodes');
  let stories = collectStories(sources);
  // Films join the same corpus and the same vocabulary gate as stories; their
  // own gates (verified link, one row per film id, catalog year join) live in
  // collectFilms.
  let films = collectFilms(sources, filmCatalogByTmdbId(titlesDump));
  validateStories([...stories, ...films]);

  // Placeholder routing: title-level rows flagged for review (no source text,
  // no tags) never publish. They leave the artifact entirely and land in the
  // validation report for the curation queue, per the spec QA loop.
  const routedToCuration = stories.filter(isPlaceholderRow).map((s) => ({
    id: s.id,
    reason: 'title-level placeholder row, no source text or tags; awaiting curation',
  }));
  if (routedToCuration.length) {
    stories = stories.filter((s) => !isPlaceholderRow(s));
  }

  // Parent-facing gate: rows carrying internal QA annotations in their
  // parent-facing fields, or whose resolution the curation notes flag as an
  // unverified synopsis fallback, never reach the artifact a parent's card
  // can draw from. They land in the validation report for the curation queue
  // instead, per Allie's 2026-11-14 feedback round.
  const suppressedFromRender = stories.flatMap((s) => {
    const reasons = suppressionReasons(s);
    return reasons.length ? [{ id: s.id, reasons }] : [];
  });
  if (suppressedFromRender.length) {
    const suppressedIds = new Set(suppressedFromRender.map((r) => r.id));
    stories = stories.filter((s) => !suppressedIds.has(s.id));
  }

  // Publish gate: nothing ships without a real situation and a full tag set.
  const nonConforming = stories.flatMap((s) => {
    const problems = publishProblems(s);
    return problems.length ? [`${s.id}: missing ${problems.join(', ')}`] : [];
  });
  if (nonConforming.length) {
    throw new Error(`published rows are non-conforming (nothing publishes without a full tag set):\n  ${nonConforming.join('\n  ')}`);
  }

  // Film honesty gate: internal annotation language never reaches a parent's
  // screen. Films do not route through the story unverified-resolution rule —
  // the corpus carries its evidence tier deliberately, and honesty lives in
  // what the card claims: the resolution line renders only from the row's own
  // tagged coping data, and the tier is never displayed (Film Card Diction).
  const filmsSuppressed = films.flatMap((f) => {
    const reasons = filmSuppressionReasons(f);
    return reasons.length ? [{ id: f.id, reasons }] : [];
  });
  if (filmsSuppressed.length) {
    const suppressedIds = new Set(filmsSuppressed.map((r) => r.id));
    films = films.filter((f) => !suppressedIds.has(f.id));
  }

  // Phase 2: artwork and Apple links. Both come from committed dumps; if
  // either is absent the build stops with instructions rather than shipping
  // half-tagged cards.
  const mode = artworkMode();
  const attribution = checkAttribution(mode);
  const artworkPath = path.join(SOURCE_DIR, 'tmdb-artwork.json');
  const appleLinksPath = path.join(SOURCE_DIR, 'apple-links.json');
  if (!existsSync(artworkPath)) {
    throw new Error('data/source/tmdb-artwork.json is missing. Run: npm run fetch:artwork');
  }
  if (!existsSync(appleLinksPath)) {
    throw new Error('data/source/apple-links.json is missing. It is transcribed from the verified deep-link findings and committed.');
  }
  const artworkDump = JSON.parse(readFileSync(artworkPath, 'utf8'));
  const appleRegistry = JSON.parse(readFileSync(appleLinksPath, 'utf8'));
  validateAppleRegistry(appleRegistry);
  const artworkIndex = buildArtworkIndex({ artworkDump, titlesDump, episodesDump });
  const artworkCoverage = attachAll(stories, artworkIndex, appleRegistry);
  const filmCoverage = attachAllFilms(films, artworkIndex);

  // The serving corpus: stories and films in one ranked index. Films ride the
  // artifact's stories array so search, filters, and /api/health see them
  // exactly like series rows.
  const rows = [...stories, ...films];

  // Deep-link integrity: every URL in the artifact must match a verified
  // pattern shape. A malformed link fails the build before anything ships.
  const malformedLinks = rows
    .filter((s) => s.appleUrl && !classifyAppleUrl(s.appleUrl))
    .map((s) => `${s.id}: ${s.appleUrl}`);
  if (malformedLinks.length) {
    throw new Error(`deep-link integrity check failed:\n  ${malformedLinks.join('\n  ')}`);
  }

  rows.sort((a, b) => a.id.localeCompare(b.id));

  const ids = new Set();
  for (const s of rows) {
    if (ids.has(s.id)) throw new Error(`duplicate story id: ${s.id}`);
    ids.add(s.id);
  }

  // The v1.1 browse-by-show strip: one real poster per published series,
  // stamped into the artifact so the server renders the strip with no new
  // fetch layer. The gate inside collectSeriesPosters stops the build when a
  // series resolves zero or several distinct posters. Derived data, so it
  // rides outside the version hash: the stamp still covers story content and
  // vectors only, and a rebuild reproduces this list byte for byte.
  const seriesPosters = collectSeriesPosters(rows);

  // The poster-tap popup: the approved description, suggested age band, and
  // verified Apple series link join onto each strip entry from the committed
  // descriptions dump. The gate inside joinSeriesDescriptions stops the build
  // when the workbook and the strip disagree — a missing or duplicate row, a
  // stale row, an unverified link — so a popup never ships half-joined.
  const descriptionsDump = sources.find((s) => s.kind === 'series-descriptions');
  const seriesPopups = joinSeriesDescriptions(seriesPosters, descriptionsDump?.rows);

  const embedder = createEmbedder();
  const embeddings = rows.map((s) => ({
    id: s.id,
    vector: stableVector(embedder.embed(searchableText(s))),
  }));

  // The version hash stamps row content and vectors, not build metadata.
  const canonical = JSON.stringify({ stories: rows, embeddings });
  const version = createHash('sha256').update(canonical).digest('hex').slice(0, 16);

  const artifact = {
    version,
    embedder: embedder.name,
    embeddingDim: embedder.dim,
    sourceManifest: sources.map((s) => ({
      workbookId: s.workbookId,
      workbookName: s.workbookName,
      sheetId: s.sheetId,
      sheetName: s.sheetName,
      kind: s.kind,
      rowCount: s.rowCount,
    })),
    storyCount: rows.length,
    seriesPosters: seriesPopups,
    stories: rows,
    embeddings,
  };
  const artifactPath = path.join(OUT_DIR, 'search-artifact.json');
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n');

  const db = new Database(path.join(OUT_DIR, 'search.db'));
  db.exec('DROP TABLE IF EXISTS stories; DROP TABLE IF EXISTS stories_fts;');
  populateDb(db, rows);
  db.close();

  const dashFindings = scanDashes(rows);
  const report = {
    version,
    artwork: {
      mode,
      attributionChecked: attribution.checked,
      coverage: {
        withStill: artworkCoverage.stills,
        posterFallback: artworkCoverage.posterFallback,
        noArtwork: artworkCoverage.noArtwork,
      },
      links: {
        episode: artworkCoverage.episodeLinks,
        show: artworkCoverage.showLinks,
        none: artworkCoverage.noLink,
        integrityCheck: 'every appleUrl matches a verified pattern shape; the build fails on any malformed link',
      },
      unresolvedSeries: artworkCoverage.unresolvedSeries,
      tmdbMismatches: artworkCoverage.mismatches,
      tmdbFetchMissing: artworkDump.missing,
    },
    coverage: coverageReport(stories, sources),
    films: {
      // Films ride the artifact's stories array; this block reports their own
      // shape so the sheet's state stays visible at build time. Evidence
      // tiers are internal metadata and are never displayed.
      rows: filmCoverage.filmRows,
      evidenceTiers: {
        synopsis_fallback: rows.filter((r) => r.kind === 'film' && r.evidenceTier === 'synopsis_fallback').length,
        title_overview: rows.filter((r) => r.kind === 'film' && r.evidenceTier === 'title_overview').length,
      },
      withoutCoping: rows.filter((r) => r.kind === 'film' && !r.coping).length,
      withoutEmotion: rows.filter((r) => r.kind === 'film' && !r.emotions.length).length,
      artwork: { withPoster: filmCoverage.withPoster, noArtwork: filmCoverage.noArtwork },
      links: { movie: filmCoverage.movieLinks, none: filmCoverage.noLink },
      suppressedFromRender: filmsSuppressed,
      note: 'Films join search and filters like series rows; they stay out of the series dropdown, the poster strip, and the rails. Empty coping or emotion is faithful upstream absence, rendered as no chip.',
    },
    houseStyle: {
      emDashScan: {
        note: 'Em dashes in curated source rows are flagged for the curation thread. The pipeline never rewrites them.',
        affected: dashFindings,
      },
    },
    curation: {
      routedToCuration,
      note: 'Placeholder rows never publish; the curation thread owns tagging them or removing them at the source.',
    },
    parentFacing: {
      suppressedFromRender,
      note: 'Rows with internal QA annotations in parent-facing fields, or with resolutions flagged as unverified synopsis fallbacks, never publish. The curation thread owns re-verifying them at the source.',
    },
    vocabulary: {
      offListObserved: [...new Set(rows.flatMap((s) => s.emotionOffList))].sort(),
      droppedTraitWords: [...new Set(rows.flatMap((s) => s.emotionDropped ?? []))].sort(),
      unknownEmotionTerms: [...new Set(rows.flatMap((s) => s.emotionUnknown))].sort(),
    },
  };
  writeFileSync(path.join(OUT_DIR, 'validation-report.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(path.join(OUT_DIR, 'build-meta.json'), JSON.stringify({ builtAt: new Date().toISOString() }, null, 2) + '\n');

  console.log(`artifact: ${artifactPath}`);
  console.log(`version:  ${version}`);
  console.log(`stories:  ${stories.length} across ${report.coverage.series ? Object.keys(report.coverage.series).length : 0} series; ${films.length} films`);
  console.log(`artwork:  mode ${mode}; stills ${artworkCoverage.stills}, poster fallback ${artworkCoverage.posterFallback}, none ${artworkCoverage.noArtwork}`);
  console.log(`links:    episode ${artworkCoverage.episodeLinks}, show page ${artworkCoverage.showLinks}, none ${artworkCoverage.noLink}`);
  console.log(`dash findings: ${dashFindings.length} source sheets flagged (see validation-report.json)`);
  console.log(`curation: ${routedToCuration.length} placeholder rows routed to the curation queue (see validation-report.json)`);
  console.log(`parent-facing gate: ${suppressedFromRender.length} rows held back from render, flagged to curation (see validation-report.json)`);
}

main();
