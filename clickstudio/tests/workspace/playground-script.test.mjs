import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { BrowserWorkspaceApi } from '../../.workspace-build/src/frontend/api/browser-workspace-api.js';
import {
    MAX_SCRIPT_STATEMENTS,
    MAX_SQL_CHARS,
} from '../../.workspace-build/src/shared/queries/execution/limits.js';

function browserStorage(t) {
    const values = new Map();
    const listeners = new Map();
    for (const [key, value] of Object.entries({
        window: {
            setTimeout,
            clearTimeout,
            addEventListener: (event, listener) => listeners.set(event, listener),
        },
        localStorage: {
            getItem: key => values.get(key) ?? null,
            setItem: (key, value) => values.set(key, value),
            removeItem: key => values.delete(key),
        },
    })) {
        const previous = Object.getOwnPropertyDescriptor(globalThis, key);
        Object.defineProperty(globalThis, key, { configurable: true, value });
        t.after(() => {
            if (previous) Object.defineProperty(globalThis, key, previous);
            else delete globalThis[key];
        });
    }
    return listeners;
}

function rows(value, count = 1) {
    return new Response(
        [
            '["value"]',
            '["String"]',
            ...Array.from({ length: count }, () => JSON.stringify([value])),
        ].join('\n') + '\n',
        { headers: { 'content-type': 'text/plain' } },
    );
}

function deferred() {
    let resolve;
    const promise = new Promise(done => {
        resolve = done;
    });
    return { promise, resolve };
}

async function until(condition) {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
        if (await condition()) return;
        await setImmediate();
    }
    assert.fail('The script did not reach the expected state.');
}

async function finished(api, id) {
    let script;
    await until(async () => {
        script = await api.request(`/scripts/${id}`);
        return script.status !== 'running';
    });
    return script;
}

function submit(api, sql, extra = {}) {
    return api.request('/scripts', {
        method: 'POST',
        body: { connectionId: 'playground', sql, ...extra },
    });
}

test('Playground scripts await each response and retain independent results and source ranges', async t => {
    browserStorage(t);
    const requests = [];
    const gates = [deferred(), deferred(), deferred()];
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        const index = requests.length;
        requests.push({ sql: init.body, queryId: new URL(url).searchParams.get('query_id') });
        await gates[index].promise;
        return rows(String(index + 1));
    });
    const api = new BrowserWorkspaceApi();
    const sql = "SELECT '👋;value';\n-- ; remains a comment\nSELECT 2; SELECT 3";
    const script = await submit(api, sql, { sourceFrom: 27, sourceTo: 27 + sql.length });
    assert.equal(script.connectionId, 'playground');
    assert.equal(script.status, 'running');
    await until(() => requests.length === 1);
    assert.deepEqual(
        (await api.request(`/scripts/${script.id}`)).statements.map(item => item.status),
        ['running', 'pending', 'pending'],
    );
    for (let index = 0; index < gates.length; index++) {
        assert.equal(requests.length, index + 1);
        gates[index].resolve();
        if (index < gates.length - 1) await until(() => requests.length === index + 2);
    }
    const complete = await finished(api, script.id);
    assert.equal(complete.status, 'succeeded');
    assert.equal(new Set(complete.statements.map(item => item.runId)).size, 3);
    for (const [index, statement] of complete.statements.entries()) {
        assert.ok(requests[index].sql.startsWith(statement.sql));
        const run = await api.request(`/runs/${statement.runId}`);
        assert.equal(run.queryId, requests[index].queryId);
        assert.equal(run.connectionId, 'playground');
        assert.equal(run.sourceFrom, 27 + statement.from);
        assert.equal(run.sourceTo, 27 + statement.to);
        assert.equal(run.permissionSnapshot.readonly, true);
        assert.equal(run.retryPolicy, 'never');
        assert.equal(run.limits.rows, 1_000);
        assert.equal(run.limits.seconds, 60);
        assert.deepEqual((await api.request(`/runs/${run.id}/result`)).rows, [[String(index + 1)]]);
    }
});

