// Pure join between the craft wave 2 story rows (workbook wb_cSVkwzvY: crafted
// story lead, resolution, and evidence note per row) and the accepted upstream
// tag corpus (the per-batch tagging workbooks plus the accepted Batch 14 dev
// sets and the two Wave 3 sheets that cover series with no batch workbook).
// Like every other join in src/pipeline, nothing here touches the network or
// the filesystem, so the join is unit testable and the build stays
// deterministic.
//
// The join keys on series_title + season_number + episode_number. Multi-story
// episodes disambiguate by normalized segment_title, because the tag sheets
// key segments inconsistently (Wonder Pets slash-joins the segment column,
// Fraggle Rock leaves it null) while segment_title agrees on both sides. A
// craft row with no tag row, or with two or more indistinguishable candidates,
// is a problem: the build fails fast rather than shipping a half-tagged row.
// Nothing is ever invented for a missing value; faithful upstream absence
// stays absent and is reported.
//
// Parent-facing mapping per the house rules: the craft story_lead is the
// per-story display synopsis, the craft resolution fills the coping field key
// (UI label: Resolution), and the tag row supplies the discovery tags
// (situation, emotion, age_band, vibe, emoji, topics). The evidence note never
// renders: it classifies into a structured evidence tier and travels as
// internal provenance only.

import {
  cleanText,
  normalizeAgeBand,
  normalizeEmotionCell,
  normalizeVibe,
  slugify as slugKey,
} from './normalize.mjs';

/**
 * Evidence tier for one craft row, classified from its verbatim evidence note.
 * The note is authored prose, so the classifier keys on the tier phrases the
 * craft wave opens with. Returns 'script', 'synopsis_fallback',
 * 'title_overview', or 'unclassified'.
 */
export function classifyEvidenceNote(note) {
  const text = String(note || '').toLowerCase();
  if (!text.trim()) return 'unclassified';
  if (/title-overview|title overview|title_overview/.test(text)) return 'title_overview';
  if (/synopsis[- ]only|synopsis[- ]fallback/.test(text)) return 'synopsis_fallback';
  if (/script/.test(text)) return 'script';
  return 'unclassified';
}

