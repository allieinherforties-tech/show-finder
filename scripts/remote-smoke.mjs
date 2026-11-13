#!/usr/bin/env node
// Remote smoke for the live service: runs from the repo sandbox against both
// production domains. Node 18+ (built-in fetch). Exits 1 on any failure.
//
//   node scripts/remote-smoke.mjs [baseUrl] [secondBaseUrl]
//
// Defaults cover the two production domains below; pass other URLs to smoke
// a preview environment. Each check asserts one deployment fact: HTTPS with a
// valid certificate (fetch fails otherwise), the honest story count, the
// frozen artifact version, exactly ONE 'This Season' section, no New Year
// remnants, working search, TMDB attribution, and zero em dashes.

const DEFAULT_URLS = [
  'https://finder.parentpeptalks.com',
  'https://show-finder-production.up.railway.app',
];

const urls = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_URLS;

const EXPECT = {
  storyCount: '547',
  version: '12ac6ea1abd4ebe9',
};

let failures = 0;

// Version and storyCount are served on /api/health; the landing HTML renders
// the rail, the footer, and the TMDB attribution.
async function healthVersion(base) {
  try {
    const res = await fetch(`${base}/api/health`);
    const body = await res.json();
    return String(body.version ?? '');
  } catch {
    return '';
  }
}

async function healthStoryCount(base) {
  try {
    const res = await fetch(`${base}/api/health`);
    const body = await res.json();
    return String(body.storyCount ?? '');
  } catch {
    return '';
  }
}

function check(label, ok, detail = '') {
  if (ok) {
    console.log(`  ok    ${label}${detail ? ` (${detail})` : ''}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}${detail ? ` (${detail})` : ''}`);
  }
}

for (const base of urls) {
  const host = base.replace(/^https?:\/\//, '');
  console.log(`\n== ${host} ==`);

  let landing;
  try {
    const res = await fetch(`${base}/`);
    landing = await res.text();
    check('HTTPS 200 with a valid certificate', res.ok, `status ${res.status}`);
  } catch (err) {
    check('HTTPS 200 with a valid certificate', false, String(err));
    continue;
  }

  check('story count is 547', landing.includes(EXPECT.storyCount) || (await healthStoryCount(base)) === EXPECT.storyCount, `expects ${EXPECT.storyCount}`);
  check(`artifact version is ${EXPECT.version}`, landing.includes(EXPECT.version) || (await healthVersion(base)) === EXPECT.version, `expects ${EXPECT.version}`);

  const sections = landing.match(/<h2>This Season<\/h2>/g) || [];
  check('exactly one This Season section', sections.length === 1, `found ${sections.length}`);
  check('no New Year remnants', !/new year/i.test(landing));
  check('TMDB attribution present', landing.includes('This website uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.'), 'verbatim notice');
  check('zero em dashes', !landing.includes('\u2014'));

  try {
    const res = await fetch(`${base}/api/search?q=blizzard`);
    const results = await res.json();
    const count = Array.isArray(results.results) ? results.results.length : results.results?.length ?? 0;
    check('live search ok', res.ok && count > 0, `status ${res.status}, ${count} hits`);
  } catch (err) {
    check('live search ok', false, String(err));
  }
}

console.log('');
if (failures) {
  console.error(`smoke FAILED: ${failures} check(s)`);
  process.exit(1);
}
console.log('smoke passed');
