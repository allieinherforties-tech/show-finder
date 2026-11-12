// Query interpretation at the edge, mojirama's Clef pattern in miniature:
// a parent's sentence becomes typed answers (age band, vibe, emotions) that
// drive filters and boosts, while the raw text still goes to the keyword and
// vector indexes untouched.

import { QUERY_EMOTION_SYNONYMS, ageToBand, VIBES } from '../vocabulary.mjs';
import { tokenize } from './embedder.mjs';

const AGE_PATTERNS = [
  /\bages?\s*:?\s*(\d{1,2})\b/i,
  /\b(\d{1,2})\s*(?:years?|yrs?)\s*old\b/i,
  /\b(?:she|he|they|kid|child)['']?s?\s*(?:is\s*)?(\d{1,2})\b/i,
  /\bis\s+(\d{1,2})\b/i,
  /\bband\s*(2-4|5-7|8-10)\b/i,
];

const VIBE_SYNONYMS = {
  calm: 'calm',
  relaxing: 'calm',
  quiet: 'calm',
  gentle: 'calm',
  silly: 'silly',
  funny: 'silly',
  goofy: 'silly',
  energetic: 'energetic',
  active: 'energetic',
};

/**
 * Parses a parent query into { text, ageBand, vibe, emotions }.
 * text is the full original query (filters refine ranking, they do not
 * subtract from what the indexes see).
 */
export function interpretQuery(query) {
  const text = String(query || '').trim();
  const result = { text, ageBand: null, vibe: null, emotions: [] };

  for (const pattern of AGE_PATTERNS) {
    const m = text.match(pattern);
    if (m) {
      const band = /\d-\d/.test(m[1]) ? m[1] : ageToBand(m[1]);
      if (band) {
        result.ageBand = band;
        break;
      }
    }
  }

  const lowered = ` ${text.toLowerCase().replace(/[^a-z0-9\s/-]+/g, ' ').replace(/\s+/g, ' ')} `;
  for (const [word, vibe] of Object.entries(VIBE_SYNONYMS)) {
    if (lowered.includes(` ${word} `)) {
      result.vibe = vibe;
      break;
    }
  }
  if (result.vibe && !VIBES.includes(result.vibe)) result.vibe = null;

  // Multi-word emotion phrases first so "left out" beats "out".
  const phrases = Object.keys(QUERY_EMOTION_SYNONYMS).filter((k) => k.includes(' '));
  const words = lowered.trim().split(' ');
  for (const phrase of phrases) {
    if (lowered.includes(` ${phrase} `)) {
      result.emotions.push(QUERY_EMOTION_SYNONYMS[phrase]);
    }
  }
  for (const word of words) {
    const mapped = QUERY_EMOTION_SYNONYMS[word];
    if (mapped && !result.emotions.includes(mapped)) {
      result.emotions.push(mapped);
    }
  }

  return result;
}

/** Builds the FTS5 MATCH expression for the free-text part of a query. */
export function ftsMatchExpression(query) {
  const tokens = tokenize(query);
  if (!tokens.length) return null;
  return tokens.map((t) => `"${t}"*`).join(' OR ');
}
