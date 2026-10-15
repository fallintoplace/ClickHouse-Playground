import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createMaterializedViewSql,
    materializedViewSelect,
} from '../../.core-build/src/shared/database/views/create-materialized-view.js';
import { splitSql } from '../../.core-build/src/shared/sql/sql.js';

for (const sql of [
    'SELECT * FROM events',
    'select value from events;',
    '-- Daily totals\nSELECT count() FROM events;',
    'WITH totals AS (SELECT count() AS n FROM events) SELECT n FROM totals;',
    "SELECT ';' AS separator FROM events; -- trailing comment",
    'SELECT {tenant:UInt64} AS tenant FROM events;',
]) {
    test(`Materialized view creation keeps one SELECT: ${sql}`, () => {
        const query = materializedViewSelect(sql);
        assert.equal(query, splitSql(sql)[0].sql);
        const created = createMaterializedViewSql(
            'analytics',
            'daily_mv',
            { database: 'reports', name: 'daily' },
            sql,
        );
        assert.equal(splitSql(created).length, 1);
        assert.ok(created.startsWith('CREATE MATERIALIZED VIEW `analytics`.`daily_mv`\n'));
        assert.ok(created.includes(`\nTO \`reports\`.\`daily\`\nAS\n${query}\n;`));
        assert.ok(!created.includes('POPULATE'));
    });
}

for (const sql of [
    '',
    '-- comment only',
    'SHOW TABLES',
    'EXPLAIN SELECT * FROM events',
    'CREATE TABLE target AS SELECT * FROM events',
    'INSERT INTO target SELECT * FROM events',
    'SELECT 1; SELECT 2',
    "SELECT 'unclosed",
]) {
    test(`Materialized view creation excludes an unsupported statement: ${sql}`, () => {
        assert.equal(materializedViewSelect(sql), undefined);
        assert.throws(() =>
            createMaterializedViewSql('demo', 'mv', { database: 'demo', name: 'target' }, sql),
        );
    });
}

test('Materialized view SQL quotes identifiers and keeps a trailing line comment separate', () => {
    const sql = createMaterializedViewSql(
        'a`b',
        ' daily totals ',
        { database: 'reporting', name: 'x\\y`z' },
        'SELECT 1 AS value -- keep this comment',
    );
    assert.equal(
        sql,
        'CREATE MATERIALIZED VIEW `a\\`b`.`daily totals`\n' +
            'TO `reporting`.`x\\\\y\\`z`\nAS\nSELECT 1 AS value -- keep this comment\n;',
    );
    assert.equal(splitSql(sql).length, 1);
});
