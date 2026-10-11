import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import {
    loadTablePermissions,
    queryTablePermissions,
} from '../../.core-build/src/backend/database/tables/permissions.js';

const denied = { create: false, insert: false, drop: false };
const settings = { readonly: 0, allow_ddl: 1 };

test('Table write permissions check each operation on its database or table', async () => {
    const queries = [];
    const permissions = await loadTablePermissions(
        async sql => {
            queries.push(sql);
            if (sql.startsWith('SELECT')) return [settings];
            if (sql === 'SHOW GRANTS FINAL')
                return [{ grants: 'GRANT INSERT ON analytics.events TO writer' }];
            return [{ result: sql.startsWith('CHECK GRANT INSERT') ? 1 : 0 }];
        },
        'analytics',
        'events',
    );
    assert.deepEqual(permissions, { create: false, insert: true, drop: false });
    assert.deepEqual(queries.filter(sql => sql.startsWith('CHECK GRANT')).sort(), [
        'CHECK GRANT CREATE TABLE ON `analytics`.*',
        'CHECK GRANT DROP TABLE ON `analytics`.`events`',
        'CHECK GRANT INSERT ON `analytics`.`events`',
    ]);
});

test('Read-only settings deny all table writes even when grants would allow them', async () => {
    for (const readonly of [1, 2, '1', '2']) {
        let requests = 0;
        const permissions = await loadTablePermissions(
            async () => {
                requests++;
                return [{ ...settings, readonly }];
            },
            'analytics',
            'events',
        );
        assert.deepEqual(permissions, denied);
        assert.equal(requests, 1);
    }
});

test('Disabling DDL keeps permitted inserts without probing create or drop grants', async () => {
    const queries = [];
    const permissions = await loadTablePermissions(
        async sql => {
            queries.push(sql);
            return sql.startsWith('SELECT')
                ? [{ readonly: 0, allow_ddl: false }]
                : [{ result: '1' }];
        },
        'analytics',
        'events',
    );
    assert.deepEqual(permissions, { create: false, insert: true, drop: false });
    assert.equal(queries.length, 2);
    assert.equal(queries[1], 'CHECK GRANT INSERT ON `analytics`.`events`');
});

test('A database without a selected table checks only creation rights', async () => {
    const queries = [];
    const permissions = await loadTablePermissions(async sql => {
        queries.push(sql);
        if (sql === 'SHOW GRANTS FINAL')
            return [{ grants: 'GRANT SELECT ON analytics.* TO reader' }];
        return sql.startsWith('SELECT') ? [settings] : [{ result: '0' }];
    }, 'analytics');
    assert.deepEqual(permissions, { create: false, insert: undefined, drop: undefined });
    assert.equal(queries.length, 3);
});

test('Unsupported, empty, and malformed grant results stay unknown per operation', async () => {
    for (const result of [[], [{ result: null }], [{ result: 'unknown' }]]) {
        const permissions = await loadTablePermissions(
            async sql => {
                if (sql.startsWith('SELECT')) throw new Error('Settings unavailable');
                if (sql === 'SHOW GRANTS FINAL')
                    return [{ grants: 'GRANT SELECT ON analytics.* TO reader' }];
                if (sql.startsWith('CHECK GRANT INSERT')) return [{ result: 0 }];
                if (sql.startsWith('CHECK GRANT DROP')) throw new Error('Unsupported query');
                return result;
            },
            'analytics',
            'events',
        );
        assert.deepEqual(permissions, { create: undefined, insert: false, drop: undefined });
    }
});

test('Scoped creation and column insert grants keep broad denials unknown', async () => {
    for (const grant of [
        'GRANT CREATE TABLE ON other_database.* TO writer',
        'GRANT CREATE TABLE ON analytics.one_table TO writer',
        'GRANT CREATE TABLE ON analytics.temp* TO writer',
        'GRANT CREATE ON analytics.* TO writer',
        'GRANT ALL ON analytics.* TO writer',
    ]) {
        const permissions = await loadTablePermissions(
            async sql => {
                if (sql.startsWith('SELECT')) return [settings];
                if (sql === 'SHOW GRANTS FINAL') return [{ grants: grant }];
                return [{ result: 0 }];
            },
            'analytics',
            'events',
        );
        assert.equal(permissions.create, undefined);
        assert.equal(permissions.drop, false);
    }
    const permissions = await loadTablePermissions(
        async sql => {
            if (sql.startsWith('SELECT')) return [settings];
            if (sql === 'SHOW GRANTS FINAL')
                return [{ grants: 'GRANT SELECT, INSERT(id) ON analytics.events TO writer' }];
            return [{ result: 0 }];
        },
        'analytics',
        'events',
    );
    assert.deepEqual(permissions, { create: false, insert: undefined, drop: false });
});

