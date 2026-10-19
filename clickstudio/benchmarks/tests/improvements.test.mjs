import assert from 'node:assert/strict';
import test from 'node:test';
import { compareReports, comparisonMarkdown } from '../lib/compare.mjs';
import { measureCase, parseRunOptions, runSuite, markdownSummary } from '../lib/measure.mjs';

const entry = (extra = {}) => ({
    id: 'case',
    units: 'rows',
    unitsPerOperation: 100,
    medianMs: 5,
    ...extra,
});
const report = (extra = {}) => ({
    schemaVersion: 1,
    environment: { node: 'v22.16.0', arch: 'x64', platform: 'linux', cpuModel: 'CPU' },
    benchmarks: [entry()],
    ...extra,
});

test('config CLI supports max iterations and paths containing equals', () => {
    const options = parseRunOptions(['--max-iterations=8000', '--output=folder/a=b.json']);
    assert.equal(options.maxIterations, 8000);
    assert.equal(options.output, 'folder/a=b.json');
    assert.throws(() => parseRunOptions(['--max-iterations=0']), /positive integer/);
    assert.throws(() => parseRunOptions(['--max-iterations=bad']), /positive integer/);
    assert.throws(() => parseRunOptions(['--samples=2=3']), /positive integer/);
});

test('calibration can exceed 256 iterations and visibly reports a target miss', async () => {
    let count = 0;
    const measured = await measureCase(
        {
            id: 'synthetic',
            group: 'synthetic',
            description: '',
            units: 'ops',
            unitsPerOperation: 1,
            run: () => ++count,
            verify: value => assert.equal(typeof value, 'number'),
        },
        { samples: 2, warmup: 1, targetMs: 10_000, maxIterations: 513 },
    );
    assert.equal(measured.iterationsPerSample, 513);
    assert.equal(measured.calibrationTargetReached, false);
    assert.ok(Number.isFinite(measured.calibrationMs));
    assert.equal(measured.samplesMs.length, 2);
    assert.match(markdownSummary({ benchmarks: [measured] }), /Below target/);
});

test('environment mismatch is not comparable', () => {
    const rows = compareReports(
        report(),
        report({ environment: { ...report().environment, cpuModel: 'Other' } }),
    );
    assert.equal(rows[0].comparable, false);
    assert.equal(rows[0].reason, 'Different cpuModel');
    assert.match(comparisonMarkdown(rows), /Different cpuModel/);
});

test('missing, workload and calibration mismatches are distinguishable', () => {
    const cases = [
        [report(), report({ benchmarks: [] }), 'Missing from candidate'],
        [
            report(),
            report({ benchmarks: [entry({ units: 'objects' })] }),
            'Different workload units',
        ],
        [
            report(),
            report({ benchmarks: [entry({ calibrationTargetReached: false })] }),
            'Calibration target not reached',
        ],
        [
            report(),
            report({ benchmarks: [entry({ medianMs: Infinity })] }),
            'Invalid median timing',
        ],
        [report(), report({ benchmarks: [entry({ medianMs: 0 })] }), 'Invalid median timing'],
    ];
    for (const [before, after, reason] of cases) {
        const result = compareReports(before, after)[0];
        assert.equal(result.comparable, false);
        assert.equal(result.reason, reason);
    }
});

test('duplicate scenario IDs are rejected in both paths', async () => {
    assert.throws(
        () => compareReports(report({ benchmarks: [entry(), entry()] }), report()),
        /duplicate/,
    );
    await assert.rejects(runSuite([{ id: 'dupe' }, { id: 'dupe' }], { filter: '' }), /unique/);
});

test('legacy reports with missing environment metadata are still comparable', () => {
    const old = { schemaVersion: 1, benchmarks: [entry({ units: undefined })] };
    const result = compareReports(old, old)[0];
    assert.equal(result.comparable, true);
    assert.equal(result.percentChange, 0);
});

test('comparison rejects changed harness sources, sampling options, or missing CPU metadata', () => {
    const cases = [
        [
            report({ suiteHash: 'first' }),
            report({ suiteHash: 'second' }),
            'Different benchmark harness',
        ],
        [report({ suiteHash: 'first' }), report(), 'Different benchmark harness'],
        [
            report({ settings: { samples: 7, targetMs: 25 } }),
            report({ settings: { samples: 5, targetMs: 25 } }),
            'Different samples',
        ],
        [
            report({ environment: { ...report().environment, cpuModel: undefined } }),
            report(),
            'Different cpuModel',
        ],
    ];
    for (const [before, after, reason] of cases) {
        const result = compareReports(before, after)[0];
        assert.equal(result.comparable, false);
        assert.equal(result.reason, reason);
    }
});

test('comparison exposes measured spread without claiming statistical significance', () => {
    const baseline = report({
        suiteHash: 'same',
        benchmarks: [entry({ medianMs: 10, spreadPercent: 12 })],
    });
    const candidate = report({
        suiteHash: 'same',
        benchmarks: [entry({ medianMs: 8, spreadPercent: 30 })],
    });
    const result = compareReports(baseline, candidate)[0];
    assert.equal(result.comparable, true);
    assert.equal(result.maxSpreadPercent, 30);
    assert.match(comparisonMarkdown([result]), /30\.0%/);
});

test('suite report preserves the workload fingerprint', async () => {
    const result = await runSuite(
        [
            {
                id: 'cheap',
                group: 'synthetic',
                units: 'ops',
                unitsPerOperation: 1,
                run: () => 7,
                verify: output => assert.equal(output, 7),
            },
        ],
        {
            filter: '',
            samples: 1,
            warmup: 1,
            targetMs: 0.1,
            maxIterations: 20,
            suiteHash: 'fixture',
        },
    );
    assert.equal(result.suiteHash, 'fixture');
});
