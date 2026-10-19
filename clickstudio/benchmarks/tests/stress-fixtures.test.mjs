import assert from 'node:assert/strict';
import test from 'node:test';
import {
    makeDistinctLabels,
    makeLargeCompactPayload,
    makeLargeSqlInput,
    makeWideResult,
} from '../stress-fixtures.mjs';

test('Category labels are deterministic, unique and long enough to stress layout', () => {
    const labels = makeDistinctLabels(500);
    assert.deepEqual(labels, makeDistinctLabels(500));
    assert.equal(new Set(labels).size, 500);
    assert.ok(labels.every(label => label.length > 20));
});

test('Wide CSV fixtures are rectangular and generated without random state', () => {
    const first = makeWideResult(10, 20);
    assert.deepEqual(first, makeWideResult(10, 20));
    assert.equal(first.columns.length, 20);
    assert.equal(first.rows.length, 10);
    assert.ok(first.rows.every(row => row.length === 20));
});

test('One-megabyte stream fixture preserves complete UTF-8 payload', () => {
    const { payload, value } = makeLargeCompactPayload();
    const lines = payload.toString('utf8').trimEnd().split('\n');
    assert.equal(lines.length, 3);
    assert.equal(JSON.parse(lines[2])[1], value);
    assert.ok(payload.byteLength >= 1024 * 1024);
});

test('SQL fixture stays within the 200 KB application limit', () => {
    const sql = makeLargeSqlInput();
    assert.ok(sql.length > 190_000 && sql.length <= 200_000);
    assert.ok(sql.endsWith(';\n'));
});
