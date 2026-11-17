// The watch pill renders its label from the row's providerLabel, never a
// hardcoded platform string (Riley's 2026-11-14 diction ruling). Same minimal
// DOM shim as the other app tests, plus a text node factory: the pill is a
// glyph image plus one text node, and the accessible name rides setAttribute.
import { test } from 'node:test';
import assert from 'node:assert/strict';

function makeElement(tag) {
  const el = {
    id: '',
    tagName: tag,
    children: [],
    dataset: {},
    listeners: {},
    hidden: false,
    textContent: '',
    className: '',
    value: '',
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
    addEventListener(type, fn) {
      (this.listeners[type] ??= []).push(fn);
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
const elements = Object.fromEntries(ids.map((id) => [id, makeElement('div')]));
globalThis.document = {
  getElementById: (id) => elements[id] ?? null,
  createElement: (tag) => makeElement(tag),
  createTextNode: (text) => ({ tagName: '#text', text }),
  addEventListener() {},
};
globalThis.fetch = () => Promise.resolve({ ok: false, status: 0, json: async () => ({}) });

await import('../public/app.js');

const emotionFilter = elements['emotion-filter'];
const results = elements.results;

function resultRow(overrides) {
  return {
    seriesTitle: 'Duck & Goose',
    seasonNumber: 2,
    episodeNumber: 1,
    segmentTitle: null,
    situation: 'A kid is scared of the dark.',
    displaySynopsis: 'd',
    emotions: ['scared'],
    ageBand: '2-4',
    vibe: 'calm',
    coping: 'naming the feeling',
    appleUrl: 'https://tv.apple.com/us/show/duck-goose/umc.cmc.3czcagetjq31vvbgkkyp1xiao',
    provider: 'apple',
    providerLabel: 'Apple TV+',
    ...overrides,
  };
}

function response(rows) {
  return {
    ok: true,
    json: async () => ({
      artworkMode: 'text',
      count: rows.length,
      matched: rows.length,
      storyCount: 525,
      version: 'test',
      results: rows,
    }),
  };
}

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function watchOf(card) {
  return card.children.find((c) => c.className === 'watch') || null;
}

async function renderRows(rows) {
  globalThis.fetch = () => Promise.resolve(response(rows));
  emotionFilter.value = 'sad';
  emotionFilter.dispatch('change');
  await settle(50);
  return results.children;
}

test('an Apple row renders the byte-identical pill: label and accessible name from providerLabel', async () => {
  const [card] = await renderRows([resultRow({})]);
  const watch = watchOf(card);
  assert.ok(watch, 'a row with a verified link renders the pill');
  const textNode = watch.children[1];
  assert.equal(textNode.text, 'Watch on Apple TV+');
  assert.equal(
    watch['aria-label'],
    'Watch Duck & Goose, season 2 episode 1, on Apple TV+',
  );
});

test('a synthetic PBS row renders Watch on PBS KIDS from its own data, zero UI rework', async () => {
  const [card] = await renderRows([resultRow({
    seriesTitle: 'Odd Squad',
    appleUrl: 'https://www.pbs.org/video/odd-squad-sample-segment/',
    provider: 'pbs',
    providerLabel: 'PBS KIDS',
  })]);
  const watch = watchOf(card);
  assert.ok(watch, 'a PBS row with a direct video link renders the pill');
  assert.equal(watch.children[1].text, 'Watch on PBS KIDS');
  assert.equal(
    watch['aria-label'],
    'Watch Odd Squad, season 2 episode 1, on PBS KIDS',
  );
  assert.equal(
    card.children.some((c) => c.textContent === 'Watch on Apple TV+'),
    false,
    'no hardcoded Apple string leaks into a PBS row',
  );
});

test('a row with no verified link renders no watch button, whatever its provider', async () => {
  const [card] = await renderRows([resultRow({
    appleUrl: null,
    provider: 'disney',
    providerLabel: 'Disney+',
  })]);
  assert.equal(watchOf(card), null, 'the honest-link rule holds: no invented button');
});

// PRD Finder v1.1: the serve path resolves the watch link (verified episode,
// else the series page), so every story card renders exactly one watch
// affordance, and a link that lands on the series page never claims the
// exact episode in its accessible name.
test('a series-page fallback link names the series, never the episode', async () => {
  const [card] = await renderRows([resultRow({
    appleUrl: 'https://tv.apple.com/us/show/duck-goose/umc.cmc.3czcagetjq31vvbgkkyp1xiao',
    appleLinkKind: 'show',
  })]);
  const watch = watchOf(card);
  assert.ok(watch, 'the fallback row renders its watch affordance: no dead-end cards');
  assert.equal(watch.children[1].text, 'Watch on Apple TV+');
  assert.equal(watch['aria-label'], 'Watch Duck & Goose on Apple TV+');
});

test('an episode-level link keeps the full episode accessible name', async () => {
  const [card] = await renderRows([resultRow({ appleLinkKind: 'episode' })]);
  assert.equal(
    watchOf(card)['aria-label'],
    'Watch Duck & Goose, season 2 episode 1, on Apple TV+',
  );
});

test('every story card renders exactly one watch affordance', async () => {
  const [card] = await renderRows([resultRow({ appleLinkKind: 'show' })]);
  const pills = card.children.filter((c) => c.className === 'watch');
  assert.equal(pills.length, 1, 'one Watch affordance per card, never two, never zero');
});
