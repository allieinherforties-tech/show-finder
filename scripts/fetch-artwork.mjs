// Offline TMDB artwork enrichment. Build time only: this script is the ONLY
// place in the repo that calls TMDB, and it is never run by the server or in
// CI. It writes a committed source dump (data/source/tmdb-artwork.json) that
// the build consumes exactly like the workbook dumps, so the serving path
// stays network free and the rebuild stays byte reproducible.
//
// Usage:
//   TMDB_API_KEY=... node scripts/fetch-artwork.mjs
// The key comes from the environment (SECRET_TMDB_API_KEY when injected).
// The key is never written to disk, never logged, and never appears in the
// output dump.
//
// What it fetches:
//   - /3/tv/{id}              per catalog series: current poster_path
//   - /3/tv/{id}/season/{n}   per catalog season: still_path per episode
//   - /3/movie/{id}           per catalog film: current poster_path
//
// Anything TMDB cannot resolve (unknown season, absent still) is recorded in
// the dump's "missing" list rather than failing the run, so one hole does not
// block the whole catalog. A failed auth check is fatal.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const SOURCE_DIR = path.resolve('data/source');
const OUT_PATH = path.join(SOURCE_DIR, 'tmdb-artwork.json');
const API_BASE = 'https://api.themoviedb.org/3';
const CONCURRENCY = 6;

// Simple concurrency-capped fetch pool. A polite rate keeps us well inside
// TMDB's limits for the roughly 200 requests this catalog needs.
async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function apiKey() {
  const key = process.env.TMDB_API_KEY || process.env.SECRET_TMDB_API_KEY;
  if (!key) {
    throw new Error('TMDB API key missing: set TMDB_API_KEY (injected as SECRET_TMDB_API_KEY). Refusing to run.');
  }
  return key;
}

// The stored key may be either a v3 API key (32 hex characters, passed as the
// api_key query param) or a v4 read access token (JWT, passed as a Bearer
// header). Both are supported; TMDB v3 keys are the common case here.
function isV3Key(key) {
  return /^[0-9a-f]{32}$/i.test(key.trim());
}

async function tmdbGet(key, urlPath, params = {}) {
  const url = new URL(`${API_BASE}${urlPath}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = { accept: 'application/json' };
  if (isV3Key(key)) {
    url.searchParams.set('api_key', key.trim());
  } else {
    // The key goes only in this header, only to TMDB.
    headers.Authorization = `Bearer ${key.trim()}`;
  }
  const res = await fetch(url, { headers });
  if (res.status === 401) throw new Error('TMDB rejected the key (401). Check TMDB_API_KEY. The key is never printed.');
  if (res.status === 404) return { notFound: true };
  if (!res.ok) throw new Error(`TMDB request failed: ${urlPath} status ${res.status}`);
  return res.json();
}

function readDump(suffix) {
  const file = path.join(SOURCE_DIR, suffix);
  return JSON.parse(readFileSync(file, 'utf8'));
}

async function main() {
  const key = apiKey();
  const titles = readDump('wb_itf7wG3d_sh_hcJ3tSMs.json');
  const episodes = readDump('wb_itf7wG3d_sh_Upf0OvWu.json');

  const filmRows = titles.rows.filter((t) => String(t.type).trim() === 'Film');

  // Unique (series_tmdb_id, season_number) pairs from the Episodes sheet.
  const seasons = new Map();
  for (const row of episodes.rows) {
    const seriesId = String(row.series_tmdb_id || '').trim();
    const season = Number(row.season_number);
    if (!seriesId || !Number.isFinite(season)) continue;
    if (!seasons.has(seriesId)) seasons.set(seriesId, new Set());
    seasons.get(seriesId).add(season);
  }

  const missing = [];
  const posters = {};
  const stills = {};

  // 1. Series posters, one request per series.
  const seriesIds = [...seasons.keys()];
  await mapPool(seriesIds, CONCURRENCY, async (id) => {
    const detail = await tmdbGet(key, `/tv/${id}`);
    if (detail.notFound) {
      missing.push(`tv ${id}: not found on TMDB`);
      return;
    }
    if (detail.poster_path) posters[id] = detail.poster_path;
    else missing.push(`tv ${id}: no poster_path`);
  });
  process.stdout.write(`series posters: ${Object.keys(posters).length}/${seriesIds.length}\n`);

  // 2. Episode stills, one request per season.
  const seasonList = [];
  for (const [seriesId, seasonNums] of seasons) {
    for (const n of [...seasonNums].sort((a, b) => a - b)) seasonList.push({ seriesId, season: n });
  }
  let stillFetched = 0;
  await mapPool(seasonList, CONCURRENCY, async ({ seriesId, season }) => {
    const detail = await tmdbGet(key, `/tv/${seriesId}/season/${season}`);
    if (detail.notFound) {
      missing.push(`tv ${seriesId} season ${season}: not found on TMDB`);
      return;
    }
    for (const ep of detail.episodes || []) {
      const num = ep.episode_number;
      if (!Number.isFinite(num)) continue;
      if (ep.still_path) {
        stills[`${seriesId}:${season}:${num}`] = ep.still_path;
        stillFetched += 1;
      } else {
        missing.push(`tv ${seriesId} S${season}E${num}: no still_path`);
      }
    }
  });
  process.stdout.write(`episode stills: ${stillFetched} across ${seasonList.length} seasons\n`);

  // 3. Film posters, one request per film.
  await mapPool(filmRows, CONCURRENCY, async (t) => {
    const id = String(t.tmdb_id || '').trim();
    if (!id) return;
    const detail = await tmdbGet(key, `/movie/${id}`);
    if (detail.notFound) {
      missing.push(`movie ${id} (${t.title}): not found on TMDB`);
      return;
    }
    if (detail.poster_path) posters[id] = detail.poster_path;
    else missing.push(`movie ${id} (${t.title}): no poster_path`);
  });

  const dump = {
    kind: 'tmdb-artwork',
    source: 'TMDB API v3, fetched offline by scripts/fetch-artwork.mjs. Build time only; never called in the serving path.',
    imageBase: 'https://image.tmdb.org/t/p',
    posters,
    stills,
    missing: missing.sort(),
  };
  mkdirSync(SOURCE_DIR, { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(dump, null, 2) + '\n');
  console.log(`wrote ${OUT_PATH}`);
  console.log(`posters: ${Object.keys(posters).length}, stills: ${Object.keys(stills).length}, missing: ${missing.length}`);
}

main();
