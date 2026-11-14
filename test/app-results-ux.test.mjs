// Regression tests for the mobile results UX in public/app.js: the live count
// line, the removable filter chips, the 12 card render cap with its calm show
// more control, and the warm zero-result state. Same minimal DOM shim as the
// other app tests, extended with the new filter and results-ux elements.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const DEBOUNCE_MS = 300;

function makeElement(id) {
  const el = {
    id,
    tagName: 'div',
    children: [],
    dataset: {},
    listeners: {},
    hidden: false,
    textContent: '',
    className: '',
    value: '',
    classList: {
      contains(cls) {
        return el.className.split(' ').includes(cls);
      },
    },
    closest(selector) {
      const cls = selector.replace(/^\./, '');
      return el.className.split(' ').includes(cls) ? el : null;
    },
    addEventListener(type, fn) {
      (this.listeners[type] ??= []).push(fn);
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    append(...kids) {
      this.children.push(...kids);
    },
    replaceChildren(...kids) {
      this.children = [...kids];
    },
    setAttribute(key, value) {
      this[key] = value;
    },
    dispatch(type, event = { preventDefault() {} }) {
      for (const fn of this.listeners[type] ?? []) fn(event);
    },
  };
  return el;
}

const ids = [
  'search-form', 'search-input', 'age-filter', 'vibe-filter', 'emotion-filter',
  'results', 'results-meta', 'active-filters', 'show-more',
  'no-results', 'no-results-text', 'no-results-suggestions', 'clarifiers',
  'clarifier-prompt', 'clarifier-options', 'start-over', 'rail-this-season',
];
const elements = Object.fromEntries(ids.map((id) => [id, makeElement(id)]));
const docListeners = {};
globalThis.document = {
  getElementById: (id) => elements[id] ?? null,
  createElement: (tag) => makeElement(tag),
  addEventListener(type, fn) {
    (docListeners[type] ??= []).push(fn);
  },
};
const dispatchDoc = (type, event) => {
  for (const fn of docListeners[type] ?? []) fn(event);
};

const fetchCalls = [];
let fetchImpl = async () => ({ ok: false, status: 0, json: async () => ({}) });
globalThis.fetch = (url) => { fetchCalls.push(String(url)); return fetchImpl(url); };

await import('../public/app.js');

const input = elements['search-input'];
const ageFilter = elements['age-filter'];
const emotionFilter = elements['emotion-filter'];
const results = elements.results;
const resultsMeta = elements['results-meta'];
const activeFilters = elements['active-filters'];
const showMore = elements['show-more'];
const noResults = elements['no-results'];
const noResultsText = elements['no-results-text'];
const noResultsSuggestions = elements['no-results-suggestions'];
const seasonRail = elements['rail-this-season'];

function resultRow(i) {
  return {
    seriesTitle: `Series ${i}`,
    seasonNumber: 1,
    episodeNumber: i,
    segmentTitle: 'The Test Story',
    situation: 's',
    displaySynopsis: 'd',
    emotions: [],
  };
}

function response({ matched, results: count }) {
  return {
    ok: true,
    json: async () => ({
      artworkMode: 'text',
      count,
      matched,
      storyCount: 525,
      version: 'test',
      results: Array.from({ length: count }, (_, i) => resultRow(i + 1)),
    }),
  };
}

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function reset(impl) {
  fetchCalls.length = 0;
  if (impl) fetchImpl = impl;
  // Start over is the real path back to idle: it clears the module-level
  // chain too, which the dropdown stubs cannot reach.
  elements['start-over'].dispatch('click');
  input.value = '';
  ageFilter.value = '';
  elements['vibe-filter'].value = '';
  emotionFilter.value = '';
  resultsMeta.hidden = true;
  resultsMeta.textContent = '';
  activeFilters.hidden = true;
  activeFilters.replaceChildren();
  showMore.hidden = true;
  noResults.hidden = true;
  noResultsText.textContent = '';
  noResultsSuggestions.hidden = true;
  seasonRail.hidden = false;
  results.replaceChildren();
}

test('picking a feeling searches the catalog and moves the count line', async () => {
  reset(() => response({ matched: 128, results: 20 }));
  emotionFilter.value = 'nervous/worried';
  emotionFilter.dispatch('change');
  assert.equal(fetchCalls.length, 1, 'a feeling is a search, no typing required');
  assert.match(fetchCalls[0], /emotion=nervous%2Fworried/);
  assert.doesNotMatch(fetchCalls[0], /[?&]q=/);
  assert.match(fetchCalls[0], /limit=600/, 'the client pages the full matched set in the view');
  await settle(50);
  assert.match(resultsMeta.textContent, /128 stories match/, 'the count names the whole matched set');
  assert.match(resultsMeta.textContent, /feeling: nervous\/worried/, 'the count names the active filter');
});

// A series reply rides the clarifier path: one tap adds the facet to the
// chain and searches, exactly as the age and feeling replies always have.
const seriesReply = (value) => ({
  className: 'clarifier',
  dataset: { facet: 'series', value },
  closest(sel) {
    return sel === '.clarifier' ? this : null;
  },
});

test('a series reply from the clarifiers searches the same way', async () => {
  reset(() => response({ matched: 77, results: 20 }));
  dispatchDoc('click', { target: seriesReply('Stillwater'), preventDefault() {} });
  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0], /series=Stillwater/);
  await settle(50);
  assert.match(resultsMeta.textContent, /77 stories match/);
  assert.match(resultsMeta.textContent, /series: Stillwater/);
});

