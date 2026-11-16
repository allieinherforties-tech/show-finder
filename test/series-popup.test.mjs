// The poster-tap series popup: the approved descriptions join onto the strip
// at build time, and each tile ships its own detail template that app.js
// clones into the shared dialog. Tests here hold both halves: the join's
// fail-fast gates (a strip series with no row, a duplicate, a stale row, or
// an unverified link stops the build) and the served markup contract the
// dialog depends on (verbatim description, honest suggested age band, the
// two actions).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { joinSeriesDescriptions, suggestedAgeLine } from '../src/pipeline/series-descriptions.mjs';
import { renderSeriesStrip, escapeHtml } from '../src/rails.mjs';

const artifact = JSON.parse(readFileSync('data/search/search-artifact.json', 'utf8'));
const dump = JSON.parse(readFileSync('data/source/wb_a6zJ9L6l_sh_udod4EbT.json', 'utf8'));

function fixturePoster(title = 'Fixture Show') {
  return [{ title, posterUrl: `https://image.tmdb.org/t/p/w342/${encodeURIComponent(title)}.jpg` }];
}

function fixtureRow(overrides = {}) {
  return {
    series_title: 'Fixture Show',
    description: 'A fixture description.',
    age_band: '5-7',
    apple_series_url: 'https://tv.apple.com/us/show/fixture-show/umc.cmc.abc123def456ghi789jkl012',
    link_status: 'verified',
    ...overrides,
  };
}

test('the age band reads as a suggestion, en dash per the approved copy', () => {
  assert.equal(suggestedAgeLine('5-7'), 'Suggested for ages 5–7');
  assert.equal(suggestedAgeLine('2-4'), 'Suggested for ages 2–4');
});

test('the join extends each poster entry with description, age band, and link', () => {
  const joined = joinSeriesDescriptions(fixturePoster(), [fixtureRow()]);
  assert.equal(joined.length, 1);
  assert.deepEqual(joined[0], {
    title: 'Fixture Show',
    posterUrl: 'https://image.tmdb.org/t/p/w342/Fixture%20Show.jpg',
    description: 'A fixture description.',
    ageBand: '5-7',
    appleSeriesUrl: 'https://tv.apple.com/us/show/fixture-show/umc.cmc.abc123def456ghi789jkl012',
  });
});

test('the build fails when a strip series has no description row', () => {
  assert.throws(
    () => joinSeriesDescriptions(fixturePoster('Uncovered Show'), [fixtureRow()]),
    /Uncovered Show: no description row/,
  );
  // And when the dump is absent entirely (the dump file missing in a
  // checkout), every strip series fails loudly rather than shipping bare.
  assert.throws(() => joinSeriesDescriptions(fixturePoster(), []), /no description row/);
});

test('the build fails on duplicate description rows for one series', () => {
  assert.throws(
    () => joinSeriesDescriptions(fixturePoster(), [fixtureRow(), fixtureRow({ description: 'again' })]),
    /duplicate description rows/,
  );
});

test('the build fails on a stale row for a series the strip does not publish', () => {
  assert.throws(
    () => joinSeriesDescriptions(fixturePoster(), [fixtureRow(), fixtureRow({ series_title: 'Retired Show' })]),
    /Retired Show: description row names a series the strip does not publish/,
  );
});

test('the build fails on an unverified link or a non-canonical URL', () => {
  assert.throws(
    () => joinSeriesDescriptions(fixturePoster(), [fixtureRow({ link_status: 'unverified' })]),
    /ships only verified links/,
  );
  assert.throws(
    () => joinSeriesDescriptions(fixturePoster(), [fixtureRow({ apple_series_url: 'https://example.com/show' })]),
    /not a canonical tv\.apple\.com link/,
  );
});

test('the build fails on empty required fields', () => {
  assert.throws(() => joinSeriesDescriptions(fixturePoster(), [fixtureRow({ description: '' })]), /description is empty/);
  assert.throws(() => joinSeriesDescriptions(fixturePoster(), [fixtureRow({ age_band: '' })]), /age_band is empty/);
  assert.throws(() => joinSeriesDescriptions(fixturePoster(), [fixtureRow({ apple_series_url: '' })]), /apple_series_url is empty/);
});

test('the stamped artifact carries the approved data for all 18 series', () => {
  assert.equal(artifact.seriesPosters.length, 18);
  const rowsByTitle = new Map(dump.rows.map((r) => [r.series_title, r]));
  for (const entry of artifact.seriesPosters) {
    const row = rowsByTitle.get(entry.title);
    assert.ok(row, `${entry.title} has an approved row`);
    assert.equal(entry.description, String(row.description).trim(), `${entry.title} ships the description verbatim`);
    assert.ok(entry.ageBand, `${entry.title} has an age band`);
    assert.ok(entry.appleSeriesUrl.startsWith('https://tv.apple.com/'), `${entry.title} links to tv.apple.com`);
  }
});

test('every tile ships a detail template with the verbatim description and the age line', () => {
  const html = renderSeriesStrip(artifact.seriesPosters);
  assert.equal((html.match(/<template class="series-detail">/g) || []).length, 18);
  for (const entry of artifact.seriesPosters) {
    const tile = html.slice(html.indexOf(`<a class="series-poster" href="/?series=${encodeURIComponent(entry.title)}"`));
    const template = tile.slice(0, tile.indexOf('</template>'));
    assert.ok(template.includes(escapeHtml(entry.description)), `${entry.title} renders its description verbatim`);
    assert.ok(template.includes(escapeHtml(suggestedAgeLine(entry.ageBand))), `${entry.title} renders the suggested age line`);
    assert.ok(template.includes('class="series-dialog-thumb"'), `${entry.title} carries its poster thumbnail`);
    assert.ok(/<img class="series-dialog-thumb"[^>]*alt=""/.test(template), `${entry.title} thumbnail is decorative (title is the dialog heading)`);
  }
});

test('the popup actions: primary watch on Apple TV+, secondary browse the facet', () => {
  const html = renderSeriesStrip(artifact.seriesPosters);
  for (const entry of artifact.seriesPosters) {
    const tile = html.slice(html.indexOf(`<a class="series-poster" href="/?series=${encodeURIComponent(entry.title)}"`));
    const template = tile.slice(0, tile.indexOf('</template>'));
    const href = `/?series=${encodeURIComponent(entry.title)}`;
    assert.ok(
      template.includes(`href="${escapeHtml(entry.appleSeriesUrl)}" target="_blank" rel="noopener noreferrer"`),
      `${entry.title} watch button opens the verified Apple series page in a new tab`,
    );
    assert.ok(template.includes(`aria-label="Watch ${escapeHtml(entry.title)} on Apple TV+"`), `${entry.title} watch button is named per series`);
    assert.ok(template.includes('>Watch on Apple TV+</a>'), `${entry.title} watch button uses the canonical provider label`);
    assert.ok(template.includes(`class="series-dialog-browse" href="${href}"`), `${entry.title} browse link deep-links the facet`);
    assert.ok(template.includes('>Browse these stories</a>'), `${entry.title} browse link uses the approved diction`);
  }
});
