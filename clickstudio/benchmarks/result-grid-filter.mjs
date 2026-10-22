import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
    displayValue,
    filterRows,
    searchResultRows,
} from '../.core-build/src/shared/queries/results/results.js';
import { makeWideResult } from './stress-fixtures.mjs';

// Reproduce the current grid's eager indexing + Set + flatMap path for a
// same-process comparison against the new lazy index. No network or DOM timing.
function previousSearch(rows, term, cached) {
    const searchableRows =
        cached ??
        rows.map(row => row.map(value => displayValue(value).toLocaleLowerCase()).join('\u0001'));
    const matchingRows = new Set(filterRows(rows, term, searchableRows));
    return rows.flatMap((row, index) => (matchingRows.has(row) ? [{ row, index }] : []));
}

function median(values) {
    const ordered = [...values].sort((left, right) => left - right);
    return ordered[Math.floor(ordered.length / 2)];
}

function measure(run) {
    let iterations = 1;
    for (;;) {
        const start = performance.now();
        let checksum = 0;
        for (let index = 0; index < iterations; index++) checksum += run().length;
        if (performance.now() - start >= 25 || iterations >= 4096) {
            assert.ok(checksum >= 0);
            break;
        }
        iterations *= 2;
    }
    const samples = [];
    for (let sample = 0; sample < 9; sample++) {
        const start = performance.now();
        let checksum = 0;
        for (let index = 0; index < iterations; index++) checksum += run().length;
        assert.ok(checksum >= 0);
        samples.push((performance.now() - start) / iterations);
    }
    return median(samples);
}

const rows = makeWideResult(2_000, 100).rows;
for (const term of ['group-', 'group-7', '42', 'q', 'missing-search-term', 'group-0\u00010']) {
    const oldIndex = rows.map(row =>
        row.map(value => displayValue(value).toLocaleLowerCase()).join('\u0001'),
    );
    const outcomeCache = new Array(rows.length);
    const expected = previousSearch(rows, term, oldIndex).map(match => match.index);
    assert.deepEqual(
        searchResultRows(rows, term, undefined, outcomeCache).map(match => match.index),
        expected,
    );

    for (const [mode, oldRun, newRun] of [
        [
            'cold',
            () => previousSearch(rows, term),
            () => searchResultRows(rows, term, undefined, new Array(rows.length)),
        ],
        [
            'warm',
            () => previousSearch(rows, term, oldIndex),
            () => searchResultRows(rows, term, undefined, outcomeCache),
        ],
    ]) {
        const oldMs = measure(oldRun);
        const newMs = measure(newRun);
        console.log(
            `${term} (${mode}): before ${oldMs.toFixed(3)} ms, after ${newMs.toFixed(3)} ms, ${(oldMs / newMs).toFixed(2)}x`,
        );
    }
}
