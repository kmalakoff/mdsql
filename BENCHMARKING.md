# Benchmarks

Per-release measurements on a public corpus. One column per release; add a column when a release changes performance or capability, and update the results tables below.

## Running

```bash
node benchmark/compare.mjs                             # released baseline (package.json) vs working tree
node benchmark/compare.mjs obsidian-hub 0.2.1 local    # explicit corpus and versions
node benchmark/eval.mjs nfcorpus                       # retrieval quality on a labeled corpus
```

The default run answers "did the working tree regress?" `local` is whatever is checked out. The working-tree column is labeled `local` until the release exists: regenerate the table at release time and the column gets its real number. Named corpora, dataset builds, and npm-installed comparison versions all cache through `benchmark/lib/cache.mjs` into `.tmp/cache/` (gitignored): fetched once, built atomically in a staging dir, safe to delete anytime. Corpus specs are pinned in `benchmark/lib/corpus.mjs`, the single source of truth. A directory path works in place of a corpus name.

`compare.mjs` installs each npm version into a temp dir (`local` = this working tree), gives every version an isolated copy of the tree with a v1 config (the lowest common denominator every version can read; copies keep cache formats and config auto-migration from cross-contaminating), runs `benchmark/run.mjs` per version, and prints the table. `run.mjs` can also run alone against any single package root + tree; it prints one JSON row.

Two kinds of metric per version:

- **Wall-time:** spawns the CLI per operation, so every number includes ~40 ms of Node startup. This is what a calling agent pays per invocation. On embed-enabled trees `run.mjs` also times `find --semantic` (`semantic_find_ms`); its delta over `find_ms` is the per-invocation semantic cost: model load, query embed, vector scan (null on trees without embed).
- **In-process:** imports the version's `dist/esm/index.js` as a library and times the engine alone: cold index build, the no-change freshness check, and incremental updates (1 file touched, 10 files modified). Pure Node, no platform dependence.

## Maintaining

- Regenerate **all** columns of a table in one sitting on one machine. Numbers are not comparable across machines or Node versions. Record machine + Node in the table caption.
- Regenerate **before** the version bump, not after publishing: a benchmark run is only a release gate if a bad number can still stop the release. See [RELEASING.md](RELEASING.md).
- The performance tables regenerate every release; the retrieval-quality tables regenerate when retrieval itself changes: fusion, ranking, the default model, tokenizer, chunking. A quality column older than the current version is expected, and says the ranking has not moved since; a retrieval change shipped without a fresh column is the gap to catch.
- To add a metric: one measured field in `run.mjs`, one row in the `ROWS` table in `compare.mjs`. Versions lacking a command report `—` automatically; a version that errors reports the error.
- Corpus pins live in `benchmark/lib/corpus.mjs`. If a pin must move (repo disappears, need a bigger corpus), regenerate every column at the new pin.

## Interpreting

- Timings are medians (wall: 5 runs, cold crawl 1; in-process: 5 no-change, 3 updates).
- Wall minus in-process ≈ per-invocation overhead: process spawn, Node/V8 startup, importing sense and its dependencies, argv parsing. The two move independently. If the in-process number grows, the engine (scan/reconcile/SQL) got slower; if the gap grows while in-process stays flat, startup got heavier, typically a new dependency imported at module top level, which every invocation pays for before any work happens. Commands lazy-load from `src/cli/` (cli.ts imports no tree code), so a heavy import belongs inside the one command that uses it; `--version` is the canary: it should stay at bare Node startup (~25 ms here).
- The update rows include everything reconcile does after re-parsing: link re-resolution across the whole table and a full PageRank pass. They are the numbers to watch as features add reconcile work.
- The bulk-change pair measures `watch`: without a watcher, the first query after many files change pays the whole reparse; with one running, the reparse happened in the background and the query pays only the freshness check.
- Token columns (`map`, `peek`, `find` row) are output-size contracts, not performance: they must stay roughly flat as trees grow. A token number that scales with tree size is a context-bloat regression even if timings look fine. The `find` row is measured in json, per row actually returned, and tracks summary and snippet length rather than tree size.
- Watch for: cold build growing worse than linearly with note count; the no-change check drifting above ~50 ms at 10k notes; the update rows drifting away from the freshness check they now track (update minus no-change is the real update work; it should stay in the tens of ms); any stress-table row moving (each guards a fixed shape cliff).

