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
import { cleanText, normalizeStoryRow, searchableText } from '../src/pipeline/normalize.mjs';
import { attachAll, buildArtworkIndex } from '../src/pipeline/artwork.mjs';
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
  const stories = collectStories(sources);
  validateStories(stories);

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
  const titlesDump = sources.find((s) => s.kind === 'catalog' && s.sheetName === 'Titles');
  const episodesDump = sources.find((s) => s.kind === 'catalog' && s.sheetName === 'Episodes');
  const artworkIndex = buildArtworkIndex({ artworkDump, titlesDump, episodesDump });
  const artworkCoverage = attachAll(stories, artworkIndex, appleRegistry);

  // Deep-link integrity: every URL in the artifact must match a verified
  // pattern shape. A malformed link fails the build before anything ships.
  const malformedLinks = stories
    .filter((s) => s.appleUrl && !classifyAppleUrl(s.appleUrl))
    .map((s) => `${s.id}: ${s.appleUrl}`);
  if (malformedLinks.length) {
    throw new Error(`deep-link integrity check failed:\n  ${malformedLinks.join('\n  ')}`);
  }

  stories.sort((a, b) => a.id.localeCompare(b.id));

  const ids = new Set();
  for (const s of stories) {
    if (ids.has(s.id)) throw new Error(`duplicate story id: ${s.id}`);
    ids.add(s.id);
  }

  const embedder = createEmbedder();
  const embeddings = stories.map((s) => ({
    id: s.id,
    vector: stableVector(embedder.embed(searchableText(s))),
  }));

  // The version hash stamps story content and vectors, not build metadata.
  const canonical = JSON.stringify({ stories, embeddings });
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
    storyCount: stories.length,
    stories,
    embeddings,
  };
  const artifactPath = path.join(OUT_DIR, 'search-artifact.json');
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n');

  const db = new Database(path.join(OUT_DIR, 'search.db'));
  db.exec('DROP TABLE IF EXISTS stories; DROP TABLE IF EXISTS stories_fts;');
  populateDb(db, stories);
  db.close();

  const dashFindings = scanDashes(stories);
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
    houseStyle: {
      emDashScan: {
        note: 'Em dashes in curated source rows are flagged for the curation thread. The pipeline never rewrites them.',
        affected: dashFindings,
      },
    },
    vocabulary: {
      offListObserved: [...new Set(stories.flatMap((s) => s.emotionOffList))].sort(),
      droppedTraitWords: [...new Set(stories.flatMap((s) => s.emotionDropped ?? []))].sort(),
      unknownEmotionTerms: [...new Set(stories.flatMap((s) => s.emotionUnknown))].sort(),
    },
  };
  writeFileSync(path.join(OUT_DIR, 'validation-report.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(path.join(OUT_DIR, 'build-meta.json'), JSON.stringify({ builtAt: new Date().toISOString() }, null, 2) + '\n');

  console.log(`artifact: ${artifactPath}`);
  console.log(`version:  ${version}`);
  console.log(`stories:  ${stories.length} across ${report.coverage.series ? Object.keys(report.coverage.series).length : 0} series`);
  console.log(`artwork:  mode ${mode}; stills ${artworkCoverage.stills}, poster fallback ${artworkCoverage.posterFallback}, none ${artworkCoverage.noArtwork}`);
  console.log(`links:    episode ${artworkCoverage.episodeLinks}, show page ${artworkCoverage.showLinks}, none ${artworkCoverage.noLink}`);
  console.log(`dash findings: ${dashFindings.length} source sheets flagged (see validation-report.json)`);
}

main();
