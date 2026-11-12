// Pure normalization for story rows coming out of the dev-set workbooks.
// Nothing here touches the network or the filesystem, so the build is
// deterministic and unit-testable.

import {
  CANONICAL_EMOTIONS,
  EMOTION_SYNONYMS,
  NON_LIST_ALLOWED,
  TRAIT_WORDS,
  AGE_BANDS,
  VIBES,
} from '../vocabulary.mjs';

const EMPTY = new Set(['', 'none', 'null', 'n/a', 'na', '-']);

/** True when a cell holds no usable value, including the literal "None" strings the Golden Set template uses. */
export function isBlank(value) {
  return value === null || value === undefined || EMPTY.has(String(value).trim().toLowerCase());
}

/** Trims and collapses whitespace; returns '' for blank input. */
export function cleanText(value) {
  if (isBlank(value)) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

/**
 * Normalizes one raw emotion cell into an object with canonical tags plus
 * what was dropped or kept off-list, so the build can report vocabulary drift
 * instead of hiding it.
 */
export function normalizeEmotionCell(raw) {
  const cell = cleanText(raw);
  if (!cell) return { canonical: [], offList: [], dropped: [], unknown: [] };
  const canonical = new Set();
  const offList = new Set();
  const dropped = new Set();
  const unknown = new Set();
  for (const piece of cell.split(/[,;&]| and /i)) {
    let term = piece.trim().toLowerCase();
    if (!term) continue;
    if (EMOTION_SYNONYMS[term]) {
      canonical.add(EMOTION_SYNONYMS[term]);
      continue;
    }
    if (CANONICAL_EMOTIONS.has(term)) {
      canonical.add(term);
      continue;
    }
    if (TRAIT_WORDS.includes(term)) {
      dropped.add(term);
      continue;
    }
    if (term === 'nervous/worried') {
      canonical.add('nervous/worried');
      continue;
    }
    // The corpus writes some pairs as a slash join; treat each side as its own term.
    if (term.includes('/')) {
      for (const side of term.split('/')) {
        const s = side.trim();
        if (!s) continue;
        if (EMOTION_SYNONYMS[s]) canonical.add(EMOTION_SYNONYMS[s]);
        else if (s === 'nervous' || s === 'worried') canonical.add('nervous/worried');
        else offList.add(s);
      }
      continue;
    }
    if (NON_LIST_ALLOWED.includes(term)) {
      offList.add(term);
      continue;
    }
    unknown.add(term);
  }
  return {
    canonical: [...canonical],
    offList: [...offList],
    dropped: [...dropped],
    unknown: [...unknown],
  };
}

/** Normalizes an age band cell to one of the three ratified bands, or ''. */
export function normalizeAgeBand(raw) {
  const cell = cleanText(raw).replace(/[\u2010-\u2015]/g, '-').replace(/\s/g, '');
  if (!cell) return '';
  if (AGE_BANDS.includes(cell)) return cell;
  const single = cell.match(/^(\d{1,2})$/);
  if (single) {
    const n = Number(single[1]);
    if (n >= 2 && n <= 4) return '2-4';
    if (n >= 5 && n <= 7) return '5-7';
    if (n >= 8 && n <= 10) return '8-10';
  }
  return '';
}

/** Normalizes a vibe cell to the ratified enum, or ''. */
export function normalizeVibe(raw) {
  const cell = cleanText(raw).toLowerCase();
  return VIBES.includes(cell) ? cell : '';
}

/** Kebab-case slug for ids. */
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Matches the curation thread's marker on title-level rows with no source text to assess. */
const NOT_ASSESSED = /^not assessed:/i;

/**
 * True for a title-level placeholder row: the curation thread flagged it for
 * review and there is no situation text or tag set behind it yet. Placeholders
 * never publish; a parent must never hit a card with nothing on it.
 */
export function isPlaceholderRow(story) {
  return Boolean(story)
    && (!story.situation || NOT_ASSESSED.test(story.situation))
    && !story.emotions.length
    && !story.ageBand
    && !story.vibe
    && !story.emoji
    && !story.coping;
}

/**
 * Spec gate for published rows: a story row must carry a real situation and a
 * full tag set (age band, vibe, emoji, coping) before it can ship. Returns the
 * list of missing fields; an empty list means the row conforms.
 */
export function publishProblems(story) {
  const problems = [];
  if (!story.situation || NOT_ASSESSED.test(story.situation)) problems.push('situation');
  if (!story.ageBand) problems.push('age band');
  if (!story.vibe) problems.push('vibe');
  if (!story.emoji) problems.push('emoji');
  if (!story.coping) problems.push('coping');
  return problems;
}

/**
 * Normalizes one raw story row. `provenance` carries the source workbook and
 * sheet ids for the artifact manifest. The display synopsis follows the
 * story-first rule: per_story_synopsis, when the source has one, is written to
 * lead with the story a parent is searching for, even for a second segment.
 */
export function normalizeStoryRow(raw, provenance) {
  const seriesTitle = cleanText(raw.series_title) || cleanText(provenance.defaultSeriesTitle);
  const season = cleanText(raw.season_number);
  const episode = cleanText(raw.episode_number);
  const segmentRaw = cleanText(raw.segment);
  const segment = segmentRaw ? Number(segmentRaw) : null;
  const emotions = normalizeEmotionCell(raw.emotion);
  const ageBand = normalizeAgeBand(raw.age_band);
  const vibe = normalizeVibe(raw.vibe);
  const synopsis = cleanText(raw.synopsis);
  const perStory = cleanText(raw.per_story_synopsis);
  const displaySynopsis = perStory || synopsis;

  const id = [
    slugify(seriesTitle),
    's' + season,
    'e' + episode,
    segment ? 'seg' + segment : '',
  ].filter(Boolean).join('-');

  return {
    id,
    seriesTitle,
    seasonNumber: Number(season) || null,
    episodeNumber: Number(episode) || null,
    episodeTitle: cleanText(raw.episode_title),
    segment,
    segmentTitle: cleanText(raw.segment_title),
    situation: cleanText(raw.situation),
    emotions: emotions.canonical,
    emotionOffList: emotions.offList,
    emotionDropped: emotions.dropped,
    emotionUnknown: emotions.unknown,
    coping: cleanText(raw.coping),
    ageBand,
    vibe,
    emoji: cleanText(raw.emoji),
    notes: cleanText(raw.notes),
    synopsis,
    perStorySynopsis: perStory,
    displaySynopsis,
    provenance: {
      workbookId: provenance.workbookId,
      workbookName: provenance.workbookName,
      sheetId: provenance.sheetId,
      sheetName: provenance.sheetName,
    },
  };
}

/** Concatenates the searchable text of a story row for the keyword index and the embedder. */
export function searchableText(row) {
  return [
    row.situation,
    row.emotions.join(', '),
    row.emotionOffList.join(', '),
    row.coping,
    row.displaySynopsis,
    row.segmentTitle,
    row.episodeTitle,
    row.seriesTitle,
    row.notes,
  ]
    .filter(Boolean)
    .join(' ');
}
