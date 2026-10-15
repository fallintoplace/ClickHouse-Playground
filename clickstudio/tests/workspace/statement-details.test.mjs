import test from 'node:test';
import assert from 'node:assert/strict';
import {
    statementDetails,
    statementNotice,
} from '../../.workspace-build/src/frontend/queries/results/statement-details.js';

const statement = { sql: 'SELECT value FROM events', status: 'succeeded' };
const run = {
    ...statement,
    columns: [{ name: 'value', type: 'UInt64' }],
    rowCount: 240,
    elapsedMs: 130.6,
    warnings: [],
};

test('A result summary includes singular columns and rounded elapsed time', () => {
    assert.equal(statementDetails(statement, run, true), '240 rows returned · 1 column · 131 ms');
});

test('An empty table still reports its result columns', () => {
    assert.equal(
        statementDetails(
            statement,
            { ...run, rowCount: 0, columns: [...run.columns, ...run.columns] },
            true,
        ),
        '0 rows returned · 2 columns · 131 ms',
    );
});

test('Live statement cards keep their existing compact outcome', () => {
    assert.equal(statementDetails(statement, run), '240 rows returned · 131 ms');
});

for (const [sql, writtenRows, outcome] of [
    ['INSERT INTO events VALUES (1)', 1, 'INSERT completed · 1 row written'],
    [
        'INSERT INTO events SELECT * FROM source',
        undefined,
        'INSERT completed · row count unavailable',
    ],
    ['CREATE TABLE events (value UInt64)', 0, 'CREATE completed'],
]) {
    test(`${outcome} does not add a zero-column count`, () => {
        const command = { ...statement, sql };
        assert.equal(
            statementDetails(command, { ...run, sql, columns: [], rowCount: 0, writtenRows }, true),
            `${outcome} · 131 ms`,
        );
    });
}

for (const status of ['pending', 'queued', 'running', 'skipped', 'timed_out']) {
    test(`${status} never borrows metrics or warnings from a stale successful run`, () => {
        const current = { ...statement, status };
        const expected = {
            pending: 'Waiting to run',
            queued: 'Waiting to run',
            running: 'Running',
            skipped: 'Skipped',
            timed_out: 'Timed out',
        };
        assert.equal(
            statementDetails(current, { ...run, warnings: ['Old warning'] }, true),
            expected[status],
        );
        assert.equal(statementNotice(current, { ...run, warnings: ['Old warning'] }), '');
    });
}

test('A failed statement without a run still exposes its error', () => {
    const failed = {
        ...statement,
        status: 'failed',
        error: { code: 'PARSE_ERROR', message: 'Unclosed quote' },
    };
    assert.equal(statementDetails(failed, run, true), 'PARSE_ERROR: Unclosed quote');
});

test('A matching run supplies its error details', () => {
    const failed = { ...statement, status: 'failed' };
    assert.equal(
        statementDetails(
            failed,
            { ...run, status: 'failed', error: { code: 'QUERY_ERROR', message: 'Unknown table' } },
            true,
        ),
        'QUERY_ERROR: Unknown table',
    );
});

test('An unavailable run shows status without invented metrics', () => {
    assert.equal(statementDetails(statement, undefined, true), 'Succeeded');
    assert.equal(statementNotice(statement), '');
});

test('Warnings use singular and plural labels', () => {
    assert.equal(statementNotice(statement, { ...run, warnings: ['Warning'] }), '1 warning');
    assert.equal(statementNotice(statement, { ...run, warnings: ['A', 'B'] }), '2 warnings');
    assert.equal(statementNotice(statement, run), '');
});

test('Truncation stays visible even before the run metadata arrives', () => {
    const truncated = { ...statement, status: 'truncated' };
    assert.equal(statementNotice(truncated), 'Result truncated');
    assert.equal(
        statementNotice(truncated, { ...run, status: 'truncated', warnings: ['Bounded output'] }),
        'Result truncated · 1 warning',
    );
});
