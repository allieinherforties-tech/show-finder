// Emotion and series filters, server side: both are hard filters on the
// filter-only query path, exactly like age and vibe. An emotion term matches
// any of the emotions a story carries (OR within the row). These run the real
// app server over the real committed artifact, so the counts double as a
// census check against data/search/search-artifact.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.mjs';

const app = createApp();
await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
const { port } = app.address();
test.after(() => app.close());

async function apiSearch(query) {
  const res = await fetch(`http://127.0.0.1:${port}/api/search${query}`);
  return { status: res.status, body: await res.json() };
}

test('an emotion filter matches any of the emotions a story carries', async () => {
  const { status, body } = await apiSearch(`?emotion=${encodeURIComponent('nervous/worried')}&limit=600`);
  assert.equal(status, 200);
  assert.ok(body.count > 0);
  assert.equal(body.count, body.matched, 'a hard filter returns the whole matched set');
  for (const r of body.results) {
    assert.ok(r.emotions.includes('nervous/worried'), 'every result carries the feeling');
  }
});

test('the emotion filter respects the corpus census', async () => {
  // 120 nervous/worried and 159 happy stories in the 525 story artifact
  // (547 minus the 22 rows the parent-facing gate holds back; verified 2026 11 14).
  const { body } = await apiSearch(`?emotion=${encodeURIComponent('nervous/worried')}&limit=600`);
  assert.equal(body.matched, 120);
  const happy = await apiSearch('?emotion=happy&limit=600');
  assert.equal(happy.body.matched, 159);
});

test('a series filter narrows to that series only', async () => {
  const { status, body } = await apiSearch('?series=Stillwater&limit=600');
  assert.equal(status, 200);
  assert.ok(body.count > 0);
  for (const r of body.results) assert.equal(r.seriesTitle, 'Stillwater');
});

test('filters combine: emotion, series, and age band together', async () => {
  const { status, body } = await apiSearch(`?emotion=sad&series=${encodeURIComponent('Camp Snoopy')}&age=5-7&limit=600`);
  assert.equal(status, 200);
  assert.ok(body.count > 0, 'the combination has real stories');
  for (const r of body.results) {
    assert.ok(r.emotions.includes('sad'));
    assert.equal(r.seriesTitle, 'Camp Snoopy');
    assert.equal(r.ageBand, '5-7');
  }
});

test('an unknown emotion term is ignored, not invented into a filter', async () => {
  // No q and no valid filter means nothing to answer: the honest refusal.
  const { status, body } = await apiSearch('?emotion=xyzzy');
  assert.equal(status, 400);
  assert.ok(body.error);
});

test('an unknown series name is ignored the same way', async () => {
  const { status } = await apiSearch('?series=Not%20A%20Real%20Show');
  assert.equal(status, 400);
});

test('a filter combination nothing matches returns an honest zero', async () => {
  const { status, body } = await apiSearch(`?emotion=jealous&series=${encodeURIComponent('Surfside Girls')}`);
  assert.equal(status, 200);
  assert.equal(body.matched, 0);
  assert.equal(body.count, 0);
});
