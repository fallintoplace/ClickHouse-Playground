import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { RunService, boundResult } from '../../.core-build/src/backend/queries/execution/runs.js';
import { DEFAULT_LIMITS } from '../../.core-build/src/shared/queries/execution/settings.js';
import { fixture, owner, other, viewer, until, columns, connection } from './helpers.mjs';
test('Lifecycle retains typed evidence and actual identity', async () => {
    const f = fixture(),
        r = f.runs.submit(owner, f.request());
    const done = await f.runs.wait(owner, r.id);
    assert.equal(done.status, 'succeeded');
    assert.equal(done.executedAs, 'reader');
    assert.equal(f.runs.result(owner, r.id).rows[0][0], '1');
    assert.equal(done.retryPolicy, 'never');
});
test('Duplicate request executes once', async () => {
    const f = fixture(),
        input = f.request();
    const a = f.runs.submit(owner, input),
        b = f.runs.submit(owner, input);
    assert.equal(a.id, b.id);
    await f.runs.wait(owner, a.id);
    assert.equal(f.calls.length, 1);
});
test('Submitting a run does not scan saved run or receipt records', async () => {
    const f = fixture(),
        list = f.store.list.bind(f.store);
    f.store.list = bucket => {
        if (bucket === 'runs' || bucket === 'receipts')
            throw new Error(`Submission loaded ${bucket}`);
        return list(bucket);
    };
    let run;
    try {
        run = f.runs.submit(owner, f.request());
    } finally {
        f.store.list = list;
    }
    assert.equal((await f.runs.wait(owner, run.id)).status, 'succeeded');
    assert.equal(f.store.count('runs'), 1);
    assert.equal(f.store.count('receipts'), 1);
});
test('New runs preserve results beyond the former history, byte and receipt caps', async () => {
    const f = fixture(),
        input = f.request(),
        first = f.runs.submit(owner, input);
    const done = await f.runs.wait(owner, first.id);
    const result = f.runs.result(owner, first.id);
    for (let i = 0; i < 10_000; i++) {
        const id = `saved-${i}`;
        f.store.put('runs', id, { ...done, id, queryId: id, bytes: 6000 });
        f.store.put('results', id, { ...result, runId: id, queryId: id });
    }
    for (let i = 0; i < 100_000; i++) {
        const id = `receipt-${i}`;
        f.store.put('receipts', id, {
            id,
            kind: 'run',
            fingerprint: id,
            resourceId: first.id,
            at: done.createdAt,
        });
    }
    const next = f.runs.submit(owner, f.request()),
        another = f.runs.submit(owner, f.request());
    await Promise.all([f.runs.wait(owner, next.id), f.runs.wait(owner, another.id)]);
    assert.equal(f.store.count('runs'), 10_003);
    assert.equal(f.store.count('results'), 10_003);
    assert.equal(f.store.count('receipts'), 100_003);
    assert.deepEqual(f.runs.result(owner, first.id), result);
    assert.equal(f.runs.submit(owner, input).id, first.id);
    assert.equal(f.calls.length, 3);
});
test('Reusing an id for different SQL rejects', () => {
    const f = fixture(),
        input = f.request();
    f.runs.submit(owner, input);
    assert.throws(() => f.runs.submit(owner, { ...input, sql: 'SELECT 9' }), {
        code: 'IDEMPOTENCY_CONFLICT',
    });
});
test('Connection trust is required server-side', () => {
    const f = fixture();
    f.runs.trust(owner, 'local', false);
    assert.throws(() => f.runs.submit(owner, f.request()), { code: 'WORKSPACE_UNTRUSTED' });
    assert.equal(f.calls.length, 0);
});
test('Connection trust is invalidated when the same profile id resolves to another target', () => {
    let host = 'http://localhost:8123';
    const f = fixture({
        authorize: (_p, id) => ({
            id,
            name: 'Local',
            host,
            database: 'default',
            username: 'reader',
            readonly: true,
            limits: { ...DEFAULT_LIMITS },
            manifest: {
                version: 1,
                serverVersion: 'fixture',
                testedAt: new Date().toISOString(),
                explain: { available: true },
                pipeline: { available: true },
            },
        }),
    });
    assert.equal(f.runs.isTrusted(owner, 'local'), true);
    host = 'http://other:8123';
    assert.equal(f.runs.isTrusted(owner, 'local'), false);
    assert.throws(() => f.runs.submit(owner, f.request()), { code: 'WORKSPACE_UNTRUSTED' });
});
test('Logical-plan requests are rejected before queuing when the capability is unavailable', () => {
    const f = fixture({
        authorize: (_principal, id) => ({
            ...connection,
            id,
            manifest: {
                ...connection.manifest,
                explainPlan: { available: false, reason: 'Plan JSON is not supported' },
            },
        }),
    });
    assert.throws(() => f.runs.submit(owner, f.request({ kind: 'plan' })), {
        code: 'CAPABILITY_UNAVAILABLE',
    });
    assert.equal(f.store.count('runs'), 0);
    assert.equal(f.calls.length, 0);
});
test('EXPLAIN ANALYZE is rejected without native support and retained as a measured run when supported', async () => {
    const unsupported = fixture({
        authorize: (_principal, id) => ({
            ...connection,
            id,
            manifest: {
                ...connection.manifest,
                explainAnalyze: { available: false, reason: 'Upgrade ClickHouse to 26.7 or newer' },
            },
        }),
    });
    assert.throws(() => unsupported.runs.submit(owner, unsupported.request({ kind: 'analyze' })), {
        code: 'CAPABILITY_UNAVAILABLE',
    });
    assert.equal(unsupported.store.count('runs'), 0);
    assert.equal(unsupported.calls.length, 0);

    const supported = fixture({
        authorize: (_principal, id) => ({
            ...connection,
            id,
            manifest: { ...connection.manifest, explainAnalyze: { available: true } },
        }),
    });
    const run = supported.runs.submit(owner, supported.request({ kind: 'analyze' }));
    assert.equal((await supported.runs.wait(owner, run.id)).kind, 'analyze');
    assert.equal(supported.calls[0].kind, 'analyze');
});
test('Viewer cannot execute', () => {
    const f = fixture();
    assert.throws(() => f.runs.submit(viewer, f.request()), { code: 'ROLE_READ_ONLY' });
});
test('Owners cannot inspect each other runs or history', async () => {
    const f = fixture(),
        r = f.runs.submit(owner, f.request());
    await f.runs.wait(owner, r.id);
    assert.throws(() => f.runs.get(other, r.id), { code: 'NOT_FOUND' });
    assert.equal(f.runs.list(other).length, 0);
});
test('Queued cancellation does not execute', async () => {
    const f = fixture(),
        r = f.runs.submit(owner, f.request());
    await f.runs.cancel(owner, r.id);
    assert.equal((await f.runs.wait(owner, r.id)).status, 'cancelled');
    assert.equal(f.calls.length, 0);
});
test('Active cancellation has a separate server kill request', async () => {
    const f = fixture({ delay: 500 }),
        r = f.runs.submit(owner, f.request());
    await until(() => f.calls.length);
    await f.runs.cancel(owner, r.id);
    assert.equal((await f.runs.wait(owner, r.id)).status, 'cancelled');
    assert.ok(f.kills.includes(r.id));
});
test('Server deadline marks timeout rather than query error', async () => {
    const f = fixture({ delay: 5000 }),
        r = f.runs.submit(owner, f.request({ limits: { seconds: 1 } }));
    assert.equal((await f.runs.wait(owner, r.id)).status, 'timed_out');
});
test('Reconnect after completion receives authoritative state', async () => {
    const f = fixture(),
        r = f.runs.submit(owner, f.request());
    await f.runs.wait(owner, r.id);
    let event;
    const close = f.runs.subscribe(owner, r.id, e => (event = e));
    close();
    assert.equal(event.run.status, 'succeeded');
    assert.ok(event.sequence >= 2);
});
test('Broken listener cannot fail execution', async () => {
    const f = fixture(),
        r = f.runs.submit(owner, f.request());
    let first = true;
    const close = f.runs.subscribe(owner, r.id, () => {
        if (!first) throw new Error('disconnected');
        first = false;
    });
    assert.equal((await f.runs.wait(owner, r.id)).status, 'succeeded');
    close();
});
test('Restart preserves old results and removes legacy expiry fields without executing SQL', async () => {
    const f = fixture(),
        r = f.runs.submit(owner, f.request());
    const done = await f.runs.wait(owner, r.id),
        result = f.runs.result(owner, r.id);
    const old = '2000-01-01T00:00:00.000Z';
    f.store.put('runs', r.id, { ...done, createdAt: old, resultExpiresAt: old });
    f.store.put('results', r.id, { ...result, createdAt: old, expiresAt: old });
    assert.deepEqual(f.runs.result(owner, r.id).rows, result.rows);
    const restarted = new RunService(f.store, f.driver, f.authorize);
    assert.equal(restarted.get(owner, r.id).resultState, 'reopenable');
    assert.equal('resultExpiresAt' in restarted.get(owner, r.id), false);
    assert.equal('expiresAt' in restarted.result(owner, r.id), false);
    assert.deepEqual(restarted.result(owner, r.id).rows, result.rows);
    assert.equal(f.calls.length, 1);
});
test('Legacy expired history preserves available rows and keeps missing rows unavailable', async () => {
    const f = fixture(),
        r = f.runs.submit(owner, f.request());
    const done = await f.runs.wait(owner, r.id),
        result = f.runs.result(owner, r.id);
    f.store.put('runs', r.id, { ...done, resultState: 'expired' });
    f.store.put('runs', 'missing', { ...done, id: 'missing', resultState: 'expired' });
    f.store.put('runs', 'missing-reopenable', {
        ...done,
        id: 'missing-reopenable',
        resultState: 'reopenable',
    });
    const restarted = new RunService(f.store, f.driver, f.authorize);
    assert.equal(restarted.get(owner, r.id).resultState, 'reopenable');
    assert.deepEqual(restarted.result(owner, r.id), result);
    const missing = restarted.get(owner, 'missing');
    assert.equal(missing.resultState, 'unavailable');
    assert.equal(restarted.get(owner, 'missing-reopenable').resultState, 'unavailable');
    assert.equal(missing.sql, done.sql);
    assert.equal(missing.queryId, done.queryId);
    assert.throws(() => restarted.result(owner, 'missing'), { code: 'RESULT_UNAVAILABLE' });
    f.store.delete('results', r.id);
    assert.throws(() => restarted.result(owner, r.id), { code: 'RESULT_UNAVAILABLE' });
    assert.equal(f.calls.length, 1);
});
test('Pagination never returns more than requested', async () => {
    const f = fixture(),
        r = f.runs.submit(owner, f.request());
    await f.runs.wait(owner, r.id);
    const page = f.runs.page(owner, r.id, 0, 1);
    assert.equal(page.rows.length, 1);
    assert.equal(page.nextOffset, 1);
    assert.equal(page.totalRows, 2);
});
test('Output row caps are explicit', () => {
    const r = boundResult(
        { columns, rows: [['1'], ['2']], truncated: false },
        { ...DEFAULT_LIMITS, rows: 1 },
    );
    assert.equal(r.rows.length, 1);
    assert.equal(r.truncated, true);
});
test('Output byte caps use UTF-8 bytes', () => {
    const limit = Buffer.byteLength(JSON.stringify(columns)) + 7;
    const r = boundResult(
        { columns, rows: [['éé'], ['x']], truncated: false },
        { ...DEFAULT_LIMITS, bytes: limit },
    );
    assert.equal(r.rows.length, 0);
    assert.equal(r.truncated, true);
});
test('Malformed row shapes are rejected', () =>
    assert.throws(
        () => boundResult({ columns, rows: [['1', '2']], truncated: false }, DEFAULT_LIMITS),
        { code: 'INVALID_RESULT' },
    ));
