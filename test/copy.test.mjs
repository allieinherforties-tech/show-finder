// House style gate: zero em dashes and en dashes in any generated copy or UI
// string. Source data with dashes is flagged by the build validation report,
// not rewritten here; this test guards what WE wrote.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const DASHES = /[\u2013\u2014]/;

const FILES = ['public/index.html', 'public/app.js', 'public/styles.css', 'README.md', 'AGENTS.md'];

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
