// Filter-first browse: the filters are the first selectivity layer, so a
// parent can browse the catalog before typing anything. These cover the two
// layers that made pure-filter queries return nothing by construction: the
// raw relevance floor in runSearch, and the server's empty-q rejection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryIndex } from '../src/search/store.mjs';
import { createApp } from '../src/server.mjs';
import { normalizeStoryRow } from '../src/pipeline/normalize.mjs';

function row(overrides) {
  return normalizeStoryRow(
    {
      series_title: 'Test Series',
      season_number: '1',
      episode_number: '1',
      segment: '1',
      segment_title: 'The Test Story',
      synopsis: 'A test story about the dark and bedtime.',
      situation: 'A kid is scared of the dark at bedtime.',
      emotion: 'scared',
      coping: 'naming the feeling',
      age_band: '2-4',
      vibe: 'calm',
      ...overrides,
    },
    { workbookId: 'wb_test', sheetId: 'sh_test' },
  );
}

const STORIES = [
  row({}),
  row({
    episode_number: '2', segment: '2', segment_title: 'The Second Story',
    synopsis: 'A pup waits for pizza and finds waiting hard.',
    situation: 'A pup waits for pizza and finds waiting hard.',
    emotion: 'impatient', coping: 'making a game of waiting', age_band: '5-7', vibe: 'silly',
  }),
  row({
    episode_number: '3', segment: null, segment_title: null,
    synopsis: 'A bear plants a garden with friends.',
    situation: 'A bear plants a garden with friends.',
    emotion: 'happy', coping: 'working together', age_band: '8-10', vibe: 'energetic',
  }),
];

test('filter-only browse returns the filtered catalog despite the raw relevance floor', () => {
  const index = createMemoryIndex(STORIES);
  const results = index.search('', { ageBand: '5-7' });
  assert.equal(results.length, 1, 'the raw floor must not empty a pure-filter query');
  assert.equal(results[0].ageBand, '5-7');

  const byVibe = index.search('', { vibe: 'energetic' });
  assert.equal(byVibe.length, 1);
  assert.equal(byVibe[0].vibe, 'energetic');
});

test('filter-only browse combines filters and respects the limit cut', () => {
  const index = createMemoryIndex(STORIES);
  const both = index.search('', { ageBand: '2-4', vibe: 'calm' });
  assert.equal(both.length, 1);
  assert.equal(both[0].ageBand, '2-4');

  const mismatch = index.search('', { ageBand: '2-4', vibe: 'silly' });
  assert.equal(mismatch.length, 0, 'a combination nothing matches returns an honest zero');

  const all = index.search('', {});
  assert.equal(all.length, 3, 'no filter at all browses the whole catalog');

  const limited = index.search('', { limit: 2 });
  assert.equal(limited.length, 2);
});

test('filter-only browse keeps facet counts over the full matched set', () => {
  const index = createMemoryIndex(STORIES);
  const { results, matched, facets } = index.search('', { ageBand: '2-4', facets: true, limit: 20 });
  assert.equal(results.length, 1);
  assert.equal(matched, 1);
  assert.ok(facets.ageBands.some((f) => f.value === '2-4'));
});

// --- The serving layer, over the real committed artifact ---

const app = createApp();
await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
const { port } = app.address();
test.after(() => app.close());

async function apiSearch(query) {
  const res = await fetch(`http://127.0.0.1:${port}/api/search${query}`);
  return { status: res.status, body: await res.json() };
}

test('the server answers a filter-only query with the filtered catalog', async () => {
  const { status, body } = await apiSearch('?age=5-7');
  assert.equal(status, 200);
  assert.ok(body.count > 0, 'a real age band has real stories');
  for (const r of body.results) assert.equal(r.ageBand, '5-7');
});

test('the server answers a vibe-only query', async () => {
  const { status, body } = await apiSearch('?vibe=calm&limit=5');
  assert.equal(status, 200);
  assert.ok(body.count > 0);
  for (const r of body.results) assert.equal(r.vibe, 'calm');
});

test('no q and no filter is still rejected', async () => {
  for (const query of ['', '?q=', '?q=%20%20']) {
    const { status, body } = await apiSearch(query);
    assert.equal(status, 400, `empty request ${query || '(none)'} must be refused`);
    assert.ok(body.error, 'the refusal says why');
  }
});

test('a filter-only query over the real catalog renders results for every row it returns', async () => {
  const { status, body } = await apiSearch('?age=2-4&limit=50');
  assert.equal(status, 200);
  for (const r of body.results) {
    assert.ok(r.seriesTitle, 'each row carries a series title');
    assert.ok(r.situation, 'each row carries a situation');
  }
});
