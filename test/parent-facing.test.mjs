// The parent-facing gate: internal QA annotations and unverified synopsis
// fallback resolutions never reach a parent's card. Unit tests over the pure
// gate, plus a regression test over the committed artifact itself: the leak
// Allie screenshotted on the Get Rolling with Otis card can never ship again.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { internalAnnotationHits, hasUnverifiedResolution, suppressionReasons, PARENT_FACING_TEXT_FIELDS } from '../src/pipeline/parent-facing.mjs';

const artifact = JSON.parse(readFileSync('data/search/search-artifact.json', 'utf8'));

test('internal annotation prose in a parent-facing field is caught, field named', () => {
  const story = {
    situation: "SYNOPSIS-ONLY (fallback): no subtitle script was available for this episode, so this row is tagged from the catalog synopsis alone and may miss details.",
    coping: "SYNOPSIS-ONLY: resolution not verified from script; the synopsis frames a sibling-arrival story. Needs Allie's review before use.",
    displaySynopsis: "A winter's cow tale. SYNOPSIS-ONLY, see notes.",
  };
  const hits = internalAnnotationHits(story);
  assert.deepEqual(hits.map((h) => h.field).sort(), ['coping', 'displaySynopsis', 'situation']);
});

test('clean parent-facing copy raises no annotation hits', () => {
  const story = {
    situation: 'waiting for a new sibling to arrive',
    coping: 'decorating the tree together while the family waits',
    displaySynopsis: "A winter's cow tale: Christmas morning, a little sister wants the tree decorated.",
  };
  assert.deepEqual(internalAnnotationHits(story), []);
  assert.deepEqual(suppressionReasons(story), []);
});

test('a synopsis fallback row without script evidence has an unverified resolution', () => {
  const story = {
    notes: "SYNOPSIS-ONLY FALLBACK, low confidence: no Gestdown script exists for this episode, so situation, emotion, and resolution are inferred from the catalog synopsis; resolution is an inference, not a screened fact.",
  };
  assert.equal(hasUnverifiedResolution(story), true);
  assert.ok(suppressionReasons(story).some((r) => r.startsWith('unverified resolution')));
});

test('a row whose notes discuss a script comparison was script-assessed, not a fallback', () => {
  // Real row shape: camp-snoopy-s1-e3-seg1. Its notes mention what synopsis
  // only tagging WOULD have read; script_vs_synopsis: proves a script ran.
  const story = {
    notes: 'vibe provisional (felt-energy draft; brand-vs-felt rule undecided). script_vs_synopsis: script names the belly-flop backstory and the nickname that keeps the fear alive; synopsis-only tagging would read this as plain fear of water.',
    situation: 'a fear of water that turns out to be shame about the belly flop',
    coping: 'sharing fears with friends normalizes hers',
  };
  assert.equal(hasUnverifiedResolution(story), false);
  assert.deepEqual(suppressionReasons(story), []);
});

test('every field the UI renders is inside the scanned set', () => {
  // The card renders: titles, situation, displaySynopsis, coping, and the tag
  // line (ageBand, vibe, emotions). Any new rendered text field must be added
  // to PARENT_FACING_TEXT_FIELDS or the gate cannot see it.
  for (const field of ['episodeTitle', 'segmentTitle', 'situation', 'coping', 'displaySynopsis']) {
    assert.ok(PARENT_FACING_TEXT_FIELDS.includes(field), `${field} must be scanned`);
  }
});

test('REGRESSION: the published artifact carries no internal annotation in any parent-facing field', () => {
  const leaked = [];
  for (const story of artifact.stories) {
    for (const hit of internalAnnotationHits(story)) {
      leaked.push(`${story.id}: ${hit.field} contains "${hit.match}"`);
    }
  }
  assert.deepEqual(leaked, [], 'internal QA annotations leaked into the parent-facing artifact');
});

test('REGRESSION: no published story row has an unverified synopsis-fallback resolution', () => {
  // Story rows only: a film's evidence tier is a deliberate, internally
  // tracked property of the corpus (Film Card Diction ruling), and honesty
  // for films lives in what the card claims, not in hiding the row. The
  // story rule here still reads the notes the way it always has.
  const unverified = artifact.stories
    .filter((s) => s.kind !== 'film')
    .filter(hasUnverifiedResolution)
    .map((s) => s.id);
  assert.deepEqual(unverified, [], 'rows with unverified resolutions shipped to parents');
});

test('REGRESSION: every film in the artifact is a verified-link row with a known evidence tier', () => {
  // The film honesty gate at build time: live-verified Apple link on every
  // row, tier internal only. This test pins what shipped; the build gate
  // itself is tested against fixtures in films.test.mjs.
  for (const film of artifact.stories.filter((s) => s.kind === 'film')) {
    assert.match(film.appleUrl || '', /^https:\/\/tv\.apple\.com\/us\/movie\//, `${film.id} carries a movie deep link`);
    assert.ok(['synopsis_fallback', 'title_overview'].includes(film.evidenceTier), `${film.id} carries a known evidence tier`);
  }
});

test('the gate held back the known fallback rows; the artifact count reflects it', () => {
  const report = JSON.parse(readFileSync('data/search/validation-report.json', 'utf8'));
  const suppressed = report.parentFacing.suppressedFromRender;
  assert.ok(suppressed.length > 0, 'the validation report must name the held-back rows');
  const ids = new Set(suppressed.map((r) => r.id));
  for (const id of ['get-rolling-with-otis-s1-e9', 'frog-and-toad-s1-e9', 'eva-the-owlet-s1-e9']) {
    assert.ok(ids.has(id), `${id} must be held back from render`);
  }
  assert.equal(artifact.storyCount, artifact.stories.length, 'storyCount matches the rows');
});

// PRD Finder v1.1, Amendment 4: internal process vocabulary never reaches a
// parent-facing surface. The banned phrases name the database, not the story.
import { internalLanguageHits, BANNED_PROCESS_LANGUAGE } from '../src/pipeline/parent-facing.mjs';

test('every banned process phrase is caught, in any casing', () => {
  const phrases = [
    'the row',
    'Listed strategy shows the answer',
    'the synopsis tells the whole story',
    "what shows up in the synopsis is this",
  ];
  for (const phrase of phrases) {
    assert.ok(internalLanguageHits(phrase).length > 0, `caught: ${phrase}`);
  }
});

test('clean parent-voice copy raises no process-language hits', () => {
  assert.deepEqual(internalLanguageHits('The episode ends with her still figuring it out.'), []);
  assert.deepEqual(internalLanguageHits('Three days in a row of sunny mornings.'), []);
  assert.deepEqual(internalLanguageHits(undefined), []);
  assert.deepEqual(internalLanguageHits(null), []);
});

test('every banned phrase in the registry is matched by the scanner', () => {
  const source = BANNED_PROCESS_LANGUAGE.source;
  const phrases = source.split('|').map((p) => p.replace(/\\b/g, ''));
  for (const phrase of phrases) {
    assert.ok(internalLanguageHits(phrase).length > 0, `the scanner catches its own registry entry: ${phrase}`);
  }
});
