// End-to-end smoke: boots the real app server on an ephemeral port and checks
// health plus the flagship parent query against the real committed artifact.

import assert from 'node:assert/strict';
import { createApp } from '../src/server.mjs';

const app = createApp();
await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
const { port } = app.address();

async function getJson(pathname) {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`);
  return { status: res.status, body: await res.json() };
}

try {
  const health = await getJson('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  assert.ok(health.body.storyCount > 0, 'artifact must hold stories');

  const search = await getJson('/api/search?q=' + encodeURIComponent('my kid is scared of the dark'));
  assert.equal(search.status, 200);
  assert.ok(search.body.count > 0, 'flagship query must match at least one story');
  const first = search.body.results[0];
  for (const field of ['seriesTitle', 'episodeNumber', 'situation', 'displaySynopsis']) {
    assert.ok(first[field] !== undefined && first[field] !== null, `result must carry ${field}`);
  }

  const filtered = await getJson('/api/search?q=' + encodeURIComponent('scared of the dark') + '&age=2-4');
  assert.equal(filtered.status, 200);
  for (const r of filtered.body.results) {
    assert.equal(r.ageBand, '2-4');
  }

  const page = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /what/);
  console.log(`smoke ok: ${health.body.storyCount} stories, version ${health.body.version}`);
} finally {
  app.close();
}
