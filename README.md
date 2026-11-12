# show-finder

Kid-situation episode finder for the Apple TV+ Kids and Family catalog.
A parent types what their kid is going through ("scared of the dark",
"nervous about a presentation") and gets story-level matches from the
catalog we collected, with a resolution note and an age band on every card.

Free, non-commercial, waitlist only. Web-first at finder.parentpeptalks.com
when launched.

## Quickstart

```
npm install
npm run build   # emits data/search/search-artifact.json + search.db
npm start       # http://localhost:3000
```

The committed `data/source/` dumps feed the build, so no workbook access is
needed to build or serve. To refresh from the project workbooks (needs the
authenticated obvious CLI): `npm run fetch && npm run build`.

## Architecture (static-first)

```
workbooks (obvious CLI)          build time only
        │
        ▼
data/source/*.json   ── npm run build ──▶  data/search/search-artifact.json
     raw sheet dumps        │              (stories, embeddings, version hash)
                            └────────────▶  data/search/search.db (SQLite FTS5)
        offline: normalize, validate, embed, hash stamp

parent query ──▶ interpret (age, vibe, emotions) ──▶ FTS5 bm25 + cosine vectors
                 at the edge                        fused score, filters, boost
        │
        ▼
text-only result cards (series, episode, segment, situation, resolution,
age band, vibe, synopsis) + waitlist placeholder
```

- **Version hash.** Every artifact carries a sha256 stamp of its story
  content and vectors, mojirama's whole-index pattern. CI rebuilds and fails
  if the committed artifact and the rebuild disagree.
- **Query interpretation.** `src/search/interpret.mjs` turns the parent's
  sentence into typed answers (age band, vibe, canonical emotions) that act
  as filters and boosts. The indexes themselves run model free.
- **Fused ranking.** `src/search/store.mjs` combines SQLite FTS5 bm25 with
  in-memory cosine similarity (0.55/0.45) plus a small emotion boost.
- **Embeddings.** Phase 1 ships a deterministic local hash embedder so the
  vector path runs end to end with no model download. The EmbeddingGemma
  class model slots in at `registerEmbedder` in `src/search/embedder.mjs`
  without touching anything else.

## Catalog data (Phase 1 sources)

552 tagged story rows across 18 series, pulled from these sheets:

| Workbook | Sheets used | Rows |
|---|---|---|
| Apple TV+ Kids & Family Base Subscription Database (wb_itf7wG3d) | Titles, Episodes | 86, 1340 |
| Stillwater, Secret Sauce Dev Set (wb_McM7y4Xx) | Stillwater tags | 77 |
| Camp Snoopy, Script Dev Set (wb_Awh3JEB3) | Script dev (26 rows) | 52 |
| Batch 1 Series, Script Dev Set (wb_CugBbpqS) | Doug Unplugs, Duck & Goose, Eva the Owlet, Frog and Toad | 93 |
| Wave 3 Batch 1, Script Dev Set (wb_DIQCgz1L) | Otis, Interrupting Chicken, Pretzel, Sago Mini Friends, Shape Island, Wolfboy | 223 |
| Wave 3 Batch 2, Script Dev Set (wb_mHUXZU8R) | Ghostwriter, Harriet the Spy, Helpsters, Surfside Girls, Sisters Grimm, WondLa | 107 |

Excluded on purpose (see `scripts/fetch-source.mjs` for the reasons): the
untagged Batch 1 baseline, the Golden Set tagging template, comparison
sheets, the superseded Stillwater pilot, and the topical dictionary.

## Testing

```
npm test             # normalization, query interpretation, fused search, house style
node scripts/smoke.mjs   # real server, real artifact, flagship query
```

## Phase status

Phase 1 skeleton: search works end to end, text-only cards, no artwork, no
deep links, waitlist placeholder. Phases 2 to 4 (artwork and links,
conversion, QA and launch) follow the approved build plan.
