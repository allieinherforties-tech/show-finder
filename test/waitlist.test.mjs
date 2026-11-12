// Waitlist conversion guards: waitlist-only conversion is load bearing for
// the artwork route, so the CTA target, its markup, and its copy discipline
// are all pinned by tests.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  applyWaitlistUrl,
  DEFAULT_WAITLIST_URL,
  WAITLIST_URL,
  WAITLIST_URL_PLACEHOLDER,
} from '../src/waitlist.mjs';

test('the default config value is the Parent Pep Talks waitlist page', () => {
  assert.equal(WAITLIST_URL, DEFAULT_WAITLIST_URL);
  assert.equal(DEFAULT_WAITLIST_URL, 'https://parentpeptalks.com/');
});

test('substitution replaces every placeholder occurrence with the configured URL', () => {
  const html = '<a href="__WAITLIST_URL__">one</a><a href="__WAITLIST_URL__">two</a>';
  const out = applyWaitlistUrl(html, 'https://example.com/waitlist');
  assert.equal(out.includes(WAITLIST_URL_PLACEHOLDER), false);
  assert.equal(out.split('https://example.com/waitlist').length - 1, 2);
});

test('the substituted URL cannot break out of the href attribute', () => {
  const out = applyWaitlistUrl('<a href="__WAITLIST_URL__">x</a>', 'https://example.com/"><script>alert(1)</script>');
  assert.equal(out.includes('<script>'), false);
  assert.match(out, /href="https:\/\/example\.com\/%22%3e%3cscript%3e/);
});

test('the served page carries real anchors pointing at the configured target', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const served = applyWaitlistUrl(html);
  assert.match(served, /<a class="waitlist-cta" href="https:\/\/parentpeptalks\.com\/" rel="noopener">Join the Parent Pep Talks waitlist<\/a>/);
  assert.match(served, /<a class="waitlist-secondary" href="https:\/\/parentpeptalks\.com\/" rel="noopener">Read the back story at Parent Pep Talks<\/a>/);
  assert.match(served, /This finder comes from Parent Pep Talks\./);
});

test('the CTA is a descriptive anchor in static markup, never built by JavaScript', async () => {
  const [html, js] = await Promise.all([
    readFile('public/index.html', 'utf8'),
    readFile('public/app.js', 'utf8'),
  ]);
  assert.match(html, /<a class="waitlist-cta" href="[^"]*"/);
  assert.equal(js.includes('waitlist-cta'), false);
  const cta = html.match(/<a class="waitlist-cta"[^>]*>([^<]*)<\/a>/);
  assert.ok(cta, 'the CTA anchor must carry its accessible name as text');
  assert.ok(!/click here|here/i.test(cta[1]), 'the accessible name must be descriptive');
});

test('the finder embeds zero external scripts and no third-party form', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const served = applyWaitlistUrl(html);
  for (const match of served.matchAll(/<script[^>]*src="([^"]*)"/g)) {
    assert.ok(match[1].startsWith('/'), `script src must be local, found ${match[1]}`);
  }
  assert.equal(/kit-form|data-kit-form|convertkit/i.test(served), false);
});

test('total conversion copy stays under 80 words', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const waitlistSection = html.match(/<section id="waitlist"[\s\S]*?<\/section>/)[0];
  const aboutCopy = html.match(/<p class="about-waitlist">[\s\S]*?<\/p>/)[0];
  const text = [waitlistSection, aboutCopy]
    .join(' ')
    .replace(/<[^>]+>/g, ' ')
    .split(WAITLIST_URL_PLACEHOLDER)
    .join('');
  const words = text.split(/\s+/).filter(Boolean).length;
  assert.ok(words < 80, `conversion copy is ${words} words, limit is 80`);
});
