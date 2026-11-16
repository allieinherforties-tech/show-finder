// Search index: SQLite FTS5 for keywords, in-memory vectors for similarity,
// fused ranking on top. The database is built from the static artifact (at
// build time to a file, in memory for tests), so serving never touches the
// network or the workbook source.

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cosine, createEmbedder } from './embedder.mjs';
import { ftsMatchExpression, interpretQuery } from './interpret.mjs';

// Column order matters: it matches the bm25 weight list in keywordScores.
const FTS_COLUMNS = 'situation, emotions, coping, synopsis, segment_title, episode_title, series_title';
const BM25_WEIGHTS = [3.0, 3.0, 2.0, 1.5, 2.0, 1.0, 1.0];

/** Creates the FTS5 schema and inserts story rows. */
export function populateDb(db, stories) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS stories_fts USING fts5(
      ${FTS_COLUMNS},
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `);
  const insert = db.prepare(
    `INSERT INTO stories_fts (rowid, situation, emotions, coping, synopsis, segment_title, episode_title, series_title)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertId = db.prepare('INSERT INTO stories (rowid, id) VALUES (?, ?)');
  db.transaction((rows) => {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      insertId.run(i + 1, row.id);
      insert.run(
        i + 1,
        row.situation,
        [...row.emotions, ...row.emotionOffList].join(', '),
        row.coping,
        row.displaySynopsis,
        row.segmentTitle,
        row.episodeTitle,
        row.seriesTitle,
      );
    }
  })(stories);
}

/** Opens an artifact and its database and returns a queryable index. */
export function loadIndex({ artifactPath, dbPath, embedderName } = {}) {
  const raw = JSON.parse(readFileSync(artifactPath, 'utf8'));
  const stories = raw.stories;
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const byId = new Map(stories.map((s, i) => [s.id, i]));
  const storiesById = new Map(stories.map((s) => [s.id, s]));
  const vectors = raw.embeddings.map((e) => Float64Array.from(e.vector));
  const embedder = createEmbedder(embedderName || raw.embedder);
  return {
    version: raw.version,
    storyCount: stories.length,
    // Series the index knows, for validating the guided reply series facet.
    // Films are not series: a parent scanning series does not expect Blush
    // between Frog and Toad and Fraggle Rock, so films stay out of this set.
    seriesTitles: new Set(stories.filter((s) => s.kind !== 'film').map((s) => s.seriesTitle)),
    // The v1.1 browse-by-show strip: one poster per published series, stamped
    // by the build. The server renders it straight from this list.
    seriesPosters: raw.seriesPosters || [],
    // Direct row access for curated surfaces (the holiday rails): a rail row
    // quotes the artifact's own story row, so a rebuild flows through.
    storyById: (id) => storiesById.get(id) || null,
    search(query, opts = {}) {
      return runSearch({ stories, byId, vectors, db, embedder }, query, opts);
    },
  };
}

/** In-memory index for tests and for the artifact build itself. */
export function createMemoryIndex(stories, embedderName) {
  const db = new Database(':memory:');
  populateDb(db, stories);
  const embedder = createEmbedder(embedderName);
  const vectors = stories.map((s) => embedder.embed(vectorInput(s)));
  const byId = new Map(stories.map((s, i) => [s.id, i]));
  return {
    // Same exclusion as the artifact path: a film is never a valid series
    // filter value, whatever builds the index.
    seriesTitles: new Set(stories.filter((s) => s.kind !== 'film').map((s) => s.seriesTitle)),
    search(query, opts = {}) {
      return runSearch({ stories, byId, vectors, db, embedder }, query, opts);
    },
  };
}

function vectorInput(row) {
  return [
    row.situation,
    row.emotions.join(' '),
    row.coping,
    row.displaySynopsis,
    row.segmentTitle,
    row.seriesTitle,
  ]
    .filter(Boolean)
    .join(' ');
}

/** Rescales an array to [0, 1]; empty arrays stay empty. */
function normalizeScores(values) {
  const max = Math.max(...values, 0);
  if (max <= 0) return values.map(() => 0);
  return values.map((v) => v / max);
}

/**
 * Facet counts over a matched set of story indexes, for the guided reply
 * chain: clarifier options derive from what the query actually matched, not
 * from the whole catalog. Sorted by count, ties alphabetical, so the same
 * result set always offers the same options.
 */
function facetCounts(stories, matchedIdx) {
  const emotions = new Map();
  const ageBands = new Map();
  const series = new Map();
  for (const i of matchedIdx) {
    const row = stories[i];
    for (const e of row.emotions) emotions.set(e, (emotions.get(e) || 0) + 1);
    if (row.ageBand) ageBands.set(row.ageBand, (ageBands.get(row.ageBand) || 0) + 1);
    // Films are not series: they never offer a series clarifier chip.
    if (row.kind !== 'film' && row.seriesTitle) series.set(row.seriesTitle, (series.get(row.seriesTitle) || 0) + 1);
  }
  const top = (map, key) => [...map.entries()]
    .map(([value, count]) => ({ [key]: value, count }))
    .sort((a, b) => b.count - a.count || String(a[key]).localeCompare(String(b[key])));
  return { emotions: top(emotions, 'term'), ageBands: top(ageBands, 'value'), series: top(series, 'title') };
}

/**
 * Fused search: FTS5 bm25 plus cosine similarity, with an emotion boost.
 * Options: { ageBand, vibe, emotions, emotionFacet, series, limit, facets }.
 * emotionFacet is a single canonical term from a filter or a guided reply: an
 * explicit parent answer, so it is a hard filter that matches any of the
 * emotions a story carries (OR within the row), exactly like age and vibe.
 * series is a hard equality filter. With facets set, the return is
 * { results, facets } where facets counts the full matched set (before the
 * limit cut).
 */