test('Partial scripts preserve each outcome, stop-on-error skips remainder', async () => {
    const f = fixture();
    const s = f.runs.submitScript(owner, f.request({ sql: 'SELECT 1; SELECT fail; SELECT 3' }));
    const done = await until(() => {
        const x = f.runs.getScript(owner, s.id);
        return x.status === 'running' ? false : x;
    });
    assert.equal(done.status, 'partial');
    assert.deepEqual(
        done.statements.map(s => s.status),
        ['succeeded', 'failed', 'skipped'],
    );
});

for (const sourceFrom of [undefined, 0, 37])
    test(`Script runs retain document offsets with selection base ${sourceFrom}`, async () => {
        const f = fixture();
        const sql = '  SELECT 1;\n SELECT 2;';
        const script = f.runs.submitScript(
            owner,
            f.request({
                sql,
                ...(sourceFrom === undefined
                    ? {}
                    : { sourceFrom, sourceTo: sourceFrom + sql.length }),
            }),
        );
        const done = await until(() => {
            const current = f.runs.getScript(owner, script.id);
            return current.status === 'running' ? false : current;
        });
        for (const statement of done.statements) {
            const run = f.runs.get(owner, statement.runId);
            assert.equal(sql.slice(statement.from, statement.to), statement.sql);
            assert.equal(run.sourceFrom, (sourceFrom ?? 0) + statement.from);
            assert.equal(run.sourceTo, (sourceFrom ?? 0) + statement.to);
        }
    });
