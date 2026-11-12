// End-to-end smoke: boots the real app server on an ephemeral port and checks
// health plus the flagship parent query against the real committed artifact.

import assert from 'node:assert/strict';
import { createApp, ARTWORK_MODE } from '../src/server.mjs';

const app = createApp();
await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
const { port } = app.address();

async function getJson(pathname) {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`);
  return { status: res.status, body: await res.json() };
}

// Verified deep-link pattern shape, from the findings document samples.
const APPLE_URL = /^https:\/\/tv\.apple\.com\/us\/(episode|show|movie)\/[a-z0-9-]+\/umc\.cmc\.[a-z0-9]{20,32}(\?showId=umc\.cmc\.[a-z0-9]{20,32})?$/;
const TMDB_URL = /^https:\/\/image\.tmdb\.org\/t\/p\/(w780|w342)\/[A-Za-z0-9_.-]+\.(jpg|png|webp)$/;

try {
  const health = await getJson('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  assert.ok(health.body.storyCount > 0, 'artifact must hold stories');
  assert.equal(health.body.artworkMode, ARTWORK_MODE, 'health reports the artwork mode');

  const search = await getJson('/api/search?q=' + encodeURIComponent('my kid is scared of the dark'));
  assert.equal(search.status, 200);
  assert.equal(search.body.artworkMode, ARTWORK_MODE);
  assert.ok(search.body.count > 0, 'flagship query must match at least one story');
  const first = search.body.results[0];
  for (const field of ['seriesTitle', 'episodeNumber', 'situation', 'displaySynopsis']) {
    assert.ok(first[field] !== undefined && first[field] !== null, `result must carry ${field}`);
  }
  for (const r of search.body.results) {
    if (r.appleUrl) assert.match(r.appleUrl, APPLE_URL, `malformed apple link on ${r.id}`);
    if (r.stillUrl) assert.match(r.stillUrl, TMDB_URL, `malformed still URL on ${r.id}`);
  }

  // In tmdb mode the flagship results must actually carry artwork; in text
  // mode the same artifact serves and the frontend simply hides images.
  if (ARTWORK_MODE === 'tmdb') {
    assert.ok(
      search.body.results.some((r) => r.stillUrl || r.posterUrl),
      'tmdb mode must serve artwork URLs from the artifact',
    );
  }

  const filtered = await getJson('/api/search?q=' + encodeURIComponent('scared of the dark') + '&age=2-4');
  assert.equal(filtered.status, 200);
  for (const r of filtered.body.results) {
    assert.equal(r.ageBand, '2-4');
  }

  const page = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /what/);
  // Attribution: the verbatim notice and the TMDB logo must ship with the page.
  assert.match(html, /This website uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB\./);
  assert.match(html, /\/tmdb-logo\.svg/);
  const logo = await fetch(`http://127.0.0.1:${port}/tmdb-logo.svg`);
  assert.equal(logo.status, 200);
  console.log(`smoke ok: ${health.body.storyCount} stories, version ${health.body.version}, artwork mode ${health.body.artworkMode}`);
} finally {
  app.close();
}
