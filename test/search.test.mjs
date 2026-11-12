import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryIndex } from '../src/search/store.mjs';
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

test('fused search finds the situation match first', () => {
  const index = createMemoryIndex(STORIES);
  const results = index.search('my kid is scared of the dark');
  assert.ok(results.length >= 1);
  assert.equal(results[0].episodeNumber, 1);
  assert.equal(results[0].emotions.includes('scared'), true);
});

test('age band from the query acts as a hard filter', () => {
  const index = createMemoryIndex(STORIES);
  const results = index.search('my kid is 5 and scared of the dark');
  assert.equal(results.length, 0);
  const matching = index.search('my kid is 3 and scared of the dark');
  assert.equal(matching.length, 1);
  assert.equal(matching[0].ageBand, '2-4');
});

test('vibe filters combine with the text query', () => {
  const index = createMemoryIndex(STORIES);
  const results = index.search('scared of the dark', { vibe: 'silly' });
  assert.equal(results.length, 0);
});

test('coping text is searchable', () => {
  const index = createMemoryIndex(STORIES);
  const results = index.search('making a game of waiting');
  assert.ok(results.length >= 1);
  assert.equal(results[0].coping, 'making a game of waiting');
});

test('runSearch never returns an off-vocabulary emotion in interpreted filters', () => {
  const index = createMemoryIndex(STORIES);
  const results = index.search('scared of the dark');
  for (const r of results) {
    for (const e of r.emotions) {
      assert.notEqual(e, undefined);
    }
  }
});
