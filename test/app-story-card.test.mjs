// The story card expansion (PRD Finder v1.1): collapsed card = poster,
// title, S/E, meta line, one lead; the Resolution is hidden until the tap,
// and the affordance is a drawn plus glyph with no text label. Same minimal
// DOM shim as the other app tests.
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
    id: 'test-series-s1-e1',
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
    appleLinkKind: 'show',
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

async function renderRows(rows) {
  globalThis.fetch = () => Promise.resolve(response(rows));
  emotionFilter.value = 'sad';
  emotionFilter.dispatch('change');
  await settle(50);
  return results.children;
}

const headOf = (card) => card.children.find((c) => c.className === 'card-head');
const expandOf = (card) => headOf(card).children.find((c) => c.className === 'card-expand');
const panelOf = (card) => card.children.find((c) => c.className === 'card-resolution');

test('a collapsed card shows no resolution and carries a plus affordance', async () => {
  const [card] = await renderRows([resultRow({})]);
  const panel = panelOf(card);
  assert.ok(panel, 'the resolution block renders into the card');
  assert.equal(panel.hidden, true, 'the resolution is hidden until expansion');
  assert.equal(panel.id, `resolution-${card.id || 'test-series-s1-e1'}`);

  const expand = expandOf(card);
  assert.ok(expand, 'the card carries its plus affordance');
  assert.equal(expand.tagName, 'button', 'keyboard operable: the affordance is a button');
  assert.equal(expand['aria-expanded'], 'false');
  assert.equal(expand.dataset.expanded, 'false');
  assert.equal(expand['aria-controls'], panel.id, 'the affordance names the panel it reveals');
  assert.ok(expand['aria-label'].startsWith('More about '), 'the accessible name speaks parent voice');
  assert.equal(
    expand['aria-label'].includes('Story details'),
    false,
    'the retired label is gone from the accessible name too',
  );
  assert.ok(
    expand.children.some((c) => c.className === 'expand-glyph'),
    'the glyph is a drawn span, decorative to screen readers',
  );
  assert.equal(
    expand.children.every((c) => c.tagName !== '#text'),
    true,
    'no text label inside the button',
  );
});

test('tapping the plus reveals the resolution and flips the affordance to close', async () => {
  const [card] = await renderRows([resultRow({})]);
  const expand = expandOf(card);
  const panel = panelOf(card);
  expand.dispatch('click');
  assert.equal(panel.hidden, false, 'the resolution is the reward for the tap');
  assert.equal(expand['aria-expanded'], 'true', 'the affordance reports the expanded state');
  assert.equal(expand.dataset.expanded, 'true', 'the CSS rotation follows the same state');
  expand.dispatch('click');
  assert.equal(panel.hidden, true, 'a second tap collapses again');
  assert.equal(expand['aria-expanded'], 'false');
});

test('a row with no resolution renders no expand affordance and no panel', async () => {
  const [card] = await renderRows([resultRow({ coping: null })]);
  assert.equal(expandOf(card), undefined, 'nothing to reveal means nothing to tap');
  assert.equal(panelOf(card), undefined, 'no resolution block is rendered either');
});
