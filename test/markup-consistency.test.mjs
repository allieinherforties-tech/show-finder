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
  // rail-this-season is not static markup: applyHolidayRails injects it at
  // serve time into the __HOLIDAY_RAILS__ placeholder.
  const serverInjected = new Set(['rail-this-season']);
  const missing = [...new Set(lookedUp)]
    .filter((id) => !serverInjected.has(id))
    .filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, [], 'every getElementById target must be in index.html');
});

test('the four filter dropdowns and the results surfaces ship', () => {
  for (const id of ['emotion-filter', 'series-filter', 'age-filter', 'vibe-filter', 'active-filters', 'show-more', 'results-meta', 'no-results-text', 'no-results-suggestions']) {
    assert.ok(html.includes(`id="${id}"`), `index.html must ship #${id}`);
  }
});
