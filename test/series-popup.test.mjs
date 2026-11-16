// The poster-tap series popup: the approved overview copy joins onto the
// strip at build time, and each tile ships its own detail template that
// app.js clones into the shared dialog. Tests here hold both halves: the
// join's fail-fast gates (a strip series with no row, a duplicate, a stale
// row, a missing overview, or an unverified link stops the build) and the
// served markup contract the dialog depends on (the lean v3.0 shape: unlabeled
// overview paragraph, the suggested age band, the two actions, and no
// five-block headings anywhere on a series card).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { joinSeriesDescriptions, suggestedAgeLine, internalIdentifierHits } from '../src/pipeline/series-descriptions.mjs';
import { renderSeriesStrip, escapeHtml } from '../src/rails.mjs';

const artifact = JSON.parse(readFileSync('data/search/search-artifact.json', 'utf8'));
const dump = JSON.parse(readFileSync('data/source/wb_a6zJ9L6l_sh_udod4EbT.json', 'utf8'));

function fixturePoster(title = 'Fixture Show') {
  return [{ title, posterUrl: `https://image.tmdb.org/t/p/w342/${encodeURIComponent(title)}.jpg` }];
}

function fixtureRow(overrides = {}) {
  return {
    series_title: 'Fixture Show',
    age_band: '5-7',
    age_band_basis: 'All 10 tagged rows age 5-7 (Fixture Dev Set, wb_FIXTURE).',
    apple_series_url: 'https://tv.apple.com/us/show/fixture-show/umc.cmc.abc123def456ghi789jkl012',
    link_status: 'verified',
    series_overview: 'Two friends share a spring lake summer, one badge at a time.',
    what_happens: 'A fixture premise, told story first.',
    feelings: 'Worry at the start, pride at the end.',
    situation: 'A fixture situation a parent might recognize.',
    resolution: 'The fix names the feeling out loud.',
    ...overrides,
  };
}

test('the age band reads as a suggestion, en dash per the approved copy', () => {
  assert.equal(suggestedAgeLine('5-7'), 'Suggested for ages 5–7');
  assert.equal(suggestedAgeLine('2-4'), 'Suggested for ages 2–4');
});

test('the join extends each poster entry with the lean v3.0 fields and carries no internal basis', () => {
  const joined = joinSeriesDescriptions(fixturePoster(), [fixtureRow()]);
  assert.equal(joined.length, 1);
  assert.deepEqual(joined[0], {
    title: 'Fixture Show',
    posterUrl: 'https://image.tmdb.org/t/p/w342/Fixture%20Show.jpg',
    overview: 'Two friends share a spring lake summer, one badge at a time.',
    ageBand: '5-7',
    appleSeriesUrl: 'https://tv.apple.com/us/show/fixture-show/umc.cmc.abc123def456ghi789jkl012',
  });
  // The workbook's age_band_basis stays internal: the join drops it even
  // when the workbook row carries it, so no render path can leak it.
  assert.equal('ageBandBasis' in joined[0], false, 'ageBandBasis never joins the popup entry');
});

test('the five-block fields stay internal data: they never join the popup entry', () => {
  // Allie's v3.0 ruling: what_happens, feelings, situation, and resolution
  // are per-story tools. The workbook keeps them; the popup entry does not.
  const joined = joinSeriesDescriptions(fixturePoster(), [fixtureRow()]);
  for (const field of ['whatHappens', 'feelings', 'situation', 'resolution']) {
    assert.equal(field in joined[0], false, `${field} never joins the popup entry`);
  }
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
  assert.throws(() => joinSeriesDescriptions(fixturePoster(), [fixtureRow({ series_overview: '' })]), /series_overview is empty/);
  assert.throws(() => joinSeriesDescriptions(fixturePoster(), [fixtureRow({ age_band: '' })]), /age_band is empty/);
  assert.throws(() => joinSeriesDescriptions(fixturePoster(), [fixtureRow({ apple_series_url: '' })]), /apple_series_url is empty/);
});

test('the parent-facing gate fails the build on internal identifiers in rendered fields', () => {
  for (const [column, value] of [
    ['age_band', 'Batch 1 band 2-4'],
    ['series_overview', 'A premise from the Dev Set.'],
    ['series_overview', 'The premise (wb_FIXTURE).'],
  ]) {
    assert.throws(
      () => joinSeriesDescriptions(fixturePoster(), [fixtureRow({ [column]: value })]),
      /internal identifier/,
      `${column} carrying internal identifiers stops the build`,
    );
  }
  // The title renders everywhere (heading, aria labels, browse link), so a
  // workbook id in it is leak too. Title and poster must stay in sync for
  // the row to reach the identifier check at all.
  const leakyTitle = 'Frog and Toad (wb_CugBbpqS)';
  assert.throws(
    () => joinSeriesDescriptions(fixturePoster(leakyTitle), [fixtureRow({ series_title: leakyTitle })]),
    /series_title contains the internal identifier "wb_"/,
  );
});

test('the gate is case-insensitive and reports every matching marker', () => {
  assert.deepEqual(internalIdentifierHits('All 16 TAGGED ROWS age 2-4'), ['tagged rows']);
  assert.deepEqual(internalIdentifierHits('Batch 1 Series Script DEV SET, wb_CugBbpqS'), ['wb_', 'dev set', 'batch']);
  assert.deepEqual(internalIdentifierHits('A clean parent-facing sentence.'), []);
});

