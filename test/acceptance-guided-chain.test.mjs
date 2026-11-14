// Acceptance regression for the guided reply chain, from Allie's 2026 11 14
// ruling, verified against the wb_McM7y4Xx sheet 'Script pilot v2':
//
//   all three phrasings ('stillwater', 'michael drops a baseball',
//   'wants to quit his sport') must reach the Stillwater segment
//   'The Catch' (stillwater-s3-e9-seg1) within at most three replies.
//
// 'The Catch' row: Michael drops the game ending catch and quits baseball
// 'never, ever, never'; emotion tags shame/embarrassment and sad, which
// normalize to the canonical terms embarrassed and sad; age band 5-7.
//
// This runs the REAL app server over the REAL committed artifact, and taps
// clarifiers the way a parent would: the feeling that fits the kid, then the
// age band. The chain offers at most two rounds; the case must pass inside
// them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.mjs';
import { deriveClarifiers, parseChainState, chainStateToParams } from '../public/guided-replies.js';

// The target story, pinned from the acceptance sheet.
const TARGET = { seriesTitle: 'Stillwater', segmentTitle: 'The Catch', id: 'stillwater-s3-e9-seg1' };
const TARGET_EMOTIONS = ['embarrassed', 'sad'];
const TARGET_AGE = '5-7';

const app = createApp();
await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
const { port } = app.address();
test.after(() => app.close());

async function apiSearch(state) {
  const params = chainStateToParams(state);
  const res = await fetch(`http://127.0.0.1:${port}/api/search?${params}`);
  assert.equal(res.status, 200, `search must answer: ${params}`);
  return res.json();
}

function isTarget(row) {
  return row.seriesTitle === TARGET.seriesTitle && row.segmentTitle === TARGET.segmentTitle;
}

// A parent taps the clarifier that fits their kid: the target's feeling when
// it is offered, otherwise the target's age band. Never the other way round.
function pickReply(options, state) {
  const emotion = options.find((o) => o.facet === 'emotion' && TARGET_EMOTIONS.includes(o.value));
  if (emotion) return emotion;
  if (!state.age) {
    const age = options.find((o) => o.facet === 'age' && o.value === TARGET_AGE);
    if (age) return age;
  }
  return null;
}

test('the Michael drops a baseball phrasing reaches The Catch with zero replies', async () => {
  const data = await apiSearch({ q: 'michael drops a baseball', round: 0 });
  const row = data.results.find(isTarget);
  assert.ok(row, 'The Catch must surface unassisted for the direct phrasing');
  assert.equal(row.id, TARGET.id);
});

for (const phrase of ['stillwater', 'michael drops a baseball', 'wants to quit his sport']) {
  test(`the ${JSON.stringify(phrase)} phrasing reaches The Catch inside two rounds`, async () => {
    let state = { q: phrase, emotion: '', age: '', series: '', round: 0 };
    let data = await apiSearch(state);
    let replies = 0;

    while (replies < 3 && !data.results.some(isTarget)) {
      assert.ok(replies < 2, 'the chain offers at most two rounds; the case must pass inside them');
      const options = deriveClarifiers(data.facets, state, data.matched);
      const reply = pickReply(options, state);
      assert.ok(reply, `round ${replies + 1} must offer a clarifier that fits the kid: ${JSON.stringify(options)}`);
      state = { ...state, round: replies + 1 };
      if (reply.facet === 'emotion') state.emotion = reply.value;
      if (reply.facet === 'age') state.age = reply.value;
      if (reply.facet === 'series') state.series = reply.value;
      data = await apiSearch(state);
      replies += 1;
    }

    const row = data.results.find(isTarget);
    assert.ok(row, `The Catch must be visible within at most three replies (used ${replies})`);
    assert.equal(row.id, TARGET.id);
    assert.equal(row.ageBand, TARGET_AGE);
    for (const emo of TARGET_EMOTIONS) {
      assert.ok(row.emotions.includes(emo), `The Catch carries the canonical term ${emo}`);
    }
  });
}

test('the chain state stays in URL parameters end to end', async () => {
  // The full state, including the round count, is encoded in the query string
  // the server already answered; the reply above round tripped through
  // chainStateToParams. Round trip once more here against the live API.
  const state = parseChainState(chainStateToParams({ q: 'wants to quit his sport', emotion: 'sad', age: '5-7', series: '', round: 2 }));
  const data = await apiSearch(state);
  assert.equal(state.round, 2);
  assert.ok(data.results.some(isTarget), 'a fully guided chain still surfaces The Catch');
});
