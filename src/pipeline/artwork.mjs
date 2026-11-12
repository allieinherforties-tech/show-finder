// Pure artwork and link joins: story rows × TMDB artwork dump × Apple link
// registry. Nothing here touches the network or the filesystem, so the build
// stays deterministic and the joins are unit testable.
//
// The artwork dump (data/source/tmdb-artwork.json) is produced offline by
// scripts/fetch-artwork.mjs, which is the only place TMDB is ever called.
// The Apple registry (data/source/apple-links.json) is transcribed from the
// verified deep-link findings. Serving consumes only what the build embeds.

import { appleLinkFor } from '../links/apple-tv.mjs';

export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

// TMDB renditions, not derivatives: a documented CDN size parameter on the
// original asset. No crops, filters, or overlays are ever applied.
export const STILL_SIZE = 'w780';
export const POSTER_SIZE = 'w342';

/** Resolves a TMDB path to a hotlinkable image.tmdb.org URL, or null. */
export function tmdbImageUrl(imageBase, tmdbPath, size) {
  if (!tmdbPath) return null;
  const p = String(tmdbPath).trim();
  if (!p) return null;
  return `${imageBase || TMDB_IMAGE_BASE}/${size}${p.startsWith('/') ? p : '/' + p}`;
}

/** Key for one episode still, keyed by TMDB series id and episode position. */
export function stillKey(seriesTmdbId, seasonNumber, episodeNumber) {
  return `${seriesTmdbId}:${seasonNumber}:${episodeNumber}`;
}

/**
 * Builds lookup structures from the committed source dumps.
 * Returns { posterByTmdbId, stillsByKey, mismatches } where mismatches lists
 * every catalog row we could not resolve, so the build report surfaces data
 * problems instead of hiding them.
 */
export function buildArtworkIndex({ artworkDump, titlesDump, episodesDump }) {
  const posterByTmdbId = new Map();
  for (const [tmdbId, path] of Object.entries(artworkDump?.posters || {})) {
    if (path) posterByTmdbId.set(String(tmdbId), path);
  }
  const stillsByKey = new Map();
  for (const [key, path] of Object.entries(artworkDump?.stills || {})) {
    if (path) stillsByKey.set(key, path);
  }

  // Series title to TMDB series id, from the Episodes sheet (it carries
  // series_tmdb_id; the Titles sheet mixes films and series).
  const seriesTmdbIdByTitle = new Map();
  const conflicts = [];
  for (const row of episodesDump?.rows || []) {
    const title = String(row.series_title || '').trim();
    const id = String(row.series_tmdb_id || '').trim();
    if (!title || !id) continue;
    if (seriesTmdbIdByTitle.has(title) && seriesTmdbIdByTitle.get(title) !== id) {
      conflicts.push(`${title}: both ${seriesTmdbIdByTitle.get(title)} and ${id} appear in the Episodes sheet`);
    }
    seriesTmdbIdByTitle.set(title, id);
  }

  // Cross-check: Titles sheet ids of type Series should agree with the
  // Episodes sheet mapping. Any disagreement is a mismatch to report.
  const mismatches = [...conflicts];
  for (const t of titlesDump?.rows || []) {
    if (String(t.type || '').trim() !== 'Series') continue;
    const title = String(t.title || '').trim();
    const id = String(t.tmdb_id || '').trim();
    if (seriesTmdbIdByTitle.has(title) && seriesTmdbIdByTitle.get(title) !== id) {
      mismatches.push(`${title}: Titles sheet says tmdb ${id}, Episodes sheet says ${seriesTmdbIdByTitle.get(title)}`);
    }
  }

  return { posterByTmdbId, stillsByKey, seriesTmdbIdByTitle, mismatches };
}

/**
 * Attaches artwork and Apple links to one story row, mutating it in place.
 * Falls back per the approved plan: episode still first, series poster
 * second, nothing (text-only) last. Apple links: verified episode id first,
 * verified show page second, no link at all rather than an invented id.
 */
export function attachArtworkAndLink(story, artworkIndex, appleRegistry) {
  const imageBase = TMDB_IMAGE_BASE;
  const seriesTmdbId = artworkIndex.seriesTmdbIdByTitle.get(story.seriesTitle) || null;
  const stillPath = seriesTmdbId
    ? artworkIndex.stillsByKey.get(stillKey(seriesTmdbId, story.seasonNumber, story.episodeNumber)) || null
    : null;
  const posterPath = seriesTmdbId ? artworkIndex.posterByTmdbId.get(seriesTmdbId) || null : null;

  story.stillUrl = tmdbImageUrl(imageBase, stillPath, STILL_SIZE);
  story.posterUrl = tmdbImageUrl(imageBase, posterPath, POSTER_SIZE);
  story.artworkSourceId = seriesTmdbId;

  const link = appleLinkFor(story, appleRegistry);
  story.appleUrl = link ? link.url : null;
  story.appleLinkKind = link ? link.kind : null;
  return story;
}

/**
 * Attaches artwork and links to every story, and returns a coverage summary
 * for the build report: stills found, poster fallbacks, missing artwork, link
 * kinds, and any series whose catalog join failed.
 */
export function attachAll(stories, artworkIndex, appleRegistry) {
  const unresolvedSeries = new Set();
  let withStill = 0;
  let posterFallback = 0;
  let noArtwork = 0;
  let episodeLinks = 0;
  let showLinks = 0;
  let noLink = 0;

  for (const s of stories) {
    attachArtworkAndLink(s, artworkIndex, appleRegistry);
    if (s.stillUrl) withStill += 1;
    else if (s.posterUrl) posterFallback += 1;
    else noArtwork += 1;
    if (!s.artworkSourceId) unresolvedSeries.add(s.seriesTitle);
    if (s.appleLinkKind === 'episode') episodeLinks += 1;
    else if (s.appleLinkKind === 'show') showLinks += 1;
    else noLink += 1;
  }

  return {
    stills: withStill,
    posterFallback,
    noArtwork,
    episodeLinks,
    showLinks,
    noLink,
    unresolvedSeries: [...unresolvedSeries].sort(),
    mismatches: artworkIndex.mismatches,
  };
}
