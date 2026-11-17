// Pure join between the browse-by-show strip's poster entries and the approved
// series description workbook. Like the artwork joins, nothing here touches
// the network or the filesystem, so the join is unit testable and the build
// stays deterministic.
//
// The popup's honesty rules live at this join: the overview copy ships verbatim
// from the workbook (never rewritten in the pipeline or the UI), the age band
// is phrased as a suggestion with no basis line (evidence provenance stays
// internal, per Allie's standing ruling), and the Apple link must carry
// the workbook's verified status — the same standard the deep-link registry
// holds story rows to. The retired single `description` column stays in the
// workbook untouched; the popup no longer reads it. The five-block fields
// (what_happens, feelings, situation, resolution) also stay in the workbook
// as internal data after the v3.0 ruling (per-story tools, never series-card
// copy); the popup no longer reads or gates on them. The `age_band_basis`
// column also stays in the workbook untouched as internal data. The
// internal-identifier gate below keeps every workbook-authored field that
// renders parent-facing — the v3.0 series_overview included — from carrying
// dev-set names or workbook ids.

import { classifyAppleUrl } from '../links/apple-tv.mjs';

/** '5-7' becomes 'Suggested for ages 5\u20137' (en dash, per the approved popup copy). */
export function suggestedAgeLine(ageBand) {
  return `Suggested for ages ${String(ageBand).replace('-', '\u2013')}`;
}

/**
 * Joins the strip's poster entries ({ title, posterUrl }) with the approved
 * description rows. Fail-fast, like the poster gate: a series with no row, a
 * duplicate row, a stale row for a series the strip does not publish, a
 * missing overview or age band, or a link the workbook does not mark verified
 * stops the build with instructions instead of shipping a half-joined popup.
 * Returns the entries in their input order (title order from the poster
 * gate), each extended with the popup's lean v3.0 fields (overview, ageBand)
 * and appleSeriesUrl.
 */

/**
 * The workbook-authored fields the popup renders parent-facing. The
 * internal-identifier gate scans exactly this list: a field that stops
 * rendering leaves it, a field that starts rendering joins it.
 */
const PARENT_FACING_COLUMNS = ['series_title', 'series_overview', 'age_band'];

/** Internal provenance markers that never render to a parent. */
const INTERNAL_IDENTIFIERS = ['wb_', 'dev set', 'batch', 'tagged rows', 'wave'];

/**
 * The internal identifiers sitting inside a parent-facing text, lowercased.
 * An empty list means the text is clean.
 */
export function internalIdentifierHits(text) {
  const haystack = String(text || '').toLowerCase();
  return INTERNAL_IDENTIFIERS.filter((marker) => haystack.includes(marker));
}

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
    if (!String(row.series_overview || '').trim()) problems.push(`${entry.title}: series_overview is empty`);
    const ageBand = String(row.age_band || '').trim();
    if (!ageBand) problems.push(`${entry.title}: age_band is empty`);
    // Parent-facing gate: every workbook-authored field the popup renders
    // must carry zero internal provenance. Dev-set names and workbook ids
    // are the leak class that shipped in the Ages block; they stop the
    // build here instead of reaching a parent's screen. The v3.0 ruling
    // moved the five-block fields to internal data, so the gate scans only
    // what still renders: title, series_overview, age_band.
    for (const column of PARENT_FACING_COLUMNS) {
      for (const marker of internalIdentifierHits(row[column])) {
        problems.push(`${entry.title}: ${column} contains the internal identifier "${marker}" (dev-set names and workbook ids never render to parents)`);
      }
    }
    const url = String(row.apple_series_url || '').trim();
    if (!url) {
      problems.push(`${entry.title}: apple_series_url is empty`);
    } else if (!classifyAppleUrl(url)) {
      problems.push(`${entry.title}: apple_series_url is not a canonical tv.apple.com link: ${url}`);
    }
    // Both link-status spellings are verified-live: the legacy popup
    // workbook writes 'verified'; the wave 2 popup workbook records the
    // HTTP status it measured ('200'). Anything else refuses to ship.
    const linkStatus = String(row.link_status || '').trim().toLowerCase();
    if (linkStatus !== 'verified' && linkStatus !== '200') {
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
      overview: String(row.series_overview || '').trim(),
      ageBand: String(row.age_band || '').trim(),
      appleSeriesUrl: String(row.apple_series_url || '').trim(),
    };
  });
}
