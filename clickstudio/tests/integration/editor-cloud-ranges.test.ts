import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import * as cloud from '../../src/frontend/database/connections/cloud-connection.js';
import { BrowserWorkspaceApi } from '../../src/frontend/api/browser-workspace.js';
import { isRun, isScript } from '../../src/frontend/queries/execution/events.js';
import { decodeValue, jsonRecord, jsonValue } from '../helpers/type-guards.js';

const credentials = {
    host: 'service.clickhouse.cloud:8443',
    database: 'default',
    username: 'reader',
    password: 'fixture-password',
};
const tested = {
    host: credentials.host,
    serverVersion: '25.1',
    queryLogSource: 'query_log',
    traceLogSource: 'symbolized',
};
const result = {
    columns: [{ name: 'value', type: 'UInt64' }],
    rows: [['1']],
    queryId: 'range-test',
    elapsedMs: 1,
    bytes: 1,
    truncated: false,
};

test('Browser Cloud failed queries retain selected document offsets', async t => {
    t.mock.method(globalThis, 'fetch', async (_url: unknown, options?: RequestInit) => {
        const body = jsonRecord(jsonValue(String(options?.body)), 'Cloud request body');
        return body.action === 'test'
            ? Response.json(tested)
            : Response.json(
                  { error: { code: 'CLICKHOUSE_46', message: 'Unknown function missing' } },
                  { status: 400 },
              );
    });
    t.after(() => cloud.disconnectClickHouseCloud());
    await cloud.connectClickHouseCloud(credentials);
    const api = new BrowserWorkspaceApi();
    const created = decodeValue(
        await api.request('/runs', {
            method: 'POST',
            body: {
                connectionId: 'clickhouse-cloud',
                sql: 'SELECT missing()',
                sourceFrom: 25,
                sourceTo: 41,
            },
        }),
        isRun,
        'Run response',
    );
    let run = created;
    for (let attempt = 0; run.status === 'running' && attempt < 100; attempt++) {
        await sleep(1);
        run = decodeValue(await api.request(`/runs/${created.id}`), isRun, 'Run response');
    }
    assert.equal(run.status, 'failed');
    assert.equal(run.sourceFrom, 25);
    assert.equal(run.sourceTo, 41);
});

test('Browser Cloud scripts keep script-local statement spans and document-relative run spans', async t => {
    t.mock.method(globalThis, 'fetch', async (_url: unknown, options?: RequestInit) => {
        const body = jsonRecord(jsonValue(String(options?.body)), 'Cloud request body');
        if (body.action === 'test') return Response.json(tested);
        assert.match(
            typeof body.queryId === 'string' ? body.queryId : '',
            /^clickstudio-run-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i,
        );
        return Response.json({ ...result, queryId: body.queryId });
    });
    t.after(() => cloud.disconnectClickHouseCloud());
    await cloud.connectClickHouseCloud(credentials);
    const api = new BrowserWorkspaceApi();
    const sql = '  SELECT 1;\n SELECT 2;';
    const created = decodeValue(
        await api.request('/scripts', {
            method: 'POST',
            body: {
                connectionId: 'clickhouse-cloud',
                sql,
                sourceFrom: 35,
                sourceTo: 35 + sql.length,
            },
        }),
        isScript,
        'Script response',
    );
    let script = created;
    for (let attempt = 0; script.status === 'running' && attempt < 100; attempt++) {
        await sleep(1);
        script = decodeValue(
            await api.request(`/scripts/${created.id}`),
            isScript,
            'Script response',
        );
    }
    assert.equal(script.status, 'succeeded');
    for (const statement of script.statements) {
        assert.equal(sql.slice(statement.from, statement.to), statement.sql);
        const run = decodeValue(
            await api.request(`/runs/${statement.runId}`),
            isRun,
            'Run response',
        );
        assert.equal(run.sourceFrom, 35 + statement.from);
        assert.equal(run.sourceTo, 35 + statement.to);
    }
});