for (const count of [1, 2, 5, MAX_SCRIPT_STATEMENTS]) {
    test(`Playground scripts support ${count} statements without a special three-query path`, async t => {
        browserStorage(t);
        const fetch = t.mock.method(globalThis, 'fetch', async () => rows('value'));
        const api = new BrowserWorkspaceApi();
        const script = await submit(
            api,
            Array.from({ length: count }, (_, index) => `SELECT ${index};`).join('\n'),
        );
        assert.equal((await finished(api, script.id)).status, 'succeeded');
        assert.equal(fetch.mock.callCount(), count);
    });
}

test('Playground validates the entire script before sending any statement', async t => {
    browserStorage(t);
    const fetch = t.mock.method(globalThis, 'fetch', async () => rows('unexpected'));
    const api = new BrowserWorkspaceApi();
    for (const [sql, extra] of [
        ['SELECT 1; INSERT INTO events VALUES (1)', {}],
        ['SELECT 1; SELECT 2 FORMAT JSONEachRow', {}],
        ["SELECT 1; SELECT 'unfinished", {}],
        ['', {}],
        ['-- only a comment', {}],
        ['SELECT 1', { parameters: { n: '1' } }],
        ['SELECT 1', { parameters: { n: 1 } }],
        ['SELECT 1', { kind: 'explain' }],
        ['SELECT 1'.repeat(MAX_SQL_CHARS), {}],
        [Array.from({ length: MAX_SCRIPT_STATEMENTS + 1 }, () => 'SELECT 1;').join('\n'), {}],
    ])
        await assert.rejects(submit(api, sql, extra));
    assert.equal(fetch.mock.callCount(), 0);
});

for (const stopOnError of [true, false]) {
    test(`Playground retains a failed statement and ${stopOnError ? 'skips' : 'continues with'} later statements`, async t => {
        browserStorage(t);
        const queryIds = [];
        const fetch = t.mock.method(globalThis, 'fetch', async (url, init) => {
            queryIds.push(new URL(url).searchParams.get('query_id'));
            return init.body.startsWith('SELECT missing')
                ? new Response(
                      'Code: 47. DB::Exception: Unknown identifier missing. (UNKNOWN_IDENTIFIER)',
                      {
                          status: 404,
                      },
                  )
                : rows('ok');
        });
        const api = new BrowserWorkspaceApi();
        const script = await submit(api, 'SELECT 1; SELECT missing; SELECT 3', { stopOnError });
        const complete = await finished(api, script.id);
        assert.equal(complete.status, 'partial');
        assert.deepEqual(
            complete.statements.map(item => item.status),
            ['succeeded', 'failed', stopOnError ? 'skipped' : 'succeeded'],
        );
        assert.equal(fetch.mock.callCount(), stopOnError ? 2 : 3);
        const run = await api.request(`/runs/${complete.statements[1].runId}`);
        assert.equal(run.queryId, queryIds[1]);
        assert.equal(run.error.code, 'CLICKHOUSE_47');
        assert.equal(run.sql, 'SELECT missing');
        assert.equal(run.resultState, 'unavailable');
    });
}

test('Playground cancellation closes the active request and never sends pending statements', async t => {
    browserStorage(t);
    let aborted = false;
    const fetch = t.mock.method(
        globalThis,
        'fetch',
        async (_url, init) =>
            new Promise((_resolve, reject) => {
                init.signal.addEventListener(
                    'abort',
                    () => {
                        aborted = true;
                        reject(new Error('request aborted'));
                    },
                    { once: true },
                );
            }),
    );
    const api = new BrowserWorkspaceApi();
    const script = await submit(api, 'SELECT 1; SELECT 2; SELECT 3');
    await until(() => fetch.mock.callCount() === 1);
    await api.request(`/scripts/${script.id}/cancel`, { method: 'POST' });
    const complete = await finished(api, script.id);
    assert.equal(aborted, true);
    assert.equal(fetch.mock.callCount(), 1);
    assert.deepEqual(
        complete.statements.map(item => item.status),
        ['cancelled', 'skipped', 'skipped'],
    );
    const run = await api.request(`/runs/${complete.statements[0].runId}`);
    assert.equal(run.status, 'cancelled');
    assert.match(run.warnings.join(' '), /may still finish/);
    assert.deepEqual(
        await api.request(`/scripts/${script.id}/cancel`, { method: 'POST' }),
        complete,
    );
});

