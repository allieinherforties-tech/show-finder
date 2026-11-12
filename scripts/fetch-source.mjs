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
      const record = {
        workbookId: source.workbookId,
        workbookName: source.workbookName,
        sheetId: sheet.sheetId,
        sheetName: sheet.name,
        kind: sheet.kind,
        defaultSeriesTitle: sheet.defaultSeriesTitle || null,
        rowCount: rows.length,
        rows,
      };
      const file = path.join(OUT_DIR, `${source.workbookId}_${sheet.sheetId}.json`);
      writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
      manifest.push({ file: path.basename(file), ...record, rows: undefined });
      process.stdout.write(`${rows.length} rows\n`);
    }
  }
  writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`done: ${manifest.length} sheets written to ${OUT_DIR}`);
}

main();
