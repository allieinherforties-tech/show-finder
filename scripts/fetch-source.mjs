// Offline catalog export: pulls the base catalog and every tagged story-row
// sheet out of the project workbooks via the obvious CLI and dumps them to
// data/source/. This script is run by hand or from a machine where the obvious
// CLI is authenticated. It is never part of the serving path, and CI consumes
// the committed dumps rather than calling the CLI.
//
// Usage: node scripts/fetch-source.mjs
//   OBVIOUS_BIN can override the CLI path; default is 'obvious'.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BIN = process.env.OBVIOUS_BIN || 'obvious';
const OUT_DIR = path.resolve('data/source');
const ROW_LIMIT = 10000;

// One-entry title alias map. The Wave 2 popup workbook titles the series
// 'Snoopy in Space'; the catalog and the craft wave (the sources of truth)
// carry the full title 'Snoopy in Space: The Search for Life' (TMDB 91249).
// The alias is applied when the popup dump is written, so the strip, the
// facets, and the popup all render the catalog title and the join stays
// exact. Anything else the workbook renames later joins here.
const POPUP_TITLE_ALIASES = {
  'Snoopy in Space': 'Snoopy in Space: The Search for Life',
};

// Every sheet the build consumes, with the reason each one is in or out.
// Sheet ids are stable, so query by id and keep the human name for provenance.
const SOURCES = [
  {
    workbookId: 'wb_itf7wG3d',
    workbookName: 'Apple TV+ Kids & Family — Base Subscription Database',
    sheets: [
      { sheetId: 'sh_hcJ3tSMs', name: 'Titles', kind: 'catalog' },
      { sheetId: 'sh_Upf0OvWu', name: 'Episodes', kind: 'catalog' },
    ],
  },
  {
    workbookId: 'wb_McM7y4Xx',
    workbookName: 'Stillwater — Secret Sauce Dev Set',
    sheets: [
      // The 77-row tags sheet supersedes the 57-row pilot (sh_3tBvzzhq).
      // It carries no series_title column; the builder defaults the series.
      { sheetId: 'sh_7kZ9CyAy', name: 'Stillwater tags', kind: 'stories', defaultSeriesTitle: 'Stillwater' },
    ],
  },
  {
    workbookId: 'wb_Awh3JEB3',
    workbookName: 'Camp Snoopy — Script Dev Set',
    sheets: [{ sheetId: 'sh_eVghoo4I', name: 'Script dev (26 rows)', kind: 'stories' }],
  },
  {
    workbookId: 'wb_CugBbpqS',
    workbookName: 'Batch 1 Series — Script Dev Set',
    sheets: [
      { sheetId: 'sh_lLgbLAg7', name: 'Doug Unplugs dev (26 rows)', kind: 'stories' },
      { sheetId: 'sh_CBCdfmEn', name: 'Duck & Goose dev (33 rows)', kind: 'stories' },
      { sheetId: 'sh_gxR7lN5I', name: 'Eva the Owlet dev (17 rows)', kind: 'stories' },
      { sheetId: 'sh_GAEmy8Pc', name: 'Frog and Toad dev (17 rows)', kind: 'stories' },
    ],
  },
  {
    workbookId: 'wb_DIQCgz1L',
    workbookName: 'Wave 3 Batch 1 — Script Dev Set',
    sheets: [
      { sheetId: 'sh_nCZJRcKy', name: 'Get Rolling with Otis', kind: 'stories' },
      { sheetId: 'sh_iG5nYyDs', name: 'Interrupting Chicken', kind: 'stories' },
      { sheetId: 'sh_5K4PGdHZ', name: 'Pretzel and the Puppies', kind: 'stories' },
      { sheetId: 'sh_xmNcJvVO', name: 'Sago Mini Friends', kind: 'stories' },
      { sheetId: 'sh_jnS85XbX', name: 'Shape Island', kind: 'stories' },
      { sheetId: 'sh_efSC3bDU', name: 'Wolfboy and the Everything Factory', kind: 'stories' },
    ],
  },
  {
    workbookId: 'wb_mHUXZU8R',
    workbookName: 'Wave 3 Batch 2 — Script Dev Set',
    sheets: [
      { sheetId: 'sh_moeIPpZ7', name: 'Ghostwriter', kind: 'stories' },
      { sheetId: 'sh_BbcKHo70', name: 'Harriet the Spy', kind: 'stories' },
      { sheetId: 'sh_RzycuYo3', name: 'Helpsters Help You', kind: 'stories' },
      { sheetId: 'sh_vQfcblaK', name: 'Surfside Girls', kind: 'stories' },
      { sheetId: 'sh_aKjlSYtN', name: 'The Sisters Grimm', kind: 'stories' },
      { sheetId: 'sh_11V3YDwL', name: 'WondLa', kind: 'stories' },
    ],
  },
  {
    workbookId: 'wb_66lUb18u',
    workbookName: 'Standalone Films Corpus — 34 Films (Verified Links)',
    sheets: [
      // One row per film, keyed by TMDB id. Every link was verified live
      // 2026-11-16 (link_status=verified); the build refuses any other value.
      { sheetId: 'sh_RJTvV8CA', name: 'Standalone Films Corpus (34 Films)', kind: 'films' },
    ],
  },
  {
    // Wave 2 craft copy: the crafted story lead, resolution, and evidence
    // note for every row (8 columns; Batch 14 adds tag columns the build
    // does not read here because its tags join from the accepted tag sheets
    // below, so all 14 batch sheets take the identical code path). The
    // craft wave is the parent-facing source of truth; the tag sheets are
    // the discovery-tag source of truth. The build joins them.
    workbookId: 'wb_cSVkwzvY',
    workbookName: 'Episode Dialog Copy — Craft Wave 2 (35 series)',
    sheets: [
      { sheetId: 'sh_SvJPlhKY', name: 'Craft batch 1 (El Deafo, Amber Brown, Best Foot Forward, Circuit Breakers, Life by Ella)', kind: 'craft-stories' },
      { sheetId: 'sh_84uUUCIV', name: 'Craft batch 2 (BE@RBRICK, Goldie, Greatness Code, My Brother the Minotaur)', kind: 'craft-stories' },
      { sheetId: 'sh_c3wo6pZq', name: 'Craft batch 3 (Prehistoric Planet)', kind: 'craft-stories' },
      { sheetId: 'sh_uncwQRgZ', name: 'Craft batch 4 (Jane, Puppy Place)', kind: 'craft-stories' },
      { sheetId: 'sh_I6mvCslT', name: 'Craft batch 5 (Snoopy in Space: The Search for Life, The Snoopy Show)', kind: 'craft-stories' },
      { sheetId: 'sh_PzC2h4A9', name: 'Craft batch 6 (Fraggle Rock)', kind: 'craft-stories' },
      { sheetId: 'sh_BEpDNZZP', name: 'Craft batch 7 (Back to the Rock, Curses!)', kind: 'craft-stories' },
      { sheetId: 'sh_m1rqLLEz', name: 'Craft batch 8 (Earthsounds, Tiny World, Secret Lives of Animals, This Is America Charlie Brown)', kind: 'craft-stories' },
      { sheetId: 'sh_ebQfxNPQ', name: 'Craft batch 9 (The Charlie Brown and Snoopy Show, Pinecone & Pony)', kind: 'craft-stories' },
      { sheetId: 'sh_nzbCt77T', name: 'Craft batch 10 (Lovely Little Farm, Not a Box, Slumberkins)', kind: 'craft-stories' },
      { sheetId: 'sh_fDHqp580', name: 'Craft batch 11 (Me, Hello Jack!, Yo Gabba GabbaLand!)', kind: 'craft-stories' },
      { sheetId: 'sh_qZJJt8v9', name: 'Craft batch 12 (Yo Gabba Gabba!)', kind: 'craft-stories' },
      { sheetId: 'sh_8wRJ0Z5T', name: 'Craft batch 13 (Wonder Pets: In the City, The Peanuts Classics)', kind: 'craft-stories' },
      { sheetId: 'sh_hosLv7qA', name: 'Craft batch 14 (Helpsters, Time Bandits, Fraggle Rock: Rock On!)', kind: 'craft-stories' },
    ],
  },
  {
    // The discovery-tag corpus the craft rows join to. Preference order per
    // series: the complete-dataset per-batch tagging workbooks (the accepted
    // tagged corpus, correctly keyed, emoji complete), then the accepted
    // Batch 14 dev sets, then the Wave 3 sheets that cover the two series
    // with no batch workbook home. The Wave 4 synopsis-fallback sets and the
    // remaining Wave 3 sheets are deliberately NOT included: their tag rows
    // carry curation-routed nulls (emotion left empty pending a
    // script-informed pass) and, in one sheet, a batch-wide episode-number
    // keying slip, where the per-batch workbooks carry the accepted tags.
    workbookId: 'wb_GaYofqCN',
    workbookName: 'Batch 1 Part A - Script-Tier Tag Set (Circuit Breakers, Amber Brown)',
    sheets: [
      // Covers Amber Brown, Best Foot Forward, Circuit Breakers, Life by
      // Ella, and BE@RBRICK.
      { sheetId: 'sh_h1M5ULgM', name: 'Script-verified rows', kind: 'tag-rows' },
    ],
  },
  {
    workbookId: 'wb_Na3ZzMTM',
    workbookName: 'Batch 2 - Script-Tier Tag Set (Goldie, Greatness Code, My Brother the Minotaur)',
    sheets: [
      { sheetId: 'sh_bfyefz2P', name: 'Script-verified rows', kind: 'tag-rows' },
    ],
  },
  {
    workbookId: 'wb_qy44e2F5',
    workbookName: 'Batch 3 — Prehistoric Planet + El Deafo (Complete-Dataset Tagging)',
    sheets: [
      // El Deafo only: the Prehistoric Planet rows here are the later
      // retagging whose thin-synopsis Uncovered specials dropped emoji and
      // emotion; Wave 3 Batch 7 carries the emoji-complete S0 tags, so the
      // build prefers it for that series.
      { sheetId: 'sh_HOwiPoc6', name: 'Batch 3', kind: 'tag-rows', seriesFilter: 'El Deafo' },
    ],
  },
  {
    workbookId: 'wb_VMKUPviU',
    workbookName: 'Batch 4 — Jane + Puppy Place (Complete-Dataset Tagging)',
    sheets: [
      { sheetId: 'sh_mYPXS1s7', name: 'Batch 4 (36 rows)', kind: 'tag-rows' },
    ],
  },
  {
    workbookId: 'wb_XP9wdcKe',
    workbookName: 'Batch 5 - Script-Tier Tag Set (Snoopy in Space, The Snoopy Show)',
    sheets: [
      { sheetId: 'sh_SwnxYFem', name: 'Script-verified rows', kind: 'tag-rows' },
    ],
  },
  {
    workbookId: 'wb_VrRuIaCk',
    workbookName: 'Batch 6 — Fraggle Rock first 48 (Complete-Dataset Tagging)',
    sheets: [
      { sheetId: 'sh_qsTQ2Ztm', name: 'Tagged rows', kind: 'tag-rows' },
    ],
  },
  {
    workbookId: 'wb_0nefOd67',
    workbookName: 'Batch 7 — Fraggle Rock second 48 (Complete-Dataset Tagging)',
    sheets: [
      { sheetId: 'sh_dRliJGcz', name: 'Tagged rows', kind: 'tag-rows' },
    ],
  },
  {
    workbookId: 'wb_Zd4i1ply',
    workbookName: 'Batch 8 — Back to the Rock + Curses! (Complete-Dataset Tagging)',
    sheets: [
      { sheetId: 'sh_uipIPmgQ', name: 'Tagged rows', kind: 'tag-rows' },
    ],
  },
  {
    workbookId: 'wb_PwfXlaK9',
    workbookName: 'Batch 9 — Earthsounds, Tiny World, Secret Lives of Animals, This Is America Charlie Brown (Complete-Dataset Tagging)',
    sheets: [
      { sheetId: 'sh_fWDW4W3f', name: 'Tagged rows', kind: 'tag-rows' },
    ],
  },
  {
    workbookId: 'wb_9ljffEu8',
    workbookName: 'Batch 10 — The Charlie Brown and Snoopy Show + Pinecone & Pony (49 rows)',
    sheets: [
      { sheetId: 'sh_FQxiPuTe', name: 'Batch 10', kind: 'tag-rows' },
    ],
  },
  {
    workbookId: 'wb_djBIYZ9Q',
    workbookName: 'Batch 11 — Lovely Little Farm, Not a Box, Slumberkins (46 rows)',
    sheets: [
      { sheetId: 'sh_9FU1FI9T', name: 'Batch 11', kind: 'tag-rows' },
    ],
  },
  {
    workbookId: 'wb_dZPgCfDp',
    workbookName: 'Tagging Batch 12: Me, Hello Jack! The Kindness Show, Yo Gabba GabbaLand! (47 rows)',
    sheets: [
      { sheetId: 'sh_Eoy96v6r', name: 'Batch 12', kind: 'tag-rows' },
    ],
  },
  {
    workbookId: 'wb_T4PLcbsp',
    workbookName: 'Tagging Batch 13: Yo Gabba Gabba! S0 specials, S1, S2, S3 E1-4 (50 rows)',
    sheets: [
      { sheetId: 'sh_35L1cKVn', name: 'Batch 13', kind: 'tag-rows' },
    ],
  },
  {
    workbookId: 'wb_Hw2S0WBV',
    workbookName: 'Tagging Batch 14: Yo Gabba Gabba! S3 E5-15 + S4, The Peanuts Classics (54 rows)',
    sheets: [
      // The sheet mixes two series and carries the 23 phantom Peanuts rows
      // retired in place by Allie's 2026-11-14 rekey-and-retire ruling; the
      // filters keep the live Yo Gabba Gabba! rows and the six rekeyed
      // Peanuts Classics episodes, and drop every RETIRED row verbatim.
      { sheetId: 'sh_d0wJbnXv', name: 'Batch 14', kind: 'tag-rows', retiredNotePrefix: 'RETIRED' },
    ],
  },
  {
    workbookId: 'wb_Yl3F8sSd',
    workbookName: 'Tagging Batch 15: Wonder Pets In the City (51 rows)',
    sheets: [
      { sheetId: 'sh_w33uvjLC', name: 'Batch 15', kind: 'tag-rows' },
    ],
  },
  {
    workbookId: 'wb_eS9g7Y0Z',
    workbookName: 'Helpsters Dev Set — Accepted (script tier, 80 rows)',
    sheets: [
      { sheetId: 'sh_hsjaQDYo', name: 'Helpsters rows', kind: 'tag-rows' },
    ],
  },
  {
    workbookId: 'wb_lOipuHzp',
    workbookName: 'Time Bandits Dev Set — Accepted (script tier, 10 rows)',
    sheets: [
      { sheetId: 'sh_OnCNePjf', name: 'Time Bandits rows', kind: 'tag-rows' },
    ],
  },
  {
    workbookId: 'wb_C6j2Tgp9',
    workbookName: 'Fraggle Rock: Rock On! Dev Set — Accepted (script tier, 6 rows)',
    sheets: [
      { sheetId: 'sh_WfNOsZgZ', name: 'Rock On! rows', kind: 'tag-rows' },
    ],
  },
  {
    workbookId: 'wb_GmjrelIH',
    workbookName: 'Wave 3 Batch 7 — Script Dev Set',
    sheets: [
      // Prehistoric Planet only: the emoji-complete source for its S0
      // Uncovered specials. The Wonder Pets rows here are superseded by the
      // complete-dataset Tagging Batch 15, and the film sheets
      // (A Charlie Brown Thanksgiving, It's the Great Pumpkin, Wolfwalkers,
      // Wolfwalkers test) belong to the films corpus, not the series join.
      { sheetId: 'sh_xrWU5TFk', name: 'Prehistoric Planet', kind: 'tag-rows', seriesFilter: 'Prehistoric Planet' },
    ],
  },
  {
    // Wave 2 popups: the approved verbatim overview, suggested age band,
    // and verified Apple series link for the 35 additions. The legacy popup
    // workbook (wb_a6zJ9L6l) is broken upstream (its query index and mirror
    // return no rows); its 18-row dump stays committed as
    // wb_a6zJ9L6l_sh_udod4EbT.json and remains the source for the original
    // series, so the 18 existing popups keep their existing source and this
    // workbook only ever adds the 35 new ones. The build fails fast when a
    // strip series has no row, a duplicate, or an unverified link.
    workbookId: 'wb_trZRboHn',
    workbookName: 'Series Descriptions — Poster Popup (Wave 2 additions)',
    sheets: [
      { sheetId: 'sh_0V4G5H5q', name: 'Wave 2 popups (35 rows)', kind: 'series-descriptions', titleAliases: POPUP_TITLE_ALIASES },
    ],
  },
];

