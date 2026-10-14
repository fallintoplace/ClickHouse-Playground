import test from 'node:test';
import assert from 'node:assert/strict';
import {
    mergeSchemaPages,
    reloadSchemaPages,
    schemaPagePath,
} from '../../.workspace-build/src/frontend/database/schema/schema-pages.js';
import {
    metadataAccessDenied,
    metadataConnectionKey,
} from '../../.workspace-build/src/frontend/database/schema/metadata-state.js';

const page = (name, pagination) => ({
    connectionId: 'clickhouse-cloud',
    fetchedAt: '2026-10-14T00:00:00Z',
    databases: ['default'],
    tables: [{ database: 'default', name, engine: 'MergeTree' }],
    columns: [{ database: 'default', table: name, name: 'id', type: 'UInt64' }],
    warnings: [],
    truncated: Boolean(pagination),
    pagination,
});

test('schema refresh reloads the loaded depth using fresh cursors and removes old objects', async () => {
    const offsets = [];
    const result = await reloadSchemaPages(
        2,
        async pagination => {
            offsets.push(pagination);
            return pagination ? page('new_second') : page('new_first', { tables: 1000 });
        },
        new AbortController().signal,
    );
    assert.deepEqual(offsets, [undefined, { tables: 1000 }]);
    assert.deepEqual(
        result.schema.tables.map(table => table.name),
        ['new_first', 'new_second'],
    );
    assert.equal(result.pages, 2);
    assert.equal(result.schema.truncated, false);
});

test('schema refresh stops at its previous depth even if more fresh pages are available', async () => {
    let calls = 0;
    const result = await reloadSchemaPages(
        2,
        async () => page(`table_${++calls}`, { tables: calls * 1000 }),
        new AbortController().signal,
    );
    assert.equal(calls, 2);
    assert.deepEqual(result.schema.pagination, { tables: 2000 });
    assert.equal(result.schema.truncated, true);
});

test('schema refresh stops early if the schema shrank or pagination is empty', async () => {
    for (const pagination of [undefined, {}, { tables: undefined }]) {
        let calls = 0;
        const result = await reloadSchemaPages(
            4,
            async () => {
                calls++;
                return page('remaining', pagination);
            },
            new AbortController().signal,
        );
        assert.equal(calls, 1);
        assert.equal(result.pages, 1);
    }
});

test('a failed later page rejects the whole refreshed schema range', async () => {
    const old = page('old', { columns: 2000 });
    await assert.rejects(
        reloadSchemaPages(
            2,
            async pagination => {
                if (pagination) throw new Error('Page unavailable');
                return page('fresh', { columns: 2000 });
            },
            new AbortController().signal,
        ),
        /Page unavailable/,
    );
    assert.equal(old.tables[0].name, 'old');
});

test('aborted schema refresh never fetches another page or returns a late result', async () => {
    const controller = new AbortController();
    let calls = 0;
    await assert.rejects(
        reloadSchemaPages(
            3,
            async () => {
                calls++;
                controller.abort();
                return page('late', { tables: 1000 });
            },
            controller.signal,
        ),
        { name: 'AbortError' },
    );
    assert.equal(calls, 1);
    await assert.rejects(
        reloadSchemaPages(
            1,
            async () => {
                throw new Error('Must not fetch');
            },
            controller.signal,
        ),
        { name: 'AbortError' },
    );
});

test('page merging deduplicates objects and warnings and uses the latest cursor and definition', () => {
    const first = { ...page('events', { tables: 1000 }), warnings: ['partial'] };
    const next = {
        ...page('events', { columns: 4000 }),
        tables: [{ database: 'default', name: 'events', engine: 'ReplacingMergeTree' }],
        warnings: ['partial', 'columns limited'],
    };
    const merged = mergeSchemaPages(first, next);
    assert.equal(merged.tables.length, 1);
    assert.equal(merged.tables[0].engine, 'ReplacingMergeTree');
    assert.equal(merged.columns.length, 1);
    assert.deepEqual(merged.warnings, ['partial', 'columns limited']);
    assert.deepEqual(merged.pagination, { columns: 4000 });
});

test('schema paths include each independent cursor, zero offsets and forced refresh', () => {
    assert.equal(
        schemaPagePath('playground', undefined, true),
        '/connections/playground/schema?refresh=true',
    );
    assert.equal(
        schemaPagePath('cloud/profile', { databases: 0, tables: 1000, columns: 2000 }),
        '/connections/cloud%2Fprofile/schema?databaseOffset=0&tableOffset=1000&columnOffset=2000',
    );
});

test('metadata identity changes for host, database, username and testedAt without delimiter collisions', () => {
    const connection = { id: 'cloud', host: 'host', database: 'db', username: 'user' };
    for (const field of ['id', 'host', 'database', 'username']) {
        assert.notEqual(
            metadataConnectionKey(connection),
            metadataConnectionKey({ ...connection, [field]: 'next' }),
        );
    }
    assert.notEqual(
        metadataConnectionKey(connection),
        metadataConnectionKey({ ...connection, manifest: { testedAt: 'now' } }),
    );
    assert.notEqual(
        metadataConnectionKey({ ...connection, host: 'a:b', database: 'c' }),
        metadataConnectionKey({ ...connection, host: 'a', database: 'b:c' }),
    );
});

test('only confirmed authentication or permission failures discard cached metadata', () => {
    for (const status of [401, 403]) assert.equal(metadataAccessDenied({ status }), true);
    for (const error of [null, 'offline', new Error('offline'), { status: 502 }, { status: 504 }]) {
        assert.equal(metadataAccessDenied(error), false);
    }
});