## Results: obsidian-hub @ b11036f9 (6,566 notes, 14 MB)

Apple Silicon, Node 26.7.0. 2026-08-22. `local` is the working tree about to be released; the baseline column is whatever `package.json` names, so a bare `compare.mjs` always reads "last release vs what ships next".

| metric | 0.11.5 | local |
|---|---|---|
| cold crawl | 1193 ms | 1192 ms |
| warm query (`COUNT(*)`) | 97 ms | 96 ms |
| BM25 search (canonical join) | 111 ms | 103 ms |
| lexical `search` (BM25 + link fusion) | 158 ms | 153 ms |
| `search` row size (json) | ~70 tokens | ~71 tokens |
| `map` (orient) | 121 ms / ~458 tokens | 123 ms / ~458 tokens |
| `peek` largest note (~77274 t) | 103 ms / ~581 tokens (0.8%) | 103 ms / ~581 tokens (0.8%) |
| bulk change (500 files): first query | 253 ms | 255 ms |
| bulk change (500 files): with warm watcher | 128 ms | 125 ms |
| in-process: cold index build | 1025 ms | 1058 ms |
| in-process: freshness check, no change | 38.1 ms | 37.3 ms |
| in-process: update, 1 file touched | 39.3 ms | 38.6 ms |
| in-process: update, 10 files modified | 39.3 ms | 40.1 ms |

Every timing row is flat: nothing moves beyond ~7%, and the movements disagree in direction
between correlated metrics (wall vs in-process), which is this harness's noise signature. This
release adds three segmented sidecar columns to `content`; on an English corpus they hold
empty strings, which is why the parse-heavy rows do not move.

**A harness caveat found last release, still load-bearing.** The first version `compare.mjs`
benchmarks pays a large one-time machine warmup (the baseline's `npm install` is itself the
warmup); a reversed-column-order run is the confirmation that a delta is real. This release
added the wall-clock sibling of the same effect, documented under Scale below: cold-crawl
wall numbers move with file-cache state, and only the version A/B on the same tree in the
same sitting is comparable.

**`search` row: ~70 -> ~71 tokens.** `search` excerpts now come from an explicit `text`
column instead of snippet's best-column mode (which the machine-written sidecars would
otherwise win), so a title-matching row excerpts prose instead of the shorter title. One
token of drift on the row estimate, same fields, verified by diffing actual rows.

## Scale

The README claims linear scaling and links here rather than carrying figures of its own, so this is the measurement behind it. `obsidian-hub-x2` and `obsidian-hub-x4` (13k / 26k notes) are named corpora that replicate the pinned hub tree N times under one root: real notes, real frontmatter, real links, regenerated from nothing like every corpus. Duplicate basenames across copies stress link-ambiguity resolution harder than a natural tree. Run `node benchmark/run.mjs . <corpusPath>` per tree; regenerate scale rows together with the main table.

Measured 2026-08-22, same machine and sitting as the table above (the `local` column). The
lexical and semantic rows come from two presets over the same glob, differing only in
`semantic`, so both measure the same files with and without vector participation:

| metric | 6.5k (hub) | 13k (x2) | 26k (x4) |
|---|---|---|---|
| cold crawl (wall) | 1.19 s | 2.62 s | 5.07 s |
| warm query | 96 ms | 171 ms | 278 ms |
| lexical `search` | 153 ms | 284 ms | 475 ms |
| semantic `search` (steady state) | — | 436 ms | 906 ms |
| `map` | 123 ms / ~458 t | 223 ms / ~531 t | 417 ms / ~531 t |
| `peek` | 103 ms / ~581 t | 183 ms / ~692 t | 305 ms / ~843 t |
| `related` | — | 362 ms | 616 ms |
| bulk change (500 files): first query | 255 ms | 331 ms | 491 ms |
| in-process: freshness check, no change | 37 ms | 80 ms | 159 ms |
| in-process: update, 1 file touched | 39 ms | 77 ms | 164 ms |

Every row is linear or better in note count across a 4x range. The freshness check (the cost
every single invocation pays) is 159 ms at 26k notes, and updates track it. `map` token
counts stay flat with tree size. Semantic `search` is linear in chunks (2.09x from 13k to
26k), which corrects the previous sitting's oddly sublinear 26k number.

