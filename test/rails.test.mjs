// The seasonal rail: ONE 'This Season' shelf quoting the production
// artifact, links matching the verified shapes, the honest count chip, and
// the play-logo button rules from Allie's 2026-11-13 feedback. Four defined
// rows (the Eva, Frog and Toad, Otis, and Merry Muttgomery holiday episodes)
// are held back by the parent-facing gate until curation re-verifies them,
// so the shelf resolves 10 of the 14 defined rows; they return
// automatically on a rebuild that publishes them again.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HOLIDAY_RAILS, resolveHolidayRails, renderHolidayRails, renderRailCard, applyHolidayRails, HOLIDAY_RAILS_PLACEHOLDER } from '../src/rails.mjs';
import { classifyAppleUrl } from '../src/links/apple-tv.mjs';

const artifact = JSON.parse(readFileSync('data/search/search-artifact.json', 'utf8'));
const storiesById = new Map(artifact.stories.map((s) => [s.id, s]));
const storyById = (id) => storiesById.get(id) || null;

const { rails: resolved, unresolved } = resolveHolidayRails(HOLIDAY_RAILS, storyById);

test('the landing page renders five rails: This Season first, then the approved order', () => {
  assert.deepEqual(resolved.map((r) => r.id), [
    'rail-this-season',
    'rail-something-new',
    'rail-big-feelings',
    'rail-friendship-trouble',
    'rail-wind-down',
  ], 'This Season leads, then Something New, Big Feelings, Friendship Trouble, Wind-Down');
  assert.equal(resolved[0].title, 'This Season', 'exact casing from the feedback');
});

test('every shipped rail clears the eight-row depth floor on the artifact', () => {
  for (const rail of resolved) {
    assert.ok(rail.rows.length >= 8, `${rail.id} resolves ${rail.rows.length} rows, below the eight-row floor`);
  }
});

test('no story appears on two rails', () => {
  const seen = new Map();
  for (const rail of resolved) {
    for (const row of rail.rows) {
      assert.equal(seen.has(row.storyId), false, `${row.storyId} is on both ${seen.get(row.storyId)} and ${rail.id}`);
      seen.set(row.storyId, rail.id);
    }
  }
});

test('the shelf resolves the 10 published rows, Thanksgiving first, then Christmas, then winter', () => {
  assert.equal(resolved[0].rows.length, 10, 'the published rows live in the one shelf; held-back rows drop until curation re-verifies them');
  const ids = resolved[0].rows.map((r) => r.storyId);
  const thanksgiving = ['sago-mini-friends-s1-e11-seg1', 'helpsters-help-you-s1-e6-seg1', 'pretzel-and-the-puppies-s1-e8-seg1', 'shape-island-s2-e3-seg1', 'sago-mini-friends-s1-e2-seg2'];
  const christmas = ['sago-mini-friends-s2-e2-seg2', 'interrupting-chicken-s1-e9-seg1'];
  assert.deepEqual(ids.slice(0, 5), thanksgiving, 'the published Thanksgiving rows lead');
  assert.deepEqual(ids.slice(5, 7), christmas, 'the published Christmas rows follow');
  assert.deepEqual(ids.slice(7), ['stillwater-s1-e13', 'shape-island-s1-e10', 'stillwater-s4-e5-seg2'], 'the published winter rows close');
  const shipped = JSON.stringify(resolved);
  assert.equal(/new year/i.test(shipped), false, 'the New Year rail stays dropped');
});

test('the approved description and honest count chip render verbatim', () => {
  const html = renderHolidayRails(resolved);
  assert.ok(html.includes('Cozy seasonal stories for the weeks ahead, all about gratitude, giving, and being together, from Thanksgiving tables to quiet winter nights.'), 'approved description renders verbatim');
  assert.ok(html.includes('<span class="rail-count">10 stories</span>'), 'the count chip reads 10 stories, not episodes');
  assert.equal((html.match(/rail-section/g) || []).length, 5, 'one section per shipped rail');
});

test('every rail row quotes the production artifact and the held-back rows are named', () => {
  // The parent-facing gate holds four defined rows back from the artifact;
  // the rail drops them and names them in unresolved, never padding over.
  assert.deepEqual(unresolved, [
    'rail-this-season: eva-the-owlet-s1-e9',
    'rail-this-season: frog-and-toad-s1-e9',
    'rail-this-season: get-rolling-with-otis-s1-e9',
    'rail-this-season: pretzel-and-the-puppies-s1-e9',
  ], 'exactly the held-back rows are unresolved');
  for (const rail of resolved) {
    for (const row of rail.rows) {
      const story = storiesById.get(row.storyId);
      assert.ok(story, `row ${row.storyId} must exist in the artifact`);
      assert.equal(row.title, story.segmentTitle || story.episodeTitle, 'title quotes the artifact');
      assert.equal(row.displaySynopsis, story.displaySynopsis);
      assert.equal(row.situation, story.situation, 'the row keeps the artifact situation for search matching');
      assert.equal(row.coping, story.coping, 'the expanded view quotes the artifact resolution');
      assert.equal(row.appleUrl, story.appleUrl || null);
      assert.ok(row.why, 'every row carries its editorial why');
    }
  }
});