export function runSearch(index, query, opts = {}) {
  const { stories, vectors, db, embedder } = index;
  const parsed = interpretQuery(query);
  const ageBand = opts.ageBand || parsed.ageBand;
  const vibe = opts.vibe || parsed.vibe;
  const emotions = new Set([...(opts.emotions || []), ...parsed.emotions]);
  const emotionFacet = opts.emotionFacet || null;
  const series = opts.series || null;
  const limit = opts.limit || 20;

  // Hard filters first; a parent who names an age sees only that band.
  const eligible = [];
  for (let i = 0; i < stories.length; i++) {
    const row = stories[i];
    if (ageBand && row.ageBand !== ageBand) continue;
    if (vibe && row.vibe !== vibe) continue;
    // Stories may carry several emotions: the term matches any of them.
    if (emotionFacet && !row.emotions.includes(emotionFacet)) continue;
    if (series && row.seriesTitle !== series) continue;
    eligible.push(i);
  }

  // Filter-only browse (no free text): relevance has nothing to say, so the
  // raw relevance floor must not apply — by construction nothing scores above
  // it and pure-filter queries would return an empty catalog. Eligible rows
  // pass through in catalog order.
  const hasText = parsed.text.length > 0;
  const qvec = hasText ? embedder.embed(parsed.text) : null;

  let kw = new Map();
  const match = ftsMatchExpression(parsed.text);
  if (match) {
    const weights = BM25_WEIGHTS.join(', ');
    const sql = `SELECT rowid, bm25(stories_fts, ${weights}) AS score
                 FROM stories_fts
                 WHERE stories_fts MATCH ?
                 ORDER BY score`;
    for (const { rowid, score } of db.prepare(sql).all(match)) {
      // bm25 is negative in SQLite; smaller (more negative) means better.
      kw.set(rowid - 1, -score);
    }
  }

  // Raw relevance floor: an item must show real keyword or vector signal before
  // ranking. Without it, max-normalization would hand a lone survivor of a hard
  // filter a perfect score no matter how unrelated it is.
  const RAW_FLOOR = 0.2;
  const withRaw = eligible
    .map((i) => ({ i, rawKw: kw.get(i) || 0, rawVec: hasText ? cosine(qvec, vectors[i]) : 0 }))
    .filter(({ rawKw, rawVec }) => !hasText || rawKw > 0 || rawVec >= RAW_FLOOR);
  const kwScores = normalizeScores(withRaw.map((r) => r.rawKw));
  const vecScores = normalizeScores(withRaw.map((r) => r.rawVec));

  const scored = withRaw.map(({ i }, pos) => {
    const row = stories[i];
    // The 0.15 query-side boost stays for emotion words the parent typed;
    // the emotion and series facets are hard filters upstream, so no facet
    // boost is needed here.
    const emotionBoost = emotions.size && row.emotions.some((e) => emotions.has(e)) ? 0.15 : 0;
    const fused = 0.55 * kwScores[pos] + 0.45 * vecScores[pos] + emotionBoost;
    return { row, scores: { keyword: round2(kwScores[pos]), vector: round2(vecScores[pos]), fused: round2(fused) } };
  });

  scored.sort((a, b) => b.scores.fused - a.scores.fused || a.row.id.localeCompare(b.row.id));

  const results = scored.slice(0, limit).map(({ row, scores }) => ({
    id: row.id,
    // 'episode' or 'film': the card renders a film subtitle, watch label,
    // and artwork alt from this, per the Film Card Diction ruling.
    kind: row.kind || 'episode',
    seriesTitle: row.seriesTitle,
    // Film-only fields, joined from the Titles catalog at build time. Both
    // null for series rows; runtime may be null for a film too, and the
    // subtitle omits the segment rather than inventing one.
    releaseYear: row.releaseYear || null,
    runtimeMinutes: row.runtimeMinutes ?? null,
    seasonNumber: row.seasonNumber,
    episodeNumber: row.episodeNumber,
    episodeTitle: row.episodeTitle,
    segment: row.segment,
    segmentTitle: row.segmentTitle,
    situation: row.situation,
    coping: row.coping,
    emoji: row.emoji,
    emotions: row.emotions,
    ageBand: row.ageBand,
    vibe: row.vibe,
    displaySynopsis: row.displaySynopsis,
    // Phase 2: artwork and deep links. The frontend renders these only when
    // the server reports artwork mode tmdb; ARTWORK_MODE=text hides them.
    stillUrl: row.stillUrl || null,
    posterUrl: row.posterUrl || null,
    appleUrl: row.appleUrl || null,
    appleLinkKind: row.appleLinkKind || null,
    // Watch-provider fields: the frontend renders the watch label from
    // providerLabel, never a hardcoded platform string.
    provider: row.provider || null,
    providerLabel: row.providerLabel || null,
    scores,
    filters: { ageBand, vibe },
    interpreted: parsed,
  }));

  if (opts.facets) {
    return { results, matched: withRaw.length, facets: facetCounts(stories, withRaw.map(({ i }) => i)) };
  }
  return results;
}

function round2(v) {
  return Math.round(v * 1000) / 1000;
}

/** Default artifact and database locations. */
export const DATA_DIR = path.resolve('data/search');
export const ARTIFACT_PATH = path.join(DATA_DIR, 'search-artifact.json');
export const DB_PATH = path.join(DATA_DIR, 'search.db');
