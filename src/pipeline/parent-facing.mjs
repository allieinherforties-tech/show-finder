// Parent-facing gate: what a parent may see on a story card. The workbook
// curation rows carry internal QA prose (fallback markers, review flags) in
// the same cells as the parent-facing text, so the render path cannot tell
// them apart. This module can. Two rules, from Allie's 2026-11-14 feedback:
//
//   1. A row whose parent-facing fields carry internal annotation language
//      never renders: the annotation IS the content there, and stripping it
//      would leave unverified text dressed as curated copy.
//   2. A row whose resolution was never script-verified (the curation notes
//      flag a synopsis-only fallback) never renders. The card presents the
//      resolution as a screened fact; an inferred one must go back to
//      curation instead.
//
// Rows whose notes discuss a script comparison (script_vs_synopsis:) were
// script-assessed; a passing mention of synopsis-only tagging in that
// discussion is not a fallback flag.

/** Every field the UI renders, directly or through the display synopsis. */
export const PARENT_FACING_TEXT_FIELDS = [
  'episodeTitle',
  'segmentTitle',
  'situation',
  'coping',
  'synopsis',
  'perStorySynopsis',
  'displaySynopsis',
];

/** Marker prose that belongs in the QA layer, never on a parent's screen. */
const INTERNAL_ANNOTATION = /synopsis[- ]only|needs allie|see notes|not assessed/i;

/** Notes wording that says this row's tags were inferred, not script-verified. */
const SYNOPSIS_FALLBACK = /synopsis[- ]only|synopsis[- ]fallback|inferred from the catalog synopsis|not script-verified|not a screened fact/i;

/** Notes wording that says a script was assessed after all. */
const SCRIPT_EVIDENCE = /script_vs_synopsis\s*:/i;

/**
 * The internal annotation markers sitting inside a row's parent-facing
 * fields. Returns a list of { field, match } describing exactly what leaked.
 */
export function internalAnnotationHits(story) {
  const hits = [];
  for (const field of PARENT_FACING_TEXT_FIELDS) {
    const text = story ? story[field] : undefined;
    if (typeof text === 'string' && INTERNAL_ANNOTATION.test(text)) {
      hits.push({ field, match: text.match(INTERNAL_ANNOTATION)[0] });
    }
  }
  return hits;
}

/**
 * True when the row's resolution is an unverified inference: the curation
 * notes describe a synopsis-only fallback and the row carries no evidence a
 * script was ever assessed.
 */
export function hasUnverifiedResolution(story) {
  const notes = story && typeof story.notes === 'string' ? story.notes : '';
  return !SCRIPT_EVIDENCE.test(notes) && SYNOPSIS_FALLBACK.test(notes);
}

/**
 * Why this row must not render to a parent. An empty list means the row's
 * parent-facing fields are clean and its resolution is script-backed.
 */
export function suppressionReasons(story) {
  const reasons = [];
  for (const hit of internalAnnotationHits(story)) {
    reasons.push(`internal annotation in parent-facing field ${hit.field}: ${hit.match}`);
  }
  if (hasUnverifiedResolution(story)) {
    reasons.push('unverified resolution: synopsis-fallback row with no script evidence, flagged back to curation');
  }
  return reasons;
}
