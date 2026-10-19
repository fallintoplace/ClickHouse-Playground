# ClickStudio benchmarks

This suite measures ClickStudio application code without running ClickHouse or making external API requests.
It complements functional tests. Results are informational, not merge gates.

## Run locally

From the `clickstudio/` directory:

```sh
npm ci
npm run bench:test
npm run bench
npm run bench -- --filter=stream --samples=9 --warmup=3 --max-iterations=100000
npm run bench -- --output=benchmarks/results/after.json
npm run bench:compare -- benchmarks/results/before.json benchmarks/results/after.json
```

`npm run bench` compiles the existing TypeScript core/workspace projects before benchmarking.
The generated JSON reports live in `benchmarks/results/` and are gitignored.
The comparison tool checks the scenario ID, workload units, Node/CPU/OS environment, and
calibration status. It rejects mismatched or under-calibrated runs rather than presenting
misleading speedups.
A negative change percentage means the candidate is faster.

## Included workloads

- Streaming: 1,000 and 5,000 JSONCompact rows, 4 KiB chunks, a fragmented 17-byte stream,
  and a 1 MiB Unicode row split into 4 KiB and 256-byte chunks.
- Charts: category aggregation (including 5,000 and 20,000 unique categories), grouped time
  buckets, heatmaps, line/bar view-model preparation, long-label category-axis calculations,
  and row-count number formatting.
- Results: filtering 200- and 1,000-row pages with prebuilt searchable text, plus wide CSV
  exports of 5,000 and 20,000 rows.
- SQL: scanning a valid script near the application's 200 KB SQL limit.
- Object Explorer: building indexes and repeated searches over 350 and 2,000 objects.

Fixtures are generated deterministically before timing. Each batch is validated against expected output.
Streaming includes the cost of collecting the stream, but not generating the input bytes.
Chart view-model and category-axis benchmarks measure data preparation, **not** React or SVG
painting. Rendering high-cardinality charts in a browser still needs separate measurement.
Explorer index creation and warmed searches are measured separately.
Filtering uses precomputed searchable text, matching the cached-text path.
Benchmarks of 20,000 rows represent retained-result hard-limit or stress scenarios, not default workloads.

## Methodology

- Node.js 22, matching the application CI version.
- Two warmup calls by default, plus unreported calibration runs.
- Seven measured samples, using adaptive batches targeting at least 25 ms.
- A 100,000-iteration cap by default, configurable with `--max-iterations`.
  When calibration cannot reach its target, reports flag the result and comparison rejects it.
- Report median and interpolated p95 per operation, operations/sec, and processed units/sec.
- Record Node version, OS, CPU model, and commit SHA (when available).
- Record RSS delta as diagnostics only; it is **not** a reliable peak-memory metric.

Use the same machine, Node version, fixture code, and available CPU capacity for before/after comparisons.
For small changes, repeat the comparison in alternating baseline/candidate order.
GitHub-hosted runner variability can exceed single-digit percentage changes.

## CI and follow-up

The `ClickStudio benchmarks` workflow runs on manual dispatch, relevant PRs, and pushes
that change the benchmark suite itself. It publishes a JSON artifact and a readable
Actions summary. It does not fail when a timing gets slower.

A separate browser benchmark suite is a follow-up: production-preview Playwright
interactions should measure chart rendering, editor typing, results painting, and
Object Explorer responsiveness. These microbenchmarks cannot substitute for that.

## Adding a benchmark

Create deterministic input outside `run()`, choose a stable scenario ID that
encodes its workload, and add a `verify(output)` check that rejects incorrect
results. Avoid putting fixture generation, assertions, logging, and expensive
measurement scaffolding inside the timed operation.
