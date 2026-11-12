import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isBlank,
  cleanText,
  normalizeEmotionCell,
  normalizeAgeBand,
  normalizeStoryRow,
  searchableText,
} from '../src/pipeline/normalize.mjs';
import { AGE_BANDS } from '../src/vocabulary.mjs';

test('isBlank catches the literal None strings the Golden Set template uses', () => {
  assert.equal(isBlank('None'), true);
  assert.equal(isBlank('  none '), true);
  assert.equal(isBlank(null), true);
  assert.equal(isBlank('scared of the dark'), false);
});

test('cleanText collapses whitespace and drops blank values', () => {
  assert.equal(cleanText('  hello   world \n'), 'hello world');
  assert.equal(cleanText('None'), '');
  assert.equal(cleanText(null), '');
});

test('normalizeEmotionCell maps noun forms to the canonical list', () => {
  const out = normalizeEmotionCell('Disappointment, fear of the unknown, anger & frustration');
  assert.deepEqual(out.canonical.sort(), ['angry', 'disappointed', 'frustrated', 'scared']);
  assert.deepEqual(out.unknown, []);
});

test('normalizeEmotionCell maps shame and confusion per the ratified Delta', () => {
  assert.deepEqual(normalizeEmotionCell('shame/embarrassment').canonical, ['embarrassed']);
  assert.deepEqual(normalizeEmotionCell('confusion').canonical, ['confused']);
  assert.deepEqual(normalizeEmotionCell('helplessness').canonical, ['hopeless']);
  assert.deepEqual(normalizeEmotionCell('embarassed').canonical, ['embarrassed']);
});

test('normalizeEmotionCell routes trait words out of the emotion column', () => {
  const out = normalizeEmotionCell('growth mindset, frustrated');
  assert.deepEqual(out.canonical, ['frustrated']);
  assert.deepEqual(out.dropped, ['growth mindset']);
});

test('normalizeEmotionCell keeps allowed non-list words and reports unknown ones', () => {
  const ok = normalizeEmotionCell('annoyance, regret');
  assert.deepEqual(ok.offList.sort(), ['annoyance', 'regret']);
  assert.deepEqual(ok.unknown, []);
  const bad = normalizeEmotionCell('totally made up feeling');
  assert.deepEqual(bad.unknown, ['totally made up feeling']);
});

test('normalizeAgeBand accepts the ratified bands and single kid ages', () => {
  for (const band of AGE_BANDS) assert.equal(normalizeAgeBand(band), band);
  assert.equal(normalizeAgeBand('4'), '2-4');
  assert.equal(normalizeAgeBand('6'), '5-7');
  assert.equal(normalizeAgeBand('9'), '8-10');
  assert.equal(normalizeAgeBand('13'), '');
  assert.equal(normalizeAgeBand('None'), '');
  assert.equal(normalizeAgeBand('5\u20137'), '5-7');
});

test('normalizeStoryRow defaults the series for the Stillwater tags sheet', () => {
  const row = normalizeStoryRow(
    { season_number: '1', episode_number: '1', segment: '1', emotion: 'happy', age_band: '2-4', vibe: 'Calm' },
    { workbookId: 'wb_x', sheetId: 'sh_x', defaultSeriesTitle: 'Stillwater' },
  );
  assert.equal(row.seriesTitle, 'Stillwater');
  assert.equal(row.id, 'stillwater-s1-e1-seg1');
  assert.equal(row.vibe, 'calm');
  assert.deepEqual(row.emotions, ['happy']);
});

test('normalizeStoryRow prefers the per-story synopsis for display', () => {
  const row = normalizeStoryRow(
    {
      series_title: 'Stillwater', season_number: '2', episode_number: '3', segment: '2',
      synopsis: 'Episode-level synopsis that opens with segment one.',
      per_story_synopsis: 'Segment two synopsis that leads with its own story.',
    },
    { workbookId: 'wb_x', sheetId: 'sh_x' },
  );
  assert.equal(row.displaySynopsis, 'Segment two synopsis that leads with its own story.');
  assert.equal(row.synopsis.includes('segment one'), true);
});

test('searchableText joins every searchable field', () => {
  const row = normalizeStoryRow(
    { series_title: 'Duck & Goose', season_number: '1', episode_number: '1', situation: 'waiting is hard', emotion: 'impatient', coping: 'take a breath' },
    { workbookId: 'wb_x', sheetId: 'sh_x' },
  );
  const text = searchableText(row);
  assert.ok(text.includes('waiting is hard'));
  assert.ok(text.includes('impatient'));
  assert.ok(text.includes('take a breath'));
  assert.ok(text.includes('Duck & Goose'));
});