test('the count line updates on every filter change, every active filter named', async () => {
  reset(() => response({ matched: 5, results: 5 }));
  ageFilter.value = '5-7';
  emotionFilter.value = 'sad';
  elements['vibe-filter'].value = 'calm';
  dispatchDoc('click', { target: seriesReply('Camp Snoopy'), preventDefault() {} });
  await settle(50);
  assert.equal(
    resultsMeta.textContent,
    '5 stories match · ages 5-7 · vibe: calm · feeling: sad · series: Camp Snoopy',
    'filter order, every active filter named',
  );
});

test('a single match reads as one story', async () => {
  reset(() => response({ matched: 1, results: 1 }));
  ageFilter.value = '8-10';
  ageFilter.dispatch('change');
  await settle(50);
  assert.match(resultsMeta.textContent, /^1 story matches/);
});

test('the rendered list caps at 12 until show more stories is tapped', async () => {
  reset(() => response({ matched: 30, results: 30 }));
  ageFilter.value = '2-4';
  ageFilter.dispatch('change');
  await settle(50);
  assert.equal(results.children.length, 12, 'twelve cards, never the full list');
  assert.equal(showMore.hidden, false, 'the calm control appears');
  assert.equal(resultsMeta.textContent.includes('30 stories match'), true, 'the count stays honest about the full set');

  showMore.dispatch('click');
  assert.equal(results.children.length, 24);
  assert.equal(showMore.hidden, false);

  showMore.dispatch('click');
  assert.equal(results.children.length, 30);
  assert.equal(showMore.hidden, true, 'the control leaves when everything is shown');
});

test('a short match set never shows the show more control', async () => {
  reset(() => response({ matched: 7, results: 7 }));
  ageFilter.value = '2-4';
  ageFilter.dispatch('change');
  await settle(50);
  assert.equal(results.children.length, 7);
  assert.equal(showMore.hidden, true);
});

test('every active filter renders as one removable chip', async () => {
  reset(() => response({ matched: 5, results: 5 }));
  ageFilter.value = '5-7';
  emotionFilter.value = 'sad';
  dispatchDoc('click', { target: seriesReply('Stillwater'), preventDefault() {} });
  emotionFilter.dispatch('change');
  await settle(50);
  assert.equal(activeFilters.hidden, false);
  assert.deepEqual(
    activeFilters.children.map((c) => [c.dataset.facet, c.textContent]),
    [['age', 'ages 5-7'], ['emotion', 'feeling: sad'], ['series', 'series: Stillwater']],
    'chips in filter order, vibe inactive so absent',
  );
});

