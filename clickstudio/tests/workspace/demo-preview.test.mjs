import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BrowserWorkspaceApi,
    SavedQueryUnavailableError,
} from '../../.workspace-build/src/frontend/api/browser-workspace-api.js';
import { sqlExamplesFor } from '../../.workspace-build/src/frontend/help/examples/sql-examples.js';
import { prepareChartSelection } from '../../.workspace-build/src/frontend/queries/results/charts/controls/chart-selection.js';
import { prepareGeoFeatures } from '../../.workspace-build/src/frontend/queries/results/maps/geo.js';

test('Offline Geography examples return matching drawable geometry instead of daily activity', async () => {
    const api = new BrowserWorkspaceApi();
    const examples = sqlExamplesFor({ id: 'demo', dataSource: 'fixture' });
    for (const [id, type, count] of [
        ['clickhouse-geo-cities', 'Point', 20],
        ['clickhouse-geo-flight-routes', 'LineString', 8],
        ['nyc-taxi-after-dark', 'Polygon', 96],
    ]) {
        const example = examples.find(candidate => candidate.id === id);
        assert.equal(example.chart.kind, 'geography');
        const run = await api.request('/runs', {
            method: 'POST',
            body: { connectionId: 'demo', sql: example.sql },
        });
        const result = await api.request(`/runs/${run.id}/result?count=100`);
        assert.equal(run.rowCount, count, id);
        assert.equal(result.rows.length, count, id);
        assert.equal(result.columns[1].type, type, id);
        const selection = prepareChartSelection(result, example.chart);
        assert.ok(selection.geography, id);
        const prepared = prepareGeoFeatures(result.rows, result.columns, selection.geography);
        assert.equal(prepared.totalFeatures, count, id);
        assert.equal(prepared.invalidRows, 0, id);
        assert.ok(
            prepared.features.every(feature => feature.geometry.type === type),
            id,
        );
        assert.ok(
            prepared.features.every(feature => feature.label && feature.measure > 0),
            id,
        );
    }
});

test('Browser saved-query reads distinguish missing records from valid and trashed documents', async () => {
    const api = new BrowserWorkspaceApi();
    await assert.rejects(api.request('/documents/missing-document'), SavedQueryUnavailableError);
    const documents = await api.request('/documents?connectionId=demo');
    const document = documents[0];
    assert.deepEqual(await api.request(`/documents/${document.id}`), document);
    await api.request(`/documents/${document.id}`, { method: 'DELETE' });
    const trashed = await api.request(`/documents/${document.id}`);
    assert.equal(trashed.id, document.id);
    assert.ok(trashed.deletedAt);
});

test('Static preview scripts keep semicolons inside strings and comments', async () => {
    const api = new BrowserWorkspaceApi();
    const sql =
        "SELECT 'first;value' AS label;\n-- the ; here is a comment\nSELECT 2 /* and ; this is a block comment */";
    const script = await api.request('/scripts', { method: 'POST', body: { sql } });

    assert.equal(script.statements.length, 2);
    assert.deepEqual(
        script.statements.map(statement => statement.sql),
        [
            "SELECT 'first;value' AS label",
            '-- the ; here is a comment\nSELECT 2 /* and ; this is a block comment */',
        ],
    );
    for (const statement of script.statements)
        assert.equal(sql.slice(statement.from, statement.to), statement.sql);
});

test('Browser query endpoints accept omitted parameters and reject malformed maps', async () => {
    const api = new BrowserWorkspaceApi();
    const body = { connectionId: 'demo', sql: 'SELECT 1' };
    for (const path of ['/runs', '/scripts', '/connections/demo/query-tree']) {
        await assert.doesNotReject(api.request(path, { method: 'POST', body }));
        await assert.doesNotReject(
            api.request(path, { method: 'POST', body: { ...body, parameters: { value: '1' } } }),
        );
        for (const parameters of [42, 'value', [], { value: 1 }])
            await assert.rejects(
                api.request(path, { method: 'POST', body: { ...body, parameters } }),
                /Expected string values/,
            );
    }
});

