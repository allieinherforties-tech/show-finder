import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretQuery, ftsMatchExpression } from '../src/search/interpret.mjs';
import { EMOTION_TERMS, VIBES } from '../src/vocabulary.mjs';

test('extracts an age band from a stated kid age', () => {
  assert.equal(interpretQuery('she is 4 and scared of the dark').ageBand, '2-4');
  assert.equal(interpretQuery('my 6 year old keeps having tantrums').ageBand, '5-7');
  assert.equal(interpretQuery('something for a 9 year old').ageBand, '8-10');
  assert.equal(interpretQuery('age 3').ageBand, '2-4');
  assert.equal(interpretQuery('scared of the dark').ageBand, null);
  assert.equal(interpretQuery('band 5-7').ageBand, '5-7');
});

test('maps parent emotion words to canonical vocabulary terms', () => {
  const out = interpretQuery('my kid is worried about the presentation');
  assert.deepEqual(out.emotions, ['nervous/worried']);
  assert.equal(EMOTION_TERMS.includes(out.emotions[0]), true);
});

test('maps multi-word feelings before single words', () => {
  const out = interpretQuery('she feels left out at school');
  assert.deepEqual(out.emotions, ['lonely']);
});

test('detects a vibe when the parent asks for one', () => {
  const calm = interpretQuery('something calm before bed');
  assert.equal(calm.vibe, 'calm');
  assert.equal(VIBES.includes(calm.vibe), true);
  assert.equal(interpretQuery('a funny show').vibe, 'silly');
  assert.equal(interpretQuery('scared of the dark').vibe, null);
});

test('never invents an emotion the vocabulary does not hold', () => {
  for (const q of ['my kid is scared of the dark', 'big feelings', 'new baby sibling']) {
    for (const e of interpretQuery(q).emotions) {
      assert.equal(EMOTION_TERMS.includes(e), true, `${q} produced off-vocabulary emotion ${e}`);
    }
  }
});

test('ftsMatchExpression quotes tokens and adds prefix matching', () => {
  assert.equal(ftsMatchExpression('scared of the dark'), '"scared"* OR "dark"*');
  assert.equal(ftsMatchExpression('!!!'), null);
});
