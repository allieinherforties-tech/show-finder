import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('every published story row in the built artifact carries the provider fields (backfill ruling)', () => {
  const artifact = JSON.parse(readFileSync('data/search/search-artifact.json', 'utf8'));
  assert.ok(artifact.stories.length > 0, 'the artifact publishes rows');
  for (const story of artifact.stories) {
    assert.equal(story.provider, 'apple', `${story.id} carries the provider key`);
    assert.equal(story.providerLabel, 'Apple TV+', `${story.id} carries the display label`);
  }
});

// The PRD v1.1 watch-link fallback: a story row with no verified Apple URL
// still resolves its series page at serve time, so every card carries a
// watch affordance. Nothing is written back: the artifact row stays as the
// curation left it.
test('a row with no verified link falls back to its series page at serve time', () => {
  const seriesPosters = [
    { title: 'Test Series', appleSeriesUrl: 'https://tv.apple.com/us/show/test-series/umc.cmc.testseriesregistry' },
  ];
  const index = createMemoryIndex(STORIES, undefined, seriesPosters);
  const [result] = index.search('scared of the dark');
  assert.equal(
    result.appleUrl,
    'https://tv.apple.com/us/show/test-series/umc.cmc.testseriesregistry',
    'the series page fills the empty watch link',
  );
  assert.equal(result.appleLinkKind, 'show', 'the fallback resolves as a show-page link');
});

test('a row with a verified link keeps it over the series fallback', () => {
  // Link fields are joined downstream of normalizeStoryRow (the build does
  // the join), so the fixture attaches them to the normalized row directly.
  const linked = [
    {
      ...normalizeStoryRow(
        {
          series_title: 'Test Series', season_number: '1', episode_number: '1',
          segment: '1', segment_title: 'The Test Story',
          synopsis: 'A test story about the dark and bedtime.',
          situation: 'A kid is scared of the dark at bedtime.',
          emotion: 'scared', coping: 'naming the feeling', age_band: '2-4', vibe: 'calm',
        },
        { workbookId: 'wb_test', sheetId: 'sh_test' },
      ),
      appleUrl: 'https://tv.apple.com/us/episode/the-test-story/umc.cmc.episoderegistry00?showId=umc.cmc.showregistry0000',
      appleLinkKind: 'episode',
      provider: 'apple',
      providerLabel: 'Apple TV+',
    },
  ];
  const seriesPosters = [
    { title: 'Test Series', appleSeriesUrl: 'https://tv.apple.com/us/show/test-series/umc.cmc.testseriesregistry' },
  ];
  const index = createMemoryIndex(linked, undefined, seriesPosters);
  const [result] = index.search('scared of the dark');
  assert.equal(result.appleUrl, linked[0].appleUrl, 'the verified episode link wins');
  assert.equal(result.appleLinkKind, 'episode');
});

test('an index built without a series list resolves no fallback, and a film never does', () => {
  const bare = createMemoryIndex(STORIES);
  const [result] = bare.search('scared of the dark');
  assert.equal(result.appleUrl, null, 'no stamped series page means no invented link');
});