test('New offline examples reopen with fixture rows matching their result columns', async () => {
    const api = new BrowserWorkspaceApi();
    const documents = await api.request('/documents?connectionId=demo');
    const byId = new Map(documents.map(document => [document.id, document]));
    const cases = [
        ['preview-starter-monthly-revenue', ['month', 'completed_orders', 'revenue']],
        [
            'preview-starter-channel-conversion',
            ['channel', 'sessions', 'conversions', 'conversion_rate_pct'],
        ],
        [
            'preview-starter-signup-cohorts',
            ['cohort_month', 'plan', 'new_users', 'average_lifetime_value'],
        ],
        [
            'preview-starter-product-page-conversion',
            ['page_path', 'page_views', 'purchasers', 'conversion_rate_pct'],
        ],
    ];

    for (const [id, expectedColumns] of cases) {
        const document = byId.get(id);
        assert.ok(document, `missing offline example ${id}`);
        assert.ok(document.runId, `${id} should retain a sample run`);
        const result = await api.request(`/runs/${document.runId}/result?count=100`);
        assert.deepEqual(
            result.columns.map(column => column.name),
            expectedColumns,
        );
        assert.ok(result.rows.length > 0, `${id} should have sample rows`);
    }
});

test('Sample EXPLAIN ANALYZE is retained as a fixture result and never evaluates submitted SQL', async () => {
    const api = new BrowserWorkspaceApi();
    const run = await api.request('/runs', {
        method: 'POST',
        body: { connectionId: 'demo', kind: 'analyze', sql: 'SELECT fixture_error()' },
    });
    assert.equal(run.kind, 'analyze');
    const result = await api.request(`/runs/${run.id}/result?count=10`);
    assert.match(result.rows[0][0], /Query summary:/);
    assert.match(run.warnings.join(' '), /do not evaluate the SQL/i);
});

test('Sample MergeTree parts are partitioned and unavailable for unknown tables', async () => {
    const api = new BrowserWorkspaceApi();
    const snapshot = await api.request('/connections/demo/table-parts', {
        method: 'POST',
        body: { database: 'demo', table: 'events' },
    });
    assert.equal(snapshot.database, 'demo');
    assert.equal(snapshot.table, 'events');
    assert.equal(snapshot.parts.length, 42);
    assert.equal(new Set(snapshot.parts.map(part => part.partition)).size, 6);
    assert.equal(snapshot.totalParts, '42');
    assert.equal(snapshot.activeParts, '36');
    assert.equal(snapshot.inactiveParts, '6');
    assert.equal(
        snapshot.parts.some(part => !part.active),
        true,
    );
    assert.ok(
        snapshot.parts.every(
            part => part.diskName === 'default' && part.minBlockNumber && part.maxBlockNumber,
        ),
    );
    assert.equal(snapshot.truncated, false);
    await assert.rejects(
        api.request('/connections/demo/table-parts', {
            method: 'POST',
            body: { database: 'demo', table: 'daily_rollup' },
        }),
    );
});

test('Static routing preserves method guards, decoded paths, and unknown-route fallbacks', async () => {
    const api = new BrowserWorkspaceApi();
    for (const [path, method] of [
        ['/connections/demo/trust', 'GET'],
        ['/connections/demo/table-parts', 'GET'],
        ['/connections/demo/native-explorer', 'GET'],
        ['/connections/demo/query-tree', 'GET'],
        ['/connections/unknown/schema', 'GET'],
        ['/connections/clickhouse-cloud/schema', 'POST'],
        ['/connections/clickhouse-cloud/documentation', 'POST'],
        ['/scripts', 'GET'],
        ['/runs', 'DELETE'],
        ['/documents/missing/unknown', 'GET'],
        ['/unknown', 'GET'],
        ['/%73ession', 'GET'],
    ])
        assert.deepEqual(await api.request(path, { method }), {}, `${method} ${path}`);
    assert.equal((await api.request('/session/', { method: 'DELETE' })).demo, true);
    assert.equal(
        (await api.request('/connections/demo/schema', { method: 'POST' })).connectionId,
        'demo',
    );
    assert.deepEqual(await api.request('/connections/demo/import-targets', { method: 'DELETE' }), [
        'demo.interview_imports',
    ]);
    assert.deepEqual(await api.request('/connections/playground/import-targets'), []);
    assert.equal((await api.request('/connections//%64emo/schema/')).connectionId, 'demo');
});

test('Static routing keeps trust and provider errors ahead of request validation', async () => {
    const api = new BrowserWorkspaceApi();
    await api.request('/connections/demo/trust', { method: 'POST', body: { trusted: false } });
    await assert.rejects(
        api.request('/connections/demo/native-explorer', {
            method: 'POST',
            body: {},
        }),
        /Trust this connection/,
    );
    await api.request('/connections/demo/trust', { method: 'POST', body: { trusted: true } });
    await assert.rejects(
        api.request('/connections/demo/native-explorer', {
            method: 'POST',
            body: {},
        }),
        /A database is required/,
    );
    await assert.rejects(api.request('/connections/demo/workload?minutes=99'), /minutes must be/);
    await assert.rejects(
        api.request('/connections/playground/workload'),
        /Observability system-table access/,
    );
    await assert.rejects(
        api.request('/connections/playground/query-tree', {
            method: 'POST',
            body: { sql: 'SELECT 1', parameters: { n: '1' } },
        }),
        /Remove query parameters/,
    );
    await assert.rejects(
        api.request('/connections/clickhouse-cloud/documentation/search'),
        /Reconnect to ClickHouse Cloud/,
    );
});

