// Guided reply tests for public/app.js against the same minimal DOM shim the
// live search tests use: clarifiers render after a search, a reply reruns the
// same search with one added facet, free text always wins, start over exits,
// and the URL is the only place chain state is written.

import { test, after } from 'node:test';
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
      if (selector === '.clarifier' || selector === '.chip') return el;
      return null;
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
  'search-form', 'search-input', 'age-filter', 'vibe-filter', 'results',
  'results-meta', 'no-results', 'clarifiers', 'clarifier-prompt',
  'clarifier-options', 'start-over',
];
const elements = Object.fromEntries(ids.map((id) => [id, makeElement(id)]));
globalThis.document = {
  getElementById: (id) => elements[id] ?? null,
  createElement: (tag) => makeElement(tag),
  addEventListener(type, fn) {
    (docListeners[type] ??= []).push(fn);
  },
};
const docListeners = {};
const dispatchDoc = (type, event) => {
  for (const fn of docListeners[type] ?? []) fn(event);
};

// The chain writes only here: URL parameters, nothing else.
const writtenUrls = [];
globalThis.history = { replaceState: (a, b, url) => writtenUrls.push(url) };
globalThis.location = { search: '', pathname: '/' };

const fetchCalls = [];
let fetchImpl = async () => ({ ok: false, status: 0, json: async () => ({}) });
globalThis.fetch = (url) => { fetchCalls.push(String(url)); return fetchImpl(url); };
const consoleErrors = [];
const realConsoleError = console.error;
console.error = (...args) => consoleErrors.push(args);
after(() => { console.error = realConsoleError; });

await import('../public/app.js');

const input = elements['search-input'];
const results = elements.results;
const clarifiers = elements.clarifiers;
const clarifierOptions = elements['clarifier-options'];
const startOver = elements['start-over'];
const ageFilter = elements['age-filter'];

function clarifierButtons() {
  return clarifierOptions.children.filter((c) => c.className.includes('clarifier'));
}

function searchResponse(overrides = {}) {
  return {
    ok: true,
    json: async () => ({
      artworkMode: 'text',
      count: 20,
      matched: 77,
      storyCount: 547,
      version: 'test',
      facets: {
        emotions: [
          { term: 'frustrated', count: 6 },
          { term: 'lonely', count: 5 },
          { term: 'nervous/worried', count: 4 },
        ],
        ageBands: [{ value: '5-7', count: 19 }, { value: '2-4', count: 1 }],
        series: [{ title: 'Stillwater', count: 20 }],
      },
      results: [{ seriesTitle: 'Stillwater', seasonNumber: 1, episodeNumber: 9, segmentTitle: 'The Catch', situation: 's', displaySynopsis: 'd', emotions: ['embarrassed', 'sad'] }],
      ...overrides,
    }),
  };
}

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function reset({ fetch: impl } = {}) {
  fetchCalls.length = 0;
  writtenUrls.length = 0;
  consoleErrors.length = 0;
  if (impl) fetchImpl = impl;
  input.value = '';
  ageFilter.value = '';
  results.replaceChildren();
  clarifiers.hidden = true;
  clarifierOptions.replaceChildren();
  startOver.hidden = true;
}

test('after a search the clarifier row offers the split, age band, and start over', async () => {
  reset({ fetch: async () => searchResponse() });
  input.value = 'stillwater';
  input.dispatch('input');
  await settle(DEBOUNCE_MS + 100);

  assert.equal(clarifiers.hidden, false, 'clarifiers visible after results');
  assert.equal(startOver.hidden, false, 'start over is offered while the chain is open');
  const values = clarifierButtons().map((b) => [b.dataset.facet, b.dataset.value]);
  assert.deepEqual(values.slice(0, 3), [
    ['emotion', 'frustrated'],
    ['emotion', 'lonely'],
    ['emotion', 'nervous/worried'],
  ]);
  assert.deepEqual(values[3], ['age', '5-7']);
  // All text lands via textContent; labels come from facets, not invented copy.
  assert.equal(clarifierButtons()[0].textContent, 'frustrated');
});

