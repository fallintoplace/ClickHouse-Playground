import test from 'node:test';
import assert from 'node:assert/strict';
import cloudApi from '../../api/cloud.js';
import * as cloud from '../../src/frontend/database/connections/cloud-connection.js';
import { BrowserWorkspaceApi } from '../../src/frontend/api/browser-workspace-api.js';
import { jsonRecord, jsonValue, responseErrorCode, stringValue } from '../helpers/type-guards.js';
import { cloudConnectionTest } from '../helpers/cloud-fixtures.js';
import {
    SQL_FUNCTION_TEMPLATES,
    createSqlFunctionQuery,
} from '../../src/shared/database/functions/sql-functions.js';

const credentials = {
    host: 'service.clickhouse.cloud:8443',
    database: 'default',
    username: 'reader',
    password: 'fixture-password',
};
const tested = cloudConnectionTest();
const result: cloud.CloudQueryResult = {
    queryId: 'query-id',
    columns: [],
    rows: [],
    elapsedMs: 1,
    bytes: 0,
    truncated: false,
};
const importJob: cloud.CloudImportJob = {
    id: 'import-id',
    connectionId: 'clickhouse-cloud',
    table: 'default.events',
    queryId: 'import-id',
    rows: 2,
    createdAt: '2026-10-10T12:00:00Z',
    status: 'succeeded',
};
const metadata = {
    database: 'default',
    observedAt: '2026-10-10T12:00:00Z',
    source: 'clickhouse',
    notes: [],
    truncated: false,
} as const;
const responses: Record<string, unknown> = {
    functions: {
        functions: [],
        canCreate: false,
        createReason: 'CREATE FUNCTION privilege is required.',
        canDrop: false,
        dropReason: 'DROP FUNCTION privilege is required.',
    },
    'create-function': {
        ...SQL_FUNCTION_TEMPLATES[0],
        createQuery: createSqlFunctionQuery(SQL_FUNCTION_TEMPLATES[0]!),
    },
    'drop-function': { name: 'udf_array_remove_at' },
    test: tested,
    run: result,
    schema: {
        connectionId: 'clickhouse-cloud',
        fetchedAt: '2026-10-10T12:00:00Z',
        tables: [],
        columns: [],
        warnings: [],
        truncated: false,
    } satisfies Awaited<ReturnType<typeof cloud.loadClickHouseCloudSchema>>,
    'query-tree': [],
    progress: {},
    cancel: { cancelled: true, queryId: 'query-id' },
    profile: [],
    pipeline: [],
    flamegraph: {
        queryId: 'query-id',
        series: {},
        samples: { CPU: 0, Real: 0 },
        symbolizedSamples: 0,
        truncated: false,
    } satisfies Awaited<ReturnType<typeof cloud.loadClickHouseCloudFlamegraph>>,
    'documentation-search': [],
    'documentation-entry': {
        name: 'sum',
        type: 'Function',
        description: 'Sum of the values.',
        serverVersion: '25.1',
        origin: 'native',
    } satisfies Awaited<ReturnType<typeof cloud.loadClickHouseCloudDocumentationEntry>>,
    'table-parts': {
        database: 'default',
        table: 'events',
        parts: [],
        totalParts: '0',
        activeParts: '0',
        inactiveParts: '0',
        truncated: false,
        measuredAt: '2026-10-10T12:00:00Z',
        totals: { rows: '0', marks: '0', compressedBytes: '0', uncompressedBytes: '0' },
    } satisfies Awaited<ReturnType<typeof cloud.loadClickHouseCloudTableParts>>,
    'table-permissions': { create: true, insert: true, drop: true },
    'create-table': {
        database: 'default',
        table: 'events',
        columns: [{ name: 'value', type: 'String' }],
        orderBy: 'tuple()',
        queryId: 'query-id',
    } satisfies Awaited<ReturnType<typeof cloud.createClickHouseCloudTable>>,
    'drop-table': { database: 'default', table: 'events', queryId: 'query-id' },
    'drop-database': { database: 'analytics', queryId: 'drop-id' },
    'import-status': importJob,
    workload: {
        connectionId: 'clickhouse-cloud',
        minutes: 60,
        scope: 'local-user',
        queryLogSource: 'query_log',
        families: [],
        points: [],
        truncated: false,
    } satisfies Awaited<ReturnType<typeof cloud.loadClickHouseCloudWorkload>>,
    replication: {
        connectionId: 'clickhouse-cloud',
        scope: 'local-node',
        capabilities: { replicas: true, queue: true },
        replicas: [],
        queue: [],
        truncated: false,
    } satisfies Awaited<ReturnType<typeof cloud.loadClickHouseCloudReplication>>,
};

function responseFor(body: Record<string, unknown>): unknown {
    if (body.action === 'native-explorer') {
        if (body.kind === 'lineage') return { ...metadata, kind: 'lineage', nodes: [], edges: [] };
        return { ...metadata, kind: body.kind, table: body.table, items: [] };
    }
    const action = stringValue(body.action, 'Cloud action');
    assert.ok(Object.hasOwn(responses, action), `Missing fixture for ${action}`);
    return responses[action];
}

