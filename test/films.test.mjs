// The standalone-film pipeline: normalization, gates, and the serving
// exclusions that keep films out of every series-discovery surface. Fixtures
// here mirror the real corpus sheet's shape (one row per film keyed by TMDB
// id, link_status and evidence_tier carried per row).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  duplicateFilmIdProblems,
  filmCatalogByTmdbId,
  filmRowProblems,
  normalizeFilmRow,
} from '../src/pipeline/films.mjs';
import { collectSeriesPosters } from '../src/pipeline/artwork.mjs';
import { filmSuppressionReasons } from '../src/pipeline/parent-facing.mjs';
import { createMemoryIndex } from '../src/search/store.mjs';

const PROVENANCE = {
  workbookId: 'wb_66lUb18u',
  workbookName: 'Standalone Films Corpus',
  sheetId: 'sh_RJTvV8CA',
  sheetName: 'Standalone Films Corpus (34 Films)',
};

function rawFilm(overrides = {}) {
  return {
    film_title: 'A Charlie Brown Thanksgiving',
    tmdb_id: '13479',
    situation: 'Peppermint Patty invites herself and the gang to Thanksgiving dinner.',
    emotion: 'nervous/worried, embarrassed',
    coping: 'asking for help',
    age_band: '5-7',
    vibe: 'silly',
    emoji: '🦃 🥧 🏈',
    notes: 'Script-verified: subslikescript full transcript',
    per_story_synopsis: null,
    synopsis: 'Peppermint Patty invites herself to dinner.',
    evidence_tier: 'title_overview',
    apple_tv_link: 'https://tv.apple.com/us/movie/a-charlie-brown-thanksgiving/umc.cmc.7grdgbjdq3tiy37f4dc3yeyms',
    apple_tv_link_verified_date: '2026-11-16',
    link_status: 'verified',
    ...overrides,
  };
}

const CATALOG_FILM = { releaseYear: '1973', runtimeMinutes: 25 };

test('a film row normalizes with the film title as the card heading and null season data', () => {
  const film = normalizeFilmRow(rawFilm(), PROVENANCE, CATALOG_FILM);
  assert.equal(film.kind, 'film');
  assert.equal(film.id, 'film-a-charlie-brown-thanksgiving-13479');
  assert.equal(film.seriesTitle, 'A Charlie Brown Thanksgiving');
  assert.equal(film.seasonNumber, null);
  assert.equal(film.episodeNumber, null);
  assert.equal(film.releaseYear, '1973');
  assert.equal(film.runtimeMinutes, 25);
  assert.equal(film.evidenceTier, 'title_overview');
});

test('year and runtime join from the Titles catalog by TMDB id, never from the corpus sheet', () => {
  const catalog = filmCatalogByTmdbId({
    rows: [
      { tmdb_id: '13479', type: 'Film', release_year: '1973', runtime_minutes: '25' },
      { tmdb_id: '1423632', type: 'Film', release_year: '2025', runtime_minutes: '26' },
      { tmdb_id: '12345', type: 'Series', release_year: '2000', runtime_minutes: '22' },
    ],
  });
  assert.deepEqual(catalog.get('13479'), { releaseYear: '1973', runtimeMinutes: 25 });
  assert.equal(catalog.get('12345'), undefined, 'a Series row never feeds the film join');
  const noRuntime = normalizeFilmRow(
    rawFilm({ tmdb_id: '12345' }),
    PROVENANCE,
    { releaseYear: '2000', runtimeMinutes: null },
  );
  assert.equal(noRuntime.runtimeMinutes, null, 'runtime is nullable; the subtitle omits it');
});

test('GATE: a film row without link_status=verified fails', () => {
  const problems = filmRowProblems(normalizeFilmRow(rawFilm({ link_status: 'pending' }), PROVENANCE, CATALOG_FILM));
  assert.ok(problems.some((p) => p.includes("not 'verified'")));
  // And every corpus row as shipped is clean.
  assert.deepEqual(filmRowProblems(normalizeFilmRow(rawFilm(), PROVENANCE, CATALOG_FILM)), []);
});

test('GATE: a film row with no Titles-catalog join fails (no release year to display)', () => {
  const problems = filmRowProblems(normalizeFilmRow(rawFilm(), PROVENANCE, undefined));
  assert.ok(problems.some((p) => p.includes('no Titles-catalog film row')));
});

test('GATE: an unknown evidence tier fails', () => {
  const problems = filmRowProblems(normalizeFilmRow(rawFilm({ evidence_tier: 'hunch' }), PROVENANCE, CATALOG_FILM));
  assert.ok(problems.some((p) => p.includes('unknown evidence tier')));
});