// Deliberately excluded, kept visible so the omission reads as a decision:
//   wb_WSepOHVK sh_WCOrNNLF  Batch 1 (10 rows): untagged baseline, no situation/emotion
//   wb_WSepOHVK sh_fD1qoMli  Golden Set Sheet 1: tagging template, literal "None" values
//   wb_WSepOHVK sh_CgBbBVL6  Tagging guide: guidance, not story rows
//   wb_McM7y4Xx sh_3tBvzzhq  Script pilot v2: superseded by the 77-row tags sheet
//   wb_Awh3JEB3 sh_jhK9Oz4m  and wb_CugBbpqS sh_mden86TN: before/after comparison sheets
//   wb_Qauc3CG7              empty duplicate of the Golden Set workbook
//   wb_t8iqBL9I              Storyline Dictionary: secondary topical layer, post-launch
//   wb_W5kkhRaI              Script Source Register: sourcing notes
//   wb_1AFQeOOG              Coverage Tracker: pipeline status, not story data
//   wb_a6zJ9L6l              Series Descriptions (legacy popup): broken upstream, dump stays committed
//   wb_ye1PvIdu/wb_vuyunUqY/wb_LIblwdwP/wb_0D6LEPul  Wave 3 Batches 3-6 sheets: superseded per series by the complete-dataset batch workbooks (tag gaps and one keying slip live there)
//   wb_UU8t0XlG/wb_z0dLhaMX/wb_pDotNfRN/wb_A4uR1YlI/wb_sxKHzlNy/wb_c7JqaG2Z/wb_wgU5zdIR  Wave 4 synopsis-fallback sets: curation-routed null tag cells where the per-batch workbooks carry the accepted tags