test('Browser Cloud workspace forwards table permission targets and returns individual rights', async t => {
    const requests: Record<string, unknown>[] = [];
    const permissions = { create: false, insert: true, drop: false };
    t.mock.method(globalThis, 'fetch', async (_url: unknown, options?: RequestInit) => {
        const body = jsonRecord(jsonValue(String(options?.body)), 'Cloud request body');
        requests.push(body);
        return Response.json(body.action === 'test' ? tested : permissions);
    });
    t.after(() => cloud.disconnectClickHouseCloud());
    await cloud.connectClickHouseCloud(credentials);
    const api = new BrowserWorkspaceApi();
    assert.deepEqual(
        await api.request('/connections/clickhouse-cloud/table-permissions', {
            method: 'POST',
            body: { database: 'analytics', table: 'events' },
        }),
        permissions,
    );
    assert.deepEqual(requests[1], {
        action: 'table-permissions',
        credentials,
        database: 'analytics',
        table: 'events',
    });
});

test('Cloud wrappers preserve action spellings and their JSON request fields', async t => {
    const requests: unknown[] = [];
    t.mock.method(globalThis, 'fetch', async (_url: unknown, options?: RequestInit) => {
        const body = jsonRecord(jsonValue(String(options?.body)), 'Cloud request body');
        requests.push(body);
        assert.equal(options?.method, 'POST');
        assert.equal(options?.credentials, 'same-origin');
        return Response.json(responseFor(body));
    });
    t.after(() => cloud.disconnectClickHouseCloud());
    await cloud.connectClickHouseCloud(credentials);
    await cloud.runClickHouseCloudSql('SELECT {value:String}', 'session-id', {
        queryId: 'query-id',
        parameters: { value: 'x' },
    });
    await cloud.loadClickHouseCloudSchema({ tableOffset: 1000 });
    await cloud.loadClickHouseCloudQueryTree('SELECT 1', {});
    await cloud.loadClickHouseCloudProgress('query-id');
    await cloud.cancelClickHouseCloudQuery('query-id');
    await cloud.loadClickHouseCloudProfileEvidence('query-id');
    await cloud.loadClickHouseCloudPipeline('SELECT 1', {});
    await cloud.loadClickHouseCloudFlamegraph(
        'query-id',
        '2026-10-10T12:00:00Z',
        '2026-10-10T12:01:00Z',
    );
    await cloud.searchClickHouseCloudDocumentation('sum', 'functions');
    await cloud.loadClickHouseCloudDocumentationEntry('sum', 'Function');
    await cloud.loadClickHouseCloudNativeExplorer(
        { kind: 'lineage', database: 'default' },
        new AbortController().signal,
    );
    await cloud.loadClickHouseCloudNativeExplorer(
        { kind: 'mutations', database: 'default', table: 'events' },
        new AbortController().signal,
    );
    await cloud.loadClickHouseCloudTableParts('default', 'events', new AbortController().signal);
    await cloud.loadClickHouseCloudTablePermissions('default', 'events');
    await cloud.createClickHouseCloudTable({
        database: 'default',
        name: 'events',
        columns: [{ name: 'value', type: 'String' }],
        orderBy: 'tuple()',
    });
    await cloud.dropClickHouseCloudTable('default', 'events', 'events');
    await cloud.dropClickHouseCloudDatabase('analytics', 'analytics');
    await cloud.checkClickHouseCloudImport('import-id', 'default.events', 2, 'deduplication-token');
    await cloud.loadClickHouseCloudWorkload(60, new AbortController().signal);
    await cloud.loadClickHouseCloudReplication(new AbortController().signal);

    const expected = [
        { action: 'test' },
        {
            action: 'run',
            sql: 'SELECT {value:String}',
            sessionId: 'session-id',
            queryId: 'query-id',
            parameters: { value: 'x' },
        },
        { action: 'schema', tableOffset: 1000 },
        { action: 'query-tree', sql: 'SELECT 1', parameters: {} },
        { action: 'progress', queryId: 'query-id' },
        { action: 'cancel', queryId: 'query-id' },
        { action: 'profile', queryId: 'query-id', source: 'query_log' },
        { action: 'pipeline', sql: 'SELECT 1', parameters: {} },
        {
            action: 'flamegraph',
            queryId: 'query-id',
            startDate: '2026-10-10',
            endDate: '2026-10-10',
            source: 'symbolized',
        },
        { action: 'documentation-search', query: 'sum', category: 'functions' },
        { action: 'documentation-entry', name: 'sum', type: 'Function', serverVersion: '25.1' },
        { action: 'native-explorer', kind: 'lineage', database: 'default' },
        { action: 'native-explorer', kind: 'mutations', database: 'default', table: 'events' },
        { action: 'table-parts', database: 'default', table: 'events' },
        { action: 'table-permissions', database: 'default', table: 'events' },
        {
            action: 'create-table',
            database: 'default',
            name: 'events',
            columns: [{ name: 'value', type: 'String' }],
            orderBy: 'tuple()',
        },
        { action: 'drop-table', database: 'default', table: 'events', confirmation: 'events' },
        { action: 'drop-database', database: 'analytics', confirmation: 'analytics' },
        {
            action: 'import-status',
            queryId: 'import-id',
            table: 'default.events',
            rows: 2,
            deduplicationToken: 'deduplication-token',
        },
        { action: 'workload', minutes: 60, source: 'query_log' },
        { action: 'replication' },
    ];
    assert.deepEqual(
        requests,
        expected.map(body => ({ ...body, credentials })),
    );
});

