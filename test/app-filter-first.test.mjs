// Regression tests for filter-first browse in public/app.js, against the same
// minimal DOM shim as app-live-search.test.mjs. The filters are the first
// selectivity layer: a parent picks an age band before typing anything, and
// that must search the catalog. The This Season rail yields to results and
// returns with the calm idle state.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

function makeElement(id) {
  return {
    id,
    tagName: 'div',
    children: [],
    dataset: {},
    listeners: {},
    hidden: false,
    textContent: '',
    className: '',
    value: '',
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
}

const elements = Object.fromEntries(
  ['search-form', 'search-input', 'age-filter', 'vibe-filter', 'results', 'results-meta', 'no-results', 'clarifiers', 'clarifier-prompt', 'clarifier-options', 'start-over', 'rail-this-season']
    .map((id) => [id, makeElement(id)]),
);
globalThis.document = {
  getElementById: (id) => elements[id] ?? null,
  createElement: (tag) => makeElement(tag),
  addEventListener() {},
};

const fetchCalls = [];
const consoleErrors = [];
let fetchImpl = async () => ({ ok: false, status: 0, json: async () => ({}) });
globalThis.fetch = (url) => { fetchCalls.push(url); return fetchImpl(url); };
const realConsoleError = console.error;
console.error = (...args) => consoleErrors.push(args);

await import('../public/app.js');
after(() => { console.error = realConsoleError; });

const input = elements['search-input'];
const ageFilter = elements['age-filter'];
const vibeFilter = elements['vibe-filter'];
const results = elements.results;
const resultsMeta = elements['results-meta'];
const noResults = elements['no-results'];
const seasonRail = elements['rail-this-season'];

function reset({ fetch: impl } = {}) {
  fetchCalls.length = 0;
  consoleErrors.length = 0;
  if (impl) fetchImpl = impl;
  input.value = '';
  ageFilter.value = '';
  vibeFilter.value = '';
  resultsMeta.hidden = true;
  resultsMeta.textContent = '';
  noResults.hidden = true;
  seasonRail.hidden = false;
  results.replaceChildren();
}

function searchResponse(count) {
  return {
    ok: true,
    json: async () => ({
      artworkMode: 'text',
      count,
      storyCount: 547,
      version: 'test',
      results: count
        ? [{ seriesTitle: 'Stillwater', seasonNumber: 1, episodeNumber: 9, situation: 's', displaySynopsis: 'd', emotions: [] }]
        : [],
    }),
  };
}

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('picking an age band searches the catalog before any typing', async () => {
  reset({ fetch: async () => searchResponse(1) });
  ageFilter.value = '5-7';
  ageFilter.dispatch('change');
  assert.equal(fetchCalls.length, 1, 'a filter change is a search, no query required');
  assert.match(String(fetchCalls[0]), /age=5-7/);
  assert.doesNotMatch(String(fetchCalls[0]), /[?&]q=/, 'the request carries no q');
  await settle(50);
  assert.equal(results.children.length, 1, 'filtered stories render');
  assert.equal(seasonRail.hidden, true, 'the rail yields to results');
});

test('a vibe-only search works the same way', async () => {
  reset({ fetch: async () => searchResponse(1) });
  vibeFilter.value = 'calm';
  vibeFilter.dispatch('change');
  assert.equal(fetchCalls.length, 1);
  assert.match(String(fetchCalls[0]), /vibe=calm/);
});

test('clearing every filter returns the calm idle state', async () => {
  reset({ fetch: async () => searchResponse(1) });
  ageFilter.value = '5-7';
  ageFilter.dispatch('change');
  await settle(50);

  ageFilter.value = '';
  ageFilter.dispatch('change');
  await settle(50);
  assert.equal(fetchCalls.length, 1, 'nothing selected makes no request');
  assert.equal(resultsMeta.hidden, true, 'results meta hidden in idle state');
  assert.equal(results.children.length, 0, 'stale results cleared');
  assert.equal(noResults.hidden, true);
  assert.equal(seasonRail.hidden, false, 'the rail returns with the idle state');
});

test('a filter combination with no matches shows the calm no-results state, rail intact', async () => {
  reset({ fetch: async () => searchResponse(0) });
  ageFilter.value = '8-10';
  vibeFilter.value = 'silly';
  ageFilter.dispatch('change');
  await settle(50);
  assert.equal(noResults.hidden, false, 'the empty state speaks');
  assert.equal(results.children.length, 0);
  assert.equal(seasonRail.hidden, false, 'no results on screen, so the rail stays');
});

test('filters still refine on top of a typed query', async () => {
  reset({ fetch: async () => searchResponse(1) });
  input.value = 'stillwater';
  input.dispatch('input');
  await settle(400);
  ageFilter.value = '5-7';
  ageFilter.dispatch('change');
  await settle(50);
  const last = String(fetchCalls[fetchCalls.length - 1]);
  assert.match(last, /q=stillwater/);
  assert.match(last, /age=5-7/);
});

test('start over from a filter-only search restores the idle state', async () => {
  reset({ fetch: async () => searchResponse(1) });
  ageFilter.value = '5-7';
  ageFilter.dispatch('change');
  await settle(50);
  assert.equal(seasonRail.hidden, true);

  elements['start-over'].dispatch('click');
  assert.equal(results.children.length, 0);
  assert.equal(seasonRail.hidden, false);
});