test('one tap on a chip removes that filter and searches again without it', async () => {
  reset(() => response({ matched: 5, results: 5 }));
  emotionFilter.value = 'sad';
  dispatchDoc('click', { target: seriesReply('Stillwater'), preventDefault() {} });
  emotionFilter.dispatch('change');
  await settle(50);

  const sadChip = activeFilters.children.find((c) => c.dataset.facet === 'emotion');
  dispatchDoc('click', { target: sadChip, preventDefault() {} });
  await settle(50);

  assert.equal(emotionFilter.value, '', 'the chip clears its dropdown');
  assert.match(fetchCalls.at(-1), /series=Stillwater/, 'the untouched filter stays');
  assert.doesNotMatch(fetchCalls.at(-1), /emotion=/, 'the removed filter leaves the query');
  assert.deepEqual(
    activeFilters.children.map((c) => c.textContent),
    ['series: Stillwater'],
  );
});

test('removing the last filter chip returns the calm idle state', async () => {
  reset(() => response({ matched: 5, results: 5 }));
  emotionFilter.value = 'sad';
  emotionFilter.dispatch('change');
  await settle(50);

  dispatchDoc('click', { target: activeFilters.children[0], preventDefault() {} });
  await settle(50);

  assert.equal(fetchCalls.length, 1, 'no request once nothing is selected');
  assert.equal(activeFilters.hidden, true);
  assert.equal(resultsMeta.hidden, true);
  assert.equal(results.children.length, 0);
  assert.equal(seasonRail.hidden, false);
});

test('a zero result with filters names them and hands back the chips', async () => {
  reset(() => response({ matched: 0, results: 0 }));
  ageFilter.value = '5-7';
  emotionFilter.value = 'guilty';
  emotionFilter.dispatch('change');
  await settle(50);

  assert.equal(noResults.hidden, false, 'the empty state speaks');
  assert.match(noResultsText.textContent, /nothing matches ages 5-7 \+ feeling: guilty/);
  assert.match(noResultsText.textContent, /try removing one filter/);
  assert.equal(noResultsSuggestions.hidden, true, 'the text search suggestions stay out of the way');
  assert.equal(activeFilters.hidden, false, 'the removal chips stay reachable');
  assert.equal(activeFilters.children.length, 2);
  assert.equal(results.children.length, 0);
  assert.equal(showMore.hidden, true, 'nothing matched, so there is nothing to show more of');
  assert.equal(seasonRail.hidden, false, 'the rail returns with the empty state');
});

test('a text search with zero matches keeps the feeling suggestions', async () => {
  reset(() => response({ matched: 0, results: 0 }));
  input.value = 'zzz no such thing';
  input.dispatch('input');
  await settle(DEBOUNCE_MS + 100);
  assert.equal(noResults.hidden, false);
  assert.equal(noResultsText.textContent, '');
  assert.equal(noResultsSuggestions.hidden, false, 'the calm suggestions are the recovery path');
});

test('start over clears the dropdowns and the chips', async () => {
  reset(() => response({ matched: 5, results: 5 }));
  ageFilter.value = '5-7';
  emotionFilter.value = 'sad';
  dispatchDoc('click', { target: seriesReply('Stillwater'), preventDefault() {} });
  emotionFilter.dispatch('change');
  await settle(50);

  elements['start-over'].dispatch('click');
  assert.equal(ageFilter.value, '');
  assert.equal(emotionFilter.value, '');
  assert.equal(activeFilters.hidden, true);
  assert.equal(results.children.length, 0);
  assert.equal(showMore.hidden, true);
});
