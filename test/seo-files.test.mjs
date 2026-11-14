// Search Console plumbing: robots.txt points at the sitemap, the sitemap
// lists exactly the public routes the build serves, and nothing here adds
// analytics, cookies, or a verification meta tag (the Google Domain property
// is DNS verified and covers the subdomain).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const CANONICAL = 'https://finder.parentpeptalks.com';

test('robots.txt exists and points at the canonical sitemap', () => {
  const robots = readFileSync('public/robots.txt', 'utf8');
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/ ?$/m);
  assert.ok(robots.includes(`Sitemap: ${CANONICAL}/sitemap.xml`), 'the sitemap pointer uses the canonical domain');
});

test('the sitemap lists exactly the page routes the build serves', () => {
  const sitemap = readFileSync('public/sitemap.xml', 'utf8');
  // The finder is one page: search, results, and episode details render on
  // the landing route, so the only page URL is the canonical root. Static
  // assets are listed in pages: sitemaps are for pages, not files.
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, [`${CANONICAL}/`]);
  assert.ok(sitemap.includes('http://www.sitemaps.org/schemas/sitemap/0.9'), 'the sitemap declares the protocol namespace');
});

test('the sitemap lists no route that does not exist in the build', () => {
  const sitemap = readFileSync('public/sitemap.xml', 'utf8');
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  for (const loc of locs) {
    const route = loc.replace(CANONICAL, '');
    const file = route === '/' ? 'public/index.html' : `public${route}`;
    assert.ok(existsSync(file), `sitemap route ${route} has no served file`);
  }
});

test('no verification meta tag and no analytics creep into the page', () => {
  const html = readFileSync('public/index.html', 'utf8');
  assert.equal(/google-site-verification/i.test(html), false, 'no verification meta tag: the Domain property is DNS verified');
  assert.equal(/plausible|analytics|gtag|googletagmanager/i.test(html), false, 'no analytics scripts, per the 2026-11-14 deferral');
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(scripts, ['/app.js'], 'the only script tag is the first-party app module');
  const appJs = readFileSync('public/app.js', 'utf8');
  assert.equal(/localStorage\.|sessionStorage\.|document\.cookie/.test(appJs), false, 'no storage and no cookies');
});

test('every public file the server could serve is a real build asset', () => {
  const files = readdirSync('public');
  for (const f of ['robots.txt', 'sitemap.xml', 'index.html', 'styles.css', 'app.js', 'guided-replies.js', 'play-button.png', 'tmdb-logo.svg']) {
    assert.ok(files.includes(f), `${f} ships in public/`);
  }
});