test('Unsupported or unrecognized grant inspection preserves possible narrow rights', async () => {
    for (const grants of [null, [{ grants: 'GRANT writer_role TO user' }], [{ grants: 1 }]]) {
        const permissions = await loadTablePermissions(
            async sql => {
                if (sql.startsWith('SELECT')) return [settings];
                if (sql === 'SHOW GRANTS FINAL') {
                    if (grants === null) throw new Error('FINAL unsupported');
                    return grants;
                }
                return [{ result: 0 }];
            },
            'analytics',
            'events',
        );
        assert.deepEqual(permissions, { create: undefined, insert: undefined, drop: false });
    }
});

test('Read grants, temporary creation, and partial revokes do not grant persistent writes', async () => {
    const permissions = await loadTablePermissions(
        async sql => {
            if (sql.startsWith('SELECT')) return [settings];
            if (sql === 'SHOW GRANTS FINAL')
                return [
                    {
                        grants: 'GRANT SELECT(`INSERT`, CREATE, ALL, ON) ON analytics.events TO reader',
                    },
                    { grants: 'GRANT CREATE TEMPORARY TABLE ON *.* TO reader' },
                    { grants: 'REVOKE INSERT(id) ON analytics.events FROM reader' },
                ];
            return [{ result: 0 }];
        },
        'analytics',
        'events',
    );
    assert.deepEqual(permissions, denied);
});

test('System tables deny writes while creation elsewhere stays available', async () => {
    for (const database of ['system', 'information_schema', 'INFORMATION_SCHEMA']) {
        for (const canCreate of [true, false]) {
            const queries = [];
            const permissions = await loadTablePermissions(
                async sql => {
                    queries.push(sql);
                    if (sql.startsWith('SELECT')) return [settings];
                    if (sql === 'SHOW GRANTS FINAL')
                        return [
                            {
                                grants: `GRANT ${canCreate ? 'CREATE TABLE' : 'SELECT'} ON analytics.* TO user`,
                            },
                        ];
                    assert.fail('System tables must not probe write grants');
                },
                database,
                'events',
            );
            assert.deepEqual(permissions, {
                create: canCreate ? undefined : false,
                insert: false,
                drop: false,
            });
            assert.equal(queries.length, 2);
        }
    }
});

test('Permission targets reject invalid names and quote valid unusual identifiers', async () => {
    for (const [database, table] of [
        ['', 'events'],
        ['a.b', 'events'],
        ['analytics', ''],
        ['analytics', '\n'],
    ]) {
        await assert.rejects(
            loadTablePermissions(async () => assert.fail('No query expected'), database, table),
            { code: 'TABLE_PERMISSION_TARGET' },
        );
    }
    const queries = [];
    await loadTablePermissions(
        async sql => {
            queries.push(sql);
            return sql.startsWith('SELECT') ? [settings] : [{ result: 1 }];
        },
        'ana`lytics',
        'ev`ents; DROP TABLE x',
    );
    assert.ok(queries.includes('CHECK GRANT INSERT ON `ana\\`lytics`.`ev\\`ents; DROP TABLE x`'));
});

test('Grant probes use the HTTP default format without appending a FORMAT clause', async () => {
    const requests = [];
    const permissions = await queryTablePermissions(
        {
            async exec(request) {
                requests.push(request);
                const row = request.query.startsWith('SELECT') ? settings : { result: 1 };
                const json = JSON.stringify(row);
                return { stream: Readable.from([json.slice(0, 3), json.slice(3), '\n\n']) };
            },
        },
        'analytics',
        'events',
    );
    assert.deepEqual(permissions, { create: true, insert: true, drop: true });
    assert.equal(requests.length, 4);
    for (const request of requests) {
        assert.equal(request.clickhouse_settings.default_format, 'JSONEachRow');
        assert.doesNotMatch(request.query, /\bFORMAT\b/);
        assert.equal(request.abort_signal.aborted, false);
    }
});
