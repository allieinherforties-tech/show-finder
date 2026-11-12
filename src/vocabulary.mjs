// Canonical emotion vocabulary and query-side synonym mapping.
//
// Provenance (2026-11-12): 19 canonical terms are observed in the tagged story
// corpus (Stillwater tags, Camp Snoopy, Batch 1 Series, Wave 3 Batches 1 and 2).
// Project memory records the ratified list growing from 18 to 21 terms by
// adding envy, homesickness, and guilt; homesick and guilty appear in the
// corpus, envy does not yet. The exact canonical spelling of the final ratified
// terms is unconfirmed, so the list below is corpus derived plus 'envy' and
// must be reconciled with the ratified 21-term list before Phase 2. Unknown
// terms surface in the build validation report instead of failing silently.

/** Canonical emotion terms, lowercase. */
export const EMOTION_TERMS = Object.freeze([
  'happy',
  'nervous/worried',
  'frustrated',
  'sad',
  'confused',
  'proud',
  'disappointed',
  'brave',
  'embarrassed',
  'scared',
  'lonely',
  'angry',
  'calm',
  'guilty',
  'jealous',
  'impatient',
  'bored',
  'hopeless',
  'homesick',
  'envy',
]);

/** Set view of the canonical list, for membership checks at classification time. */
export const CANONICAL_EMOTIONS = new Set(EMOTION_TERMS);

/**
 * Terms the Emotion Vocabulary Delta (art_0mCPMyqN) leaves allowed as
 * non-list words: real feelings that sit close to list terms and stay
 * permitted under the standing rule (a good-fitting non-list word beats a
 * forced list word).
 */
export const NON_LIST_ALLOWED = Object.freeze([
  'annoyance',
  'regret',
  'compassion',
  'disbelief',
  'self-doubt',
  'silly',
]);

/**
 * Trait and mindset words are themes, not feelings. The Delta routes them to
 * notes, so normalization drops them from the emotion column while the words
 * stay searchable in the keyword text.
 */
export const TRAIT_WORDS = Object.freeze([
  'growth mindset',
  'fixed mindset',
  'stubbornness',
  'impulsiveness',
  'selflessness',
  'misalignment',
  'growing pains',
  'stuck in the past',
  'growth',
  'unbridled optimism that pays off',
]);

/** Canonical spellings for variant emotion words found in the corpus. */
export const EMOTION_SYNONYMS = Object.freeze({
  'disappointment': 'disappointed',
  'confusion': 'confused',
  'fear': 'scared',
  'fear of the unknown': 'scared',
  'loneliness': 'lonely',
  'anger': 'angry',
  'frustration': 'frustrated',
  'helplessness': 'hopeless',
  'shame': 'embarrassed',
  'shame/embarrassment': 'embarrassed',
  'embarassed': 'embarrassed',
  'homesickness': 'homesick',
  'guilt': 'guilty',
  'envy': 'envy',
  'jealousy': 'jealous',
});

/** Parent language to canonical emotion, used at query time. Canonical single-word terms map to themselves so an exact feeling word still triggers the emotion boost. */
export const QUERY_EMOTION_SYNONYMS = Object.freeze({
  'worried': 'nervous/worried',
  'anxious': 'nervous/worried',
  'nervous': 'nervous/worried',
  'afraid': 'scared',
  'frightened': 'scared',
  'terrified': 'scared',
  'fearful': 'scared',
  'scared': 'scared',
  'upset': 'sad',
  'sad': 'sad',
  'mad': 'angry',
  'furious': 'angry',
  'angry': 'angry',
  'frustration': 'frustrated',
  'frustrated': 'frustrated',
  'ashamed': 'embarrassed',
  'shame': 'embarrassed',
  'humiliated': 'embarrassed',
  'embarrassment': 'embarrassed',
  'embarrassed': 'embarrassed',
  'let down': 'disappointed',
  'disappointment': 'disappointed',
  'disappointed': 'disappointed',
  'alone': 'lonely',
  'lonely': 'lonely',
  'left out': 'lonely',
  'envious': 'jealous',
  'jealous': 'jealous',
  'guilt': 'guilty',
  'guilty': 'guilty',
  'bored': 'bored',
  'impatient': 'impatient',
  'helpless': 'hopeless',
  'hopeless': 'hopeless',
  'homesick': 'homesick',
  'confused': 'confused',
  'brave': 'brave',
  'courageous': 'brave',
  'proud': 'proud',
  'joyful': 'happy',
  'excited': 'happy',
  'happy': 'happy',
});

export const AGE_BANDS = Object.freeze(['2-4', '5-7', '8-10']);
export const VIBES = Object.freeze(['calm', 'silly', 'energetic']);

/** Maps a number (a stated kid age) to its age band, or null when out of range. */
export function ageToBand(age) {
  const n = Number(age);
  if (!Number.isInteger(n)) return null;
  if (n >= 2 && n <= 4) return '2-4';
  if (n >= 5 && n <= 7) return '5-7';
  if (n >= 8 && n <= 10) return '8-10';
  return null;
}
