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
import { renderSeriesStrip, applySeriesStrip, SERIES_STRIP_PLACEHOLDER, escapeHtml } from '../src/rails.mjs';

const artifact = JSON.parse(readFileSync('data/search/search-artifact.json', 'utf8'));
const descriptionsDump = JSON.parse(readFileSync('data/source/wb_a6zJ9L6l_sh_udod4EbT.json', 'utf8'));
const seriesPosters = joinSeriesDescriptions(collectSeriesPosters(artifact.stories), descriptionsDump.rows);
const html = renderSeriesStrip(seriesPosters);

test('the strip renders one poster per published series, all 18 today', () => {
  // 18 is the published series count on the corpus this build stamps; the
  // assertion pins the honest-count rule: every series, no filler.
  assert.equal(seriesPosters.length, 18, 'one entry per published series');
  assert.equal((html.match(/<li class="series-poster-item">/g) || []).length, 18);
  assert.equal((html.match(/<a class="series-poster" /g) || []).length, 18, 'one tap target per series');
  assert.equal((html.match(/<img class="series-poster-img" /g) || []).length, 18);
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
  assert.equal(bySeries.size, 18);
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
  // Each poster now renders twice, honestly: once on the tile, once as the
  // popup's thumbnail inside the tile's detail template. 18 x 2 today.
  const srcs = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(srcs.length, 36);
  for (const src of srcs) {
    assert.ok(realUrls.has(src), `rendered poster must come from the artifact: ${src}`);
  }
  assert.equal(/placeholder|filler/i.test(html), false);
});

test('every tap target deep-links the series facet and names the series accessibly', () => {
  const anchors = [...html.matchAll(/<a class="series-poster"([^>]+)>[\s\S]*?<\/a>/g)].map((m) => m);
  assert.equal(anchors.length, 18);
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
  const nasty = [{ title: 'Show <script>alert(1)</script> & "Pals"', posterUrl: 'https://image.tmdb.org/t/p/w342/x.jpg', description: '<img src=x onerror=alert(1)>', ageBand: '5-7', appleSeriesUrl: 'https://tv.apple.com/us/show/x/umc.cmc.abc' }];
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
  // No animation, no marquee, no autoplay hooks in the served markup.
  assert.equal(/animation|autoplay|marquee/i.test(html), false);
  // The scroller is keyboard focusable so arrow keys reach the posters.
  assert.ok(html.includes('<ul class="series-posters" tabindex="0"'), 'the scroll row is keyboard reachable');
});

test('app.js yields the strip to story matches with the rails', async () => {
  const app = readFileSync('public/app.js', 'utf8');
  assert.ok(app.includes("getElementById('series-strip')"), 'app.js holds the strip');
  // Three toggle sites: idle returns it, zero matches return it, matches hide it.
  assert.equal((app.match(/seriesStrip\.hidden = (true|false)/g) || []).length, 3);
});
