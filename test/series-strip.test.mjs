// The v1.1 browse-by-show strip: one real poster per published series,
// rendered server side from the build's stamped list. Every test here reads
// the production artifact, so a rebuild that breaks the strip's facts (a
// series loses its poster, a tap link stops deep-linking the series facet)
// fails the suite rather than shipping.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectSeriesPosters } from '../src/pipeline/artwork.mjs';
import { joinSeriesDescriptions } from '../src/pipeline/series-descriptions.mjs';
import { renderSeriesStrip, applySeriesStrip, SERIES_STRIP_PLACEHOLDER, SERIES_STRIP_SIZE, pickShuffledSeries, escapeHtml } from '../src/rails.mjs';

const artifact = JSON.parse(readFileSync('data/search/search-artifact.json', 'utf8'));
// Two popup sources stand behind the strip: the legacy workbook's committed
// dump (its upstream workbook is broken) covers the original 18 series, and
// the wave 2 additions workbook covers the rest. The strip joins both.
const descriptionRows = ['wb_a6zJ9L6l_sh_udod4EbT.json', 'wb_trZRboHn_sh_0V4G5H5q.json']
  .flatMap((file) => JSON.parse(readFileSync(`data/source/${file}`, 'utf8')).rows);
const seriesPosters = joinSeriesDescriptions(collectSeriesPosters(artifact.stories), descriptionRows);
const html = renderSeriesStrip(seriesPosters);

test('the strip renders one poster per published series, however many are published', () => {
  // Count-agnostic by ruling: the strip renders whatever series the artifact
  // publishes (18 today, growing toward 53), so every count below pins the
  // honest-count rule against the stamped list, never a hardcoded number.
  const count = seriesPosters.length;
  assert.ok(count > 0, 'the strip is never empty on a published corpus');
  assert.equal((html.match(/<li class="series-poster-item">/g) || []).length, count);
  assert.equal((html.match(/<a class="series-poster" /g) || []).length, count, 'one tap target per series');
  assert.equal((html.match(/<img class="series-poster-img" /g) || []).length, count);
});

test('the stamped artifact list matches a fresh derivation from the story rows', () => {
  assert.deepEqual(artifact.seriesPosters, seriesPosters, 'the build stamp and the story rows agree');
});

test('each series resolves exactly one distinct poster URL, and the build gate holds it', () => {
  const bySeries = new Map();
  for (const s of artifact.stories) {
    // Films are not series; they never enter the strip (diction ruling,
    // exclusions).
    if (s.kind === 'film') continue;
    if (!bySeries.has(s.seriesTitle)) bySeries.set(s.seriesTitle, new Set());
    if (s.posterUrl) bySeries.get(s.seriesTitle).add(s.posterUrl);
  }
  assert.equal(bySeries.size, seriesPosters.length, 'every distinct story series has a strip entry');
  for (const [title, posters] of bySeries) {
    assert.equal(posters.size, 1, `${title} resolves exactly one poster URL`);
  }
  // The gate: a series with two posters stops the build.
  assert.throws(() => collectSeriesPosters([
    { seriesTitle: 'Fixture Show', posterUrl: 'https://image.tmdb.org/t/p/w342/a.jpg' },
    { seriesTitle: 'Fixture Show', posterUrl: 'https://image.tmdb.org/t/p/w342/b.jpg' },
  ]), /exactly one/);
  // And a series with none stops the build rather than shipping a filler tile.
  assert.throws(() => collectSeriesPosters([
    { seriesTitle: 'Fixture Show', posterUrl: null },
  ]), /no poster resolved/);
});

test('every rendered poster is a real artifact poster URL, never a placeholder', () => {
  const realUrls = new Set(artifact.stories.map((s) => s.posterUrl).filter(Boolean));
  // Each poster renders twice, honestly: once on the tile, once as the
  // popup's thumbnail inside the tile's detail template.
  const srcs = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(srcs.length, seriesPosters.length * 2);
  for (const src of srcs) {
    assert.ok(realUrls.has(src), `rendered poster must come from the artifact: ${src}`);
  }
  assert.equal(/placeholder|filler/i.test(html), false);
});

test('every tap target deep-links the series facet and names the series accessibly', () => {
  const anchors = [...html.matchAll(/<a class="series-poster"([^>]+)>[\s\S]*?<\/a>/g)].map((m) => m);
  assert.equal(anchors.length, seriesPosters.length);
  for (const [i, match] of anchors.entries()) {
    const entry = seriesPosters[i];
    const attrs = match[1];
    assert.ok(attrs.includes(`href="/?series=${encodeURIComponent(entry.title)}"`), `the tap deep-links the series facet for ${entry.title}`);
    assert.ok(attrs.includes(`aria-label="About ${escapeHtml(entry.title)}"`), `the tap names its popup for ${entry.title}`);
    const img = match[0].match(/<img class="series-poster-img"([^>]+)>/)[1];
    assert.ok(img.includes(`alt="${escapeHtml(entry.title)}"`), `the series title is the image alt for ${entry.title}`);
  }
});

