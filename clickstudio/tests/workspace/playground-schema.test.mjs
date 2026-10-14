import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlaygroundSchema } from '../../.workspace-build/src/frontend/database/connections/playground-client.js';

const cacheKey = 'clickstudio:playground-schema:v1';

function storage(t) {
    const values = new Map();
    for (const [key, value] of Object.entries({
        window: { setTimeout, clearTimeout },
        localStorage: {
            getItem: key => values.get(key) ?? null,
            setItem: (key, value) => values.set(key, value),
        },
    })) {
        const previous = Object.getOwnPropertyDescriptor(globalThis, key);
        Object.defineProperty(globalThis, key, { configurable: true, value });
        t.after(() => {
            if (previous) Object.defineProperty(globalThis, key, previous);
            else delete globalThis[key];
        });
    }
    return values;
}

function rows(names, data) {
    return new Response(
        [
            JSON.stringify(names),
            JSON.stringify(names.map(() => 'String')),
            ...data.map(row => JSON.stringify(row)),
        ].join('\n') + '\n',
        { headers: { 'content-type': 'text/plain' } },
    );
}

function mockSchema(t, databases = [['github'], ['empty_db']], overrides = {}) {
    return t.mock.method(globalThis, 'fetch', async (_url, request) => {
        const sql = request.body;
        if (sql.includes('FROM system.databases'))
            return overrides.databases?.() ?? rows(['name'], databases);
        if (sql.includes('FROM system.tables'))
            return (
                overrides.tables?.() ??
                rows(
                    [
                        'database',
                        'name',
                        'engine',
                        'sorting_key',
                        'primary_key',
                        'partition_key',
                        'sampling_key',
                        'total_rows',
                        'total_bytes',
                        'total_bytes_uncompressed',
                    ],
                    [['analytics', 'events', 'MergeTree', '', '', '', '', '10', '100', '200']],
                )
            );
        if (sql.includes('FROM system.columns')) return rows([], []);
        assert.fail(`Unexpected schema query: ${sql}`);
    });
}

test('Playground schema includes empty databases and deduplicates catalog and table databases', async t => {
    storage(t);
    mockSchema(t, [
        ['empty_db'],
        ['github'],
        ['analytics'],
        ['github'],
        [''],
        ['system'],
        ['INFORMATION_SCHEMA'],
    ]);
    const schema = await loadPlaygroundSchema();
    assert.deepEqual(schema.databases, ['github', 'empty_db', 'analytics']);
    assert.equal(schema.tables[0].database, 'analytics');
    assert.deepEqual(schema.warnings, []);
});

test('Legacy and malformed Playground database caches reload instead of keeping only the default database', async t => {
    const values = storage(t);
    const fetch = mockSchema(t);
    for (const databases of [undefined, ['github', 7]]) {
        values.set(
            cacheKey,
            JSON.stringify({
                savedAt: Date.now(),
                schema: {
                    connectionId: 'playground',
                    fetchedAt: '2026-10-14',
                    tables: [],
                    columns: [],
                    warnings: [],
                    truncated: false,
                    databases,
                },
            }),
        );
        const previousCalls = fetch.mock.callCount();
        const schema = await loadPlaygroundSchema();
        assert.deepEqual(schema.databases, ['github', 'empty_db', 'analytics']);
        assert.equal(fetch.mock.callCount() - previousCalls, 3);
    }
});

test('Playground database lists are cached and forced schema refresh reloads the catalog', async t => {
    storage(t);
    const fetch = mockSchema(t);
    const first = await loadPlaygroundSchema();
    const cached = await loadPlaygroundSchema();
    assert.deepEqual(cached, first);
    assert.equal(fetch.mock.callCount(), 3);
    await loadPlaygroundSchema(undefined, true);
    assert.equal(fetch.mock.callCount(), 6);
});

test('Unavailable Playground database metadata preserves loaded tables and reports the incomplete list', async t => {
    storage(t);
    mockSchema(t, [], {
        databases: () => new Response('Code: 497. ACCESS_DENIED', { status: 403 }),
    });
    const schema = await loadPlaygroundSchema();
    assert.deepEqual(schema.databases, ['github', 'analytics']);
    assert.equal(schema.tables.length, 1);
    assert.match(schema.warnings[0], /Database metadata is unavailable/);
});

for (const count of [1000, 1001]) {
    test(`Playground catalog with ${count} rows reports truncation only when databases were omitted`, async t => {
        storage(t);
        mockSchema(
            t,
            Array.from({ length: count }, (_, index) => [`db_${index}`]),
        );
        const schema = await loadPlaygroundSchema();
        assert.equal(schema.truncated, count > 1000);
        assert.ok(schema.databases.includes('db_999'));
        assert.ok(!schema.databases.includes('db_1000'));
        if (count > 1000)
            assert.match(schema.warnings[0], /Some databases, tables or columns may be missing/);
        else assert.deepEqual(schema.warnings, []);
    });
}

test('A failed table query still rejects the Playground schema and never caches partial data', async t => {
    const values = storage(t);
    mockSchema(t, [['empty_db']], {
        tables: () => new Response('Code: 497. ACCESS_DENIED', { status: 403 }),
    });
    await assert.rejects(loadPlaygroundSchema());
    assert.equal(values.has(cacheKey), false);
});

test('Aborting the catalog request rejects schema loading without caching a fallback list', async t => {
    const values = storage(t);
    const controller = new AbortController();
    mockSchema(t, [], {
        databases: () => {
            controller.abort();
            throw new Error('Request aborted');
        },
    });
    await assert.rejects(loadPlaygroundSchema(controller.signal));
    assert.equal(values.has(cacheKey), false);
});
