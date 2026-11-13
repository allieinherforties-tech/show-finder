// Apple TV link harvester.
//
// Discovers official tv.apple.com show pages and episode IDs for the story
// catalog and updates data/source/apple-links.json. House rule: zero invented
// links. Every recorded URL is either (a) taken verbatim from Apple's own
// published sitemaps (https://tv.apple.com/robots.txt lists the sitemap
// indexes) or (b) verified live with an HTTP 200 fetch and a page-metadata
// match before it is written to the registry. A URL that cannot be verified
// is never recorded; the row stays at show-page fallback or no link.
//
// Discovery paths, in order of trust:
//   1. Sitemaps (robots-listed, allowed for crawling):
//        sitemaps_tv_index_original-show_1.xml    -> official show URLs
//        sitemaps_tv_index_original-episode_1.xml -> episode URLs with ?showId=
//   2. Episode page verification: each episode page is server-rendered and
//      carries meta apple:content_id (the episode id) and a <title> of the
//      form "Watch {episode title} - {series} (Season N, Episode M) - Apple
//      TV", which is the exact match key against the catalog row.
//
// Site etiquette: 1 request per second by default (--interval to change),
// every response body cached on disk under data/harvest-cache/ (gitignored)
// so re-runs never re-hit Apple for a URL already fetched, and the run stops
// cleanly on 403 or 429 rather than retry-storming.
//
// Usage:
//   node scripts/harvest-apple-links.mjs                     # full run
//   node scripts/harvest-apple-links.mjs --stage=sitemaps    # build sitemap index only
//   node scripts/harvest-apple-links.mjs --only="Shape Island"
//   node scripts/harvest-apple-links.mjs --interval=1500 --dry-run

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { normalizeStoryRow, isPlaceholderRow } from '../src/pipeline/normalize.mjs';

const SOURCE_DIR = path.resolve('data/source');
const CACHE_DIR = path.resolve('data/harvest-cache');
const REGISTRY_PATH = path.resolve('data/source/apple-links.json');
const REPORT_PATH = path.resolve('data/harvest/harvest-report.json');

const SITEMAP_INDEX_SHOW = 'https://tv.apple.com/sitemaps_tv_index_original-show_1.xml';
const SITEMAP_INDEX_EPISODE = 'https://tv.apple.com/sitemaps_tv_index_original-episode_1.xml';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  }),
);
const INTERVAL_MS = Number(args.interval || 1000);
const DRY_RUN = args['dry-run'] === true;
const ONLY = typeof args.only === 'string' ? args.only : null;
const STAGE = typeof args.stage === 'string' ? args.stage : 'all';

// ---------------------------------------------------------------------------
// Throttled, cached fetch. Every response is cached to disk keyed by URL hash
// so re-runs replay from disk. 403/429 aborts the run (Apple is blocking us;
// backing off is the only correct move). 5xx and network errors retry once.
// ---------------------------------------------------------------------------

let lastRequestAt = 0;
let blocked = null;

async function fetchCached(url, { interval = true } = {}) {
  const cacheKey = createHash('sha256').update(url).digest('hex').slice(0, 32);
  const bodyPath = path.join(CACHE_DIR, `${cacheKey}.body`);
  const metaPath = path.join(CACHE_DIR, `${cacheKey}.meta.json`);
  if (existsSync(bodyPath)) {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    return { ...meta, body: readFileSync(bodyPath, 'utf8'), cached: true };
  }
  if (blocked) throw new Error(`blocked earlier (${blocked}); aborting before fetching ${url}`);
  if (interval) {
    const wait = INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
  }
  // Transient network failures (DNS blips, connection resets) retry with
  // backoff instead of killing a 20-minute run that is 75% cached.
  let res = null;
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
        redirect: 'follow',
        signal: AbortSignal.timeout(45_000),
      });
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2_000 * (attempt + 1)));
    }
  }
  if (lastErr) throw new Error(`network: ${url} :: ${lastErr.cause?.code || lastErr.message}`);
  // Cache the RAW response bytes: sub-sitemaps arrive gzipped (~2MB at rest
  // vs ~40MB decompressed; the full catalog must not live in memory).
  const raw = Buffer.from(await res.arrayBuffer());
  if (res.status === 403 || res.status === 429) {
    blocked = `HTTP ${res.status} on ${url}`;
    throw new Error(`blocked: HTTP ${res.status} on ${url} (stopping cleanly; cache preserves progress)`);
  }
  if (!res.ok) console.error(`fetch: HTTP ${res.status} on ${url}`);
  const body = res.ok ? decompressIfGzip(raw).toString('utf8') : null;
  const meta = { status: res.status, finalUrl: res.url || url };
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(bodyPath, raw);
  writeFileSync(metaPath, JSON.stringify({ url, ...meta }, null, 2));
  return { ...meta, body, cached: false };
}

