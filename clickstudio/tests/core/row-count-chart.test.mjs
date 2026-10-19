import test from 'node:test';
import assert from 'node:assert/strict';
import { countRowsOverTime } from '../../.core-build/src/shared/queries/results/results.js';

test('Row-count charts retain chronological buckets without grouping', () => {
    const result = countRowsOverTime(
        [
            [Date.UTC(2026, 9, 19, 10, 0), 'first'],
            [Date.UTC(2026, 9, 19, 10, 0, 30), 'second'],
            ['2026-10-19T10:01:00Z', 'third'],
        ],
        0,
    );

    assert.equal(result.unit, 'minute');
    assert.equal(result.excludedRows, 0);
    assert.deepEqual(result.series, [
        {
            key: '__rows__',
            label: 'Rows',
            points: [
                { timestamp: Date.UTC(2026, 9, 19, 10, 0), label: '2026-10-19 10:00', count: 2 },
                { timestamp: Date.UTC(2026, 9, 19, 10, 1), label: '2026-10-19 10:01', count: 1 },
            ],
        },
    ]);
});

test('Row-count charts preserve grouped object keys, top series and excluded dates', () => {
    const fast = { label: 'fast' };
    const slow = { label: 'slow' };
    const result = countRowsOverTime(
        [
            ['2026-10-19T10:10:00Z', fast],
            ['2026-10-19T10:40:00Z', { label: 'fast' }],
            ['2026-10-19T15:25:00Z', slow],
            ['invalid date', slow],
        ],
        0,
        1,
        1,
    );

    assert.equal(result.unit, 'hour');
    assert.equal(result.excludedRows, 1);
    assert.deepEqual(result.series, [
        {
            key: JSON.stringify(fast),
            label: JSON.stringify(fast),
            points: [{ timestamp: Date.UTC(2026, 9, 19, 10), label: '2026-10-19 10:00', count: 2 }],
        },
        {
            key: '__other__',
            label: 'Other (1)',
            points: [{ timestamp: Date.UTC(2026, 9, 19, 15), label: '2026-10-19 15:00', count: 1 }],
        },
    ]);
});

test('Row-count charts return no series when all timestamps are invalid', () => {
    assert.deepEqual(countRowsOverTime([[null], ['invalid date'], [undefined]], 0), {
        unit: 'day',
        excludedRows: 3,
        series: [],
    });
});

test('Large row-count charts avoid spreading timestamps into function arguments', () => {
    const origin = Date.UTC(2026, 9, 19);
    const rows = Array.from({ length: 150_000 }, (_, index) => [origin + index * 1000]);
    const result = countRowsOverTime(rows, 0);

    assert.equal(result.excludedRows, 0);
    assert.equal(result.series.length, 1);
    assert.equal(
        result.series[0].points.reduce((sum, point) => sum + point.count, 0),
        rows.length,
    );
});
