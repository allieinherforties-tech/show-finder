// The seasonal rail: ONE 'This Season' shelf of 14 rows quoting the
// production artifact, links matching the verified shapes, the honest count
// chip, and the play-logo button rules from Allie's 2026-11-13 feedback.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HOLIDAY_RAILS, resolveHolidayRails, renderHolidayRails, applyHolidayRails, HOLIDAY_RAILS_PLACEHOLDER } from '../src/rails.mjs';
import { classifyAppleUrl } from '../src/links/apple-tv.mjs';

const artifact = JSON.parse(readFileSync('data/search/search-artifact.json', 'utf8'));
const storiesById = new Map(artifact.stories.map((s) => [s.id, s]));
const storyById = (id) => storiesById.get(id) || null;

const { rails: resolved, unresolved } = resolveHolidayRails(HOLIDAY_RAILS, storyById);

test('the landing page renders exactly ONE seasonal rail titled This Season', () => {
  assert.equal(resolved.length, 1, 'one rail, no featured/secondary sections');
  assert.equal(resolved[0].id, 'rail-this-season');
  assert.equal(resolved[0].title, 'This Season', 'exact casing from the feedback');
});

test('the shelf holds all 14 rows, Thanksgiving first, then Christmas, then winter', () => {
  assert.equal(resolved[0].rows.length, 14, 'all 14 rows live in the one shelf');
  const ids = resolved[0].rows.map((r) => r.storyId);
  const thanksgiving = ['sago-mini-friends-s1-e11-seg1', 'helpsters-help-you-s1-e6-seg1', 'pretzel-and-the-puppies-s1-e8-seg1', 'shape-island-s2-e3-seg1', 'sago-mini-friends-s1-e2-seg2', 'eva-the-owlet-s1-e9'];
  const christmas = ['frog-and-toad-s1-e9', 'sago-mini-friends-s2-e2-seg2', 'interrupting-chicken-s1-e9-seg1', 'get-rolling-with-otis-s1-e9'];
  assert.deepEqual(ids.slice(0, 6), thanksgiving, 'the six Thanksgiving rows lead');
  assert.deepEqual(ids.slice(6, 10), christmas, 'the four Christmas rows follow');
  assert.deepEqual(ids.slice(10), ['stillwater-s1-e13', 'shape-island-s1-e10', 'stillwater-s4-e5-seg2', 'pretzel-and-the-puppies-s1-e9'], 'the four winter rows close');
  const shipped = JSON.stringify(resolved);
  assert.equal(/new year/i.test(shipped), false, 'the New Year rail stays dropped');
});

test('the approved description and honest count chip render verbatim', () => {
  const html = renderHolidayRails(resolved);
  assert.ok(html.includes('Cozy seasonal stories for the weeks ahead: episodes about gratitude, giving, and being together, from Thanksgiving tables to quiet winter nights.'), 'approved description renders verbatim');
  assert.ok(html.includes('<span class="rail-count">14 stories</span>'), 'the count chip reads 14 stories, not episodes');
  assert.equal((html.match(/rail-section/g) || []).length, 1, 'exactly one section renders');
});

test('every rail row quotes the production artifact and is fully resolved', () => {
  assert.deepEqual(unresolved, [], 'every rail row must resolve against the artifact');
  for (const rail of resolved) {
    for (const row of rail.rows) {
      const story = storiesById.get(row.storyId);
      assert.ok(story, `row ${row.storyId} must exist in the artifact`);
      assert.equal(row.title, story.segmentTitle || story.episodeTitle, 'title quotes the artifact');
      assert.equal(row.displaySynopsis, story.displaySynopsis);
      assert.equal(row.appleUrl, story.appleUrl || null);
      assert.ok(row.why, 'every row carries its editorial why');
    }
  }
});

test('every row with a verified link carries the play button, no visible Apple TV text', () => {
  const html = renderHolidayRails(resolved);
  const linked = resolved[0].rows.filter((r) => r.appleUrl);
  const unlinked = resolved[0].rows.filter((r) => !r.appleUrl);
  assert.equal(unlinked.length, 0, 'all 14 rows carry verified links from the harvested artifact');
  assert.equal(linked.length, 14, 'all 14 rows are linked');
  assert.equal((html.match(/class="watch-play"/g) || []).length, 14, 'one play button per verified row');
  for (const row of linked) {
    assert.ok(classifyAppleUrl(row.appleUrl), `malformed apple link on ${row.storyId}: ${row.appleUrl}`);
    assert.equal(row.linkKind, classifyAppleUrl(row.appleUrl));
  }
  const labels = [...html.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
  const watchLabels = labels.filter((l) => l.startsWith('Watch on Apple TV'));
  assert.equal(watchLabels.length, 14, 'each button keeps its Watch on Apple TV accessible name');
  assert.equal(new Set(watchLabels).size, 14, 'aria labels stay distinct per row');
  const buttons = [...html.matchAll(/<a class="watch-play".*?<\/a>/gs)].map((m) => m[0]);
  for (const button of buttons) {
    assert.ok(button.includes('/play-button.png'), 'the deeplink wraps the play logo');
    assert.ok(button.includes('alt=""'), 'the icon is hidden from screen readers');
    assert.equal(/Apple TV/.test(button.replace(/aria-label="[^"]*"/, '')), false, 'no visible Apple TV text on the button');
  }
});

test('the rendered rail is dash free, escaped, and labeled', () => {
  const html = renderHolidayRails(resolved);
  assert.equal(/[\u2013\u2014]/.test(html), false, 'zero em or en dashes in rendered rail');
  assert.ok(html.includes('<h2>This Season</h2>'), 'the shelf header renders');
  assert.ok(!html.includes('rail-kind'), 'the featured/secondary labels are gone');
  assert.ok(!html.includes('<script'), 'rail text never injects markup');
  assert.ok(!html.includes(HOLIDAY_RAILS_PLACEHOLDER));
});

test('a story id the artifact no longer holds drops its row and the chip recounts', () => {
  const missing = resolveHolidayRails(HOLIDAY_RAILS, (id) => (id === 'frog-and-toad-s1-e9' ? null : storyById(id)));
  assert.deepEqual(missing.unresolved, ['rail-this-season: frog-and-toad-s1-e9']);
  assert.equal(missing.rails[0].rows.length, 13, 'the row is dropped, never padded');
  const html = renderHolidayRails(missing.rails);
  assert.ok(html.includes('<span class="rail-count">13 stories</span>'), 'the honest count chip follows the resolved rows');
  assert.equal(html.includes('Christmas Eve'), false);
});

test('the served landing page carries the rail substitution end to end', () => {
  const page = '<main>__HOLIDAY_RAILS__</main>';
  const served = applyHolidayRails(page, storyById);
  assert.equal(served.includes(HOLIDAY_RAILS_PLACEHOLDER), false);
  assert.ok(served.includes('This Season'));
});