**Cold-crawl wall numbers move with file-cache state, found and pinned this sitting.** The
first 26k pass of the day read 7.3 s against 5.1 s in the previous sitting; the in-process
build was flat and per-note linear, the released 0.11.5 run on the same tree in the same
sitting read the same as local (A/B parity, plus direct spawn timing parity at 2.33 s vs
2.34 s on the 13k tree), and a warm re-run settled back to 5.07 s. The previous sitting
built the corpora immediately before measuring, which warms the cache invisibly. The cold
crawl row above is the warm-confirmed number; only same-sitting same-cache comparisons are
meaningful for this row, and the in-process build is the controlled version of it.

What the scale rows watch, in order of what actually breaks: the per-query freshness check (stats every file, linear, the cost every call pays), cold crawl (linear; a quadratic here was found and fixed at 13k/26k: FTS5 DELETE by column scans the whole table, and delete-before-insert ran per doc on cold builds where the table was empty), reconcile after updates (linear; dominated by whole-table link re-resolution plus a full PageRank pass), and the watcher race (a query during the watcher's bulk write transaction waits on `busy_timeout`, sized at 30s to cover ~3x the largest measured reconcile).

## Stress: the shape-cliff guard

`stress` is a pinned synthetic corpus (benchmark/lib/corpus.mjs) that packs every measured shape cliff into one 2,000-note tree: a 1 MB note, 200 headings per note, 100 links per note, 300 distinct frontmatter fields. Each cliff was found by the shape sweep (`benchmark/sweep.mjs`), fixed, and is held fixed by this row per release: `node benchmark/run.mjs . .tmp/cache/stress-stress-1`.

Measured 2026-08-22:

| metric | stress (2k notes, worst shapes) | guards |
|---|---|---|
| lexical `search` | 307 ms | bounded excerpt: snippet() never runs on docs past 16 KB; a JS best-window excerpt (with a `lines` section pointer) covers them |
| semantic `search` | 969 ms | brute-force scan over 402,000 chunks (201 per note); linear in chunks, not notes |
| cold crawl | 3.7 s (wall; see the file-cache note under Scale) | linear; heading-dense notes produce many chunks, all placeholder-only until the first semantic search |
| `peek` largest note (~255k t) | 65 ms / ~476 tokens | every peek list caps at 20 with true totals |
| `related` | 1.51 s | seed chunks sampled to 16: cost is `target_chunks x stored_chunks`, and 201 headings would otherwise multiply a full-corpus scan (12.7 s before the cap) |
| `map` (300 fields) | 92 ms / ~367 tokens | all per-column aggregates in one scan |
| in-process: update, 1 file touched | 14 ms | incremental link resolution; PageRank only when the edge set changed |
| bulk change (500 files): first query | 1.10 s | FTS delete by rowid; link rows diffed, not wiped |
| BM25 search (canonical join, raw SQL) | 9.1 s | **unguarded by design**: the canonical query calls snippet() directly, and raw SQL gets exactly what it asks for; `search` is the bounded path, and the skill documents the bound for hand-written SQL |

The sweep itself (`sweep.mjs`) re-runs when the engine changes, not per release; the probes it keeps (SQLite's 2,000-column limit fenced with a named error, adversarial markdown at ~8 s / 5 pathological notes with no timeout) are recorded in the findings file.

## Retrieval quality

`benchmark/eval.mjs <corpus>` runs every labeled query through the shipped library in four passes and reports nDCG@10, MRR@10 and hit@10 against the corpus qrels: **bm25-only** (links and rank off), **fused** (BM25 + link expansion), **fused-embed-configured** (the embed block present, the preset `semantic: false`; a hidden guard pass), and **semantic** (embed block present, preset semantic on). There is no per-call semantic switch: the preset decides, so the guard exercises the one lever a tree owner actually has. Queries are natural-language text submitted as an OR bag of words (the standard bag-of-words baseline; bare FTS5 terms AND-join and punctuation is syntax).

Two guards run before any number is reported:

- **Bit-identity.** The guard pass must return rows identical to fused, query for query; a divergence aborts the run with a nonzero exit. This is what makes "a semantic:false preset changes nothing on an embed-configured tree" a tested claim rather than a design intention.
- **Paired per-query deltas.** Point metrics hide whether a change moved many queries a little or a few queries a lot, and at these sample sizes a 0.01 difference can be noise. Every comparison also reports wins/losses and a sign-test z (|z| > 2 is beyond noise).

Labeled corpora convert their labels to one format (`labels/queries.jsonl` + `test.tsv`, read by `benchmark/lib/labels.mjs`):

- **nfcorpus:** BEIR NFCorpus, 3,633 medical abstracts, 323 queries, graded qrels (~38 judged/query). No links, so fused equals bm25-only; it measures lexical recall and the vocabulary gap semantic expansion targets.
- **fever:** FEVER dev split, 2,860 Wikipedia pages cited as evidence by 13,229 verifiable claims, with sentence link annotations kept as wikilinks. The claims are the queries; the corpus that can measure whether link fusion helps or hurts ranking.

Results, nfcorpus (Apple Silicon, Node 26.7.0, 2026-08-22, local):

| metric | bm25 | fused | semantic |
|---|---|---|---|
| nDCG@10 | 0.3234 | 0.3234 | 0.3431 |
| MRR@10 | 0.5183 | 0.5183 | 0.5553 |
| hit@10 | 0.6873 | 0.6873 | 0.7121 |
| mean ms/query | 5.4 | 5.4 | 14.5 |

Paired deltas: semantic vs fused is 108W/77L on nDCG (z=2.3) and 16W/8L on hit (z=1.6) —
the same shape as the 0.6.0 measurement (110W/77L, z=2.4), so the semantic gain carried
through every release between.

Results, fever (Apple Silicon, Node 26.7.0, 2026-08-13, 0.6.0):

| metric | bm25 | fused | semantic |
|---|---|---|---|
| nDCG@10 | 0.9436 | 0.9361 | 0.9435 |
| MRR@10 | 0.9508 | 0.9381 | 0.9479 |
| hit@10 | 0.9969 | 0.9971 | 0.9974 |
| mean ms/query | 7.7 | 15.3 | 18.9 |

Paired deltas: on fever, semantic vs fused is 1084W/687L on nDCG (z=9.4).

**Two eval-harness bugs were found and fixed this sitting, and they explain why the table
above went stale.** After the explicit-embed change (0.10.0), eval's embed variants no
longer named a model, so the semantic pass silently measured lexical; and eval still passed
a per-call `semantic` option the library had deliberately removed, so the guard pass was
measuring nothing. The two masked each other — with no embed block, the dead option never
mattered — and nothing surfaced because quality tables only regenerate when retrieval
changes. The rule that follows: eval columns regenerate whenever eval.mjs or the config
semantics it drives change, not only when ranking does.

Read:

- The published BEIR BM25 (Anserini) baseline for NFCorpus is nDCG@10 ≈ 0.32. The FTS5 pipeline matches it, so `find`'s lexical layer is a faithful BM25 rather than an approximation, and the identical fused column confirms link fusion is a no-op where there are no links.
- **The two corpora are the ends of one axis**, and no customer tree is either: NFCorpus is maximal vocabulary gap (layman queries, jargon documents; 31% of queries have no relevant document in the top 10), FEVER is zero gap (claims quote their evidence nearly verbatim, 99.7% hit@10 for plain BM25). A change that wins on one by losing on the other is fitted to a corpus nobody has.
- **Semantic expansion earns its cost where the gap is real** and does no harm where it isn't: +0.021 nDCG / +0.028 hit on NFCorpus, and on FEVER it recovers most of link fusion's ranking cost rather than adding noise (0.9361 → 0.9435 nDCG).
- **Link fusion's own contribution is smaller than the fused column suggests.** Its score comes largely from PageRank restart mass sitting on the seed set, which re-ranks matches in near-match order; on FEVER it costs ~1 point of MRR by occasionally promoting neighbors above the true evidence page. Removing that restart mass was measured and rejected: it drops FEVER hit@10 to 0.907. `via` labels are gated on a real incident edge, so the labels stay honest even where the score echo remains.

### Static-model bake-off (semantic-search-design.md, sequence step 2)

`benchmark/bakeoff.mjs <corpus>` embeds a labeled corpus with the candidate static model, scores cosine-only and bm25+vector RRF (find's pool size and RRF constant) against the qrels, and prints each storage lever next to the acceptance thresholds. Model files fetch once into `.tmp/cache/`, pinned by revision like corpora. Doc vectors are stored per lever (sliced, re-normalized, optionally int8); queries stay f32.

Results: nfcorpus, 323 queries, `minishlab/potion-retrieval-32M@6fc8051f` (macOS arm64, Node 26, 2026-08-13). Model load 39 ms, embed 0.30 ms/doc:

| variant | nDCG@10 | MRR@10 | hit@10 | Δ nDCG | Δ hit | ms/query | vectors MB |
|---|---|---|---|---|---|---|---|
| bm25 (baseline) | 0.3233 | 0.5185 | 0.6873 | — | — | 0.7 | — |
| cosine f32-512 | 0.3086 | 0.5069 | 0.6842 | — | — | 1.2 | 7.4 |
| cosine f32-256 | 0.3019 | 0.5000 | 0.6749 | — | — | 0.6 | 3.7 |
| cosine f32-128 | 0.2875 | 0.4769 | 0.6656 | — | — | 0.3 | 1.9 |
| cosine int8-512 | 0.3085 | 0.5069 | 0.6842 | — | — | 1.2 | 1.9 |
| cosine int8-256 | 0.3022 | 0.5003 | 0.6749 | — | — | 0.6 | 0.9 |
| bm25+vec f32-512 | 0.3451 | 0.5583 | 0.7090 | +0.0218 | +0.0217 | 1.9 | 7.4 |
| bm25+vec f32-256 | 0.3432 | 0.5565 | 0.7152 | +0.0198 | +0.0279 | 1.3 | 3.7 |
| bm25+vec f32-128 | 0.3405 | 0.5458 | 0.7183 | +0.0172 | +0.0310 | 1.0 | 1.9 |
| bm25+vec int8-512 | 0.3453 | 0.5586 | 0.7090 | +0.0219 | +0.0217 | 1.9 | 1.9 |
| bm25+vec int8-256 | 0.3438 | 0.5564 | 0.7152 | +0.0204 | +0.0279 | 1.3 | 0.9 |

Read:

- The acceptance thresholds below were the bar for silent default-on fusion, superseded 2026-08-13 by the explicit-expansion reframe: the bar is now recall-when-invoked, which these numbers clear at every lever.
- **Fusion helps at every lever**: both nDCG and hit improve across the board, but **no lever clears both acceptance thresholds** (ΔnDCG ≥ +0.02 and Δhit ≥ +0.03): 512-dim clears nDCG and misses hit by 0.008; 128-dim clears hit and misses nDCG; 256-dim near-misses both. Latency passes everywhere (≤1.9 ms vs the 10 ms ceiling).
- **int8 storage is free**: identical quality to f32 at every dims setting, at ¼ the bytes. Whatever ships, vectors store quantized.
- **Cosine-only never beats BM25** (0.309 vs 0.323 at best), consistent with published results on this BM25-favoring dataset, so the pure-JS loader is faithful; and it confirms the design's recall-layer stance: vectors must fuse, never replace.
- The fusion here is untuned equal-weight RRF at pool 30. NFCorpus ships train/dev qrels (`labels/dev.tsv`, readable via `readLabels(dir, 'dev')`), so fusion-tuning levers can be tuned on dev and reported on test without touching the gate.

## Capabilities

| | 0.2.1 | 0.3.0 | 0.6.0 | 0.7.2 | 0.8.0 | 0.9.5 | 0.10.0 | local |
|---|---|---|---|---|---|---|---|---|
| frontmatter filter + FTS5 search | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| links table, backlinks, dead links | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| sections table, outline with line ranges | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| PageRank (`_rank`), hub detection | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| fused retrieval (`find`, `via` column) | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| bounded orient/structure commands (`map`, `peek`) | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| lenient frontmatter (syntax errors → warnings, values kept) | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| config auto-migration | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| feature toggles | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `--version` | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| semantic expansion (`features.embed`, `find --semantic`, `via: vector`) | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| feature state reported by `map` and `status` | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| labeled-corpus retrieval eval (nDCG/MRR/hit, paired deltas) | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| saved-query assertions (`sense check`, `checks`) | — | — | — | ✓ | ✓ | ✓ | ✓ | — |
| tree-declared find scope (`defaults.find.where`) | — | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| `similarity` on semantic rows | — | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| scale corpora (13k / 26k) measured per release | — | — | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| saved finds (`queries` object form, `sense <name>` with baked-in settings) | — | — | — | — | ✓ | ✓ | ✓ | ✓ |
| bounded excerpts + `lines` on every `find` row | — | — | — | — | ✓ | ✓ | ✓ | ✓ |
| incremental link resolution; PageRank only on edge changes | — | — | — | — | ✓ | ✓ | ✓ | ✓ |
| derived `busy_timeout` (from observed reconcile, in `status`) | — | — | — | — | ✓ | ✓ | ✓ | ✓ |
| progress on stderr for long builds (TTY-aware, sparse when piped) | — | — | — | — | ✓ | ✓ | ✓ | ✓ |
| column-limit fence (named error at SQLite's 2,000) | — | — | — | — | ✓ | ✓ | ✓ | ✓ |
| stress corpus in the release gate | — | — | — | — | ✓ | ✓ | ✓ | ✓ |
| presets (config v3: one bundle for scope + settings; indexing derived) | — | — | — | — | — | ✓ | ✓ | ✓ |
| `search` verb (words + links + vectors fused by default) | — | — | — | — | — | ✓ | ✓ | ✓ |
| per-preset derived embedding (semantic-off presets cost no vectors) | — | — | — | — | — | ✓ | ✓ | ✓ |
| per-preset coverage in `status`/`map`; named rebuild notices | — | — | — | — | — | ✓ | ✓ | ✓ |
| `sql` verb (ad-hoc SQL; `query` renamed, one release of a pointer) | — | — | — | — | — | — | ✓ | ✓ |
| explicit `embed` block (config v4: model named in the file, no implicit default) | — | — | — | — | — | — | ✓ | ✓ |
| `sense download` (nothing fetches the model implicitly; a missing model is an error) | — | — | — | — | — | — | ✓ | ✓ |
| `queries` entries name their verb (`{ sql }` / `{ search }`, no bare-string shorthand) | — | — | — | — | — | — | ✓ | ✓ |
| link-graph route between two notes (`sense path`, bounded SQL traversal) | — | — | — | — | — | — | ✓ | ✓ |
| similar-but-unlinked (`sense related`, seed chunks sampled to bound the scan) | — | — | — | — | — | — | ✓ | ✓ |
| scope vocabulary on `map`/`peek`/`path`/`related` (`--exclude`, `--no-exclude`) | — | — | — | — | — | — | ✓ | ✓ |
| zero-dependency file walk (`node:fs` glob; POSIX paths on every platform) | — | — | — | — | — | — | ✓ | ✓ |
| quarantined frontmatter (a refused parse writes no columns; `_parse_error` says why) | — | — | — | — | — | — | — | ✓ |
| csv output; `sql` rows streamed, not materialized (`--format csv`, bigint-safe json) | — | — | — | — | — | — | — | ✓ |
| `content.tokenize` (per-tree FTS5 tokenizer; a tokenize-only change keeps vectors, links, sections) | — | — | — | — | — | — | — | ✓ |
| unspaced-script word search (grapheme sidecars, substring semantics, `segment()` SQL function) | — | — | — | — | — | — | — | ✓ |
| reserved-character scalars accepted by policy (`aliases: [@handle]`, tested per shape) | — | — | — | — | — | — | — | ✓ |
| unrendered-template detection (`created: {{date}}`, named with its path) | — | — | — | — | — | — | — | ✓ |
| embeddings cover the body, not the frontmatter block | — | — | — | — | — | — | — | ✓ |
| `similarity` clamped to a true cosine range | — | — | — | — | — | — | — | ✓ |
| `related` names every unanswerable case (no model, semantic-off scope, empty seed) | — | — | — | — | — | — | — | ✓ |
| `sql --preset` (binds a `scope` table to join; scopes FTS5 `MATCH` too) | — | — | — | — | — | — | — | ✓ |
| `status` names every location and derived value (config, cache, model dir, api key state) | — | — | — | — | — | — | — | ✓ |