test('a reply reruns the same search with one added facet and one round spent', async () => {
  reset({ fetch: async () => searchResponse() });
  input.value = 'stillwater';
  input.dispatch('input');
  await settle(DEBOUNCE_MS + 100);
  fetchCalls.length = 0;

  dispatchDoc('click', { target: clarifierButtons()[0], preventDefault() {} });
  await settle(50);

  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0], /q=stillwater/);
  assert.match(fetchCalls[0], /emotion=frustrated/);
  // The round count is chain state: it rides the URL, never the API call.
  assert.equal(/r=/.test(fetchCalls[0]), false, 'the API call carries facets, not chain rounds');
  // The URL is the only store: the write carries the whole chain state.
  assert.match(writtenUrls.at(-1), /emotion=frustrated/);
  assert.match(writtenUrls.at(-1), /r=1/);
});

test('the second reply is the last: no third round is ever offered', async () => {
  reset({ fetch: async () => searchResponse() });
  input.value = 'stillwater';
  input.dispatch('input');
  await settle(DEBOUNCE_MS + 100);
  dispatchDoc('click', { target: clarifierButtons()[0], preventDefault() {} });
  await settle(50);
  assert.ok(clarifierButtons().length > 0, 'round two still offers options');

  dispatchDoc('click', { target: clarifierButtons().at(-1), preventDefault() {} });
  await settle(50);

  assert.match(writtenUrls.at(-1), /r=2/, 'two rounds spent, recorded in the URL');
  assert.equal(clarifierButtons().length, 0, 'round two is the final round');
  assert.equal(clarifiers.hidden, false, 'the exit stays reachable');
  assert.equal(startOver.hidden, false);
});

test('typing free text mid chain starts a fresh chain', async () => {
  reset({ fetch: async () => searchResponse() });
  input.value = 'stillwater';
  input.dispatch('input');
  await settle(DEBOUNCE_MS + 100);
  dispatchDoc('click', { target: clarifierButtons()[0], preventDefault() {} });
  await settle(50);
  fetchCalls.length = 0;

  input.value = 'michael drops a baseball';
  input.dispatch('input');
  await settle(DEBOUNCE_MS + 100);

  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0], /q=michael\+drops\+a\+baseball/);
  assert.equal(/emotion=/.test(fetchCalls[0]), false, 'facets cleared by typing');
  assert.equal(/r=/.test(fetchCalls[0]), false, 'round count reset by typing');
});

test('an age reply moves the visible filter with it', async () => {
  reset({ fetch: async () => searchResponse() });
  input.value = 'stillwater';
  input.dispatch('input');
  await settle(DEBOUNCE_MS + 100);
  fetchCalls.length = 0;

  const ageBtn = clarifierButtons().find((b) => b.dataset.facet === 'age');
  dispatchDoc('click', { target: ageBtn, preventDefault() {} });
  await settle(50);

  assert.equal(ageFilter.value, '5-7');
  assert.match(fetchCalls.at(-1), /age=5-7/);
  assert.match(writtenUrls.at(-1), /r=1/);
});

test('start over exits the chain to the calm idle state', async () => {
  reset({ fetch: async () => searchResponse() });
  input.value = 'stillwater';
  input.dispatch('input');
  await settle(DEBOUNCE_MS + 100);
  dispatchDoc('click', { target: clarifierButtons()[0], preventDefault() {} });
  await settle(50);

  startOver.dispatch('click', { preventDefault() {} });

  assert.equal(input.value, '');
  assert.equal(ageFilter.value, '');
  assert.equal(results.children.length, 0, 'stale results cleared');
  assert.equal(clarifiers.hidden, true);
  assert.equal(writtenUrls.at(-1), '/', 'the URL carries no chain state after start over');
});

test('a clarifier tap never leaks storage: the URL write is the only side effect', async () => {
  reset({ fetch: async () => searchResponse() });
  input.value = 'stillwater';
  input.dispatch('input');
  await settle(DEBOUNCE_MS + 100);
  fetchCalls.length = 0;
  writtenUrls.length = 0;

  dispatchDoc('click', { target: clarifierButtons()[1], preventDefault() {} });
  await settle(50);

  assert.equal(fetchCalls.length, 1, 'exactly one search rerun per reply');
  assert.equal(writtenUrls.length, 1, 'exactly one URL write per reply');
  assert.equal(typeof globalThis.localStorage, 'undefined', 'no storage API exists on this page');
});
