import assert from 'node:assert/strict';

function uniqueBenchmarks(report, name) {
    const byId = new Map();
    for (const benchmark of report.benchmarks) {
        assert.ok(
            typeof benchmark.id === 'string' && benchmark.id,
            name + ' benchmark ID is missing',
        );
        assert.ok(!byId.has(benchmark.id), name + ' has duplicate benchmark ID: ' + benchmark.id);
        byId.set(benchmark.id, benchmark);
    }
    return byId;
}

function environmentDifference(before, after) {
    for (const key of ['node', 'platform', 'arch', 'cpuModel']) {
        const baselineValue = before.environment?.[key];
        const candidateValue = after.environment?.[key];
        if (baselineValue !== candidateValue && (baselineValue || candidateValue))
            return 'Different ' + key;
    }
    return null;
}

function benchmarkSetupDifference(before, after) {
    if (before.suiteHash !== after.suiteHash && (before.suiteHash || after.suiteHash))
        return 'Different benchmark harness';
    for (const key of ['samples', 'warmup', 'targetMs', 'maxIterations']) {
        const baselineValue = before.settings?.[key];
        const candidateValue = after.settings?.[key];
        if (
            baselineValue !== candidateValue &&
            (baselineValue !== undefined || candidateValue !== undefined)
        )
            return 'Different ' + key;
    }
    return null;
}

export function compareReports(baseline, candidate) {
    assert.equal(baseline.schemaVersion, 1, 'Unsupported baseline benchmark version');
    assert.equal(candidate.schemaVersion, 1, 'Unsupported candidate benchmark version');
    const before = uniqueBenchmarks(baseline, 'Baseline');
    const after = uniqueBenchmarks(candidate, 'Candidate');
    const setupMismatch =
        environmentDifference(baseline, candidate) ?? benchmarkSetupDifference(baseline, candidate);
    const ids = [...new Set([...before.keys(), ...after.keys()])].sort();
    return ids.map(id => {
        const oldCase = before.get(id);
        const newCase = after.get(id);
        let reason = null;
        if (!oldCase || !newCase) reason = 'Missing from ' + (!oldCase ? 'baseline' : 'candidate');
        else if (
            oldCase.unitsPerOperation !== newCase.unitsPerOperation ||
            oldCase.units !== newCase.units
        )
            reason = 'Different workload units';
        else if (setupMismatch) reason = setupMismatch;
        else if (
            oldCase.calibrationTargetReached === false ||
            newCase.calibrationTargetReached === false
        )
            reason = 'Calibration target not reached';
        else if (
            !Number.isFinite(oldCase.medianMs) ||
            oldCase.medianMs <= 0 ||
            !Number.isFinite(newCase.medianMs) ||
            newCase.medianMs <= 0
        )
            reason = 'Invalid median timing';
        if (reason) return { id, comparable: false, reason };
        const baselineMs = oldCase.medianMs;
        const candidateMs = newCase.medianMs;
        return {
            id,
            comparable: true,
            baselineMs,
            candidateMs,
            percentChange: ((candidateMs - baselineMs) / baselineMs) * 100,
            speedup: baselineMs / candidateMs,
            maxSpreadPercent:
                Number.isFinite(oldCase.spreadPercent) && Number.isFinite(newCase.spreadPercent)
                    ? Math.max(oldCase.spreadPercent, newCase.spreadPercent)
                    : null,
        };
    });
}

export function comparisonMarkdown(rows) {
    const lines = [
        '| Benchmark | Baseline median | Candidate median | Change | Max spread |',
        '| --- | ---: | ---: | ---: | ---: |',
    ];
    for (const row of rows) {
        const name = row.id.replaceAll('|', '\\|').replaceAll('\n', ' ');
        if (!row.comparable) {
            lines.push('| ' + name + ' | - | - | Not comparable: ' + row.reason + ' | - |');
            continue;
        }
        const change = (row.percentChange >= 0 ? '+' : '') + row.percentChange.toFixed(1) + '%';
        lines.push(
            '| ' +
                name +
                ' | ' +
                row.baselineMs.toFixed(3) +
                ' ms | ' +
                row.candidateMs.toFixed(3) +
                ' ms | ' +
                change +
                ' | ' +
                (row.maxSpreadPercent == null ? 'n/a' : row.maxSpreadPercent.toFixed(1) + '%') +
                ' |',
        );
    }
    return '## ClickHouse Playground benchmark comparison\n\n' + lines.join('\n') + '\n';
}