test('catalog titles can never inject markup into the strip', () => {
  const nasty = [{ title: 'Show <script>alert(1)</script> & "Pals"', posterUrl: 'https://image.tmdb.org/t/p/w342/x.jpg', overview: '<img src=x onerror=alert(1)>', ageBand: '5-7', appleSeriesUrl: 'https://tv.apple.com/us/show/x/umc.cmc.abc' }];
  const rendered = renderSeriesStrip(nasty);
  assert.equal(rendered.includes('<script'), false, 'script tags never survive escaping');
  assert.ok(rendered.includes('&lt;script&gt;'), 'the title renders escaped');
});

test('an empty list renders nothing: the strip never pads', () => {
  assert.equal(renderSeriesStrip([]), '');
  assert.equal(renderSeriesStrip(null), '');
  const page = `<main>${SERIES_STRIP_PLACEHOLDER}</main>`;
  const served = applySeriesStrip(page, []);
  assert.equal(served.includes(SERIES_STRIP_PLACEHOLDER), false, 'the placeholder never leaks');
  assert.equal(served, '<main></main>');
});

test('the strip renders server side with no script dependency and no auto-motion', () => {
  assert.equal(html.includes('<script'), false);
  // No motion hooks in the served markup: no CSS animation declarations, no
  // autoplay, no marquee. The bare word is allowed because popup overview
  // prose may legitimately describe a series as animation (Greatness Code).
  assert.equal(/@keyframes|animation\s*:|autoplay|<marquee/i.test(html), false);
  // The scroller is keyboard focusable so arrow keys reach the posters.
  assert.ok(html.includes('<ul class="series-posters" tabindex="0"'), 'the scroll row is keyboard reachable');
});

test('app.js yields the strip to story matches with the rails', async () => {
  const app = readFileSync('public/app.js', 'utf8');
  assert.ok(app.includes("getElementById('series-strip')"), 'app.js holds the strip');
  // Three toggle sites: idle returns it, zero matches return it, matches hide it.
  assert.equal((app.match(/seriesStrip\.hidden = (true|false)/g) || []).length, 3);
});

// The shuffle ruling (Allie, 2026-11-17): the strip serves ~15 posters per
// page load, picked fresh at random from the full published set, because
// recently added series' slower thumbnails were stalling the first paint.
// The pick is server side and per request: no cookies, no identifiers, no
// persistence; search and filters reach every published series regardless.
test('the served strip is a shuffled slice of the published set, never the whole 53', () => {
  assert.ok(seriesPosters.length > SERIES_STRIP_SIZE, 'the published set is larger than the slice, so the slice is doing the work');
  const served = pickShuffledSeries(seriesPosters);
  assert.equal(served.length, SERIES_STRIP_SIZE, `the strip serves ${SERIES_STRIP_SIZE} posters per page load`);
  assert.equal(new Set(served).size, SERIES_STRIP_SIZE, 'no series renders twice on one page');
  for (const entry of served) {
    assert.ok(seriesPosters.includes(entry), 'every served poster comes from the published set');
  }
});

test('a smaller published set renders in full: the slice never pads or drops', () => {
  const few = seriesPosters.slice(0, 5);
  assert.deepEqual(pickShuffledSeries(few), few, 'under the size cap the whole set renders');
  assert.deepEqual(pickShuffledSeries([]), []);
  assert.deepEqual(pickShuffledSeries(null), []);
});

test('the pick is a real shuffle, not a stable slice: order and membership vary', () => {
  // Seeded rngs pin both behaviors deterministically: a low-seeded pick and
  // a high-seeded pick select different members from a shuffled pool.
  const low = pickShuffledSeries(seriesPosters, SERIES_STRIP_SIZE, () => 0);
  const high = pickShuffledSeries(seriesPosters, SERIES_STRIP_SIZE, () => 0.999);
  assert.notDeepEqual(low.map((p) => p.title), high.map((p) => p.title), 'different draws pick different posters');
});

test('the shuffled slice keeps every locked strip behavior per tile', () => {
  const html = renderSeriesStrip(pickShuffledSeries(seriesPosters));
  assert.equal((html.match(/<a class="series-poster" /g) || []).length, SERIES_STRIP_SIZE, 'one deep-linking tap target per served poster');
  assert.equal((html.match(/loading="lazy"/g) || []).length, SERIES_STRIP_SIZE, 'lazy loading survives the shuffle; the popup thumb is inert template content');
  assert.equal((html.match(/width="220" height="330"/g) || []).length, SERIES_STRIP_SIZE * 2, 'fixed dimensions survive the shuffle: no layout shift');
});
