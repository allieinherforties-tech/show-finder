// The Feeling and Series dropdown options are static markup, so a test holds
// them in step with the artifact: exactly the terms and series with at least
// eight stories, in census order (count desc, ties alphabetical). A term that
// crosses or falls below the floor, or a series that gains or loses stories,
// fails here until the markup is updated on purpose.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const MIN_STORIES = 8;
const artifact = JSON.parse(await readFile('data/search/search-artifact.json', 'utf8'));

function emotionCensus() {
  const counts = new Map();
  for (const s of artifact.stories) {
    for (const e of s.emotions) counts.set(e, (counts.get(e) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= MIN_STORIES)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([term]) => term);
}

function seriesCensus() {
  const counts = new Map();
  for (const s of artifact.stories) counts.set(s.seriesTitle, (counts.get(s.seriesTitle) || 0) + 1);
  return [...counts.entries()]
    .filter(([, c]) => c >= MIN_STORIES)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([title]) => title);
}

async function selectOptions(id) {
  const html = await readFile('public/index.html', 'utf8');
  const block = html.match(new RegExp(`<select id="${id}"[\\s\\S]*?</select>`))[0];
  return [...block.matchAll(/<option(?: value="([^"]*)")?>([^<]*)</g)]
    .map((m) => (m[1] !== undefined ? m[1] : m[2].replace(/&amp;/g, '&')))
    .slice(1); // drop the leading 'any' placeholder
}

test('the feeling dropdown ships exactly the emotions with at least eight stories', async () => {
  assert.deepEqual(await selectOptions('emotion-filter'), emotionCensus());
});

test('the series dropdown ships exactly the series with at least eight stories', async () => {
  assert.deepEqual(await selectOptions('series-filter'), seriesCensus());
});

test('the series floor excludes the short series, not the catalog', async () => {
  const census = seriesCensus();
  assert.ok(!census.includes('Helpsters Help You'), 'a six story series stays out of the dropdown');
  assert.equal(census.length, 17);
});