test('Browser Cloud failed script statements retain a failed run with document-relative diagnostics', async t => {
    t.mock.method(globalThis, 'fetch', async (_url: unknown, options?: RequestInit) => {
        const body = jsonRecord(jsonValue(String(options?.body)), 'Cloud request body');
        if (body.action === 'test') return Response.json(tested);
        assert.match(
            typeof body.queryId === 'string' ? body.queryId : '',
            /^clickstudio-run-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i,
        );
        if (typeof body.sql === 'string' && body.sql.includes('missing()'))
            return Response.json(
                { error: { code: 'CLICKHOUSE_46', message: 'Unknown function missing' } },
                { status: 400 },
            );
        return Response.json(result);
    });
    t.after(() => cloud.disconnectClickHouseCloud());
    await cloud.connectClickHouseCloud(credentials);
    const api = new BrowserWorkspaceApi();
    const sql = 'SELECT 1; SELECT missing(); SELECT 3';
    const created = decodeValue(
        await api.request('/scripts', {
            method: 'POST',
            body: {
                connectionId: 'clickhouse-cloud',
                sql,
                sourceFrom: 40,
                sourceTo: 40 + sql.length,
            },
        }),
        isScript,
        'Script response',
    );
    let script = created;
    for (let attempt = 0; script.status === 'running' && attempt < 100; attempt++) {
        await sleep(1);
        script = decodeValue(
            await api.request(`/scripts/${created.id}`),
            isScript,
            'Script response',
        );
    }
    assert.equal(script.status, 'partial');
    assert.deepEqual(
        script.statements.map(statement => statement.status),
        ['succeeded', 'failed', 'skipped'],
    );
    const failed = script.statements[1]!;
    assert.ok(failed.runId);
    const run = decodeValue(await api.request(`/runs/${failed.runId}`), isRun, 'Run response');
    assert.equal(run.status, 'failed');
    assert.equal(run.queryId, `clickstudio-run-${run.id}`);
    assert.equal(run.resultState, 'unavailable');
    assert.equal(run.sourceFrom, 40 + failed.from);
    assert.equal(run.sourceTo, 40 + failed.to);
    assert.equal(run.error?.position, 40 + sql.indexOf('missing'));
});

for (const kind of ['explain', 'plan', 'pipeline', 'analyze'] as const)
    test(`Browser Cloud ${kind} runs store original SQL and normalize syntax locations`, async t => {
        let executedSql = '';
        t.mock.method(globalThis, 'fetch', async (_url: unknown, options?: RequestInit) => {
            const body = jsonRecord(jsonValue(String(options?.body)), 'Cloud request body');
            if (body.action === 'test') return Response.json(tested);
            executedSql = typeof body.sql === 'string' ? body.sql : '';
            return Response.json(
                { error: { code: 'CLICKHOUSE_62', message: 'Syntax error (line 2, col 8)' } },
                { status: 400 },
            );
        });
        t.after(() => cloud.disconnectClickHouseCloud());
        await cloud.connectClickHouseCloud(credentials);
        const api = new BrowserWorkspaceApi();
        const sql = 'SELECT bad';
        const created = decodeValue(
            await api.request('/runs', {
                method: 'POST',
                body: {
                    connectionId: 'clickhouse-cloud',
                    sql,
                    kind,
                    sourceFrom: 40,
                    sourceTo: 40 + sql.length,
                },
            }),
            isRun,
            'Run response',
        );
        let run = created;
        for (let attempt = 0; run.status === 'running' && attempt < 100; attempt++) {
            await sleep(1);
            run = decodeValue(await api.request(`/runs/${created.id}`), isRun, 'Run response');
        }
        assert.equal(run.status, 'failed');
        assert.equal(run.sql, sql);
        assert.equal(run.error?.position, 47);
        assert.match(executedSql, /^EXPLAIN /);
        assert.ok(executedSql.endsWith(`\n${sql}`));
    });