function runJson(args) {
  const stdout = execFileSync(BIN, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(stdout);
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const manifest = [];
  for (const source of SOURCES) {
    for (const sheet of source.sheets) {
      process.stdout.write(`fetching ${source.workbookName} / ${sheet.name} ... `);
      const result = runJson([
        'workbooks', 'query',
        `--workbookId=${source.workbookId}`,
        `--rowLimit=${ROW_LIMIT}`,
        `--sql=SELECT * FROM "${sheet.sheetId}"`,
      ]);
      const payload = result.data || result;
      const rows = payload.rows || [];
      if (!rows.length) throw new Error(`sheet ${sheet.sheetId} returned no rows`);
      // Popup title aliases: applied at dump time so every downstream
      // surface (strip, facets, popup) renders the catalog title. The dump
      // carries the aliased title plus the verbatim source title for audit.
      const aliases = sheet.titleAliases || null;
      const dumpedRows = aliases
        ? rows.map((row) => {
            const original = String(row.series_title || '');
            const mapped = aliases[original.trim()];
            return mapped ? { ...row, series_title: mapped, series_title_source: original } : row;
          })
        : rows;
      const record = {
        workbookId: source.workbookId,
        workbookName: source.workbookName,
        sheetId: sheet.sheetId,
        sheetName: sheet.name,
        kind: sheet.kind,
        defaultSeriesTitle: sheet.defaultSeriesTitle || null,
        seriesFilter: sheet.seriesFilter || null,
        retiredNotePrefix: sheet.retiredNotePrefix || null,
        rowCount: dumpedRows.length,
        rows: dumpedRows,
      };
      const file = path.join(OUT_DIR, `${source.workbookId}_${sheet.sheetId}.json`);
      writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
      manifest.push({ file: path.basename(file), ...record, rows: undefined });
      process.stdout.write(`${dumpedRows.length} rows\n`);
    }
  }
  writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`done: ${manifest.length} sheets written to ${OUT_DIR}`);
}

main();
