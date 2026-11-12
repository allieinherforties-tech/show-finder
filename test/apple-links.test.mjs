// Apple TV deep link generator, validated against the verified per-episode
// sample list in the Findings: Apple TV+ Web URL Deep Links document
// (art_5OFQO4Vl). Every expected URL below is copied verbatim from that
// document's live-checked list.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  APPLE_LINK_PATTERNS,
  appleLinkFor,
  buildEpisodeUrl,
  buildMovieUrl,
  buildShowUrl,
  classifyAppleUrl,
  validateAppleRegistry,
} from '../src/links/apple-tv.mjs';

// From the findings document, verified live with HTTP 200 and title checks.
const VERIFIED_EPISODES = [
  {
    seriesTitle: 'Stillwater', showId: 'umc.cmc.3czcagetjq31vvbgkkyp1xiao',
    slug: 'addys-breakpuzzled', episodeId: 'umc.cmc.30shwbrm280q8iyhg2hbllvf4', season: 5, episode: 1,
    url: 'https://tv.apple.com/us/episode/addys-breakpuzzled/umc.cmc.30shwbrm280q8iyhg2hbllvf4?showId=umc.cmc.3czcagetjq31vvbgkkyp1xiao',
  },
  {
    seriesTitle: 'Camp Snoopy', showId: 'umc.cmc.4erhnrmkf9vgeojl3uryxsc0j',
    slug: 'a-clubhouse-built-for-two--a-camp-divided', episodeId: 'umc.cmc.7gbbanynb8qojufrh9xpyow15', season: 2, episode: 5,
    url: 'https://tv.apple.com/us/episode/a-clubhouse-built-for-two--a-camp-divided/umc.cmc.7gbbanynb8qojufrh9xpyow15?showId=umc.cmc.4erhnrmkf9vgeojl3uryxsc0j',
  },
  {
    seriesTitle: 'The Snoopy Show', showId: 'umc.cmc.5iswprrvjjw6ab020a17x4ca3',
    slug: 'big-beagle-on-campus', episodeId: 'umc.cmc.hw42a3hxxafzd8mhggfp2ai9', season: 2, episode: 9,
    url: 'https://tv.apple.com/us/episode/big-beagle-on-campus/umc.cmc.hw42a3hxxafzd8mhggfp2ai9?showId=umc.cmc.5iswprrvjjw6ab020a17x4ca3',
  },
  {
    seriesTitle: 'The Snoopy Show', showId: 'umc.cmc.5iswprrvjjw6ab020a17x4ca3',
    slug: 'happiness-is-a-day-at-the-beach', episodeId: 'umc.cmc.3tuegusa46y9r9b35n7fti246', season: 3, episode: 1,
    url: 'https://tv.apple.com/us/episode/happiness-is-a-day-at-the-beach/umc.cmc.3tuegusa46y9r9b35n7fti246?showId=umc.cmc.5iswprrvjjw6ab020a17x4ca3',
  },
  {
    seriesTitle: 'Fraggle Rock: Back to the Rock', showId: 'umc.cmc.2r077021gw7fu0noml0hln2yq',
    slug: 'pilot', episodeId: 'umc.cmc.3y8c99tqcap65j8dvzymj8r8q', season: 1, episode: 1,
    url: 'https://tv.apple.com/us/episode/pilot/umc.cmc.3y8c99tqcap65j8dvzymj8r8q?showId=umc.cmc.2r077021gw7fu0noml0hln2yq',
  },
  {
    seriesTitle: 'Fraggle Rock: Back to the Rock', showId: 'umc.cmc.2r077021gw7fu0noml0hln2yq',
    slug: 'deep-dive', episodeId: 'umc.cmc.3f0yrt3oohwlg3lhdj75nlcj2', season: 1, episode: 11,
    url: 'https://tv.apple.com/us/episode/deep-dive/umc.cmc.3f0yrt3oohwlg3lhdj75nlcj2?showId=umc.cmc.2r077021gw7fu0noml0hln2yq',
  },
  {
    seriesTitle: 'Fraggle Rock: Back to the Rock', showId: 'umc.cmc.2r077021gw7fu0noml0hln2yq',
    slug: 'all-of-us', episodeId: 'umc.cmc.345rksst31xrqiopt64mavpom', season: 1, episode: 13,
    url: 'https://tv.apple.com/us/episode/all-of-us/umc.cmc.345rksst31xrqiopt64mavpom?showId=umc.cmc.2r077021gw7fu0noml0hln2yq',
  },
  {
    seriesTitle: 'Sago Mini Friends', showId: 'umc.cmc.4ckulbycyeuavnlen3du06vvy',
    slug: 'a-little-fun--toothbrush-in-space', episodeId: 'umc.cmc.5phpwbskihylrtuilgin3g7qr', season: 3, episode: 2,
    url: 'https://tv.apple.com/us/episode/a-little-fun--toothbrush-in-space/umc.cmc.5phpwbskihylrtuilgin3g7qr?showId=umc.cmc.4ckulbycyeuavnlen3du06vvy',
  },
];

