// Guided replies: at most two rounds of one tap clarifiers after a search.
// Everything here is pure: options derive from the server's facet counts
// (which describe what the query actually matched), chain state goes to and
// from URL parameters, and labels come from the finder's existing controlled
// vocabularies (canonical emotion terms, age bands, series titles). Rendering
// and fetching live in app.js.

export const MAX_ROUNDS = 2;

// A split over fewer results than this refines nothing worth tapping.
export const MIN_MATCHED_FOR_CLARIFIERS = 5;

// Age band labels mirror the age filter options in index.html and the bands
// in src/vocabulary.mjs; test/guided-replies.test.mjs holds all three in step.
const AGE_BAND_LABELS = {
  '2-4': 'ages 2 to 4',
  '5-7': 'ages 5 to 7',
  '8-10': 'ages 8 to 10',
};

// Once a facet holds most of the result set, tapping it narrows nothing.
const MAX_SHARE = 0.8;
const EMOTION_CHOICES = 3;
const SERIES_CHOICES = 2;

export function ageBandLabel(band) {
  return AGE_BAND_LABELS[band] || band;
}

/** Reads the chain state out of URL parameters. Malformed values fall back to a fresh chain. */
export function parseChainState(params) {
  const round = Number(params.get('r'));
  return {
    q: params.get('q') || '',
    emotion: params.get('emotion') || '',
    age: params.get('age') || '',
    series: params.get('series') || '',
    round: Number.isInteger(round) && round >= 0 && round <= MAX_ROUNDS ? round : 0,
  };
}

/** Writes the chain state into URL parameters; the URL is the only store. */
export function chainStateToParams(state) {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.emotion) params.set('emotion', state.emotion);
  if (state.age) params.set('age', state.age);
  if (state.series) params.set('series', state.series);
  if (state.round) params.set('r', String(state.round));
  return params;
}

/** The calm prompt above the options, per round. */
export function chainPrompt(round) {
  return round === 0 ? 'if one of these fits, tap it:' : 'want to get closer? tap one:';
}

function share(count, matched) {
  return matched > 0 ? count / matched : 0;
}

/**
 * Derives this round's clarifier options from the server's facet counts.
 * Each option is one tap that adds one facet: the dominant emotion split
 * (round one only, the split question gets one answer), then age band and
 * series. Facets already applied are never offered again.
 */
export function deriveClarifiers(facets, state, matched) {
  if (!facets || state.round >= MAX_ROUNDS || matched < MIN_MATCHED_FOR_CLARIFIERS) return [];
  const options = [];

  if (!state.emotion) {
    const usable = facets.emotions.filter(
      (f) => f.count >= 2 && share(f.count, matched) <= MAX_SHARE,
    );
    for (const f of usable.slice(0, EMOTION_CHOICES)) {
      // Canonical emotion term from the corpus vocabulary, passed through as is.
      options.push({ facet: 'emotion', value: f.term, label: f.term });
    }
  }

  const bands = facets.ageBands.filter(
    (f) => f.value !== state.age && f.count >= 2 && share(f.count, matched) <= MAX_SHARE,
  );
  for (const f of bands.slice(0, SERIES_CHOICES)) {
    options.push({ facet: 'age', value: f.value, label: ageBandLabel(f.value) });
  }

  if (facets.series.length > 1) {
    const titles = facets.series.filter(
      (f) => f.title !== state.series && f.count >= 2 && share(f.count, matched) <= MAX_SHARE,
    );
    for (const f of titles.slice(0, SERIES_CHOICES)) {
      options.push({ facet: 'series', value: f.title, label: f.title });
    }
  }

  return options;
}
