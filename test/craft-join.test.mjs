// The craft-to-tag join that publishes wave 2: crafted prose (story lead,
// resolution, evidence note) joins the accepted tag corpus on series, season,
// and episode, with segment titles disambiguating multi-story episodes.
// Fail-fast rules live here: an unmatched or ambiguous craft row stops the
// build rather than shipping a half-tagged row, and nothing is ever invented
// for an empty tag cell.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCraftStory,
  classifyEvidenceNote,
  craftJoinKey,
  craftStoryKey,
  filterTagRows,
  joinCraftToTags,
} from '../src/pipeline/craft-join.mjs';
import { publishProblems } from '../src/pipeline/normalize.mjs';

function craft(overrides = {}) {
  return {
    series_title: 'Fixture Show',
    season_number: '1',
    episode_number: '1',
    segment: '',
    segment_title: 'The Big Day',
    story_lead: 'Maya loses the big race and tries again.',
    resolution: 'Maya names the feeling and asks for a do-over.',
    evidence_note: 'Script-verified line reads.',
    ...overrides,
  };
}

function tag(overrides = {}) {
  return {
    series_title: 'Fixture Show',
    season_number: '1',
    episode_number: '1',
    episode_title: 'The Big Day',
    segment: '',
    segment_title: 'The Big Day',
    situation: 'losing a race',
    emotion: 'sad, frustrated',
    coping: '',
    age_band: '5-7',
    vibe: 'calm',
    emoji: '\ud83d\ude22',
    topics: '',
    notes: '',
    ...overrides,
  };
}

test('evidence notes classify into the three tiers and never pass unclassified silently', () => {
  assert.equal(classifyEvidenceNote('Script-verified line reads.'), 'script');
  assert.equal(classifyEvidenceNote('Synopsis-only fallback; no script access.'), 'synopsis_fallback');
  assert.equal(classifyEvidenceNote('Title-overview tier; sourced from the catalog listing.'), 'title_overview');
  assert.equal(classifyEvidenceNote('Synopsis-only: title-overview tier.'), 'title_overview', 'the tier phrase governs, however the note opens');
  assert.equal(classifyEvidenceNote(''), 'unclassified');
  assert.equal(classifyEvidenceNote('Handcrafted against the recap page.'), 'unclassified');
});

test('multi-story episodes are two distinct stories, not duplicates', () => {
  const rows = [
    craft({ segment_title: 'The Big Day' }),
    craft({ segment_title: 'The Quiet After' }),
  ];
  assert.notEqual(craftStoryKey(rows[0]), craftStoryKey(rows[1]), 'different segment titles, different stories');
  assert.equal(craftJoinKey(rows[0]), craftJoinKey(rows[1]), 'same episode key');
  const { pairs, problems } = joinCraftToTags(rows, [
    tag({ segment_title: 'The Big Day' }),
    tag({ segment_title: 'The Quiet After' }),
  ]);
  assert.equal(problems.length, 0, 'two segments alone are not a problem');
  assert.equal(pairs.length, 2);
});

test('the same segment title twice on one episode stops the build', () => {
  const rows = [craft(), craft()];
  const { problems } = joinCraftToTags(rows, [tag()]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /duplicate craft story/);
});

test('a craft row with no tag row is a fail-fast problem, never a silent drop', () => {
  const { pairs, problems, unmatched } = joinCraftToTags([craft()], []);
  assert.equal(pairs.length, 0);
  assert.equal(problems.length, 1);
  assert.match(unmatched[0], /no tag row/);
});

test('two tag candidates on one episode disambiguate by segment title', () => {
  const rows = [
    craft({ segment_title: 'The Big Day' }),
    craft({ segment_title: 'The Quiet After' }),
  ];
  const rows_tags = [
    tag({ segment_title: 'The Big Day', situation: 'losing a race' }),
    tag({ segment_title: 'The Quiet After', situation: 'the calm after a hard day' }),
  ];
  const { pairs, problems } = joinCraftToTags(rows, rows_tags);
  assert.equal(problems.length, 0);
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].tag.situation, 'losing a race');
  assert.equal(pairs[1].tag.situation, 'the calm after a hard day');
});