test('Local Cloud sessions continue to omit credentials from JSON and multipart requests', async t => {
    const requests: Array<{ url: unknown; options?: RequestInit }> = [];
    t.mock.method(globalThis, 'fetch', async (url: unknown, options?: RequestInit) => {
        requests.push({ url, options });
        if (options?.method === 'DELETE') return new Response(null, { status: 204 });
        if (String(url).endsWith('/cloud/session')) return Response.json(tested);
        if (options?.body instanceof FormData) return Response.json(importJob);
        return Response.json(
            responseFor(jsonRecord(jsonValue(String(options?.body)), 'Cloud request body')),
        );
    });
    t.after(() => cloud.disconnectClickHouseCloud());
    await cloud.connectClickHouseCloud(credentials, true);
    await cloud.runClickHouseCloudSql('SELECT 1');
    await cloud.loadClickHouseCloudTablePermissions('default');
    await cloud.importClickHouseCloudFile({
        file: new File(['value\nx'], 'rows.csv'),
        format: 'csv',
        target: 'default.events',
        fields: { value: 'value' },
        queryId: 'import-id',
    });
    assert.deepEqual(JSON.parse(String(requests[0]?.options?.body)), { credentials });
    assert.deepEqual(JSON.parse(String(requests[1]?.options?.body)), {
        action: 'run',
        sql: 'SELECT 1',
    });
    assert.deepEqual(JSON.parse(String(requests[2]?.options?.body)), {
        action: 'table-permissions',
        database: 'default',
    });
    const form = requests[3]?.options?.body;
    assert.ok(form instanceof FormData);
    assert.equal(form.get('action'), 'import-commit');
    assert.equal(form.has('credentials'), false);
    assert.equal(form.get('format'), 'csv');
    assert.equal(form.get('target'), 'default.events');
    assert.equal(form.get('queryId'), 'import-id');
    assert.equal(form.get('fields'), '{"value":"value"}');
    const file = form.get('file');
    assert.ok(file instanceof File);
    assert.equal(file.name, 'rows.csv');
    assert.equal(await file.text(), 'value\nx');
    await cloud.loadClickHouseCloudFunctions();
    await cloud.createClickHouseCloudFunction(SQL_FUNCTION_TEMPLATES[0]!);
    await cloud.dropClickHouseCloudFunction('udf_array_remove_at', 'udf_array_remove_at');
    for (const request of requests.slice(4)) {
        const body = jsonRecord(jsonValue(String(request.options?.body)), 'Function request');
        assert.equal(Object.hasOwn(body, 'credentials'), false);
    }
});

test('Cloud function discovery and structured creation use guarded Cloud actions', async t => {
    const requests: Record<string, unknown>[] = [];
    t.mock.method(globalThis, 'fetch', async (_url: unknown, options?: RequestInit) => {
        const body = jsonRecord(jsonValue(String(options?.body)), 'Cloud function request');
        requests.push(body);
        return Response.json(responseFor(body));
    });
    t.after(() => cloud.disconnectClickHouseCloud());
    await cloud.connectClickHouseCloud(credentials);
    const api = new BrowserWorkspaceApi();
    assert.deepEqual(
        await api.request('/connections/clickhouse-cloud/functions'),
        responses.functions,
    );
    const template = SQL_FUNCTION_TEMPLATES[0]!;
    const input = {
        name: template.name,
        parameters: template.parameters,
        expression: template.expression,
    };
    const fn = await cloud.createClickHouseCloudFunction(input);
    assert.equal(fn.name, 'udf_array_remove_at');
    assert.deepEqual(await cloud.dropClickHouseCloudFunction(fn.name, fn.name), { name: fn.name });
    assert.deepEqual(requests[1], { action: 'functions', credentials });
    assert.deepEqual(requests[2], { action: 'create-function', credentials, ...input });
    assert.deepEqual(requests[3], {
        action: 'drop-function',
        credentials,
        name: fn.name,
        confirmation: fn.name,
    });
});

test('Unknown Cloud JSON actions keep their error and credential validation precedence', async () => {
    const request = (body: unknown) =>
        new Request('http://localhost/api/cloud', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
    for (const action of [
        'unknown',
        'constructor',
        'toString',
        '__proto__',
        'import-commit',
        null,
        1,
    ]) {
        const response = await cloudApi.fetch(request({ action, credentials }));
        assert.equal(response.status, 400);
        assert.equal(await responseErrorCode(response), 'CLOUD_ACTION');
    }
    const response = await cloudApi.fetch(request({ action: 'unknown' }));
    assert.equal(await responseErrorCode(response), 'CLOUD_CREDENTIALS');
});
