// Apple TV+ web deep links.
//
// URL patterns verified live in the Findings: Apple TV+ Web URL Deep Links
// document (art_5OFQO4Vl): the slug is decorative, the umc.cmc id is the
// routing key, and ?showId= is canonical matching. This module is pure: no
// network, no filesystem, fully unit testable. Every URL we emit must match
// one of the verified pattern shapes; the build fails on anything malformed.
//
// Note: the findings document's risk note says ids are 22 characters, but
// every verified id in the document itself is 25 characters
// (umc.cmc. + 25). The pattern below accepts the verified shape, not the
// prose approximation.

export const APPLE_TV_BASE = 'https://tv.apple.com/us';

// umc.cmc. + opaque lowercase alphanumeric id. The verified samples range
// from 24 to 25 characters, so the pattern bounds the length rather than
// pinning one count (the findings prose said 22; the samples say otherwise).
const ID_SHAPE = 'umc\\.cmc\\.[a-z0-9]{20,32}';
const SLUG_SHAPE = '[a-z0-9-]+';

export const APPLE_LINK_PATTERNS = {
  episode: new RegExp(`^${APPLE_TV_BASE}/episode/${SLUG_SHAPE}/${ID_SHAPE}\\?showId=${ID_SHAPE}$`),
  show: new RegExp(`^${APPLE_TV_BASE}/show/${SLUG_SHAPE}/${ID_SHAPE}$`),
  movie: new RegExp(`^${APPLE_TV_BASE}/movie/${SLUG_SHAPE}/${ID_SHAPE}$`),
};

/** Classifies a URL against the verified pattern shapes, or reports it malformed. */
export function classifyAppleUrl(url) {
  for (const [kind, pattern] of Object.entries(APPLE_LINK_PATTERNS)) {
    if (pattern.test(url)) return kind;
  }
  return null;
}

/** Episode page URL. Canonical form includes the showId param (per the findings). */
export function buildEpisodeUrl(slug, episodeId, showId) {
  return withShapeCheck(
    `${APPLE_TV_BASE}/episode/${slug}/${episodeId}?showId=${showId}`,
    'episode',
  );
}

/** Show page URL. The fallback when no episode id is verified. */
export function buildShowUrl(slug, showId) {
  return withShapeCheck(`${APPLE_TV_BASE}/show/${slug}/${showId}`, 'show');
}

/** Film page URL (pattern identical to shows except the /movie/ segment). */
export function buildMovieUrl(slug, movieId) {
  return withShapeCheck(`${APPLE_TV_BASE}/movie/${slug}/${movieId}`, 'movie');
}

function withShapeCheck(url, expectedKind) {
  const kind = classifyAppleUrl(url);
  if (kind !== expectedKind) {
    throw new Error(`generated URL does not match the verified ${expectedKind} pattern: ${url}`);
  }
  return url;
}

function normalizeTitle(title) {
  return String(title || '').trim().toLowerCase();
}

/**
 * Resolves the Apple TV link for one story row against the verified registry
 * (data/source/apple-links.json, built from the findings document).
 *
 * Precedence, per the build spec and findings:
 *   1. episode level, when this exact season and episode has a verified id
 *   2. show page, when the series has a verified show id
 *   3. null, when the series has no verified pattern at all
 *
 * Returns { url, kind } or null. Never invents an id.
 */
export function appleLinkFor(story, registry) {
  if (!registry || !Array.isArray(registry.shows)) return null;
  const show = registry.shows.find((s) => normalizeTitle(s.seriesTitle) === normalizeTitle(story.seriesTitle));
  if (!show) return null;
  const episode = (show.verifiedEpisodes || []).find(
    (e) => e.seasonNumber === story.seasonNumber && e.episodeNumber === story.episodeNumber,
  );
  if (episode && episode.episodeId) {
    return { url: buildEpisodeUrl(episode.slug, episode.episodeId, show.showId), kind: 'episode' };
  }
  return { url: buildShowUrl(show.slug, show.showId), kind: 'show' };
}

/** Validates every registry entry generates a well-shaped URL. Throws on any malformed one. */
export function validateAppleRegistry(registry) {
  const problems = [];
  for (const show of registry.shows || []) {
    if (!show.seriesTitle) problems.push(`registry show missing seriesTitle: ${JSON.stringify(show)}`);
    try {
      buildShowUrl(show.slug, show.showId);
    } catch (err) {
      problems.push(`show ${show.seriesTitle || '?'}: ${err.message}`);
    }
    for (const e of show.verifiedEpisodes || []) {
      try {
        buildEpisodeUrl(e.slug, e.episodeId, show.showId);
      } catch (err) {
        problems.push(`episode ${show.seriesTitle || '?'} S${e.seasonNumber}E${e.episodeNumber}: ${err.message}`);
      }
    }
  }
  if (problems.length) throw new Error(`apple link registry validation failed:\n  ${problems.join('\n  ')}`);
  return true;
}
