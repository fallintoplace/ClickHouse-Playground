import test from 'node:test';
import assert from 'node:assert/strict';
import {
    indexSchema,
    indexedTable,
    tableColumns,
    sqlHoverTarget,
    schemaHoverInfo,
} from '../../.workspace-build/src/frontend/queries/editor/schema-context.js';
import { createSqlLexer, sqlLexer } from '../../.workspace-build/src/shared/sql/lexer.js';

const schema = {
    tables: [
        { database: 'demo', name: 'first_table', engine: 'MergeTree' },
        { database: 'demo', name: 'second_table', engine: 'Memory' },
        { database: 'other', name: 'first_table', engine: 'Log' },
    ],
    columns: [
        {
            database: 'demo',
            table: 'first_table',
            name: 'id',
            type: 'UInt64',
            comment: 'Numeric ID',
        },
        { database: 'demo', table: 'second_table', name: 'id', type: 'String', comment: '' },
        {
            database: 'demo',
            table: 'second_table',
            name: 'special name',
            type: 'Date',
            comment: '',
        },
        { database: 'demo', table: 'second_table', name: 'count', type: 'UInt32', comment: '' },
        { database: 'other', table: 'first_table', name: 'id', type: 'Int32', comment: '' },
    ],
};
const index = indexSchema(schema, 'demo');
function hover(sql, token) {
    const target = sqlHoverTarget(sqlLexer.scan(sql), sql.indexOf(token));
    return target && schemaHoverInfo(index, sql, target);
}

test('schema indexing prefers the connection database and avoids ambiguous short names', () => {
    assert.equal(indexedTable(index, 'FIRST_TABLE').database, 'demo');
    assert.equal(indexedTable(index, 'other.first_table').engine, 'Log');
    assert.equal(indexedTable(indexSchema(schema), 'first_table'), undefined);
    assert.equal(tableColumns(index, indexedTable(index, 'demo.second_table')).length, 3);
    assert.equal(indexSchema(undefined).tablesByName.size, 0);
    assert.equal(indexedTable(indexSchema(undefined), 'unknown'), undefined);
});

for (const [sql, token, expected] of [
    [
        'SELECT b.id FROM demo.first_table a JOIN demo.second_table b ON a.id = b.id',
        'b.id',
        'demo.second_table.id · String',
    ],
    [
        'SELECT a.id FROM demo.first_table a JOIN demo.second_table b ON a.id = b.id',
        'a.id',
        'demo.first_table.id · UInt64 · Numeric ID',
    ],
    [
        'SELECT second_table.id FROM demo.second_table',
        'second_table.id',
        'demo.second_table.id · String',
    ],
    [
        'SELECT demo.second_table.id FROM demo.second_table',
        'demo.second_table.id',
        'demo.second_table.id · String',
    ],
    ['SELECT id FROM second_table', 'id', 'demo.second_table.id · String'],
    [
        'SELECT b."special name" FROM demo.second_table AS b',
        'special name',
        'demo.second_table.special name · Date',
    ],
    ['SELECT `b`.`id` FROM demo.second_table AS `b`', '`id`', 'demo.second_table.id · String'],
    ['SELECT unknown.id FROM demo.first_table', 'unknown.id', undefined],
    ['SELECT id FROM missing_table', 'id', undefined],
    ['SELECT id FROM demo.first_table a JOIN demo.second_table b ON a.id = b.id', 'id', undefined],
    ['SELECT demo.second_table FROM numbers(1)', 'demo.second_table', 'demo.second_table · Memory'],
    ['SELECT count FROM demo.second_table', 'count', 'demo.second_table.count · UInt32'],
])
    test(`schema hover resolves the identifier in ${sql}`, () =>
        assert.equal(hover(sql, token), expected));

for (const engine of [
    sqlLexer,
    await createSqlLexer(async () => {
        throw new Error('blocked');
    }),
]) {
    for (const sql of [
        "SELECT 'id'",
        'SELECT ‘id’',
        'SELECT $tag$id$tag$',
        '-- id',
        '// id',
        '/* id */',
        '# id',
        "SELECT 'escaped\\\' id'",
    ]) {
        test(`${engine.engine} metadata hover ignores literal or comment: ${sql}`, () => {
            assert.equal(sqlHoverTarget(engine.scan(sql), sql.indexOf('id')), undefined);
        });
    }
    test(`${engine.engine} hover detects actual function calls and escaped quoted identifiers`, () => {
        assert.equal(sqlHoverTarget(engine.scan('SELECT count (id)'), 8).functionCall, true);
        assert.equal(
            sqlHoverTarget(engine.scan('SELECT count FROM demo.second_table'), 8).functionCall,
            false,
        );
        const source = 'SELECT "b"."a""b", `b`.`x\\`y`';
        assert.deepEqual(sqlHoverTarget(engine.scan(source), source.indexOf('a')).parts, [
            'b',
            'a"b',
        ]);
        assert.deepEqual(sqlHoverTarget(engine.scan(source), source.indexOf('x')).parts, [
            'b',
            'x`y',
        ]);
    });
    test(`${engine.engine} hover uses UTF-16 positions`, () => {
        const sql = "SELECT 'é😀', b.id FROM demo.second_table b";
        assert.deepEqual(sqlHoverTarget(engine.scan(sql), sql.indexOf('b.id')).parts, ['b', 'id']);
    });
}

test('schema lookup preserves case-sensitive table, column and alias identities', () => {
    const schema = {
        tables: [
            { database: 'demo', name: 'Events', engine: 'MergeTree' },
            { database: 'demo', name: 'events', engine: 'Memory' },
        ],
        columns: [
            { database: 'demo', table: 'Events', name: 'Id', type: 'UInt64', comment: '' },
            { database: 'demo', table: 'events', name: 'id', type: 'String', comment: '' },
            { database: 'demo', table: 'Events', name: 'id', type: 'Int32', comment: '' },
        ],
    };
    const index = indexSchema(schema, 'demo');
    assert.equal(indexedTable(index, 'demo.Events').engine, 'MergeTree');
    assert.equal(indexedTable(index, 'demo.events').engine, 'Memory');
    assert.equal(indexedTable(index, 'DEMO.EVENTS'), undefined);
    for (const [sql, token, expected] of [
        ['SELECT e.Id FROM demo.Events e', 'e.Id', 'demo.Events.Id · UInt64'],
        ['SELECT e.id FROM demo.Events e', 'e.id', 'demo.Events.id · Int32'],
        [
            'SELECT E.Id FROM demo.Events E JOIN demo.events e ON E.Id = e.id',
            'E.Id',
            'demo.Events.Id · UInt64',
        ],
        [
            'SELECT e.id FROM demo.Events E JOIN demo.events e ON E.Id = e.id',
            'e.id',
            'demo.events.id · String',
        ],
        ['SELECT e.ID FROM demo.Events e', 'e.ID', undefined],
    ])
        assert.equal(
            schemaHoverInfo(index, sql, sqlHoverTarget(sqlLexer.scan(sql), sql.indexOf(token))),
            expected,
        );
});
