// Artwork join: story rows × TMDB artwork dump × Apple registry, all pure.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildArtworkIndex,
  stillKey,
  tmdbImageUrl,
  attachAll,
} from '../src/pipeline/artwork.mjs';

const FIXTURE_DUMP = {
  imageBase: 'https://image.tmdb.org/t/p',
  posters: { '111834': '/stillwaterPoster.jpg', '112148': '/dougPoster.jpg' },
  stills: { '111834:1:4': '/stillwaterS1E4.jpg', '111834:1:5': '/stillwaterS1E5.jpg' },
  missing: [],
};

const FIXTURE_TITLES = {
  rows: [
    { title: 'Stillwater', type: 'Series', tmdb_id: '111834' },
    { title: 'Doug Unplugs', type: 'Series', tmdb_id: '112148' },
    { title: 'A Charlie Brown Christmas', type: 'Film', tmdb_id: '13187' },
  ],
};

const FIXTURE_EPISODES = {
  rows: [
    { series_title: 'Stillwater', series_tmdb_id: '111834' },
    { series_title: 'Doug Unplugs', series_tmdb_id: '112148' },
  ],
};

const FIXTURE_REGISTRY = {
  shows: [
    { seriesTitle: 'Stillwater', slug: 'stillwater', showId: 'umc.cmc.3czcagetjq31vvbgkkyp1xiao', verifiedEpisodes: [{ seasonNumber: 1, episodeNumber: 4, slug: 'addys-breakpuzzled', episodeId: 'umc.cmc.30shwbrm280q8iyhg2hbllvf4' }] },
  ],
};

test('tmdb paths resolve to hotlinked image URLs, empty paths to null', () => {
  assert.equal(tmdbImageUrl(null, '/abc.jpg', 'w780'), 'https://image.tmdb.org/t/p/w780/abc.jpg');
  assert.equal(tmdbImageUrl(null, 'abc.jpg', 'w780'), 'https://image.tmdb.org/t/p/w780/abc.jpg');
  assert.equal(tmdbImageUrl(null, '', 'w780'), null);
  assert.equal(tmdbImageUrl(null, null, 'w780'), null);
});

test('episode stills win, series posters are the fallback, neither means no artwork', () => {
  const index = buildArtworkIndex({ artworkDump: FIXTURE_DUMP, titlesDump: FIXTURE_TITLES, episodesDump: FIXTURE_EPISODES });
  const stories = [
    { id: 'a', seriesTitle: 'Stillwater', seasonNumber: 1, episodeNumber: 4 },
    { id: 'b', seriesTitle: 'Doug Unplugs', seasonNumber: 1, episodeNumber: 1 },
    { id: 'c', seriesTitle: 'Unknown Show', seasonNumber: 1, episodeNumber: 1 },
  ];
  const coverage = attachAll(stories, index, FIXTURE_REGISTRY);
  assert.equal(stories[0].stillUrl, 'https://image.tmdb.org/t/p/w780/stillwaterS1E4.jpg');
  assert.equal(stories[1].stillUrl, null);
  assert.equal(stories[1].posterUrl, 'https://image.tmdb.org/t/p/w342/dougPoster.jpg');
  assert.equal(stories[2].stillUrl, null);
  assert.equal(stories[2].posterUrl, null);
  assert.deepEqual(coverage, {
    stills: 1,
    posterFallback: 1,
    noArtwork: 1,
    episodeLinks: 1,
    showLinks: 0,
    noLink: 2,
    unresolvedSeries: ['Unknown Show'],
    mismatches: [],
  });
});

test('a two story episode shares one still, like an episode shares its artwork', () => {
  const index = buildArtworkIndex({ artworkDump: FIXTURE_DUMP, titlesDump: FIXTURE_TITLES, episodesDump: FIXTURE_EPISODES });
  const stories = [
    { id: 'seg1', seriesTitle: 'Stillwater', seasonNumber: 1, episodeNumber: 4 },
    { id: 'seg2', seriesTitle: 'Stillwater', seasonNumber: 1, episodeNumber: 4 },
  ];
  attachAll(stories, index, FIXTURE_REGISTRY);
  assert.equal(stories[0].stillUrl, stories[1].stillUrl);
});

test('Titles and Episodes sheet id disagreements are reported as mismatches', () => {
  const titles = { rows: [{ title: 'Stillwater', type: 'Series', tmdb_id: '999999' }] };
  const episodes = { rows: [{ series_title: 'Stillwater', series_tmdb_id: '111834' }] };
  const index = buildArtworkIndex({ artworkDump: FIXTURE_DUMP, titlesDump: titles, episodesDump: episodes });
  assert.equal(index.mismatches.length, 1);
  assert.match(index.mismatches[0], /Titles sheet says tmdb 999999, Episodes sheet says 111834/);
});

test('still keys are stable and include all three id parts', () => {
  assert.equal(stillKey('111834', 1, 4), '111834:1:4');
});
