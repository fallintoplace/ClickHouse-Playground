import assert from 'node:assert/strict';
import test from 'node:test';
import { markdownSummary, measureCase, parseRunOptions, percentile } from '../lib/measure.mjs';
import { compareReports, comparisonMarkdown } from '../lib/compare.mjs';
import {
    chunkPayload,
    makeCategoryRows,
    makeCompactPayload,
    makeExplorerSchema,
    makeHeatmapRows,
    makeTimeRows,
} from '../fixtures.mjs';

test('Percentiles interpolate sorted samples without mutating the source', () => {
    const values = [4, 1, 3, 2];
    assert.equal(percentile(values, 0.5), 2.5);
    assert.equal(percentile(values, 0.95), 3.8499999999999996);
    assert.deepEqual(values, [4, 1, 3, 2]);
    assert.throws(() => percentile([], 0.5));
});

test('Run option parser validates settings and supports inline arguments', () => {
    const parsed = parseRunOptions([
        '--samples=3',
        '--warmup',
        '2',
        '--target-ms=5',
        '--filter',
        'chart',
        '--output',
        'results/new.json',
    ]);
    assert.deepEqual(parsed, {
        samples: 3,
        warmup: 2,
        targetMs: 5,
        maxIterations: 100_000,
        filter: 'chart',
        output: 'results/new.json',
    });
    assert.throws(() => parseRunOptions(['--samples=0']));
    assert.throws(() => parseRunOptions(['--warmup=2.5']));
    assert.throws(() => parseRunOptions(['--unknown=1']));
    assert.throws(() => parseRunOptions(['--filter']));
});

test('Synchronous microbenchmarks produce samples and validate outside the timer', async () => {
    let operations = 0;
    let checks = 0;
    const output = await measureCase(
        {
            id: 'test/sync',
            group: 'test',
            description: 'A synthetic operation',
            units: 'rows',
            unitsPerOperation: 12,
            run: () => ++operations,
            verify: value => {
                assert.equal(typeof value, 'number');
                checks++;
            },
        },
        { warmup: 1, samples: 3, targetMs: 0.1, maxIterations: 4 },
    );
    assert.equal(output.samplesMs.length, 3);
    assert.ok(output.iterationsPerSample >= 1 && output.iterationsPerSample <= 4);
    assert.ok(output.p95Ms >= output.medianMs);
    assert.ok(output.medianMs >= output.p05Ms);
    assert.ok(output.spreadPercent >= 0);
    assert.ok(operations > checks);
    assert.equal(output.unitsPerOperation, 12);
});

test('Asynchronous microbenchmarks can verify their resolved results', async () => {
    const output = await measureCase(
        {
            id: 'test/async',
            group: 'test',
            description: 'A synthetic async operation',
            units: 'rows',
            unitsPerOperation: 1,
            async: true,
            run: async () => 42,
            verify: value => assert.equal(value, 42),
        },
        { warmup: 1, samples: 2, targetMs: 0.1, maxIterations: 4 },
    );
    assert.equal(output.samplesMs.length, 2);
    assert.ok(output.medianMs >= 0);
});

test('Benchmarks fail when validation detects an incorrect result', async () => {
    await assert.rejects(
        measureCase(
            {
                id: 'test/invalid',
                async: false,
                run: () => 9,
                verify: value => assert.equal(value, 10),
            },
            { warmup: 1, samples: 1, targetMs: 0.1 },
        ),
        { code: 'ERR_ASSERTION' },
    );
});

test('Benchmark fixtures are deterministic, bounded and preserve streaming bytes', () => {
    const payload = makeCompactPayload(100);
    assert.deepEqual(Buffer.concat(chunkPayload(payload, 17)), payload);
    assert.equal(payload.toString().trim().split('\n').length, 102);
    assert.deepEqual(makeTimeRows(4), makeTimeRows(4));
    assert.equal(makeCategoryRows(100).length, 100);
    assert.equal(makeHeatmapRows(96).length, 96);
    const schema = makeExplorerSchema(25);
    assert.equal(schema.tables.length, 25);
    assert.equal(schema.columns.length, 150);
});

test('Comparisons mark faster candidates with a negative percentage', () => {
    const baseline = {
        schemaVersion: 1,
        benchmarks: [{ id: 'stream/large', medianMs: 10, unitsPerOperation: 100 }],
    };
    const candidate = {
        schemaVersion: 1,
        benchmarks: [{ id: 'stream/large', medianMs: 6, unitsPerOperation: 100 }],
    };
    const comparison = compareReports(baseline, candidate);
    assert.equal(comparison[0].percentChange, -40);
    assert.ok(comparison[0].speedup > 1.6);
    assert.match(comparisonMarkdown(comparison), /-40\.0%/);
    assert.match(
        markdownSummary({
            benchmarks: [{ id: 'example', medianMs: 1, p95Ms: 2, operationsPerSecond: 1000 }],
        }),
        /example/,
    );
});

test('Comparisons reject mismatched workload sizes and missing scenarios', () => {
    const baseline = {
        schemaVersion: 1,
        benchmarks: [{ id: 'case-a', medianMs: 1, unitsPerOperation: 200 }],
    };
    const candidate = {
        schemaVersion: 1,
        benchmarks: [
            { id: 'case-a', medianMs: 2, unitsPerOperation: 500 },
            { id: 'case-b', medianMs: 3, unitsPerOperation: 200 },
        ],
    };
    assert.equal(compareReports(baseline, candidate).filter(row => row.comparable).length, 0);
    assert.match(comparisonMarkdown(compareReports(baseline, candidate)), /Not comparable/);
    assert.throws(() => compareReports({ ...baseline, schemaVersion: 2 }, candidate));
});
