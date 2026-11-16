// Film card rendering, per the Film Card Diction ruling: the subtitle slot
// reads 'Film · year · runtime', the watch pill's accessible name names the
// film without season/episode nonsense, and a film poster's alt is 'Poster
// for {title}'. Same minimal DOM shim as the other app tests.
import test from 'node:test';
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
    getAttribute(key) {
      return this[key] ?? null;
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

function filmRow(overrides = {}) {
  return {
    id: 'film-a-charlie-brown-christmas-13187',
    kind: 'film',
    seriesTitle: 'A Charlie Brown Christmas',
    releaseYear: '1965',
    runtimeMinutes: 25,
    seasonNumber: null,
    episodeNumber: null,
    segmentTitle: null,
    situation: 'Charlie Brown has the Yuletide blues.',
    displaySynopsis: 'd',
    emotions: ['sad'],
    ageBand: '5-7',
    vibe: 'calm',
    coping: 'asking for help',
    appleUrl: 'https://tv.apple.com/us/movie/a-charlie-brown-christmas/umc.cmc.mbxalimrwrtq72wj4h601pyf',
    provider: 'apple',
    providerLabel: 'Apple TV+',
    ...overrides,
  };
}

function episodeRow(overrides = {}) {
  return {
    id: 'frog-and-toad-s1-e2',
    kind: 'episode',
    seriesTitle: 'Frog and Toad',
    seasonNumber: 1,
    episodeNumber: 2,
    segmentTitle: null,
    situation: 'A kid is scared of the dark.',
    displaySynopsis: 'd',
    emotions: ['scared'],
    ageBand: '2-4',
    vibe: 'calm',
    coping: 'naming the feeling',
    appleUrl: 'https://tv.apple.com/us/show/frog-and-toad/umc.cmc.3czcagetjq31vvbgkkyp1xiao',
    provider: 'apple',
    providerLabel: 'Apple TV+',
    ...overrides,
  };
}

function response(rows) {
  return {
    ok: true,
    json: async () => ({
      artworkMode: 'tmdb',
      count: rows.length,
      matched: rows.length,
      storyCount: 559,
      version: 'test',
      results: rows,
    }),
  };
}

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function subtitleOf(card) {
  return card.children.find((c) => c.className === 'episode') || null;
}

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

test('a film card reads Film · year · runtime on the subtitle line', async () => {
  const [card] = await renderRows([filmRow({})]);
  assert.equal(subtitleOf(card).textContent, 'Film · 1965 · 25 min');
});

test('a film with no runtime omits the segment instead of inventing one', async () => {
  const [card] = await renderRows([filmRow({ runtimeMinutes: null })]);
  assert.equal(subtitleOf(card).textContent, 'Film · 1965');
});

test('a film with no year or runtime still reads as a film', async () => {
  const [card] = await renderRows([filmRow({ runtimeMinutes: null, releaseYear: null })]);
  assert.equal(subtitleOf(card).textContent, 'Film');
});

test('the film watch pill names the film alone, never season null episode null', async () => {
  const [card] = await renderRows([filmRow({})]);
  const watch = watchOf(card);
  assert.equal(watch.getAttribute('aria-label'), 'Watch A Charlie Brown Christmas on Apple TV+');
  assert.equal(watch.children.at(-1).text, 'Watch on Apple TV+');
});

test('the film heading renders the film title', async () => {
  const [card] = await renderRows([filmRow({})]);
  const heading = card.children.find((c) => c.tagName === 'h3');
  assert.equal(heading.textContent, 'A Charlie Brown Christmas');
});

test('a film poster gets the Poster-for alt, not an episode or series phrase', async () => {
  const [card] = await renderRows([filmRow({ posterUrl: 'https://image.tmdb.org/t/p/w342/x.jpg' })]);
  const figure = card.children.find((c) => c.className === 'card-artwork');
  const img = figure.children[0];
  assert.equal(img.alt, 'Poster for A Charlie Brown Christmas');
});

test('an episode card keeps the S/E subtitle and accessible name unchanged', async () => {
  const [card] = await renderRows([episodeRow({})]);
  assert.equal(subtitleOf(card).textContent, 'S1 E2');
  assert.equal(watchOf(card).getAttribute('aria-label'), 'Watch Frog and Toad, season 1 episode 2, on Apple TV+');
});

test('an episode still keeps the Episode-still alt', async () => {
  const [card] = await renderRows([episodeRow({ stillUrl: 'https://image.tmdb.org/t/p/w780/y.jpg' })]);
  const figure = card.children.find((c) => c.className === 'card-artwork');
  assert.equal(figure.children[0].alt, 'Episode still for Frog and Toad');
});

test('a film with no coping renders no resolution text, per the faithful-absence rule', async () => {
  const [card] = await renderRows([filmRow({ coping: '' })]);
  const resolution = card.children.find((c) => c.className === 'resolution');
  assert.equal(resolution.textContent, '');
});
