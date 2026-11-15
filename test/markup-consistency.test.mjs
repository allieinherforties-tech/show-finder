// Markup consistency: every element id app.js looks up must exist in the
// served page. The DOM shim tests create elements from an id list, so they
// cannot catch a markup id that went missing; this test can. Run against the
// real public/index.html.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile('public/app.js', 'utf8');
const html = await readFile('public/index.html', 'utf8');

const lookedUp = [...app.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);

test('app.js never looks up an id the page does not ship', () => {
  assert.ok(lookedUp.length > 5, 'the lookup scan itself found the real ids');
  // rail-this-season and series-strip are not static markup: applyHolidayRails
  // and applySeriesStrip inject them at serve time into their placeholders.
  const serverInjected = new Set(['rail-this-season', 'series-strip']);
  const missing = [...new Set(lookedUp)]
    .filter((id) => !serverInjected.has(id))
    .filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, [], 'every getElementById target must be in index.html');
});

test('the three filter dropdowns and the results surfaces ship', () => {
  for (const id of ['emotion-filter', 'age-filter', 'vibe-filter', 'active-filters', 'show-more', 'results-meta', 'no-results-text', 'no-results-suggestions']) {
    assert.ok(html.includes(`id="${id}"`), `index.html must ship #${id}`);
  }
});

test('the Series dropdown is retired from the filter row', () => {
  // Ruled 2026-11-14 (Decision Memo: The Series Dropdown): the dropdown
  // misstates coverage against the 90-title catalog; series-led discovery
  // moves to a purpose-built poster surface in v1.1. The server-side series
  // facet stays: clarifier chips and shared URLs still filter by series.
  assert.equal(html.includes('series-filter'), false);
});

test('story-match surfaces sit above the rails in the page', () => {
  // Episode recommendations outrank browsing, always: even the searching and
  // zero-match states render above the rails, never below them.
  const surfaces = ['results-meta', 'active-filters', 'clarifiers', 'results', 'no-results', 'show-more'];
  const railsAt = html.indexOf('__HOLIDAY_RAILS__');
  assert.ok(railsAt > 0, 'the rails placeholder ships in the page');
  for (const id of surfaces) {
    const at = html.indexOf(`id="${id}"`);
    assert.ok(at >= 0 && at < railsAt, `#${id} must sit above the rails`);
  }
});

test('the poster strip ships beneath the hero and above the rails and results', () => {
  // Ruled v1.1 placement: beneath the hero, above the rails. It sits before
  // the result surfaces too; app.js hides it while matches are on screen,
  // so story matches still outrank browsing.
  const stripAt = html.indexOf('__SERIES_STRIP__');
  assert.ok(stripAt > 0, 'the strip placeholder ships in the page');
  assert.ok(html.indexOf('</header>') < stripAt, 'the strip sits beneath the hero');
  assert.ok(stripAt < html.indexOf('__HOLIDAY_RAILS__'), 'the strip sits above the rails');
  assert.ok(stripAt < html.indexOf('id="results-meta"'), 'the strip sits above the result surfaces');
});

test('the stylesheet keeps the [hidden] reset that makes hidden mean hidden', async () => {
  const css = await readFile('public/styles.css', 'utf8');
  // Class rules like .show-more { display: block } beat the UA's [hidden]
  // rule; without this reset, hidden controls render anyway.
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});
