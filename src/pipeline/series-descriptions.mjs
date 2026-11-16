// Pure join between the browse-by-show strip's poster entries and the approved
// series description workbook. Like the artwork joins, nothing here touches
// the network or the filesystem, so the join is unit testable and the build
// stays deterministic.
//
// The popup's honesty rules live at this join: the block copy ships verbatim
// from the workbook (never rewritten in the pipeline or the UI), the age band
// is phrased as a suggestion with its basis, and the Apple link must carry
// the workbook's verified status — the same standard the deep-link registry
// holds story rows to. The retired single `description` column stays in the
// workbook untouched; the popup no longer reads it.

import { classifyAppleUrl } from '../links/apple-tv.mjs';

/** '5-7' becomes 'Suggested for ages 5\u20137' (en dash, per the approved popup copy). */
export function suggestedAgeLine(ageBand) {
  return `Suggested for ages ${String(ageBand).replace('-', '\u2013')}`;
}

/**
 * Joins the strip's poster entries ({ title, posterUrl }) with the approved
 * description rows. Fail-fast, like the poster gate: a series with no row, a
 * duplicate row, a stale row for a series the strip does not publish, a
 * missing block field, or a link the workbook does not mark verified stops
 * the build with instructions instead of shipping a half-joined popup.
 * Returns the entries in their input order (title order from the poster
 * gate), each extended with the popup's five blocks (whatHappens, ageBand,
 * ageBandBasis, feelings, situation, resolution) and appleSeriesUrl.
 */
export function joinSeriesDescriptions(posterEntries, rows) {
  const byTitle = new Map();
  const problems = [];
  for (const row of rows || []) {
    const title = String(row.series_title || '').trim();
    if (!title) {
      problems.push('a description row is missing series_title');
      continue;
    }
    if (byTitle.has(title)) {
      problems.push(`${title}: duplicate description rows where the popup needs exactly one`);
      continue;
    }
    byTitle.set(title, row);
  }

  const published = new Set(posterEntries.map((e) => e.title));
  for (const title of byTitle.keys()) {
    if (!published.has(title)) {
      problems.push(`${title}: description row names a series the strip does not publish (remove the stale row or publish the series)`);
    }
  }

  for (const entry of posterEntries) {
    const row = byTitle.get(entry.title);
    if (!row) {
      problems.push(`${entry.title}: no description row (add one to the Series Descriptions sheet)`);
      continue;
    }
    for (const column of ['what_happens', 'feelings', 'situation', 'resolution', 'age_band_basis']) {
      if (!String(row[column] || '').trim()) problems.push(`${entry.title}: ${column} is empty`);
    }
    const ageBand = String(row.age_band || '').trim();
    if (!ageBand) problems.push(`${entry.title}: age_band is empty`);
    const url = String(row.apple_series_url || '').trim();
    if (!url) {
      problems.push(`${entry.title}: apple_series_url is empty`);
    } else if (!classifyAppleUrl(url)) {
      problems.push(`${entry.title}: apple_series_url is not a canonical tv.apple.com link: ${url}`);
    }
    if (String(row.link_status || '').trim() !== 'verified') {
      problems.push(`${entry.title}: link_status is "${row.link_status}" where the popup ships only verified links (verify the link, then set the status)`);
    }
  }

  if (problems.length) {
    throw new Error(`series description gate failed:\n  ${problems.join('\n  ')}`);
  }

  return posterEntries.map((entry) => {
    const row = byTitle.get(entry.title);
    return {
      ...entry,
      whatHappens: String(row.what_happens || '').trim(),
      ageBand: String(row.age_band || '').trim(),
      ageBandBasis: String(row.age_band_basis || '').trim(),
      feelings: String(row.feelings || '').trim(),
      situation: String(row.situation || '').trim(),
      resolution: String(row.resolution || '').trim(),
      appleSeriesUrl: String(row.apple_series_url || '').trim(),
    };
  });
}