test('no internal identifier renders anywhere in the served strip markup', () => {
  const html = renderSeriesStrip(artifact.seriesPosters);
  for (const marker of ['wb_', 'dev set', 'batch', 'tagged rows', 'wave']) {
    assert.ok(!html.toLowerCase().includes(marker), `the strip markup never contains "${marker}"`);
  }
  // The workbook keeps its basis text (the copy the QA report caught), but
  // that text never reaches the markup.
  const frogRow = dump.rows.find((r) => r.series_title === 'Frog and Toad');
  assert.ok(frogRow && String(frogRow.age_band_basis || '').includes('wb_'), 'Frog and Toad keeps its internal basis in the workbook');
  assert.ok(!html.includes(escapeHtml(frogRow.age_band_basis)), 'Frog and Toad basis text never renders');
});

test('the stamped artifact carries the approved data for every published series', () => {
  // Count-agnostic: the strip grows with the catalog (18 today, 53 to come),
  // so the popup entries are checked against the description rows they join,
  // never against a hardcoded series count.
  const rowsByTitle = new Map(dump.rows.map((r) => [r.series_title, r]));
  assert.equal(artifact.seriesPosters.length, rowsByTitle.size, 'one popup entry per description row');
  for (const entry of artifact.seriesPosters) {
    const row = rowsByTitle.get(entry.title);
    assert.ok(row, `${entry.title} has an approved row`);
    assert.equal(entry.overview, String(row.series_overview).trim(), `${entry.title} ships series_overview verbatim`);
    assert.ok(entry.ageBand, `${entry.title} has an age band`);
    assert.equal('ageBandBasis' in entry, false, `${entry.title} ships no age_band_basis (internal data)`);
    assert.ok(entry.appleSeriesUrl.startsWith('https://tv.apple.com/'), `${entry.title} links to tv.apple.com`);
  }
});

test('every tile ships a detail template in the lean v3.0 shape', () => {
  const html = renderSeriesStrip(artifact.seriesPosters);
  assert.equal((html.match(/<template class="series-detail">/g) || []).length, artifact.seriesPosters.length);
  for (const entry of artifact.seriesPosters) {
    const tile = html.slice(html.indexOf(`<a class="series-poster" href="/?series=${encodeURIComponent(entry.title)}"`));
    const template = tile.slice(0, tile.indexOf('</template>'));
    // The overview renders verbatim, unlabeled: no 'What happens' heading
    // above it, and the only labeled block on the card is Ages.
    assert.ok(template.includes(`<p class="series-dialog-overview">${escapeHtml(entry.overview)}</p>`), `${entry.title} renders series_overview verbatim`);
    const headings = [...template.matchAll(/<h3 class="series-dialog-heading">([^<]+)<\/h3>/g)].map((m) => m[1]);
    assert.deepEqual(headings, ['Ages'], `${entry.title} labels only the Ages block`);
    assert.ok(template.includes(escapeHtml(suggestedAgeLine(entry.ageBand))), `${entry.title} renders the suggested age line under Ages`);
    assert.ok(!template.includes('series-dialog-age-basis'), `${entry.title} renders no basis line under Ages`);
    assert.ok(template.includes('class="series-dialog-thumb"'), `${entry.title} carries its poster thumbnail`);
    assert.ok(/<img class="series-dialog-thumb"[^>]*alt=""/.test(template), `${entry.title} thumbnail is decorative (title is the dialog heading)`);
  }
});

test('the five-block headings and copy are gone from the series popup markup', () => {
  // Allie's v3.0 ruling: the five blocks are per-story tools. Their headings
  // never render on a series card, and their workbook copy never leaks into
  // a series template either.
  const html = renderSeriesStrip(artifact.seriesPosters);
  for (const heading of ['What happens', 'Feelings', 'Situation', 'Resolution']) {
    assert.ok(!html.includes(`>${heading}</h3>`), `the "${heading}" heading is gone from series cards`);
  }
  const rowsByTitle = new Map(dump.rows.map((r) => [r.series_title, r]));
  for (const entry of artifact.seriesPosters) {
    const tile = html.slice(html.indexOf(`<a class="series-poster" href="/?series=${encodeURIComponent(entry.title)}"`));
    const template = tile.slice(0, tile.indexOf('</template>'));
    for (const column of ['what_happens', 'feelings', 'situation', 'resolution']) {
      const internal = String(rowsByTitle.get(entry.title)[column] || '').trim();
      assert.ok(internal, `${entry.title} keeps its internal ${column} in the workbook`);
      // When the approved overview copy itself holds the same sentence
      // (Duck & Goose), the appearance is the parent-facing overview, not
      // the internal field rendering; only a distinct text is a leak.
      if (internal === entry.overview) continue;
      assert.ok(!template.includes(escapeHtml(internal)), `${entry.title} never renders the internal ${column}`);
    }
  }
});

test('the retired single description column is gone from the popup markup', () => {
  const html = renderSeriesStrip(artifact.seriesPosters);
  assert.ok(!html.includes('series-dialog-description'), 'the old description paragraph is not rendered');
  const rowsByTitle = new Map(dump.rows.map((r) => [r.series_title, r]));
  for (const entry of artifact.seriesPosters) {
    const tile = html.slice(html.indexOf(`<a class="series-poster" href="/?series=${encodeURIComponent(entry.title)}"`));
    const template = tile.slice(0, tile.indexOf('</template>'));
    const retired = String(rowsByTitle.get(entry.title).description || '').trim();
    assert.ok(retired, `${entry.title} still has a description column in the workbook`);
    assert.ok(!template.includes(escapeHtml(retired)), `${entry.title} no longer renders the old description column`);
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