// The verified show pages and the verified film page, same document.
const VERIFIED_SHOWS = [
  { seriesTitle: 'Stillwater', slug: 'stillwater', showId: 'umc.cmc.3czcagetjq31vvbgkkyp1xiao' },
  { seriesTitle: 'Camp Snoopy', slug: 'camp-snoopy', showId: 'umc.cmc.4erhnrmkf9vgeojl3uryxsc0j' },
  { seriesTitle: 'The Snoopy Show', slug: 'the-snoopy-show', showId: 'umc.cmc.5iswprrvjjw6ab020a17x4ca3' },
  { seriesTitle: 'Fraggle Rock: Back to the Rock', slug: 'fraggle-rock-back-to-the-rock', showId: 'umc.cmc.2r077021gw7fu0noml0hln2yq' },
  { seriesTitle: 'Sago Mini Friends', slug: 'sago-mini-friends', showId: 'umc.cmc.4ckulbycyeuavnlen3du06vvy' },
];
const VERIFIED_FILM_URL = 'https://tv.apple.com/us/movie/theres-no-place-like-home-snoopy/umc.cmc.52sgmi3vdpedurrbtz6louqqo';

test('the generator reproduces every verified episode URL from the findings, character for character', () => {
  for (const v of VERIFIED_EPISODES) {
    assert.equal(buildEpisodeUrl(v.slug, v.episodeId, v.showId), v.url, v.seriesTitle);
  }
});

test('the generator reproduces the verified show and film URLs', () => {
  for (const s of VERIFIED_SHOWS) {
    assert.equal(buildShowUrl(s.slug, s.showId), `https://tv.apple.com/us/show/${s.slug}/${s.showId}`);
  }
  assert.equal(buildMovieUrl('theres-no-place-like-home-snoopy', 'umc.cmc.52sgmi3vdpedurrbtz6louqqo'), VERIFIED_FILM_URL);
});

test('the committed registry validates and matches the verified samples', () => {
  const registry = JSON.parse(readFileSync(path.resolve('data/source/apple-links.json'), 'utf8'));
  assert.equal(validateAppleRegistry(registry), true);
  for (const v of VERIFIED_EPISODES) {
    const link = appleLinkFor(
      { seriesTitle: v.seriesTitle, seasonNumber: v.season, episodeNumber: v.episode },
      registry,
    );
    assert.deepEqual(link, { url: v.url, kind: 'episode' });
  }
});

test('link resolution falls back to the show page when the episode id is not verified', () => {
  const registry = JSON.parse(readFileSync(path.resolve('data/source/apple-links.json'), 'utf8'));
  const link = appleLinkFor({ seriesTitle: 'Stillwater', seasonNumber: 1, episodeNumber: 1 }, registry);
  assert.deepEqual(link, { url: `https://tv.apple.com/us/show/stillwater/umc.cmc.3czcagetjq31vvbgkkyp1xiao`, kind: 'show' });
});

test('series with no verified pattern resolve to no link rather than an invented one', () => {
  const link = appleLinkFor({ seriesTitle: 'Doug Unplugs', seasonNumber: 1, episodeNumber: 1 }, {
    shows: VERIFIED_SHOWS.map((s) => ({ ...s, verifiedEpisodes: [] })),
  });
  assert.equal(link, null);
});

test('malformed links fail the pattern check', () => {
  const bad = [
    'https://tv.apple.com/uk/episode/pilot/umc.cmc.3y8c99tqcap65j8dvzymj8r8q?showId=umc.cmc.2r077021gw7fu0noml0hln2yq',
    'https://tv.apple.com/us/episode/pilot/umc.cmc.short',
    'https://tv.apple.com/us/episode/pilot/umc.cmc.3y8c99tqcap65j8dvzymj8r8q',
    'https://evil.example.com/us/episode/pilot/umc.cmc.3y8c99tqcap65j8dvzymj8r8q?showId=umc.cmc.2r077021gw7fu0noml0hln2yq',
    'https://tv.apple.com/us/show/the-snoopy-show/umc.cmc.5iswprrvjjw6ab020a17x4ca3?showId=umc.cmc.4erhnrmkf9vgeojl3uryxsc0j',
  ];
  for (const url of bad) {
    assert.equal(classifyAppleUrl(url), null, url);
  }
  // And each verified URL classifies to its own kind.
  for (const v of VERIFIED_EPISODES) assert.equal(classifyAppleUrl(v.url), 'episode');
  assert.equal(classifyAppleUrl(VERIFIED_FILM_URL), 'movie');
});

test('the id shape accepts the verified sample lengths and rejects malformed ids', () => {
  // Verified ids run 24 to 25 characters; the prose "22 chars" is wrong and
  // the pattern follows the samples, not the prose.
  const id25 = 'umc.cmc.' + 'a'.repeat(25);
  const id24 = 'umc.cmc.' + 'a'.repeat(24);
  assert.equal(APPLE_LINK_PATTERNS.show.test(`https://tv.apple.com/us/show/x/${id25}`), true);
  assert.equal(APPLE_LINK_PATTERNS.show.test(`https://tv.apple.com/us/show/x/${id24}`), true);
  const idShort = 'umc.cmc.' + 'a'.repeat(8);
  assert.equal(APPLE_LINK_PATTERNS.show.test(`https://tv.apple.com/us/show/x/${idShort}`), false);
});