test('Old scripts and receipts survive restart and the former script capacity', async () => {
    const f = fixture(),
        input = f.request({ sql: 'SELECT 1' }),
        script = f.runs.submitScript(owner, input);
    await until(() => f.runs.getScript(owner, script.id).status !== 'running');
    const done = f.runs.getScript(owner, script.id),
        old = '2000-01-01T00:00:00.000Z';
    f.store.put('scripts', script.id, { ...done, createdAt: old });
    const receiptKey = f.store
        .keys('receipts')
        .find(key => f.store.get('receipts', key).resourceId === script.id);
    f.store.put('receipts', receiptKey, { ...f.store.get('receipts', receiptKey), at: old });
    for (let i = 0; i < 200; i++)
        f.store.put('scripts', `saved-${i}`, { ...done, id: `saved-${i}`, createdAt: old });
    const restarted = new RunService(f.store, f.driver, f.authorize);
    assert.equal(restarted.submitScript(owner, input).id, script.id);
    const next = restarted.submitScript(owner, f.request({ sql: 'SELECT 2' }));
    await until(() => restarted.getScript(owner, next.id).status !== 'running');
    assert.equal(f.store.count('scripts'), 202);
    assert.ok(f.store.get('receipts', receiptKey));
    assert.equal(f.calls.length, 2);
});
test('Continue-on-error scripts do not hide a failed statement', async () => {
    const f = fixture();
    const s = f.runs.submitScript(
        owner,
        f.request({ sql: 'SELECT 1; SELECT fail; SELECT 3' }),
        false,
    );
    const done = await until(() => {
        const x = f.runs.getScript(owner, s.id);
        return x.status === 'running' ? false : x;
    });
    assert.equal(done.status, 'partial');
    assert.deepEqual(
        done.statements.map(s => s.status),
        ['succeeded', 'failed', 'succeeded'],
    );
});
test('All script statements are guarded before the first executes', () => {
    const f = fixture();
    assert.throws(() => f.runs.submitScript(owner, f.request({ sql: 'SELECT 1; DROP TABLE t' })));
    assert.equal(f.calls.length, 0);
});
test('Cancellation applies to the active script and skips remaining statements', async () => {
    const f = fixture({ delay: 500 });
    const s = f.runs.submitScript(owner, f.request({ sql: 'SELECT 1; SELECT 2' }));
    await until(() => f.calls.length);
    await f.runs.cancelScript(owner, s.id);
    const done = await until(() => {
        const x = f.runs.getScript(owner, s.id);
        return x.status === 'running' ? false : x;
    });
    assert.equal(done.status, 'cancelled');
    assert.equal(f.calls.length, 1);
});
test('Restart marks active runs interrupted, never replays', async () => {
    const f = fixture({ delay: 100 }),
        r = f.runs.submit(owner, f.request());
    await until(() => f.calls.length);
    const restarted = new RunService(f.store, f.driver, f.authorize);
    assert.equal(restarted.get(owner, r.id).status, 'interrupted');
    assert.equal(f.calls.length, 1);
    await f.runs.close();
});
test('Ephemeral progress cannot outrank post-restart durable state', async () => {
    const f = fixture({ delay: 50 }),
        r = f.runs.submit(owner, f.request());
    let progressSequence;
    const close = f.runs.subscribe(owner, r.id, event => {
        if (event.type === 'progress') progressSequence = event.sequence;
    });
    await until(() => progressSequence !== undefined);
    const restarted = new RunService(f.store, f.driver, f.authorize);
    const interrupted = restarted.get(owner, r.id);
    assert.equal(interrupted.status, 'interrupted');
    assert.ok(interrupted.sequence > progressSequence);
    close();
    await sleep(60);
    await f.runs.close();
    await restarted.close();
});
test('Deleting history does not release the idempotency reservation', async () => {
    const f = fixture(),
        input = f.request(),
        r = f.runs.submit(owner, input);
    await f.runs.wait(owner, r.id);
    f.runs.remove(owner, r.id);
    assert.throws(() => f.runs.submit(owner, input), { code: 'RETIRED_REQUEST' });
});
test('Old deleted-run receipts still prevent replay after restart', async () => {
    const f = fixture(),
        input = f.request(),
        run = f.runs.submit(owner, input);
    await f.runs.wait(owner, run.id);
    f.runs.remove(owner, run.id);
    const receiptKey = f.store.keys('receipts')[0];
    f.store.put('receipts', receiptKey, {
        ...f.store.get('receipts', receiptKey),
        at: '2000-01-01T00:00:00.000Z',
    });
    const restarted = new RunService(f.store, f.driver, f.authorize);
    assert.ok(f.store.get('receipts', receiptKey));
    assert.throws(() => restarted.submit(owner, input), { code: 'RETIRED_REQUEST' });
    assert.equal(f.calls.length, 1);
});
test('Child runs cannot cross connection boundaries', async () => {
    const f = fixture(),
        r = f.runs.submit(owner, f.request());
    await f.runs.wait(owner, r.id);
    f.runs.trust(owner, 'second', true);
    assert.throws(
        () => f.runs.submit(owner, f.request({ connectionId: 'second', parentRunId: r.id })),
        { code: 'CONNECTION_MISMATCH' },
    );
});
