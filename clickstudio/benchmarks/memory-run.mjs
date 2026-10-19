import assert from 'node:assert/strict';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { arch, cpus, platform } from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { collectCompactStream } from '../.core-build/src/backend/database/clickhouse/result-stream.js';
import { LargeCellStore } from '../.core-build/src/backend/queries/execution/large-cells.js';
import { MemoryStore } from '../.core-build/src/backend/system/store.js';
import { exportCsv } from '../.core-build/src/shared/queries/results/results.js';

const scenarios = [
    {
        id: 'stream/5000-rows-100-columns',
        async run() {
            async function* source() {
                const columns = Array.from({ length: 100 }, (_, index) => 'column_' + index);
                yield Buffer.from(
                    JSON.stringify(columns) +
                        '\n' +
                        JSON.stringify(columns.map(() => 'String')) +
                        '\n',
                );
                for (let first = 0; first < 5_000; first += 25) {
                    const batch = Array.from({ length: 25 }, (_, index) =>
                        JSON.stringify(
                            Array.from({ length: 100 }, (_, column) =>
                                String(((first + index) * (column + 1)) % 1_000),
                            ),
                        ),
                    );
                    yield Buffer.from(batch.join('\n') + '\n');
                }
            }
            const result = await collectCompactStream(source(), {
                rows: 5_000,
                bytes: 5_000_000,
            });
            assert.equal(result.rows.length, 5_000);
            assert.equal(result.columns.length, 100);
            assert.equal(result.truncated, false);
        },
    },
    {
        id: 'stream/100000-incoming-rows-truncated',
        async run() {
            let generated = 0;
            let closed = false;
            async function* source() {
                try {
                    yield Buffer.from('["value"]\n["String"]\n');
                    for (let first = 0; first < 100_000; first += 100) {
                        generated += 100;
                        yield Buffer.from(
                            Array.from({ length: 100 }, (_, index) =>
                                JSON.stringify([String(first + index)]),
                            ).join('\n') + '\n',
                        );
                    }
                } finally {
                    closed = true;
                }
            }
            const result = await collectCompactStream(source(), {
                rows: 1_000,
                bytes: 2_000_000,
            });
            assert.equal(result.rows.length, 1_000);
            assert.equal(result.truncationReason, 'rows');
            assert.ok(generated < 100_000);
            assert.equal(closed, true);
        },
    },
    {
        id: 'stream/large-cells-detach-and-delete',
        async run() {
            const storage = new MemoryStore();
            const cells = new LargeCellStore(storage);
            const large = '🧪'.repeat(150_000);
            const lines = Array.from({ length: 3 }, (_, index) =>
                JSON.stringify([String(index), large]),
            );
            const payload = '["id","payload"]\n["UInt64","String"]\n' + lines.join('\n') + '\n';
            const result = await collectCompactStream(
                [Buffer.from(payload)],
                { rows: 10, bytes: 20_000 },
                {
                    store: cells,
                    ownerKey: 'memory-owner',
                    runId: 'memory-run',
                    referenceToken: 'memory-token',
                },
            );
            assert.equal(result.truncated, false);
            assert.equal(result.rows.length, 3);
            assert.equal(storage.count('large-cells'), 3);
            cells.deleteRun('memory-owner', 'memory-run');
            assert.equal(storage.count('large-cells'), 0);
        },
    },
    {
        id: 'result/retained-csv-5000-by-20',
        async run() {
            const columns = Array.from({ length: 20 }, (_, index) => ({
                name: 'column_' + index,
                type: 'String',
            }));
            const rows = Array.from({ length: 5_000 }, (_, row) =>
                Array.from({ length: 20 }, (_, column) => 'v' + row + '-' + column),
            );
            const csv = exportCsv({ columns, rows });
            assert.ok(csv.startsWith('column_0,column_1'));
            assert.equal(csv.split('\r\n').length, 5_001);
        },
    },
];

function memory() {
    const usage = process.memoryUsage();
    return {
        rssBytes: usage.rss,
        heapUsedBytes: usage.heapUsed,
        externalBytes: usage.external,
        arrayBuffersBytes: usage.arrayBuffers,
    };
}

function maximum(left, right) {
    return Object.fromEntries(Object.keys(left).map(key => [key, Math.max(left[key], right[key])]));
}

async function collectGarbage() {
    assert.equal(typeof global.gc, 'function', 'Run with node --expose-gc');
    global.gc();
    await new Promise(resolve => setImmediate(resolve));
    global.gc();
}

async function measure(scenario, iterations) {
    await collectGarbage();
    const baseline = memory();
    let sampledPeak = baseline;
    const sample = () => {
        sampledPeak = maximum(sampledPeak, memory());
    };
    const timer = setInterval(sample, 5);
    const start = performance.now();
    try {
        for (let index = 0; index < iterations; index++) {
            await scenario.run();
            sample();
        }
    } finally {
        clearInterval(timer);
        sample();
    }
    const durationMs = performance.now() - start;
    await collectGarbage();
    const afterGc = memory();
    return {
        id: scenario.id,
        iterations,
        durationMs: Math.round(durationMs * 100) / 100,
        baseline,
        sampledPeak,
        afterGc,
        retainedHeapDeltaBytes: afterGc.heapUsedBytes - baseline.heapUsedBytes,
    };
}

function summary(results) {
    const mb = bytes => (bytes / 1_000_000).toFixed(2);
    const lines = [
        '## ClickStudio memory diagnostics (report only)',
        '',
        'Sampled memory is not an exact high-water mark or a reliable leak verdict.',
        '',
        '| Scenario | Time (ms) | Sampled peak RSS (MB) | Sampled peak heap (MB) | Heap after GC delta (MB) |',
        '| --- | ---: | ---: | ---: | ---: |',
    ];
    for (const result of results) {
        lines.push(
            '| ' +
                result.id +
                ' | ' +
                result.durationMs.toFixed(2) +
                ' | ' +
                mb(result.sampledPeak.rssBytes) +
                ' | ' +
                mb(result.sampledPeak.heapUsedBytes) +
                ' | ' +
                mb(result.retainedHeapDeltaBytes) +
                ' |',
        );
    }
    return lines.join('\n') + '\n';
}

const arg = process.argv.find(value => value.startsWith('--output='));
const destination = resolve(
    arg ? arg.slice('--output='.length) : 'benchmarks/results/memory-ci.json',
);
const iterations = Number(process.env.CLICKSTUDIO_MEMORY_ITERATIONS ?? 5);
assert.ok(Number.isSafeInteger(iterations) && iterations > 0 && iterations <= 50);
const results = [];
for (const scenario of scenarios) {
    const result = await measure(scenario, iterations);
    results.push(result);
    console.log(
        scenario.id +
            ': ' +
            result.durationMs.toFixed(1) +
            ' ms, sampled peak RSS ' +
            (result.sampledPeak.rssBytes / 1_000_000).toFixed(1) +
            ' MB',
    );
}
const report = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    gitSha: process.env.GITHUB_SHA ?? null,
    samplesPerScenario: iterations,
    environment: {
        node: process.version,
        platform: platform(),
        arch: arch(),
        cpuModel: cpus()[0]?.model ?? 'unknown',
    },
    metricsAreSampled: true,
    results,
};
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, JSON.stringify(report, null, 2) + '\n');
if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary(results));
}
console.log('Memory report: ' + destination);
