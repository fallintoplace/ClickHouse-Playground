import test from 'node:test';
import assert from 'node:assert/strict';
import {
    canDropDatabase,
    dropDatabaseSql,
    isDatabaseDrop,
    sqlReferencesQualifiedDatabase,
} from '../../.core-build/src/shared/database/databases/delete-database.js';
import { DatabaseDeletionService } from '../../.core-build/src/backend/database/databases/delete-database.js';
import { MemoryStore } from '../../.core-build/src/backend/system/store.js';
import { owner, viewer, isAuditEvent, fixture, connection } from './helpers.mjs';

test('Database deletion rejects protected and invalid targets and quotes unusual names', () => {
    for (const name of [
        '',
        'default',
        'DEFAULT',
        'system',
        'SYSTEM',
        'information_schema',
        'INFORMATION_SCHEMA',
        'a.b',
        '\n',
        'x'.repeat(129),
        'a\x7fb',
    ]) {
        assert.equal(canDropDatabase(name), false, name);
    }
    for (const name of [
        'BEATLES_DB',
        'empty database',
        'ana`lytics',
        'x; DROP DATABASE other',
        'x'.repeat(128),
    ]) {
        assert.equal(canDropDatabase(name), true, name);
    }
    assert.equal(dropDatabaseSql('ana`lytics'), 'DROP DATABASE IF EXISTS `ana\\`lytics`');
    assert.equal(isDatabaseDrop({ database: 'analytics', queryId: 'drop-id' }), true);
    for (const value of [null, {}, { database: 'analytics', queryId: 1 }])
        assert.equal(isDatabaseDrop(value), false);
});

test('Database source invalidation recognizes identifiers while ignoring SQL strings and comments', () => {
    for (const sql of [
        'SELECT * FROM analytics.events',
        'SELECT * FROM `analytics`.`events`',
        'SELECT * FROM "analytics"."events"',
    ]) {
        assert.equal(sqlReferencesQualifiedDatabase(sql, 'analytics'), true, sql);
    }
    for (const sql of [
        "SELECT 'analytics.events'",
        '-- analytics.events\nSELECT 1',
        'SELECT * FROM other.events',
        "SELECT '",
        'SELECT analytics.value FROM other.events AS analytics',
        'WITH src AS (SELECT 1) SELECT * FROM src',
        'SELECT * FROM events',
        'SELECT 1',
        'SELECT * FROM numbers(10)',
    ]) {
        assert.equal(sqlReferencesQualifiedDatabase(sql, 'analytics'), false, sql);
    }
});

test('Database deletion authorizes the exact confirmed target before calling the driver', async () => {
    const store = new MemoryStore();
    const calls = [];
    const service = new DatabaseDeletionService(
        store,
        {
            async dropDatabase(...args) {
                calls.push(args);
            },
        },
        () => true,
    );
    for (const [principal, database, confirmation, code] of [
        [viewer, 'analytics', 'analytics', 'ROLE_READ_ONLY'],
        [owner, 'default', 'default', 'DATABASE_DROP_TARGET'],
        [owner, 'system', 'system', 'DATABASE_DROP_TARGET'],
        [owner, 'analytics', '', 'DATABASE_DROP_CONFIRMATION'],
        [owner, 'analytics', 'Analytics', 'DATABASE_DROP_CONFIRMATION'],
        [owner, 'analytics', 'analytics ', 'DATABASE_DROP_CONFIRMATION'],
        [owner, 'analytics', ' analytics', 'DATABASE_DROP_CONFIRMATION'],
    ]) {
        await assert.rejects(service.drop(principal, 'local', database, confirmation), { code });
    }
    assert.equal(calls.length, 0);
    const result = await service.drop(owner, 'local', 'analytics', 'analytics');
    assert.deepEqual(calls, [['local', 'analytics', result.queryId]]);
    assert.match(result.queryId, /^clickstudio-drop-database-/);
    assert.equal(result.database, 'analytics');
    assert.ok(
        store
            .list('audit', isAuditEvent)
            .some(event => event.action === 'database.drop' && event.resourceId === 'analytics'),
    );
});

test('Untrusted connections and driver failures do not report database deletion success', async () => {
    const store = new MemoryStore();
    const driver = {
        async dropDatabase() {
            throw new Error('DROP DATABASE was denied');
        },
    };
    await assert.rejects(
        new DatabaseDeletionService(store, driver, () => false).drop(
            owner,
            'local',
            'analytics',
            'analytics',
        ),
        { code: 'WORKSPACE_UNTRUSTED' },
    );
    await assert.rejects(
        new DatabaseDeletionService(store, driver, () => true).drop(
            owner,
            'local',
            'analytics',
            'analytics',
        ),
        /DROP DATABASE was denied/,
    );
});

test('Database fallback preserves only unchanged trust on the same connection', () => {
    for (const scenario of ['unchanged', 'revoked', 'replaced']) {
        const previous = { ...connection, database: 'analytics' };
        let current = previous;
        const { runs } = fixture({ authorize: () => current });
        if (scenario === 'revoked') runs.trust(owner, previous.id, false);
        current = {
            ...previous,
            database: 'default',
            ...(scenario === 'replaced' ? { host: 'https://another.example' } : {}),
        };
        runs.refreshTrustAfterDatabaseDeleted(owner, previous);
        assert.equal(runs.isTrusted(owner, previous.id), scenario === 'unchanged', scenario);
    }
});