test('Cancelled static requests stop before changing documents or connection trust', async () => {
    const api = new BrowserWorkspaceApi();
    await api.request('/connections/demo/trust', { method: 'POST', body: { trusted: false } });
    const before = await api.request('/documents');
    const controller = new AbortController();
    const reason = new Error('Cancelled before dispatch');
    controller.abort(reason);
    for (const [path, body] of [
        ['/documents', { name: 'Cancelled document', sql: 'SELECT 2' }],
        ['/connections/demo/trust', { trusted: true }],
    ])
        await assert.rejects(
            api.request(path, {
                method: 'POST',
                body,
                signal: controller.signal,
            }),
            error => error === reason,
        );
    assert.deepEqual(await api.request('/documents'), before);
    assert.equal((await api.request('/connections'))[0].trusted, false);
});

test('Static saved versions preserve revision conflicts and trash restoration', async () => {
    const api = new BrowserWorkspaceApi();
    const first = await api.request('/documents', {
        method: 'POST',
        body: { name: 'Versioned', sql: 'SELECT 1', connectionId: 'demo' },
    });
    const second = await api.request(`/documents/${first.id}`, {
        method: 'PUT',
        body: {
            name: 'Versioned',
            sql: 'SELECT 2',
            connectionId: 'demo',
            baseRevision: first.revision,
        },
    });
    await assert.rejects(
        api.request(`/documents/${first.id}/restore-revision`, {
            method: 'POST',
            body: { revision: first.revision, baseRevision: first.revision },
        }),
        /A newer version exists/,
    );
    await assert.rejects(
        api.request(`/documents/${first.id}/restore-revision`, {
            method: 'POST',
            body: { revision: 0, baseRevision: second.revision },
        }),
        /Choose a valid saved version/,
    );
    const restored = await api.request(`/documents/${first.id}/restore-revision`, {
        method: 'POST',
        body: { revision: first.revision, baseRevision: second.revision },
    });
    assert.equal(restored.sql, first.sql);
    assert.equal(restored.revision, second.revision + 1);
    await api.request(`/documents/${first.id}`, { method: 'DELETE' });
    assert.ok((await api.request('/documents?trash=true')).some(item => item.id === first.id));
    await api.request(`/documents/${first.id}/restore`, { method: 'POST' });
    assert.ok(
        (await api.request('/documents')).some(item => item.id === first.id && !item.deletedAt),
    );
    assert.deepEqual(
        (await api.request(`/documents/${first.id}/revisions`)).map(item => item.revision),
        [3, 2, 1],
    );
});

test('Static import commits once and rejects duplicate or unknown mappings', async () => {
    const api = new BrowserWorkspaceApi();
    const preview = await api.request('/imports/preview', {
        method: 'POST',
        body: { name: 'events.csv', format: 'csv', source: 'day,events\n2026-10-10,2' },
    });
    for (const fields of [{ day: 'day', events: 'day' }, { missing: 'day' }, { day: 'unknown' }])
        await assert.rejects(
            api.request(`/imports/${preview.id}/mapping`, {
                method: 'POST',
                body: { connectionId: 'demo', table: 'demo.interview_imports', fields },
            }),
            /mapped once|unknown source/,
        );
    const mapping = await api.request(`/imports/${preview.id}/mapping`, {
        method: 'POST',
        body: {
            connectionId: 'demo',
            table: 'demo.interview_imports',
            fields: { day: 'day', events: 'events' },
        },
    });
    const first = await api.request(`/imports/${mapping.id}/commit`, { method: 'POST' });
    const second = await api.request(`/imports/${mapping.id}/commit`, { method: 'POST' });
    assert.deepEqual(second, first);
    assert.equal(first.rows, 1);
    assert.equal(first.status, 'succeeded');
    const schema = await api.request('/connections/demo/schema');
    assert.equal(schema.tables.find(table => table.name === 'interview_imports').rowEstimate, '1');
    await api.request(`/imports/${preview.id}`, { method: 'DELETE' });
    await assert.rejects(
        api.request(`/imports/${mapping.id}/commit`, { method: 'POST' }),
        /Mapping not found/,
    );
    assert.deepEqual(
        await api.request(`/imports/${first.id}/reconcile`, { method: 'POST' }),
        first,
    );
});