/** Sub-sitemap bodies are cached gzip-compressed when Apple served them gzipped. */
function decompressIfGzip(buf) {
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf;
}

function cachedBodyToText(bodyPath) {
  return decompressIfGzip(readFileSync(bodyPath)).toString('utf8');
}

// ---------------------------------------------------------------------------
// Text normalization used for all title matching. Punctuation-insensitive so
// catalog titles ("Duck & Goose", "Addy's Break/Puzzled") compare equal to
// Apple slugs ("duck-and-goose", "addys-breakpuzzled"). Matching is cheap;
// verification is the page-metadata check, so a loose matcher is safe.
// ---------------------------------------------------------------------------

export function normForMatch(s) {
  return String(s)
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '');
}

// Slug candidates for a series title: straightforward hyphenation plus the
// ampersand variants, so "Duck & Goose" also tries "duck-and-goose".
export function showSlugCandidates(title) {
  const base = String(title).trim().toLowerCase().replace(/[\u2018\u2019\u02bc]/g, "'");
  const amp = base.replace(/&/g, ' and ');
  const noAmp = base.replace(/&/g, '');
  return [...new Set([base, amp, noAmp].map((t) => t.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')))];
}

// ---------------------------------------------------------------------------
// Sitemap layer.
// ---------------------------------------------------------------------------

function parseSitemapIndexXml(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

/** One sub-sitemap: returns the canonical /us/ episode or show URLs it lists. */
/**
 * Flatten a substring: V8 regex captures are SlicedStrings that keep their
 * parent string alive — for sitemap URLs that parent is the 40MB decompressed
 * XML body. Copying to a fresh buffer lets the body be collected. Kept URLs
 * survive the scan, so every one of them must be flat.
 */
const flatString = (s) => Buffer.from(s, 'utf8').toString('utf8');

function parseSitemapUsUrls(xml) {
  const urls = new Set();
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    if (/^https:\/\/tv\.apple\.com\/us\//.test(m[1])) urls.add(flatString(m[1]));
  }
  for (const m of xml.matchAll(/<xhtml:link[^>]*hreflang="en-US"[^>]*href="([^"]+)"/g)) {
    urls.add(flatString(m[1].replace(/&amp;/g, '&')));
  }
  return [...urls];
}

/** Builds { showBySlug, showIdBySlug, episodesByShowId } from the sitemaps. */
export function buildSitemapIndexes(showUrls, episodeUrls) {
  const showBySlug = new Map(); // slug -> { showId, url }
  for (const url of showUrls) {
    const m = url.match(/^https:\/\/tv\.apple\.com\/us\/show\/([a-z0-9-]+)\/(umc\.cmc\.[a-z0-9]+)$/);
    if (m) showBySlug.set(m[1], { showId: m[2], url });
  }
  const episodesByShowId = new Map(); // showId -> Map(episodeId -> { slug, url })
  for (const url of episodeUrls) {
    const m = url.match(/^https:\/\/tv\.apple\.com\/us\/episode\/([a-z0-9-]+)\/(umc\.cmc\.[a-z0-9]+)\?showId=(umc\.cmc\.[a-z0-9]+)$/);
    if (!m) continue;
    const [, slug, episodeId, showId] = m;
    if (!episodesByShowId.has(showId)) episodesByShowId.set(showId, new Map());
    const existing = episodesByShowId.get(showId).get(episodeId);
    // The same episode can appear under slugs that differ only in
    // punctuation collapse; keep the first canonical sighting.
    if (!existing) episodesByShowId.get(showId).set(episodeId, { slug, url });
  }
  return { showBySlug, episodesByShowId };
}

const SITEMAP_LISTS_JSON = path.join(CACHE_DIR, 'sitemap-lists.json');
const SHOW_INDEX_JSON = path.join(CACHE_DIR, 'show-index.json');

/**
 * Apple ships its whole originals catalog in these sitemaps: 671 sub-files,
 * each ~40MB decompressed. Downloading caches every sub-file (compressed at
 * rest); parsing happens lazily per-file with a filter, so memory only ever
 * holds URLs relevant to our 18 series.
 */
async function ensureSitemapsCached() {
  console.log('sitemaps: downloading indexes');
  const showIndex = parseSitemapIndexXml((await fetchCached(SITEMAP_INDEX_SHOW)).body);
  const episodeIndex = parseSitemapIndexXml((await fetchCached(SITEMAP_INDEX_EPISODE)).body);
  console.log(`sitemaps: ${showIndex.length} show sub-sitemaps, ${episodeIndex.length} episode sub-sitemaps`);
  let done = 0;
  for (const url of [...showIndex, ...episodeIndex]) {
    await fetchCached(url);
    done += 1;
    if (done % 100 === 0) console.log(`sitemaps: ${done}/${showIndex.length + episodeIndex.length} sub-sitemaps cached`);
  }
  const lists = { showIndex, episodeIndex };
  writeFileSync(SITEMAP_LISTS_JSON, JSON.stringify(lists, null, 2) + '\n');
  console.log('sitemaps: all sub-sitemaps cached');
  return lists;
}

export function loadCachedSitemapLists() {
  if (!existsSync(SITEMAP_LISTS_JSON)) return null;
  return JSON.parse(readFileSync(SITEMAP_LISTS_JSON, 'utf8'));
}

/**
 * Stream cached sub-sitemap bodies one at a time and keep only URLs passing
 * the filter. Each body decompresses to ~40MB, so nothing beyond the filtered
 * output may be retained across iterations.
 */
function scanCachedSitemaps(urls, filter) {
  const kept = [];
  urls.forEach((url, i) => {
    if (i % 50 === 0) console.log(`scan: ${i}/${urls.length}`);
    const cacheKey = createHash('sha256').update(url).digest('hex').slice(0, 32);
    const bodyPath = path.join(CACHE_DIR, `${cacheKey}.body`);
    const metaPath = path.join(CACHE_DIR, `${cacheKey}.meta.json`);
    if (!existsSync(bodyPath)) return;
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    if (meta.status !== 200) return;
    for (const u of parseSitemapUsUrls(cachedBodyToText(bodyPath))) if (filter(u)) kept.push(u);
  });
  return kept;
}

// Significant title tokens for show-slug filtering: data-driven from the story
// rows (no hardcoded series list). Stopwords and short words are dropped; the
// page-metadata verification is what actually gates correctness.
const STOP_TOKENS = new Set(['the', 'and', 'an', 'a', 'of', 'in', 'with', 'to', 'at', 'on', 'for', 'show', 'tv']);

function significantSeriesTokens(rows) {
  const tokens = new Set();
  for (const title of new Set((rows || []).map((r) => r.seriesTitle))) {
    for (const w of String(title).toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length >= 3 && !STOP_TOKENS.has(w)) tokens.add(w);
    }
  }
  return tokens;
}

function urlMatchesTokens(url, tokens) {
  const m = url.match(/^https:\/\/tv\.apple\.com\/us\/show\/([a-z0-9-]+)\//);
  if (!m) return false;
  for (const t of tokens) if (m[1].includes(t)) return true;
  return false;
}

/**
 * Search-page fallback for series absent from Apple's original-show sitemaps
 * (e.g. licensed titles like Duck & Goose): Apple's own search results expose
 * show URLs. Cached fetch; a candidate must contain every significant title
 * token in its slug, and the show page is still fully verified before use.
 */
async function discoverShowViaSearch(title) {
  const tokens = [...new Set(String(title).toLowerCase().split(/[^a-z0-9]+/))]
    .filter((w) => w.length >= 3 && !STOP_TOKENS.has(w));
  const url = `https://tv.apple.com/us/search?term=${encodeURIComponent(title)}`;
  const res = await fetchCached(url);
  const evidence = { searchUrl: url, httpStatus: res.status, candidates: [], verified: false };
  if (res.status !== 200 || !res.body) return { ...evidence, reason: `HTTP ${res.status}` };
  const seen = new Set();
  for (const m of res.body.matchAll(/https:\/\/tv\.apple\.com\/us\/show\/([a-z0-9-]+)\/(umc\.cmc\.[a-z0-9]+)/g)) {
    const [ , slug, showId] = m;
    if (seen.has(showId)) continue;
    seen.add(showId);
    const slugTokens = new Set(slug.split('-'));
    if (tokens.length && tokens.every((t) => slugTokens.has(t))) evidence.candidates.push({ slug, showId });
  }
  for (const c of evidence.candidates) {
    const page = await verifyShowPage(title, c.slug, c.showId);
    evidence.pageVerification = page;
    if (page.verified) return { ...evidence, verified: true, slug: c.slug, showId: c.showId };
  }
  return { ...evidence, reason: 'no search-result show page verified' };
}

/** Show-slug candidates: scan cached show sub-sitemaps, filtered by title tokens. */
function buildShowIndex(showIndexUrls, rows) {
  const tokens = significantSeriesTokens(rows);
  const showUrls = scanCachedSitemaps(showIndexUrls, (u) => urlMatchesTokens(u, tokens));
  const { showBySlug } = buildSitemapIndexes(showUrls, []);
  console.log(`show index: ${showBySlug.size} candidate slugs from ${tokens.size} series tokens`);
  return showBySlug;
}

/** Episode index: only URLs belonging to the verified show IDs. */
export function buildEpisodeIndex(episodeIndexUrls, showIds) {
  const episodeUrls = scanCachedSitemaps(episodeIndexUrls, (u) => {
    const m = u.match(/showId=(umc\.cmc\.[a-z0-9]+)/);
    return m !== null && showIds.has(m[1]);
  });
  const { episodesByShowId } = buildSitemapIndexes([], episodeUrls);
  const totalEpisodes = [...episodesByShowId.values()].reduce((n, m) => n + m.size, 0);
  console.log(`episode index: ${totalEpisodes} episodes across ${episodesByShowId.size} shows`);
  return episodesByShowId;
}

// ---------------------------------------------------------------------------
// Live page verification.
// ---------------------------------------------------------------------------

/**
 * Normalize a page <title> for matching: strip bidi control marks anywhere and
 * turn non-breaking spaces (Apple renders "Apple\u00a0TV" in titles) into
 * regular spaces.
 */
function normalizePageTitle(t) {
  return String(t)
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
    .replace(/\u00a0/g, ' ');
}

/**
 * Verifies a show page: HTTP 200 and the schema:tv-series name matches the
 * expected series title. Returns evidence.
 */
export async function verifyShowPage(seriesTitle, slug, showId) {
  const url = `https://tv.apple.com/us/show/${slug}/${showId}`;
  const res = await fetchCached(url);
  const evidence = { url, httpStatus: res.status, expectedTitle: seriesTitle, verified: false };
  if (res.status !== 200 || !res.body) return { ...evidence, reason: `HTTP ${res.status}` };
  const m = res.body.match(/<script id=schema:tv-series type="application\/ld\+json">([\s\S]*?)<\/script>/);
  const pageTitle = (res.body.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
  evidence.pageTitle = pageTitle ? normalizePageTitle(pageTitle).trim() : null;
  if (m) {
    try {
      const schema = JSON.parse(m[1]);
      evidence.schemaName = schema.name || null;
      evidence.verified = normForMatch(schema.name) === normForMatch(seriesTitle);
    } catch {
      evidence.reason = 'schema:tv-series JSON did not parse';
    }
  } else {
    evidence.reason = 'no schema:tv-series block on page';
  }
  return evidence;
}

/**
 * Verifies one episode page against a catalog row. The page must return
 * HTTP 200, carry apple:content_id equal to the episode id, and its <title>
 * must read "Watch {title} - {series} (Season S, Episode E) - Apple TV"
 * with matching numbers and punctuation-insensitive title equality.
 */
export async function verifyEpisodePage(seriesTitle, seasonNumber, episodeNumber, episodeTitle, slug, episodeId, showId) {
  const url = `https://tv.apple.com/us/episode/${slug}/${episodeId}?showId=${showId}`;
  const res = await fetchCached(url);
  const evidence = {
    url,
    httpStatus: res.status,
    expected: { seriesTitle, seasonNumber, episodeNumber, episodeTitle },
  };
  if (res.status !== 200 || !res.body) return { ...evidence, verified: false, reason: `HTTP ${res.status}` };

  const contentId = (res.body.match(/apple:content_id" content="([^"]+)"/) || [])[1];
  evidence.contentId = contentId || null;
  if (contentId !== episodeId) return { ...evidence, verified: false, reason: `apple:content_id ${contentId} != ${episodeId}` };

  const pageTitle = (res.body.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
  evidence.pageTitle = pageTitle ? normalizePageTitle(pageTitle).trim() : null;
  const tm = evidence.pageTitle && evidence.pageTitle.match(/^Watch (.*) - (.*) \(Season (\d+), Episode (\d+)\) - Apple TV$/);
  if (!tm) return { ...evidence, verified: false, reason: `page title did not match the Watch pattern: ${evidence.pageTitle}` };
  const [ , epTitle, series, season, episode] = tm;
  evidence.pageEpisodeTitle = epTitle.trim();
  evidence.pageSeriesTitle = series.trim();
  if (Number(season) !== Number(seasonNumber) || Number(episode) !== Number(episodeNumber)) {
    return { ...evidence, verified: false, reason: `page says Season ${season} Episode ${episode}, row says ${seasonNumber} ${episodeNumber}` };
  }
  if (normForMatch(epTitle) !== normForMatch(episodeTitle)) {
    return { ...evidence, verified: false, reason: `episode title mismatch: page "${epTitle.trim()}" vs row "${episodeTitle}"` };
  }
  if (normForMatch(series) !== normForMatch(seriesTitle)) {
    return { ...evidence, verified: false, reason: `series mismatch: page "${series.trim()}" vs row "${seriesTitle}"` };
  }
  return { ...evidence, verified: true };
}

// ---------------------------------------------------------------------------
// Catalog rows and registry.
// ---------------------------------------------------------------------------

export function loadStoryRows() {
  const files = listSourceFiles();
  const rows = [];
  for (const f of files) {
    const src = JSON.parse(readFileSync(path.join(SOURCE_DIR, f), 'utf8'));
    if (src.kind !== 'stories') continue;
    for (const raw of src.rows) {
      // Mirror the build's collectStories exactly: provenance carries the
      // sheet-level defaultSeriesTitle (the Stillwater tags sheet omits
      // series_title), and placeholder rows (no situation, no synopsis) are
      // excluded — that is how the published 547-row set is defined.
      const story = normalizeStoryRow(raw, {
        workbookId: src.workbookId,
        workbookName: src.workbookName,
        sheetId: src.sheetId,
        sheetName: src.sheetName,
        defaultSeriesTitle: src.defaultSeriesTitle,
      });
      if (!story.seriesTitle || !story.episodeNumber) continue;
      if (isPlaceholderRow(story)) continue;
      const episodeTitle = String(raw.episode_title || '').trim();
      if (!episodeTitle) continue;
      rows.push({ seriesTitle: story.seriesTitle, seasonNumber: story.seasonNumber, episodeNumber: story.episodeNumber, episodeTitle });
    }
  }
  return rows;
}

function listSourceFiles() {
  return readdirSync(SOURCE_DIR).filter((f) => f.endsWith('.json') && !['manifest.json', 'apple-links.json', 'tmdb-artwork.json'].includes(f));
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });
  mkdirSync(path.dirname(REPORT_PATH), { recursive: true });

  const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
  const rows = loadStoryRows();
  const before = coverage(registry, rows);
  const beforeBySeries = coverageBySeries(registry, rows);

  let sitemaps = STAGE === 'sitemaps' || STAGE === 'all' ? await ensureSitemapsCached() : loadCachedSitemapLists();
  if (!sitemaps) {
    console.log('no cached sitemap lists; run with --stage=sitemaps first');
    process.exitCode = 1;
    return;
  }
  if (STAGE === 'sitemaps') return;

  console.log(`catalog: ${rows.length} published story rows across ${new Set(rows.map((r) => normForMatch(r.seriesTitle))).size} series`);

  // Show slugs: scan cached show sub-sitemaps filtered by title tokens. The
  // scan result is memoized in show-index.json so re-runs reuse it.
  let showBySlug;
  if (existsSync(SHOW_INDEX_JSON)) {
    showBySlug = new Map(Object.entries(JSON.parse(readFileSync(SHOW_INDEX_JSON, 'utf8'))));
    console.log(`show index: reusing ${showBySlug.size} cached candidate slugs`);
  } else {
    showBySlug = buildShowIndex(sitemaps.showIndex, rows);
    writeFileSync(SHOW_INDEX_JSON, JSON.stringify(Object.fromEntries(showBySlug), null, 2) + '\n');
  }

  // --- Show discovery for series missing from the registry -----------------
  const known = new Set((registry.shows || []).map((s) => normForMatch(s.seriesTitle)));
  const seriesNeeded = [...new Set(rows.map((r) => r.seriesTitle))]
    .filter((t) => !known.has(normForMatch(t)))
    .filter((t) => (ONLY ? normForMatch(t).includes(normForMatch(ONLY)) : true));
  const showEvidence = [];
  for (const title of seriesNeeded) {
    // Slug candidates from the title, matched against Apple's own show
    // sitemap. No guessing beyond that: an unlisted candidate is not tried.
    let entry = null;
    for (const slug of showSlugCandidates(title)) {
      if (showBySlug.has(slug)) {
        const candidate = showBySlug.get(slug);
        const evidence = await verifyShowPage(title, slug, candidate.showId);
        showEvidence.push(evidence);
        if (evidence.verified) {
          entry = { seriesTitle: title, slug, showId: candidate.showId, verifiedEpisodes: [] };
          break;
        }
      }
    }
    if (entry) {
      registry.shows.push(entry);
      console.log(`show: ${title} -> /us/show/${entry.slug}/${entry.showId} (verified)`);
    } else {
      // Sitemap discovery failed: try Apple's own search page before giving up.
      const viaSearch = await discoverShowViaSearch(title);
      if (viaSearch.verified) {
        entry = { seriesTitle: title, slug: viaSearch.slug, showId: viaSearch.showId, verifiedEpisodes: [] };
        registry.shows.push(entry);
        console.log(`show: ${title} -> /us/show/${entry.slug}/${entry.showId} (verified via search)`);
      } else {
        console.log(`show: ${title} -> NO VERIFIED SHOW PAGE; rows stay linkless (zero invented links)`);
        showEvidence.push({ expectedTitle: title, verified: false, reason: 'no sitemap slug candidate verified' });
        showEvidence.push({ expectedTitle: title, verified: false, searchFallback: true, ...viaSearch });
      }
    }
  }

  // --- Episode harvest ------------------------------------------------------
  // Episode index is built after show discovery so every verified show ID
  // participates; the scan is cache-only (no network).
  const showIds = new Set((registry.shows || []).map((s) => s.showId));
  const episodesByShowId = buildEpisodeIndex(sitemaps.episodeIndex, showIds);
  const episodeEvidence = [];
  const newEpisodes = [];
  const bySeries = new Map();
  for (const r of rows) {
    const key = normForMatch(r.seriesTitle);
    if (!bySeries.has(key)) bySeries.set(key, []);
    bySeries.get(key).push(r);
  }
  for (const show of registry.shows || []) {
    const rowsForShow = bySeries.get(normForMatch(show.seriesTitle)) || [];
    if (!rowsForShow.length) continue;
    const sitemapEps = episodesByShowId.get(show.showId) || new Map();
    const have = new Set((show.verifiedEpisodes || []).map((e) => `${e.seasonNumber}:${e.episodeNumber}`));
    for (const r of rowsForShow) {
      if (have.has(`${r.seasonNumber}:${r.episodeNumber}`)) continue;
      const candidates = [...sitemapEps.entries()].filter(([, e]) => normForMatch(e.slug) === normForMatch(r.episodeTitle));
      let verifiedEvidence = null;
      for (const [episodeId, e] of candidates) {
        const evidence = await verifyEpisodePage(r.seriesTitle, r.seasonNumber, r.episodeNumber, r.episodeTitle, e.slug, episodeId, show.showId);
        episodeEvidence.push(evidence);
        if (evidence.verified) {
          verifiedEvidence = evidence;
          break;
        }
      }
      if (verifiedEvidence) {
        if (!show.verifiedEpisodes) show.verifiedEpisodes = [];
        show.verifiedEpisodes.push({ seasonNumber: r.seasonNumber, episodeNumber: r.episodeNumber, slug: verifiedEvidence.url.match(/\/episode\/([a-z0-9-]+)\//)[1], episodeId: verifiedEvidence.contentId });
        newEpisodes.push(`${show.seriesTitle} S${r.seasonNumber}E${r.episodeNumber}`);
      } else if (!candidates.length) {
        console.log(`episode: ${show.seriesTitle} S${r.seasonNumber}E${r.episodeNumber} "${r.episodeTitle}" -> no slug candidate in Apple sitemap; stays at show fallback`);
      }
    }
  }

  // --- Coverage after, and outputs -----------------------------------------
  const after = coverage(registry, rows);
  console.log('coverage before:', JSON.stringify(before));
  console.log('coverage after: ', JSON.stringify(after));
  console.log(`new verified episode links: ${newEpisodes.length}`);

  const report = {
    kind: 'apple-link-harvest-report',
    harvestedAt: new Date().toISOString(),
    method: 'Apple robots-listed original-show and original-episode sitemaps for discovery; every recorded URL verified live (HTTP 200, apple:content_id match, page title title/series/season/episode match). No URL is invented; unmatched rows keep show fallback or no link.',
    throttling: `${INTERVAL_MS} ms between requests, responses cached in data/harvest-cache/ (gitignored)`,
    coverage: { before, after },
    coverageBySeries: { before: beforeBySeries, after: coverageBySeries(registry, rows) },
    showVerification: showEvidence,
    episodeVerification: episodeEvidence,
  };
  if (!DRY_RUN) {
    writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
    console.log(`wrote ${REGISTRY_PATH} and ${REPORT_PATH}`);
  } else {
    console.log('dry run: registry and report not written');
  }
  if (blocked) {
    console.error(`stopped on block: ${blocked}`);
    process.exitCode = 2;
  }
}

/** Coverage counts over published rows: episode-level, show-level, none. */
function coverage(registry, rows) {
  const counts = { episodeLevel: 0, showLevel: 0, none: 0 };
  const shows = registry.shows || [];
  for (const r of rows || []) {
    const show = shows.find((s) => normForMatch(s.seriesTitle) === normForMatch(r.seriesTitle));
    if (!show) counts.none += 1;
    else if ((show.verifiedEpisodes || []).some((e) => e.seasonNumber === r.seasonNumber && e.episodeNumber === r.episodeNumber)) counts.episodeLevel += 1;
    else counts.showLevel += 1;
  }
  return counts;
}

/** Per-series coverage over published rows. */
function coverageBySeries(registry, rows) {
  const bySeries = new Map();
  for (const r of rows || []) {
    const t = r.seriesTitle;
    if (!bySeries.has(t)) bySeries.set(t, { episodeLevel: 0, showLevel: 0, none: 0 });
    const show = (registry.shows || []).find((s) => normForMatch(s.seriesTitle) === normForMatch(t));
    const bucket = bySeries.get(t);
    if (!show) bucket.none += 1;
    else if ((show.verifiedEpisodes || []).some((e) => e.seasonNumber === r.seasonNumber && e.episodeNumber === r.episodeNumber)) bucket.episodeLevel += 1;
    else bucket.showLevel += 1;
  }
  return Object.fromEntries([...bySeries.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([t, c]) => [t, c]));
}

// Run only when executed directly — importing this module (tests, offline
// checks) must not trigger a live harvest.
if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exitCode = 1;
  });
}