test('every rail card carries its expanded detail template', () => {
  const html = renderHolidayRails(resolved);
  const cards = (html.match(/<article class="rail-card">/g) || []).length;
  const templates = (html.match(/<template class="rail-detail">/g) || []).length;
  assert.equal(templates, cards, 'one detail template per card');
  // Lean block model (wb_08gsOLEW): one unlabeled story-lead paragraph,
  // then the labeled Resolution line. The five-field label list is gone;
  // the situation field stays in the data model and never renders here.
  for (const label of ['<dt>Situation</dt>', '<dt>Ages</dt>', '<dt>Feelings</dt>', '<dt>What happens</dt>']) {
    assert.equal(html.includes(label), false, `the retired label ${label} never renders`);
  }
  assert.ok(html.includes('<dt>Resolution</dt>'), 'the expanded view names Resolution');
  assert.ok(html.includes('class="rail-dialog-lead"'), 'the expanded view opens its story with the unlabeled lead');
  assert.ok(html.includes('<button class="rail-card-more" type="button" aria-haspopup="dialog">Story details</button>'), 'each card has its keyboard affordance');
  // The expanded view is served from the same gated artifact, so the
  // internal-annotation scan in test/parent-facing.test.mjs covers it too;
  // this pins that no internal field key leaks into the rendered labels.
  assert.equal(html.includes('coping'), false, 'the field key never renders; the label is Resolution');
});

