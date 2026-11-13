// The Q4 holiday rails: rows quote the production artifact, links match the
// verified shapes, and the composition follows the featured-moment ruling
// (Christmas leads, Thanksgiving and Winter secondary, New Year dropped).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HOLIDAY_RAILS, resolveHolidayRails, renderHolidayRails, applyHolidayRails, HOLIDAY_RAILS_PLACEHOLDER } from '../src/rails.mjs';
import { classifyAppleUrl } from '../src/links/apple-tv.mjs';

const artifact = JSON.parse(readFileSync('data/search/search-artifact.json', 'utf8'));
const storiesById = new Map(artifact.stories.map((s) => [s.id, s]));
const storyById = (id) => storiesById.get(id) || null;

const { rails: resolved, unresolved } = resolveHolidayRails(HOLIDAY_RAILS, storyById);

test('the holiday composition follows the featured-moment ruling', () => {
  assert.deepEqual(
    resolved.map((r) => [r.id, r.kind]),
    [
      ['rail-seasonal', 'featured'],
      ['rail-thanksgiving', 'secondary'],
      ['rail-winter', 'secondary'],
    ],
  );
  assert.equal(resolved[0].title, 'This season');
  assert.equal(resolved[0].rows.length, 4, 'the Christmas lead has its four real story rows');
  assert.equal(resolved[1].rows.length, 6, 'the Thanksgiving secondary shelf has its six rows');
  assert.equal(resolved[2].rows.length, 4, 'the Winter secondary shelf has its four rows');
  const shipped = JSON.stringify(resolved);
  assert.equal(/new year/i.test(shipped), false, 'the New Year rail is dropped entirely');
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

test('every rail Apple link matches a verified pattern shape', () => {
  let linked = 0;
  for (const rail of resolved) {
    for (const row of rail.rows) {
      if (row.appleUrl) {
        assert.ok(classifyAppleUrl(row.appleUrl), `malformed apple link on ${row.storyId}: ${row.appleUrl}`);
        assert.equal(row.linkKind, classifyAppleUrl(row.appleUrl));
        linked += 1;
      } else {
        assert.equal(row.linkKind, null, `unlinked row ${row.storyId} gets no button rather than an invented URL`);
      }
    }
  }
  assert.ok(linked > 0, 'at least one rail row carries a verified link');
});

test('the rendered rails are dash free, escaped, and labeled', () => {
  const html = renderHolidayRails(resolved);
  assert.equal(/[\u2013\u2014]/.test(html), false, 'zero em or en dashes in rendered rails');
  for (const title of ['This season', 'Thanksgiving', 'Winter']) {
    assert.ok(html.includes(`<h2>${title}</h2>`), `section header ${title} renders`);
  }
  assert.equal((html.match(/seasonal · secondary/g) || []).length, 2, 'both secondary shelves carry the label');
  assert.ok(!html.includes('<script'), 'rail text never injects markup');
  assert.ok(!html.includes(HOLIDAY_RAILS_PLACEHOLDER));
});

test('a story id the artifact no longer holds drops its row and is reported', () => {
  const missing = resolveHolidayRails(HOLIDAY_RAILS, (id) => (id === 'frog-and-toad-s1-e9' ? null : storyById(id)));
  assert.deepEqual(missing.unresolved, ['rail-seasonal: frog-and-toad-s1-e9']);
  assert.equal(missing.rails[0].rows.length, 3, 'the row is dropped, never padded');
  assert.equal(renderHolidayRails(missing.rails).includes('Christmas Eve'), false);
});

test('the served landing page carries the rails substitution end to end', () => {
  const page = '<main>__HOLIDAY_RAILS__</main>';
  const served = applyHolidayRails(page, storyById);
  assert.equal(served.includes(HOLIDAY_RAILS_PLACEHOLDER), false);
  assert.ok(served.includes('This season'));
});