test('two candidates that share the craft segment title are ambiguous and stop the build', () => {
  const { pairs, problems, ambiguous } = joinCraftToTags(
    [craft({ segment_title: 'The Big Day' })],
    [tag(), tag({ situation: 'another situation' })],
  );
  assert.equal(pairs.length, 0);
  assert.equal(ambiguous.length, 1);
  assert.equal(problems.length, 1);
});

test('a tag row with no craft counterpart is reported, not an error', () => {
  const { unusedTagRows } = joinCraftToTags([craft()], [tag(), tag({ episode_number: '2' })]);
  assert.equal(unusedTagRows.length, 1);
  assert.equal(craftJoinKey(unusedTagRows[0]), 'fixture-show|s1|e2');
});

test('filterTagRows applies the series filter and drops retired rows verbatim', () => {
  const rows = [
    tag({ series_title: 'One Show' }),
    tag({ series_title: 'Other Show' }),
    tag({ series_title: 'One Show', notes: 'RETIRED s1e2 phantom row' }),
  ];
  const kept = filterTagRows(rows, { seriesFilter: 'One Show', retiredNotePrefix: 'RETIRED' });
  assert.equal(kept.length, 1);
  assert.equal(kept[0].notes, '', 'the kept row passes through untouched');
  assert.equal(rows.length, 3, 'the filter drops nothing from the source data itself');
});

test('buildCraftStory maps craft prose to the parent-facing fields and tags to the filters', () => {
  const story = buildCraftStory(
    { craft: craft(), tag: tag({ emotion: 'shame/embarrassment, sad' }) },
    { workbookId: 'wb_FIXTURE', sheetId: 'sh_FIXTURE' },
  );
  assert.equal(story.id, 'fixture-show-s1-e1');
  assert.equal(story.seriesTitle, 'Fixture Show');
  assert.equal(story.episodeTitle, 'The Big Day');
  assert.equal(story.perStorySynopsis, 'Maya loses the big race and tries again.');
  assert.equal(story.displaySynopsis, story.perStorySynopsis, 'the craft lead is the display synopsis');
  assert.equal(story.coping, 'Maya names the feeling and asks for a do-over.', 'the craft resolution fills the coping key');
  assert.deepEqual(story.emotions, ['embarrassed', 'sad'], 'tag emotions normalize to canonical terms');
  assert.equal(story.ageBand, '5-7');
  assert.equal(story.vibe, 'calm');
  assert.equal(story.situation, 'losing a race');
  assert.equal(story.evidenceTier, 'script');
  assert.equal(story.evidenceNote, 'Script-verified line reads.', 'the evidence note travels as internal provenance');
  assert.equal(story.notes, '', 'the notes field stays empty so unverified-resolution suppression cannot misfire');
});

test('a craft segment becomes its own row id', () => {
  const story = buildCraftStory(
    { craft: craft({ segment: '2', segment_title: 'The Quiet After' }), tag: tag({ segment: '2', segment_title: 'The Quiet After' }) },
    {},
  );
  assert.equal(story.id, 'fixture-show-s1-e1-seg2');
});

test('the publish gate keeps coping required for wave 1 rows and optional for craft rows with a faithful absence', () => {
  const wave1 = { situation: 'a situation', ageBand: '5-7', vibe: 'calm', emoji: 'sad', coping: '' };
  assert.deepEqual(publishProblems(wave1), ['coping'], 'wave 1 rows still need coping');
  assert.deepEqual(publishProblems(wave1, { requireCoping: false }), [], 'a craft row may carry the faithful absence');
  const craftRow = { situation: '', ageBand: '5-7', vibe: 'calm', emoji: 'sad', coping: '' };
  assert.deepEqual(publishProblems(craftRow, { requireCoping: false }), ['situation'], 'every other gate holds');
});