/** Normalized segment title for join disambiguation: letters and digits only. */
function normalizedSegmentTitle(row) {
  return String(row.segment_title || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Episode-level group key: series + season + episode. Segment disambiguation happens after. */
export function craftJoinKey(row) {
  return [
    slugKey(cleanText(row.series_title)),
    's' + cleanText(row.season_number),
    'e' + cleanText(row.episode_number),
  ].join('|');
}

/** Full story key: the episode key plus the normalized segment title. Two
 * craft rows share it only when they describe the same story twice, which is
 * a data problem; two rows for the same episode with different segment
 * titles are the normal multi-story case. */
export function craftStoryKey(row) {
  const seg = normalizedSegmentTitle(row).replace(/\s+/g, ' ');
  return `${craftJoinKey(row)}|${seg}`;
}

/**
 * Tag rows are filtered per source sheet at the config level: a sheet can be
 * restricted to one series (the Tagging Batch 14 sheet mixes Yo Gabba Gabba!
 * with The Peanuts Classics) and can drop rows the curation thread retired in
 * place (the 23 phantom Peanuts rows carry a RETIRED note prefix). A filter
 * never rewrites a kept row.
 */
export function filterTagRows(rows, { seriesFilter = null, retiredNotePrefix = null } = {}) {
  return (rows || []).filter((row) => {
    if (seriesFilter && cleanText(row.series_title) !== seriesFilter) return false;
    if (retiredNotePrefix && String(row.notes || '').trim().startsWith(retiredNotePrefix)) return false;
    return true;
  });
}

/**
 * Joins craft rows to tag rows. Returns { pairs, problems, coverage } where
 * pairs is one { craft, tag } entry per joined row; problems is a list of
 * fail-fast complaints (unmatched craft rows, ambiguous candidates, duplicate
 * craft keys); coverage counts what the build report publishes.
 */
export function joinCraftToTags(craftRows, tagRows) {
  const problems = [];
  const pairs = [];

  const seenStory = new Set();
  for (const craft of craftRows || []) {
    const key = craftStoryKey(craft);
    if (seenStory.has(key)) {
      problems.push(`duplicate craft story ${key} (the same segment title appears twice for one episode)`);
    }
    seenStory.add(key);
  }

  const tagsByKey = new Map();
  for (const tag of tagRows || []) {
    const key = craftJoinKey(tag);
    if (!tagsByKey.has(key)) tagsByKey.set(key, []);
    tagsByKey.get(key).push(tag);
  }

  const unmatched = [];
  const ambiguous = [];
  for (const craft of craftRows || []) {
    const key = craftJoinKey(craft);
    const candidates = tagsByKey.get(key) || [];
    let tag = null;
    if (candidates.length === 1) {
      tag = candidates[0];
    } else if (candidates.length > 1) {
      const segTitle = normalizedSegmentTitle(craft);
      const bySegTitle = candidates.filter((c) => normalizedSegmentTitle(c) === segTitle);
      if (bySegTitle.length === 1) {
        tag = bySegTitle[0];
      } else {
        ambiguous.push(`${craft.series_title} s${craft.season_number}e${craft.episode_number}: ${bySegTitle.length} tag rows share the segment title "${craft.segment_title || ''}"`);
        continue;
      }
    } else {
      unmatched.push(`${craft.series_title} s${craft.season_number}e${craft.episode_number}: no tag row`);
      continue;
    }
    pairs.push({ craft, tag });
  }

  problems.push(...unmatched, ...ambiguous);

  const usedTagKeys = new Set(pairs.map(({ tag }) => craftJoinKey(tag)));
  const unusedTagRows = (tagRows || []).filter((tag) => !usedTagKeys.has(craftJoinKey(tag)));

  return { pairs, problems, unmatched, ambiguous, unusedTagRows };
}

/**
 * Builds one published story row from a joined { craft, tag } pair. The
 * pipeline consumes only joined rows; a missing tag row never reaches here.
 * Evidence tier and evidence note are internal provenance: the note is stored
 * on the row but never rendered and never searched.
 */
export function buildCraftStory({ craft, tag }, provenance) {
  const seriesTitle = cleanText(craft.series_title);
  const season = cleanText(craft.season_number);
  const episode = cleanText(craft.episode_number);
  const segmentRaw = cleanText(craft.segment);
  const segment = segmentRaw ? Number(segmentRaw) : null;
  const emotions = normalizeEmotionCell(tag.emotion);
  const storyLead = cleanText(craft.story_lead);
  const resolution = cleanText(craft.resolution);

  const id = [
    slugKey(seriesTitle),
    's' + season,
    'e' + episode,
    segment ? 'seg' + segment : '',
  ].filter(Boolean).join('-');

  return {
    id,
    kind: 'episode',
    seriesTitle,
    seasonNumber: Number(season) || null,
    episodeNumber: Number(episode) || null,
    episodeTitle: cleanText(tag.episode_title),
    segment,
    segmentTitle: cleanText(craft.segment_title),
    situation: cleanText(tag.situation),
    emotions: emotions.canonical,
    emotionOffList: emotions.offList,
    emotionDropped: emotions.dropped,
    emotionUnknown: emotions.unknown,
    coping: resolution,
    ageBand: normalizeAgeBand(tag.age_band),
    vibe: normalizeVibe(tag.vibe),
    emoji: cleanText(tag.emoji),
    topics: cleanText(tag.topics),
    notes: '',
    synopsis: '',
    perStorySynopsis: storyLead,
    displaySynopsis: storyLead,
    evidenceTier: classifyEvidenceNote(craft.evidence_note),
    evidenceNote: cleanText(craft.evidence_note),
    provenance,
  };
}
