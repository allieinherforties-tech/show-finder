// Pure normalization and gates for standalone-film rows (the Standalone Films
// Corpus sheet). Films join the serving corpus like story rows, but the sheet
// shape and the honesty rules differ: one row per film keyed by TMDB id, a
// live-verified Apple movie link required for every row, and year/runtime
// joined from the Titles catalog at build time so the card subtitle can read
// 'Film · 1973 · 25 min' (Film Card Diction ruling, art_GBwlVMwO).
//
// Nothing here touches the network or the filesystem.

import {
  cleanText,
  isBlank,
  normalizeAgeBand,
  normalizeEmotionCell,
  normalizeVibe,
  slugify,
} from './normalize.mjs';

/** The evidence tiers the corpus carries. Internal metadata only: never displayed. */
export const FILM_EVIDENCE_TIERS = ['synopsis_fallback', 'title_overview'];

/** The film's row in the Titles catalog: where year and runtime come from. */
export function filmCatalogByTmdbId(titlesDump) {
  const byId = new Map();
  for (const row of titlesDump?.rows || []) {
    const id = cleanText(row.tmdb_id);
    if (!id || cleanText(row.type).toLowerCase() !== 'film') continue;
    byId.set(id, {
      releaseYear: cleanText(row.release_year),
      runtimeMinutes: isBlank(row.runtime_minutes) ? null : Number(row.runtime_minutes) || null,
    });
  }
  return byId;
}

/**
 * Normalizes one raw film row. The film's title lands in seriesTitle — the
 * field every card heading renders — so the card heading is the film name.
 * The Apple link is carried as appleUrl straight from the sheet; the deep-link
 * integrity check in the build validates its shape like any other row.
 */
export function normalizeFilmRow(raw, provenance, catalogFilm) {
  const title = cleanText(raw.film_title);
  const tmdbId = cleanText(raw.tmdb_id);
  const emotions = normalizeEmotionCell(raw.emotion);
  const synopsis = cleanText(raw.synopsis);
  const perStory = cleanText(raw.per_story_synopsis);

  return {
    id: `film-${slugify(title)}-${tmdbId}`,
    kind: 'film',
    seriesTitle: title,
    tmdbId,
    seasonNumber: null,
    episodeNumber: null,
    episodeTitle: '',
    segment: null,
    segmentTitle: '',
    situation: cleanText(raw.situation),
    emotions: emotions.canonical,
    emotionOffList: emotions.offList,
    emotionDropped: emotions.dropped,
    emotionUnknown: emotions.unknown,
    coping: cleanText(raw.coping),
    ageBand: normalizeAgeBand(raw.age_band),
    vibe: normalizeVibe(raw.vibe),
    emoji: cleanText(raw.emoji),
    notes: cleanText(raw.notes),
    synopsis,
    perStorySynopsis: perStory,
    displaySynopsis: perStory || synopsis,
    // Internal only: drives no display, but the build report carries it.
    evidenceTier: cleanText(raw.evidence_tier),
    linkStatus: cleanText(raw.link_status),
    appleTvLink: cleanText(raw.apple_tv_link),
    linkVerifiedDate: cleanText(raw.apple_tv_link_verified_date),
    // Joined from the Titles catalog by TMDB id, not carried by the corpus sheet.
    releaseYear: catalogFilm?.releaseYear || '',
    runtimeMinutes: catalogFilm?.runtimeMinutes ?? null,
    provenance: {
      workbookId: provenance.workbookId,
      workbookName: provenance.workbookName,
      sheetId: provenance.sheetId,
      sheetName: provenance.sheetName,
    },
  };
}

/**
 * Per-row gate problems. The two hard rules the film PR adds: every film's
 * Apple link is live-verified (the honest-link rule — nothing indexes on an
 * unverified link), and the row joins the Titles catalog so the subtitle can
 * disambiguate same-named films by year. An empty coping or emotion field is
 * faithful upstream absence, never a problem.
 */
export function filmRowProblems(film) {
  const problems = [];
  if (!film.seriesTitle) problems.push('missing film title');
  if (!film.tmdbId) problems.push('missing TMDB id');
  if (film.linkStatus !== 'verified') {
    problems.push(`link_status is '${film.linkStatus || 'empty'}', not 'verified' (the honest-link rule)`);
  }
  if (!FILM_EVIDENCE_TIERS.includes(film.evidenceTier)) {
    problems.push(`unknown evidence tier '${film.evidenceTier || 'empty'}'`);
  }
  if (!film.releaseYear) problems.push(`no Titles-catalog film row for TMDB id ${film.tmdbId || '?'} (no release year to display)`);
  if (!film.situation) problems.push('missing situation');
  return problems;
}

/** Duplicate film ids fail the build: exactly one row per TMDB id. */
export function duplicateFilmIdProblems(films) {
  const seen = new Map();
  for (const f of films) {
    const key = f.tmdbId || '(no id)';
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(f.id);
  }
  return [...seen.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([tmdbId, ids]) => `TMDB id ${tmdbId}: ${ids.length} rows (${ids.join(', ')})`);
}