function previewStorage(t) {
    const values = new Map();
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: key => values.get(key) ?? null,
            setItem: (key, value) => values.set(key, value),
        },
    });
    t.after(() => {
        if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
        else delete globalThis.localStorage;
    });
    return values;
}

test('Static preview restores saved execution and document history after invalid entries', async t => {
    const storage = previewStorage(t);
    const api = new BrowserWorkspaceApi();
    const run = await api.request('/runs', { method: 'POST', body: { sql: 'SELECT 7' } });
    const document = await api.request('/documents', {
        method: 'POST',
        body: { name: 'Retained', sql: 'SELECT 7', connectionId: 'demo', runId: run.id },
    });
    await api.request(`/documents/${document.id}`, { method: 'DELETE' });
    const [key, value] = [...storage.entries()][0];
    const state = JSON.parse(value);
    state.sequence = 0;
    state.runs.unshift(null, {});
    state.results.unshift(null, {});
    state.scripts.unshift(null, {});
    state.documents.unshift(null, {});
    state.revisions.unshift(null, ['invalid', {}], ['invalid', [null, { revision: -1 }]]);
    storage.set(key, JSON.stringify(state));
    const reopened = new BrowserWorkspaceApi();
    assert.equal((await reopened.request(`/runs/${run.id}`)).sql, run.sql);
    assert.ok((await reopened.request(`/runs/${run.id}/result`)).rows.length);
    assert.ok(
        (await reopened.request('/documents?trash=true')).some(item => item.id === document.id),
    );
    assert.equal(
        (await reopened.request(`/documents/${document.id}/revisions`))[0].sql,
        document.sql,
    );
    const next = await reopened.request('/runs', { method: 'POST', body: { sql: 'SELECT 8' } });
    assert.ok(next.sequence > run.sequence);
});

for (const legacyState of ['reopenable', 'expired']) {
    test(`Static preview preserves old ${legacyState} Playground rows without executing SQL`, async t => {
        const storage = previewStorage(t),
            api = new BrowserWorkspaceApi();
        const run = await api.request('/runs', { method: 'POST', body: { sql: 'SELECT 7' } });
        const result = await api.request(`/runs/${run.id}/snapshot`);
        const [key, value] = [...storage.entries()][0],
            state = JSON.parse(value);
        const storedRun = state.runs.find(item => item.id === run.id);
        storedRun.connectionId = 'playground';
        storedRun.resultState = legacyState;
        storedRun.resultExpiresAt = '2000-01-01T00:00:00.000Z';
        state.results.find(item => item.runId === run.id).expiresAt = storedRun.resultExpiresAt;
        storage.set(key, JSON.stringify(state));
        const fetch = t.mock.method(globalThis, 'fetch', async () => {
            throw new Error('Unexpected request');
        });
        const reopened = new BrowserWorkspaceApi();
        const restored = await reopened.request(`/runs/${run.id}`);
        assert.equal(restored.resultState, 'reopenable');
        assert.equal('resultExpiresAt' in restored, false);
        assert.equal(restored.queryId, run.queryId);
        assert.deepEqual((await reopened.request(`/runs/${run.id}/snapshot`)).rows, result.rows);
        assert.equal('expiresAt' in (await reopened.request(`/runs/${run.id}/snapshot`)), false);
        assert.equal(fetch.mock.callCount(), 0);
    });
}

test('Static preview keeps legacy history with missing rows without fabricating results', async t => {
    const storage = previewStorage(t),
        api = new BrowserWorkspaceApi();
    const run = await api.request('/runs', { method: 'POST', body: { sql: 'SELECT 7' } });
    const [key, value] = [...storage.entries()][0],
        state = JSON.parse(value);
    state.runs.find(item => item.id === run.id).resultState = 'expired';
    state.results = state.results.filter(item => item.runId !== run.id);
    storage.set(key, JSON.stringify(state));
    const reopened = new BrowserWorkspaceApi(),
        restored = await reopened.request(`/runs/${run.id}`);
    assert.equal(restored.resultState, 'unavailable');
    assert.equal(restored.sql, run.sql);
    assert.equal(restored.queryId, run.queryId);
    await assert.rejects(reopened.request(`/runs/${run.id}/snapshot`), /no longer available/);
});

