// House style gate: zero em dashes and en dashes in any generated copy or UI
// string. Source data with dashes is flagged by the build validation report,
// not rewritten here; this test guards what WE wrote.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { HOLIDAY_RAILS, resolveHolidayRails, renderRailCard } from '../src/rails.mjs';

const DASHES = /[\u2013\u2014]/;

// PRD Finder v1.1, Amendment 4: internal process vocabulary never reaches a
// parent-facing surface. The scan mirrors the runtime gate in
// src/pipeline/parent-facing.mjs (which is excluded here: it owns the
// registry and must name the phrases it bans).
import { BANNED_PROCESS_LANGUAGE } from '../src/pipeline/parent-facing.mjs';

const PROCESS_LANGUAGE_FILES = [
  'public/index.html',
  'public/app.js',
  'public/guided-replies.js',
  'public/styles.css',
];

const FILES = [
  'public/index.html',
  'public/app.js',
  'public/guided-replies.js',
  'public/styles.css',
  'README.md',
  'AGENTS.md',
];

test('house copy carries zero em or en dashes', async () => {
  for (const file of FILES) {
    const text = await readFile(file, 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      assert.equal(
        DASHES.test(lines[i]),
        false,
        `${file}:${i + 1} contains a dash character: ${lines[i].trim().slice(0, 80)}`,
      );
    }
  }
});

test('the search UI component source is dash free', async () => {
  const files = (await readdir('src', { recursive: true }))
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => path.join('src', f));
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    // Strip comments before scanning: provenance notes may quote the vocabulary
    // memo, and source file comments are not product copy.
    const code = text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const lines = code.split('\n');
    for (let i = 0; i < lines.length; i++) {
      assert.equal(
        DASHES.test(lines[i]),
        false,
        `${file}:${i + 1} has a dash in code or string content`,
      );
    }
  }
});

test('no banned internal process language in any authored surface', async () => {
  // The registry regex is non-global (match semantics for the runtime
  // gate); the scan needs a global copy per file.
  const banned = new RegExp(BANNED_PROCESS_LANGUAGE.source, 'gi');
  const offenders = [];
  for (const file of PROCESS_LANGUAGE_FILES) {
    const text = await readFile(file, 'utf8');
    // Comments are allowed to name the rule (the gate, the PRD); the ban
    // targets shipped copy and markup.
    const code = text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const hits = [...code.matchAll(banned)].map((m) => m[0]);
    if (hits.length > 0) offenders.push(`${file}: ${hits.join(', ')}`);
  }
  assert.deepEqual(offenders, [], 'internal process language leaked into authored surfaces');
});

test('no banned internal process language in any rendered rail row', async () => {
  const banned = new RegExp(BANNED_PROCESS_LANGUAGE.source, 'gi');
  const artifact = JSON.parse(await readFile('data/search/search-artifact.json', 'utf8'));
  const storiesById = new Map(artifact.stories.map((s) => [s.id, s]));
  const { rails } = resolveHolidayRails(HOLIDAY_RAILS, (id) => storiesById.get(id) || null);
  const offenders = [];
  for (const rail of rails) {
    for (const row of rail.rows) {
      const html = renderRailCard(row);
      const hits = [...html.matchAll(banned)].map((m) => m[0]);
      if (hits.length > 0) offenders.push(`${row.storyId}: ${hits.join(', ')}`);
    }
  }
  assert.deepEqual(offenders, [], 'rendered rail rows stay in parent voice');
});
