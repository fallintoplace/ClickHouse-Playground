import assert from 'node:assert/strict';
import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';

export function percentile(samples, fraction) {
    assert.ok(samples.length > 0, 'Cannot summarize an empty benchmark');
    assert.ok(fraction >= 0 && fraction <= 1, 'Percentile must be between 0 and 1');
    const sorted = [...samples].sort((left, right) => left - right);
    const position = (sorted.length - 1) * fraction;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function positiveInteger(value, name) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1)
        throw new Error(name + ' must be a positive integer');
    return parsed;
}

export function parseRunOptions(argv) {
    const options = {
        samples: 7,
        warmup: 2,
        targetMs: 25,
        maxIterations: 100_000,
        filter: '',
        output: 'benchmarks/results/latest.json',
    };
    const valueOptions = new Map([
        ['--samples', 'samples'],
        ['--warmup', 'warmup'],
        ['--target-ms', 'targetMs'],
        ['--max-iterations', 'maxIterations'],
        ['--filter', 'filter'],
        ['--output', 'output'],
    ]);
    for (let index = 0; index < argv.length; index++) {
        const argument = argv[index];
        const separator = argument.indexOf('=');
        const flag = separator < 0 ? argument : argument.slice(0, separator);
        const name = valueOptions.get(flag);
        if (!name) throw new Error('Unknown benchmark option: ' + argument);
        const value = separator < 0 ? argv[++index] : argument.slice(separator + 1);
        if (!value || value.startsWith('--')) throw new Error('Missing value for ' + flag);
        if (name === 'samples' || name === 'warmup' || name === 'maxIterations')
            options[name] = positiveInteger(value, flag);
        else if (name === 'targetMs') {
            options.targetMs = Number(value);
            if (!Number.isFinite(options.targetMs) || options.targetMs <= 0)
                throw new Error('--target-ms must be positive');
        } else options[name] = value;
    }
    return options;
}

async function timeBatch(scenario, iterations) {
    let last;
    const start = performance.now();
    if (scenario.async) {
        for (let index = 0; index < iterations; index++) last = await scenario.run();
    } else {
        for (let index = 0; index < iterations; index++) {
            last = scenario.run();
            if (last && typeof last.then === 'function')
                throw new Error('Async benchmark must set async: true: ' + scenario.id);
        }
    }
    return { elapsedMs: performance.now() - start, last };
}

export async function measureCase(scenario, options = {}) {
    const samples = options.samples ?? 7;
    const warmup = options.warmup ?? 2;
    const targetMs = options.targetMs ?? 25;
    const maxIterations = options.maxIterations ?? 100_000;
    positiveInteger(samples, 'samples');
    positiveInteger(warmup, 'warmup');
    positiveInteger(maxIterations, 'maxIterations');
    assert.ok(Number.isFinite(targetMs) && targetMs > 0, 'targetMs must be positive');

    for (let index = 0; index < warmup; index++) {
        const output = await timeBatch(scenario, 1);
        scenario.verify(output.last);
    }

    let iterations = 1;
    let calibrationMs;
    while (true) {
        // Two trials prevent a single scheduling pause from faking a calibrated batch.
        const first = await timeBatch(scenario, iterations);
        scenario.verify(first.last);
        const second = await timeBatch(scenario, iterations);
        scenario.verify(second.last);
        calibrationMs = Math.min(first.elapsedMs, second.elapsedMs);
        if (calibrationMs >= targetMs || iterations >= maxIterations) break;
        const estimate = Math.ceil((iterations * targetMs) / Math.max(calibrationMs, 0.01));
        iterations = Math.min(maxIterations, Math.max(iterations + 1, estimate));
    }

    const rssBefore = process.memoryUsage().rss;
    const timings = [];
    const batchTimingsMs = [];
    for (let index = 0; index < samples; index++) {
        const sample = await timeBatch(scenario, iterations);
        scenario.verify(sample.last);
        batchTimingsMs.push(sample.elapsedMs);
        timings.push(sample.elapsedMs / iterations);
    }
    const medianMs = percentile(timings, 0.5);
    const p05Ms = percentile(timings, 0.05);
    const p95Ms = percentile(timings, 0.95);
    return {
        id: scenario.id,
        group: scenario.group,
        description: scenario.description,
        units: scenario.units,
        unitsPerOperation: scenario.unitsPerOperation,
        iterationsPerSample: iterations,
        calibrationMs,
        calibrationTargetReached:
            calibrationMs >= targetMs && percentile(batchTimingsMs, 0.5) >= targetMs,
        samplesMs: timings,
        medianMs,
        p05Ms,
        p95Ms,
        spreadPercent: medianMs > 0 ? ((p95Ms - p05Ms) / medianMs) * 100 : null,
        operationsPerSecond: medianMs > 0 ? 1000 / medianMs : null,
        unitsPerSecond: medianMs > 0 ? (scenario.unitsPerOperation * 1000) / medianMs : null,
        rssDeltaBytes: process.memoryUsage().rss - rssBefore,
    };
}

export async function runSuite(scenarios, options) {
    const ids = scenarios.map(scenario => scenario.id);
    assert.equal(new Set(ids).size, ids.length, 'Benchmark scenario IDs must be unique');
    const selected = scenarios.filter(scenario =>
        scenario.id.toLowerCase().includes(options.filter.toLowerCase()),
    );
    if (!selected.length) throw new Error('No benchmarks match filter: ' + options.filter);
    const results = [];
    for (const scenario of selected) {
        const result = await measureCase(scenario, options);
        results.push(result);
        console.log(
            result.id +
                ': median ' +
                result.medianMs.toFixed(3) +
                ' ms, p95 ' +
                result.p95Ms.toFixed(3) +
                ' ms' +
                (result.calibrationTargetReached ? '' : ' (calibration target not reached)'),
        );
    }
    return {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        gitSha: process.env.GITHUB_SHA ?? null,
        suiteHash: options.suiteHash ?? null,
        environment: {
            node: process.version,
            platform: platform(),
            arch: arch(),
            cpuModel: cpus()[0]?.model ?? 'unknown',
        },
        settings: {
            samples: options.samples,
            warmup: options.warmup,
            targetMs: options.targetMs,
            maxIterations: options.maxIterations,
        },
        benchmarks: results,
    };
}

export function markdownSummary(report) {
    const rows = [
        '| Benchmark | Median (ms) | p95 (ms) | Spread | Operations/s | Calibration |',
        '| --- | ---: | ---: | ---: | ---: | --- |',
    ];
    for (const item of report.benchmarks) {
        const safeId = item.id.replaceAll('|', '\\|');
        let calibration = 'Unknown';
        if (item.calibrationTargetReached === true) calibration = 'OK';
        else if (item.calibrationTargetReached === false) calibration = 'Below target';
        rows.push(
            '| ' +
                safeId +
                ' | ' +
                item.medianMs.toFixed(3) +
                ' | ' +
                item.p95Ms.toFixed(3) +
                ' | ' +
                (item.spreadPercent == null ? 'n/a' : item.spreadPercent.toFixed(1) + '%') +
                ' | ' +
                (item.operationsPerSecond?.toFixed(1) ?? 'n/a') +
                ' | ' +
                calibration +
                ' |',
        );
    }
    return '## ClickHouse Playground microbenchmarks\n\n' + rows.join('\n') + '\n';
}