test('Reloading an unfinished Playground script interrupts it without replaying requests', async t => {
    browserStorage(t);
    const gate = deferred();
    const fetch = t.mock.method(globalThis, 'fetch', async () => {
        await gate.promise;
        return rows('1');
    });
    const api = new BrowserWorkspaceApi();
    const script = await submit(api, 'SELECT 1; SELECT 2');
    await until(() => fetch.mock.callCount() === 1);
    const reopened = new BrowserWorkspaceApi();
    const interrupted = await reopened.request(`/scripts/${script.id}`);
    assert.equal(interrupted.status, 'interrupted');
    assert.deepEqual(
        interrupted.statements.map(item => item.status),
        ['interrupted', 'skipped'],
    );
    assert.equal(fetch.mock.callCount(), 1);
    await api.request(`/scripts/${script.id}/cancel`, { method: 'POST' });
    gate.resolve();
    await finished(api, script.id);
});

test('A truncated Playground result is retained and the next statement still runs', async t => {
    browserStorage(t);
    let index = 0;
    t.mock.method(globalThis, 'fetch', async () => rows(String(++index), index === 1 ? 1_000 : 1));
    const api = new BrowserWorkspaceApi();
    const script = await submit(api, 'SELECT 1; SELECT 2');
    const complete = await finished(api, script.id);
    assert.equal(complete.status, 'succeeded');
    assert.deepEqual(
        complete.statements.map(item => item.status),
        ['truncated', 'succeeded'],
    );
    const result = await api.request(`/runs/${complete.statements[0].runId}/snapshot`);
    assert.equal(result.completeness, 'truncated');
    assert.equal(result.rows.length, 1_000);
});

test('Playground request timeouts retain a timed-out statement without retrying or running later queries', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    browserStorage(t);
    const fetch = t.mock.method(
        globalThis,
        'fetch',
        async (_url, init) =>
            new Promise((_resolve, reject) => {
                init.signal.addEventListener('abort', () => reject(new Error('Request aborted')), {
                    once: true,
                });
            }),
    );
    const api = new BrowserWorkspaceApi();
    const script = await submit(api, 'SELECT 1; SELECT 2');
    await until(() => fetch.mock.callCount() === 1);
    t.mock.timers.tick(65_000);
    const complete = await finished(api, script.id);
    assert.equal(complete.status, 'failed');
    assert.deepEqual(
        complete.statements.map(item => item.status),
        ['timed_out', 'skipped'],
    );
    const run = await api.request(`/runs/${complete.statements[0].runId}`);
    assert.equal(run.status, 'timed_out');
    assert.equal(run.error.code, 'PLAYGROUND_TIMEOUT');
    assert.equal(fetch.mock.callCount(), 1);
});

for (const outcome of ['success', 'failure']) {
    test(`Unloading a Playground script preserves interruption after a late ${outcome}`, async t => {
        const listeners = browserStorage(t);
        const gate = deferred();
        const fetch = t.mock.method(globalThis, 'fetch', async () => {
            await gate.promise;
            return outcome === 'success'
                ? rows('1')
                : new Response(
                      'Code: 47. DB::Exception: Unknown identifier. (UNKNOWN_IDENTIFIER)',
                      { status: 404 },
                  );
        });
        const api = new BrowserWorkspaceApi();
        const script = await submit(api, 'SELECT 1; SELECT 2');
        await until(() => fetch.mock.callCount() === 1);
        listeners.get('pagehide')();
        gate.resolve();
        await setImmediate();
        const complete = await api.request(`/scripts/${script.id}`);
        assert.equal(complete.status, 'interrupted');
        assert.deepEqual(
            complete.statements.map(item => item.status),
            ['interrupted', 'skipped'],
        );
        assert.equal(fetch.mock.callCount(), 1);
        assert.equal(complete.statements[0].runId, undefined);
    });
}

test('Leaving an idle browser API does not overwrite newer retained data', async t => {
    const listeners = browserStorage(t);
    new BrowserWorkspaceApi();
    const key = 'clickstudio:vercel-preview-database:v1';
    const database = JSON.parse(localStorage.getItem(key));
    database.runs.push({ ...database.runs[0], id: 'another-tab-run' });
    const updated = JSON.stringify(database);
    localStorage.setItem(key, updated);
    listeners.get('pagehide')();
    assert.equal(localStorage.getItem(key), updated);
    const reopened = new BrowserWorkspaceApi();
    assert.equal((await reopened.request('/runs/another-tab-run')).id, 'another-tab-run');
});
