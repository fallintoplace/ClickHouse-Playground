import test from 'node:test';
import assert from 'node:assert/strict';
import {
    activeStatementIndex,
    appendQuerySeparator,
    statementOutline,
    tableAliases,
} from '../../.core-build/src/frontend/queries/editor/sql-editor-helpers.js';
import { selectedStatement, splitSql } from '../../.core-build/src/shared/sql/sql.js';

for (const [name, sql, count] of [
    ['empty', '', 0],
    ['comments only', '-- hi;\n/* another ; */ # last;', 0],
    ['empty statements', '; ; SELECT 1;; SELECT 2;', 2],
    ['quoted semicolon', "SELECT 'a;b'; SELECT 2", 2],
    ['escaped quote', "SELECT 'a\\\';b'; SELECT 2", 2],
    ['quoted identifiers', 'SELECT `a;b`, "c;d"; SELECT 2', 2],
    ['nested comments', '/* a /* b; */ c */ SELECT 1; SELECT 2', 2],
    ['heredoc', 'SELECT $sql$a;b$sql$; SELECT 2', 2],
])
    test(`statement outline: ${name}`, () => {
        const outline = statementOutline(sql);
        assert.equal(outline.error, undefined);
        assert.equal(outline.statements.length, count);
        for (let position = 0; position <= sql.length + 1; position++) {
            const index = activeStatementIndex(outline.statements, position);
            assert.equal(outline.statements[index]?.sql, selectedStatement(sql, position)?.sql);
        }
    });

for (const sql of [
    "SELECT 'unfinished",
    'SELECT "unfinished',
    'SELECT `unfinished',
    'SELECT /* unfinished',
    'SELECT $tag$unfinished',
]) {
    test(`incomplete input stays editable: ${sql}`, () => {
        assert.ok(statementOutline(sql).error);
        assert.deepEqual(statementOutline(sql).statements, []);
        assert.equal(activeStatementIndex([], 0), -1);
        assert.throws(() => appendQuerySeparator(sql));
    });
}

test('outline labels omit leading comments but retain exact source ranges', () => {
    const sql = '-- investigation\nSELECT\n  1;\n SELECT 2';
    const { statements } = statementOutline(sql);
    assert.equal(statements[0].label, 'SELECT 1');
    assert.equal(sql.slice(statements[0].from, statements[0].to), statements[0].sql);
    assert.equal(statementOutline('SELECT ' + 'x'.repeat(100)).statements[0].label.length, 62);
});

for (const [name, sql, operation] of [
    ['SELECT', "SELECT 'DELETE FROM events' AS note", 'read'],
    ['SELECT outfile', "SELECT 1 INTO OUTFILE '/tmp/export.tsv'", 'unknown'],
    ['WITH SELECT', 'WITH recent AS (SELECT 1 AS id) SELECT id FROM recent', 'read'],
    ['INSERT', 'INSERT INTO events SELECT 1', 'insert'],
    ['native UPDATE mutation', 'ALTER TABLE events UPDATE value = 2 WHERE id = 1', 'update'],
    [
        'quoted table UPDATE mutation',
        'ALTER TABLE `events` UPDATE value = 2 WHERE id = 1',
        'update',
    ],
    ['native DELETE mutation', 'ALTER TABLE events DELETE WHERE id = 1', 'delete'],
    ['drop partition mutation', "ALTER TABLE events DROP PARTITION '202401'", 'delete'],
    [
        'reserved table name is not an update',
        'ALTER TABLE update MODIFY COLUMN status String',
        'schema',
    ],
    ['DELETE statement', 'DELETE FROM events WHERE id = 1', 'delete'],
    ['truncate', 'TRUNCATE TABLE events', 'delete'],
    ['drop', 'DROP TABLE events', 'delete'],
    ['schema alter', 'ALTER TABLE events ADD COLUMN status String', 'schema'],
    ['comment keywords', '-- UPDATE and DELETE are examples\nSELECT 1', 'read'],
    ['unknown operation', 'SYSTEM FLUSH LOGS', 'unknown'],
    ['empty statement', '', 'unknown'],
])
    test(`operation preview classifies ${name}`, () => {
        const outline = statementOutline(sql);
        assert.equal(outline.error, undefined);
        assert.equal(outline.statements.length, sql ? 1 : 0);
        assert.equal(outline.statements[0]?.operation ?? 'unknown', operation);
    });

test('script preview keeps order and labels an UPDATE followed by DELETE', () => {
    const outline = statementOutline(
        'SELECT id FROM events; ALTER TABLE events UPDATE value = 2 WHERE id = 1; ALTER TABLE events DELETE WHERE id = 1',
    );
    assert.deepEqual(
        outline.statements.map(statement => statement.operation),
        ['read', 'update', 'delete'],
    );
    assert.deepEqual(
        outline.statements.map(statement => statement.from < statement.to),
        [true, true, true],
    );
});

for (const sql of [
    '',
    '  ',
    '-- a comment',
    '# a comment',
    '/* a comment */',
    'SELECT 1',
    'SELECT 1  ',
    'SELECT 1;',
    'SELECT 1; -- end',
    'SELECT 1 -- end',
    'SELECT 1 # end',
    'SELECT 1 /* end */',
    "SELECT ';'",
]) {
    test(`adding a snippet preserves query boundaries: ${JSON.stringify(sql)}`, () => {
        const before = splitSql(sql);
        const appended = sql + appendQuerySeparator(sql) + 'SELECT 42;';
        const after = splitSql(appended);
        assert.equal(after.length, before.length + 1);
        assert.ok(appended.startsWith(sql));
        assert.match(after.at(-1).sql, /SELECT 42$/);
        assert.equal(selectedStatement(appended, appended.indexOf('42'))?.sql, after.at(-1).sql);
    });
}

for (const [sql, alias, table] of [
    ['SELECT e. FROM analytics.events e', 'e', 'analytics.events'],
    ['SELECT e. FROM `analytics`.`events` AS e', 'e', 'analytics.events'],
    ['SELECT e. FROM "analytics" . "events" e', 'e', 'analytics.events'],
    ['SELECT e. FROM `analytics`.`event log` e', 'e', 'analytics.event log'],
    ['SELECT e. FROM `event``log` e', 'e', 'event`log'],
    ['SELECT e. FROM `events` AS "my alias"', 'my alias', 'events'],
    ['SELECT r. FROM events e LEFT JOIN reports r ON e.id = r.id', 'r', 'reports'],
    ["SELECT 'FROM wrong e' FROM events e", 'e', 'events'],
    ['SELECT e. FROM events e -- FROM wrong e', 'e', 'events'],
    ['SELECT e. FROM events e /* JOIN wrong e */', 'e', 'events'],
    ['SELECT * FROM events FINAL', 'final', undefined],
    ['SELECT * FROM numbers(10) n', 'n', undefined],
    ["SELECT 'unfinished", 'e', undefined],
])
    test(`table hints respect SQL tokens: ${sql}`, () => {
        assert.equal(tableAliases(sql).get(alias), table);
    });

test('the current statement scopes repeated aliases in a script', () => {
    const sql = 'SELECT e. FROM events e; SELECT e. FROM reports e';
    const { statements } = statementOutline(sql);
    for (const [position, expected] of [
        [7, 'events'],
        [31, 'reports'],
    ]) {
        const statement = statements[activeStatementIndex(statements, position)];
        assert.equal(tableAliases(statement.sql).get('e'), expected);
    }
});
