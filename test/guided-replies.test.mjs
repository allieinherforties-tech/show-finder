// Unit tests for the guided reply chain logic in public/guided-replies.js,
// plus the product invariants that must never regress: labels come from the
// existing controlled vocabularies, the chain caps at two rounds, and chain
// state lives in URL parameters with no storage or logging anywhere.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AGE_BANDS } from '../src/vocabulary.mjs';
import {
  MAX_ROUNDS,
  MIN_MATCHED_FOR_CLARIFIERS,
  deriveClarifiers,
  parseChainState,
  chainStateToParams,
  chainPrompt,
  ageBandLabel,
} from '../public/guided-replies.js';

const FACETS = {
  emotions: [
    { term: 'frustrated', count: 6 },
    { term: 'lonely', count: 5 },
    { term: 'nervous/worried', count: 4 },
    { term: 'sad', count: 2 },
  ],
  ageBands: [
    { value: '5-7', count: 9 },
    { value: '2-4', count: 6 },
  ],
  series: [{ title: 'Stillwater', count: 20 }],
};

test('round one offers the dominant emotion split, then age and series', () => {
  const options = deriveClarifiers(FACETS, { emotion: '', age: '', series: '', round: 0 }, 20);
  assert.deepEqual(options.slice(0, 3).map((o) => o.value), ['frustrated', 'lonely', 'nervous/worried']);
  assert.deepEqual(options.slice(3).map((o) => [o.facet, o.value]), [
    ['age', '5-7'],
    ['age', '2-4'],
  ]);
  // Stillwater is the only series in the set, so no series clarifier.
  assert.equal(options.some((o) => o.facet === 'series'), false);
});

test('emotion labels are canonical vocabulary terms passed through untouched', () => {
  const options = deriveClarifiers(FACETS, { emotion: '', age: '', series: '', round: 0 }, 20);
  for (const o of options.filter((o) => o.facet === 'emotion')) {
    assert.ok(AGE_BANDS.concat(['frustrated', 'lonely', 'nervous/worried', 'sad']).includes(o.value));
    assert.equal(o.label, o.value, 'emotion labels are the terms themselves, not invented copy');
  }
});

test('an answered emotion is never offered again', () => {
  const options = deriveClarifiers(FACETS, { emotion: 'sad', age: '', series: '', round: 1 }, 20);
  assert.equal(options.some((o) => o.facet === 'emotion'), false);
});

test('a dominant facet is not offered: tapping it would narrow nothing', () => {
  const dominated = {
    emotions: [{ term: 'happy', count: 19 }, { term: 'sad', count: 1 }],
    ageBands: [{ value: '5-7', count: 20 }],
    series: [{ title: 'Stillwater', count: 20 }],
  };
  const options = deriveClarifiers(dominated, { emotion: '', age: '', series: '', round: 0 }, 20);
  assert.equal(options.length, 0);
});

test('the chain ends after two rounds and stays quiet under five matches', () => {
  const state = { emotion: 'sad', age: '', series: '', round: MAX_ROUNDS };
  assert.equal(deriveClarifiers(FACETS, state, 20).length, 0);
  assert.equal(deriveClarifiers(FACETS, { ...state, round: 0 }, MIN_MATCHED_FOR_CLARIFIERS - 1).length, 0);
});

test('age band labels match the finder vocabulary exactly', () => {
  for (const band of AGE_BANDS) {
    assert.match(ageBandLabel(band), /^ages \d+ to \d+$/);
  }
  assert.equal(ageBandLabel('5-7'), 'ages 5 to 7');
});

test('chain state round trips through URL parameters and nothing else', () => {
  const state = { q: 'wants to quit his sport', emotion: 'sad', age: '5-7', series: 'Stillwater', round: 2 };
  const params = chainStateToParams(state);
  assert.equal(String(params), 'q=wants+to+quit+his+sport&emotion=sad&age=5-7&series=Stillwater&r=2');
  assert.deepEqual(parseChainState(params), state);
});

test('malformed round values fall back to a fresh chain', () => {
  for (const bad of ['9', '-1', 'two', '1.5']) {
    assert.equal(parseChainState(new URLSearchParams({ r: bad })).round, 0, `r=${bad} must not be trusted`);
  }
});

test('the prompt stays calm and free of urgency', () => {
  assert.match(chainPrompt(0), /if one of these fits/);
  assert.match(chainPrompt(1), /tap one/);
});

test('no storage, cookies, or persistence anywhere in the chain path', async () => {
  const sources = await Promise.all([
    readFile('public/app.js', 'utf8'),
    readFile('public/guided-replies.js', 'utf8'),
    readFile('src/server.mjs', 'utf8'),
  ]);
  // Comments may name the invariant; code may not reach for the APIs.
  const code = (text) => text.replace(/\/\/.*$/gm, '');
  for (const text of sources) {
    assert.equal(/localStorage|sessionStorage|document\.cookie|indexedDB/i.test(code(text)), false);
  }
  // The server side of the chain neither logs nor persists a query.
  assert.equal(/INSERT|appendFile|createWriteStream/i.test(code(sources[2])), false);
});
