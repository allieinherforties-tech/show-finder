// Regression tests for live search in public/app.js, run against a minimal
// DOM shim. These cover the reported bug (typing did nothing) and the silent
// paths around it: blank input, stale responses, and swallowed fetch errors.
//
// The stubs are installed once at file scope: app.js is an ESM module with
// top-level element lookups, so it binds to whatever DOM exists at first
// import, and the debounced search reads globalThis.fetch at call time.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const DEBOUNCE_MS = 300;

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
  ['search-form', 'search-input', 'age-filter', 'vibe-filter', 'results', 'results-meta', 'no-results']
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
const results = elements.results;
const resultsMeta = elements['results-meta'];
const noResults = elements['no-results'];

function reset({ fetch: impl } = {}) {
  fetchCalls.length = 0;
  consoleErrors.length = 0;
  if (impl) fetchImpl = impl;
  input.value = '';
  resultsMeta.hidden = true;
  resultsMeta.textContent = '';
  noResults.hidden = true;
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

test('typing updates results without pressing Enter', async () => {
  reset({ fetch: async () => searchResponse(1) });
  input.value = 'stillwater';
  input.dispatch('input');
  assert.equal(fetchCalls.length, 0, 'no request before the debounce window closes');
  await settle(DEBOUNCE_MS + 100);
  assert.equal(fetchCalls.length, 1);
  assert.match(String(fetchCalls[0]), /q=stillwater/);
  assert.equal(results.children.length, 1, 'result card rendered in place');
  assert.equal(noResults.hidden, true);
});

test('clearing the box returns the calm idle state', async () => {
  reset({ fetch: async () => searchResponse(1) });
  input.value = 'stillwater';
  input.dispatch('input');
  await settle(DEBOUNCE_MS + 100);
  assert.equal(results.children.length, 1);

  input.value = '   ';
  input.dispatch('input');
  await settle(DEBOUNCE_MS + 100);
  assert.equal(fetchCalls.length, 1, 'blank input makes no request');
  assert.equal(resultsMeta.hidden, true, 'results meta hidden in idle state');
  assert.equal(results.children.length, 0, 'stale results cleared');
  assert.equal(noResults.hidden, true);
});

test('a stale slow response never overwrites fresh results', async () => {
  const slow = async () => {
    await settle(150);
    return searchResponse(1);
  };
  reset({ fetch: (url) => (String(url).includes('puppy') ? Promise.resolve(searchResponse(2)) : slow()) });

  input.value = 'stillwater';
  input.dispatch('input');
  await settle(DEBOUNCE_MS + 50);
  input.value = 'stillwater puppy';
  input.dispatch('input');
  await settle(DEBOUNCE_MS + 300);

  assert.equal(fetchCalls.length, 2);
  assert.equal(results.children.length, 1);
  assert.match(resultsMeta.textContent, /2 of 547/, 'the newest query wins');
});

test('fetch failures are logged and surfaced, never swallowed', async () => {
  reset({ fetch: async () => { throw new Error('network down'); } });
  input.value = 'stillwater';
  input.dispatch('input');
  await settle(DEBOUNCE_MS + 100);
  assert.equal(consoleErrors.length, 1, 'console.error called');
  assert.match(String(consoleErrors[0]), /network down/);
  assert.match(resultsMeta.textContent, /search is unavailable right now/);
});
