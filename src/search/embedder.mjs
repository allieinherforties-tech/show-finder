// Embedding provider for the vector side of search.
//
// The planned production embedder is an EmbeddingGemma-class model (spec,
// stack table). Downloading a 300M parameter model is not compatible with a
// fast, green CI run in Phase 1, so the default provider here is a
// deterministic local embedder: feature-hashed bag of unigrams and bigrams,
// L2 normalized. It has no semantics beyond token overlap, which is enough to
// exercise the fused-ranking path end to end. Register a real model provider
// here in Phase 2 via registerEmbedder; nothing else in the codebase changes.

import { createHash } from 'node:crypto';

const DIM = 384;
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'had',
  'has', 'have', 'he', 'her', 'his', 'i', 'in', 'is', 'it', 'its', 'of', 'on',
  'or', 'she', 'that', 'the', 'their', 'them', 'then', 'there', 'they', 'this',
  'to', 'was', 'were', 'will', 'with', 'you', 'your', 'my', 'our', 'we', 'us',
]);

/** Lowercases, strips punctuation, drops stopwords, returns tokens. */
export function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Stable index into the feature space for a term. */
function bucket(term) {
  const h = createHash('sha1').update(term).digest();
  return h.readUInt32BE(0) % DIM;
}

const registry = new Map();

/**
 * Deterministic local embedder. Non-negative bag-of-features vectors keep
 * cosine similarity inside [0, 1] and make builds byte-reproducible.
 */
registry.set('local-hash-v1', () => ({
  name: 'local-hash-v1',
  dim: DIM,
  embed(text) {
    const vec = new Float64Array(DIM);
    const tokens = tokenize(text);
    const grams = [...tokens];
    for (let i = 0; i < tokens.length - 1; i++) {
      grams.push(tokens[i] + '_' + tokens[i + 1]);
    }
    for (const g of grams) {
      vec[bucket(g)] += 1;
    }
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < DIM; i++) vec[i] /= norm;
    }
    return vec;
  },
}));

/** Registers a model-backed provider under a name (the Phase 2 swap point). */
export function registerEmbedder(name, factory) {
  registry.set(name, factory);
}

/** Creates the embedder named in EMBEDDER (default local-hash-v1). */
export function createEmbedder(name = process.env.EMBEDDER || 'local-hash-v1') {
  const factory = registry.get(name);
  if (!factory) {
    throw new Error(`unknown embedder "${name}". Registered: ${[...registry.keys()].join(', ')}`);
  }
  return factory();
}

/** Cosine similarity for two equal-length vectors. */
export function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/** Rounds to a fixed precision so serialized vectors are byte-stable across runs. */
export function stableVector(vec) {
  return Array.from(vec, (v) => Math.round(v * 1e6) / 1e6);
}