test('every row with a verified link carries the play button, no visible Apple TV text', () => {
  const html = renderHolidayRails(resolved);
  const linked = resolved.flatMap((r) => r.rows).filter((r) => r.appleUrl);
  const unlinked = resolved.flatMap((r) => r.rows).filter((r) => !r.appleUrl);
  assert.equal(unlinked.length, 0, 'all rail rows carry verified links from the harvested artifact');
  assert.equal(linked.length, 50, '50 linked rows across the five rails');
  assert.equal((html.match(/class="watch-play"/g) || []).length, 50, 'one play button per verified row');
  for (const row of linked) {
    assert.ok(classifyAppleUrl(row.appleUrl), `malformed apple link on ${row.storyId}: ${row.appleUrl}`);
    assert.equal(row.linkKind, classifyAppleUrl(row.appleUrl));
  }
  const labels = [...html.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
  const watchLabels = labels.filter((l) => l.startsWith('Watch on Apple TV'));
  assert.equal(watchLabels.length, 50, 'each button keeps its Watch on Apple TV accessible name');
  assert.equal(new Set(watchLabels).size, watchLabels.length, 'aria labels stay distinct per row');
  const buttons = [...html.matchAll(/<a class="watch-play".*?<\/a>/gs)].map((m) => m[0]);
  for (const button of buttons) {
    assert.ok(button.includes('/play-button.png'), 'the deeplink wraps the play logo');
    assert.ok(button.includes('alt=""'), 'the icon is hidden from screen readers');
    assert.equal(/Apple TV/.test(button.replace(/aria-label="[^"]*"/, '')), false, 'no visible Apple TV text on the button');
  }
});

test('every rail row carries the provider fields the diction ruling locked', () => {
  for (const rail of resolved) {
    for (const row of rail.rows) {
      assert.equal(row.provider, 'apple', `${row.storyId} carries the provider key`);
      assert.equal(row.providerLabel, 'Apple TV+', `${row.storyId} carries the display label`);
    }
  }
});

test('rail aria labels compose from providerLabel, and a synthetic PBS row renders Watch on PBS KIDS', () => {
  const html = renderHolidayRails(resolved);
  const labels = [...html.matchAll(/<a class="watch-play"[^>]*aria-label="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(labels.length, 50, 'one accessible name per linked row');
  for (const label of labels) {
    assert.ok(label.startsWith('Watch on Apple TV+: '), `ruled template from data: ${label}`);
  }
  // A future PBS row exercises the same render path with nothing changed:
  // the label comes from the row, never a hardcoded platform string.
  const pbs = renderRailCard({
    storyId: 'odd-squad-s1-e1',
    title: 'Undercover Alyssa',
    seriesTitle: 'Odd Squad',
    seasonNumber: 1,
    episodeNumber: 1,
    segment: null,
    episodeLine: 'S1 E1',
    ageBand: '5-7',
    vibe: 'silly',
    emotions: ['happy'],
    situation: 'A kid solves an odd case.',
    coping: 'working the case',
    displaySynopsis: 'd',
    stillUrl: null,
    posterUrl: null,
    appleUrl: 'https://www.pbs.org/video/odd-squad-undercover-alyssa/',
    linkKind: 'direct',
    provider: 'pbs',
    providerLabel: 'PBS KIDS',
    why: 'test row',
  });
  assert.ok(pbs.includes('aria-label="Watch on PBS KIDS: Odd Squad, Undercover Alyssa, season 1 episode 1"'), 'the PBS aria label follows the ruled template');
  assert.equal(pbs.includes('Apple TV'), false, 'no hardcoded platform string in the render path');
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
  const missing = resolveHolidayRails(HOLIDAY_RAILS, (id) => (id === 'stillwater-s1-e13' ? null : storyById(id)));
  assert.deepEqual(missing.unresolved, [
    'rail-this-season: eva-the-owlet-s1-e9',
    'rail-this-season: frog-and-toad-s1-e9',
    'rail-this-season: get-rolling-with-otis-s1-e9',
    'rail-this-season: stillwater-s1-e13',
    'rail-this-season: pretzel-and-the-puppies-s1-e9',
  ]);
  assert.equal(missing.rails[0].rows.length, 9, 'the row is dropped, never padded');
  const html = renderHolidayRails(missing.rails);
  assert.ok(html.includes('<span class="rail-count">9 stories</span>'), 'the honest count chip follows the resolved rows');
  assert.equal(html.includes('script-verified solstice story'), false);
});

test('the served landing page carries the rail substitution end to end', () => {
  const page = '<main>__HOLIDAY_RAILS__</main>';
  const served = applyHolidayRails(page, storyById);
  assert.equal(served.includes(HOLIDAY_RAILS_PLACEHOLDER), false);
  assert.ok(served.includes('This Season'));
});

test("every card's detail template carries the dialog banner with the card's image and alt text", () => {
  // Ruled in the story-details dialog artwork review: the expanded view opens
  // with the same artwork the card loaded (a cache hit, never a new request),
  // same alt text, no filter or overlay the card does not apply.
  const html = renderHolidayRails(resolved);
  const cards = [...html.matchAll(/<article class="rail-card">[\s\S]*?<\/article>/g)].map((m) => m[0]);
  assert.equal(cards.length, 50, 'the fixture rails render 50 cards');
  for (const card of cards) {
    const cardImg = card.match(/<img class="rail-still"([^>]+)>/);
    assert.ok(cardImg, 'every rail row on the live rails has artwork');
    const src = /src="([^"]+)"/.exec(cardImg[1])[1];
    const alt = /alt="([^"]*)"/.exec(cardImg[1])[1];
    const template = card.match(/<template class="rail-detail">([\s\S]*?)<\/template>/)[1];
    const banner = template.match(/<figure class="rail-dialog-banner">\s*<img class="rail-dialog-still"([^>]+)>\s*<\/figure>/);
    assert.ok(banner, 'the detail template carries the banner figure');
    const bannerSrc = /src="([^"]+)"/.exec(banner[1])[1];
    const bannerAlt = /alt="([^"]*)"/.exec(banner[1])[1];
    assert.equal(bannerSrc, src, 'the banner reuses the exact URL the card loaded');
    assert.equal(bannerAlt, alt, 'the banner keeps the card image alt text');
    // The banner sits above the story fields: artwork at the top of the
    // expanded view.
    assert.ok(template.indexOf('rail-dialog-banner') < template.indexOf('rail-detail-list'), 'the banner renders above the detail list');
  }
});

test('a card with no artwork carries a detail template with no banner and no placeholder', () => {
  // No live rail row lacks artwork today, so this builds the row by hand:
  // the imageless path must stay clean if a future row loses its art.
  const row = {
    storyId: 'fixture-no-art',
    title: 'A Quiet Episode',
    seriesTitle: 'Fixture Series',
    episodeLine: 'Season 1, episode 1',
    seasonNumber: 1,
    episodeNumber: 1,
    emotions: ['calm'],
    vibe: 'gentle',
    why: 'Because the fixture says so.',
    situation: 'Something quiet happens.',
    coping: 'It resolves calmly.',
    displaySynopsis: 'The fixture synopsis.',
    ageBand: '5-8',
    stillUrl: null,
    posterUrl: null,
    appleUrl: 'https://tv.apple.com/x',
    linkKind: 'episode',
    provider: 'apple',
    providerLabel: 'Apple TV+',
  };
  const html = renderRailCard(row);
  assert.ok(html.includes('<template class="rail-detail">'), 'the imageless card still carries its detail template');
  assert.equal(html.includes('rail-dialog-banner'), false, 'no banner figure is rendered');
  assert.equal(html.includes('rail-dialog-still'), false, 'no image element is rendered');
  assert.ok(html.includes('class="rail-dialog-lead"'), 'the story lead renders without artwork');
  assert.ok(html.includes('<dt>Resolution</dt>'), 'the Resolution line renders without artwork');
});