test('empty coping or emotion is faithful upstream absence, never a gate', () => {
  const sparse = normalizeFilmRow(rawFilm({ coping: null, emotion: null }), PROVENANCE, CATALOG_FILM);
  assert.deepEqual(filmRowProblems(sparse), []);
  assert.deepEqual(sparse.emotions, []);
  assert.equal(sparse.coping, '');
});

test('GATE: duplicate film ids fail (exactly one row per TMDB id)', () => {
  const films = [
    normalizeFilmRow(rawFilm(), PROVENANCE, CATALOG_FILM),
    normalizeFilmRow(rawFilm({ evidence_tier: 'synopsis_fallback' }), { ...PROVENANCE, sheetId: 'sh_other' }, CATALOG_FILM),
  ];
  assert.equal(duplicateFilmIdProblems(films).length, 1);
  assert.deepEqual(duplicateFilmIdProblems([films[0]]), []);
});

test('films stay out of the series poster strip, even with a poster resolved', () => {
  const seriesPosters = collectSeriesPosters([
    { kind: 'episode', seriesTitle: 'Frog and Toad', posterUrl: 'https://image.tmdb.org/t/p/w342/a.jpg' },
    { kind: 'film', seriesTitle: 'Blush', posterUrl: 'https://image.tmdb.org/t/p/w342/b.jpg' },
    { kind: 'film', seriesTitle: 'A Charlie Brown Christmas', posterUrl: 'https://image.tmdb.org/t/p/w342/c.jpg' },
    { kind: 'film', seriesTitle: 'A Charlie Brown Christmas', posterUrl: 'https://image.tmdb.org/t/p/w342/c.jpg' },
  ]);
  assert.deepEqual(seriesPosters.map((p) => p.title), ['Frog and Toad']);
});

test('the film honesty gate scans parent-facing fields only, never the notes tier language', () => {
  const film = normalizeFilmRow(
    rawFilm({ notes: 'synopsis-only: no verified script source; registered fallback' }),
    PROVENANCE,
    CATALOG_FILM,
  );
  // Tier language lives in notes, which is internal: no suppression.
  assert.deepEqual(filmSuppressionReasons(film), []);
  // But annotation prose in a parent-facing field still stops the row.
  const annotated = normalizeFilmRow(
    rawFilm({ situation: 'synopsis-only situation text' }),
    PROVENANCE,
    CATALOG_FILM,
  );
  assert.equal(filmSuppressionReasons(annotated).length, 1);
});

function filmRowFixture(overrides = {}) {
  return {
    ...normalizeFilmRow(rawFilm(), PROVENANCE, CATALOG_FILM),
    displaySynopsis: 'Peppermint Patty invites herself to dinner.',
    ...overrides,
  };
}

function episodeRowFixture() {
  return {
    id: 'frog-and-toad-s1-e1-seg1',
    kind: 'episode',
    seriesTitle: 'Frog and Toad',
    seasonNumber: 1,
    episodeNumber: 1,
    episodeTitle: 'Cookies',
    segment: 1,
    segmentTitle: 'Cookies',
    situation: 'Toad bakes cookies.',
    emotions: ['happy'],
    emotionOffList: [],
    coping: 'willpower schemes',
    ageBand: '5-7',
    vibe: 'silly',
    displaySynopsis: 'Frog and Toad try to resist cookies.',
    posterUrl: null,
    stillUrl: null,
    appleUrl: null,
    appleLinkKind: null,
    provider: 'apple',
    providerLabel: 'Apple TV+',
  };
}

test('a film is searchable and serves in results with kind, year, and runtime', () => {
  const index = createMemoryIndex([episodeRowFixture(), filmRowFixture()]);
  const { results, facets } = index.search('thanksgiving', { facets: true });
  const film = results.find((r) => r.kind === 'film');
  assert.ok(film, 'the film matches a film-title query');
  assert.equal(film.releaseYear, '1973');
  assert.equal(film.runtimeMinutes, 25);
  assert.equal(film.seriesTitle, 'A Charlie Brown Thanksgiving');
  // A film match contributes no series facet: a film is not a clarifier chip.
  assert.deepEqual(facets.series, []);
  // Films are not series in the index either, so a series filter can never
  // name one.
  assert.equal(index.seriesTitles.has('A Charlie Brown Thanksgiving'), false);
  assert.equal(index.seriesTitles.has('Frog and Toad'), true);
  // On a broad match across both kinds, the facet counts only the series.
  const broad = index.search('', { facets: true });
  assert.deepEqual(broad.facets.series.map((f) => f.title), ['Frog and Toad']);
});

test('a film serves through the emotion and age filters like a series row', () => {
  const index = createMemoryIndex([filmRowFixture()]);
  const { results } = index.search('', { emotionFacet: 'nervous/worried', ageBand: '5-7', facets: true });
  assert.equal(results.length, 1, 'the film answers the feeling filter');
});