test('Static preview keeps results, scripts and documents beyond the former storage caps', async t => {
    const storage = previewStorage(t),
        api = new BrowserWorkspaceApi();
    const run = await api.request('/runs', { method: 'POST', body: { sql: 'SELECT 7' } });
    const script = await api.request('/scripts', { method: 'POST', body: { sql: 'SELECT 1' } });
    const document = await api.request('/documents', {
        method: 'POST',
        body: { name: 'Saved', sql: run.sql, connectionId: 'demo' },
    });
    const result = await api.request(`/runs/${run.id}/snapshot`);
    const [key, value] = [...storage.entries()][0],
        state = JSON.parse(value);
    for (let i = 0; i < 125; i++) {
        const id = `saved-${i}`;
        state.runs.push({ ...run, id, queryId: id });
        state.results.push({ ...result, runId: id, queryId: id, rows: [['x'.repeat(16_000)]] });
        state.scripts.push({ ...script, id });
        state.documents.push({ ...document, id, runId: id });
        state.revisions.push([id, [{ ...document, id, runId: id }]]);
    }
    storage.set(key, JSON.stringify(state));
    const reopened = new BrowserWorkspaceApi();
    assert.deepEqual((await reopened.request('/runs/saved-0/snapshot')).rows, [
        ['x'.repeat(16_000)],
    ]);
    assert.equal((await reopened.request('/scripts/saved-0')).id, 'saved-0');
    assert.equal((await reopened.request('/documents/saved-0')).runId, 'saved-0');
    const saved = JSON.parse(storage.get(key));
    for (const bucket of ['runs', 'results', 'scripts', 'documents', 'revisions']) {
        assert.equal(saved[bucket].length, state[bucket].length, bucket);
    }
    assert.ok(storage.get(key).length > 1_500_000);
    const again = new BrowserWorkspaceApi();
    assert.deepEqual((await again.request('/runs/saved-0/result')).rows, [['x'.repeat(16_000)]]);
});

for (const sourceFrom of [undefined, 0, 31])
    test(`Browser script runs preserve document source ranges with base ${sourceFrom}`, async () => {
        const api = new BrowserWorkspaceApi();
        const sql = '  SELECT 1;\n SELECT 2;';
        const script = await api.request('/scripts', {
            method: 'POST',
            body: {
                sql,
                ...(sourceFrom === undefined
                    ? {}
                    : { sourceFrom, sourceTo: sourceFrom + sql.length }),
            },
        });
        for (const statement of script.statements) {
            const run = await api.request(`/runs/${statement.runId}`);
            assert.equal(run.sourceFrom, (sourceFrom ?? 0) + statement.from);
            assert.equal(run.sourceTo, (sourceFrom ?? 0) + statement.to);
        }
    });

test('Browser query runs retain validated source ranges', async () => {
    const api = new BrowserWorkspaceApi();
    const run = await api.request('/runs', {
        method: 'POST',
        body: { sql: 'SELECT 1', sourceFrom: 25, sourceTo: 33 },
    });
    assert.equal(run.sourceFrom, 25);
    assert.equal(run.sourceTo, 33);
    for (const range of [
        { sourceFrom: -1, sourceTo: 2 },
        { sourceFrom: 1 },
        { sourceFrom: 2, sourceTo: 1 },
        { sourceFrom: 1.5, sourceTo: 2 },
    ]) {
        const invalid = await api.request('/runs', {
            method: 'POST',
            body: { sql: 'SELECT 1', ...range },
        });
        assert.equal(invalid.sourceFrom, undefined);
        assert.equal(invalid.sourceTo, undefined);
    }
});

test('Browser saved documents preserve Geography setup across revisions and chart types', async t => {
    previewStorage(t);
    const api = new BrowserWorkspaceApi();
    const geography = {
        source: { mode: 'coordinates', longitude: 0, latitude: 1 },
        sourceColumnNames: ['longitude', 'latitude'],
        label: 2,
        measure: 3,
        swapCoordinates: false,
    };
    const saved = await api.request('/documents', {
        method: 'POST',
        body: {
            name: 'Places.sql',
            sql: 'SELECT 1',
            chart: { kind: 'geography', x: 0, ys: [], title: 'Places', geography },
        },
    });
    assert.deepEqual(saved.chart.geography, geography);
    const read = await api.request(`/documents/${saved.id}`);
    assert.deepEqual(read.chart.geography, geography);
    const switched = await api.request(`/documents/${saved.id}`, {
        method: 'PUT',
        body: { ...saved, baseRevision: saved.revision, chart: { ...saved.chart, kind: 'bar' } },
    });
    assert.deepEqual(switched.chart.geography, geography);
    const revision = await api.request(`/documents/${saved.id}/revisions`);
    assert.deepEqual(revision[0].chart.geography, geography);
    assert.deepEqual(revision[1].chart.geography, geography);
    const reopened = new BrowserWorkspaceApi();
    assert.deepEqual((await reopened.request(`/documents/${saved.id}`)).chart.geography, geography);
});
