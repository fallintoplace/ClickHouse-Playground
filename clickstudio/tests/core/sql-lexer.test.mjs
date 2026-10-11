import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createSqlLexer, sqlLexer } from '../../.core-build/src/shared/sql/lexer.js';
import {
    formatSql,
    hasSqlComments,
    lexSql,
    parameterNames,
    selectedStatement,
    splitSql,
    SqlSyntaxError,
    tokenizedStatements,
} from '../../.core-build/src/shared/sql/sql.js';
import { guardSql } from '../../.core-build/src/backend/queries/execution/guards.js';
import { statementOutline } from '../../.core-build/src/frontend/workspace/editor/tools.js';

const fallback = await createSqlLexer(async () => {
    throw new Error('WASM unavailable');
});

test('the published ClickHouse lexer is the default engine', () => {
    assert.equal(sqlLexer.engine, 'clickhouse');
    assert.equal(fallback.engine, 'fallback');
});

const protectedCases = [
    ["SELECT 'é你好🙂; DROP' AS note; SELECT 2", ["'é你好🙂; DROP'"]],
    ["SELECT 'it''s;ok', 'it\\\'s;ok'; SELECT 2", ["'it''s;ok'", "'it\\\'s;ok'"]],
    ['SELECT `a``b;c`, "d\\\";e"; SELECT 2', ['`a``b;c`', '"d\\\";e"']],
    ['SELECT $123$a; DROP TABLE t$123$; SELECT 2', ['$123$a; DROP TABLE t$123$']],
    [
        'SELECT $0$a;b$0$, $_123$c;d$_123$, $$e;f$$; SELECT 2',
        ['$0$a;b$0$', '$_123$c;d$_123$', '$$e;f$$'],
    ],
    ['SELECT ‘a; DROP’, “identifier;name”; SELECT 2', ['‘a; DROP’', '“identifier;name”']],
    ['SELECT ‘a\\’; SELECT 2', ['‘a\\’']],
    ['\uFEFFSELECT 1;\uFEFF SELECT 2', []],
    ['SELECT 1; -- ; DELETE\nSELECT 2', ['-- ; DELETE\n']],
    ['SELECT 1; # ; DELETE\nSELECT 2', ['# ; DELETE\n']],
    ['SELECT 1; // ; DELETE\nSELECT 2', ['// ; DELETE\n']],
    ['SELECT 1 // keep; DROP TABLE t\n; SELECT 2', ['// keep; DROP TABLE t\n']],
    ['SELECT 1 -- keep; DROP TABLE t\n; SELECT 2', ['-- keep; DROP TABLE t\n']],
    ['SELECT 1 # keep; DROP TABLE t\r\n; SELECT 2', ['# keep; DROP TABLE t\r\n']],
    ['#!/usr/bin/clickhouse-local;\nSELECT 1; SELECT 2', ['#!/usr/bin/clickhouse-local;\n']],
    ['/* outer ; /* inner ; */ done */ SELECT 1; SELECT 2', ['/* outer ; /* inner ; */ done */']],
    ["SELECT '\uD800;\uDC00'; SELECT 2", ["'\uD800;\uDC00'"]],
];

for (const lexer of [sqlLexer, fallback]) {
    for (const [sql, protectedText] of protectedCases) {
        test(`${lexer.engine} source ranges and protected values: ${JSON.stringify(sql)}`, () => {
            const scan = lexer.scan(sql);
            assert.equal(scan.error, undefined);
            for (const token of scan.tokens) {
                assert.ok(token.from >= 0 && token.to <= sql.length);
                assert.equal(sql.slice(token.from, token.to), token.text);
            }
            assert.deepEqual(
                scan.protectedRanges.map(range => sql.slice(range.from, range.to)),
                protectedText,
            );
            assert.equal(scan.tokens.filter(token => token.text === ';').length, 1);
        });
    }

    for (const [suffix, message] of [
        ["'unfinished\\", 'Unclosed quoted value or identifier'],
        ['"unfinished""', 'Unclosed quoted value or identifier'],
        ['`unfinished\\', 'Unclosed quoted value or identifier'],
        ['‘unfinished', 'Unclosed quoted value or identifier'],
        ['“unfinished', 'Unclosed quoted value or identifier'],
        ['/* outer /* inner */', 'Unclosed block comment'],
        ['$$unfinished', 'Unclosed heredoc'],
        ['$tag$unfinished', 'Unclosed heredoc'],
        ['$123$unfinished', 'Unclosed heredoc'],
        ['#comment', 'Unrecognized SQL token'],
        ['#\tcomment', 'Unrecognized SQL token'],
        ['#', 'Unrecognized SQL token'],
        ['\0', 'Unrecognized SQL token'],
        ['é', 'Unrecognized SQL token'],
    ]) {
        test(`${lexer.engine} preserves an invalid draft tail: ${JSON.stringify(suffix)}`, () => {
            const prefix = "\uFEFFSELECT '你好🙂'; SELECT ";
            const scan = lexer.scan(prefix + suffix);
            assert.ok(scan.error instanceof SqlSyntaxError);
            assert.equal(scan.error.position, prefix.length);
            assert.equal(scan.error.message, message);
            assert.deepEqual(scan.protectedRanges.at(-1), {
                from: prefix.length,
                to: prefix.length + suffix.length,
            });
        });
    }
}

for (const [sql, protectedText] of protectedCases) {
    test(`splitting and formatting preserve native protected text: ${JSON.stringify(sql)}`, () => {
        const statements = splitSql(sql);
        assert.equal(statements.length, 2);
        for (const statement of statements)
            assert.equal(sql.slice(statement.from, statement.to), statement.sql);
        const formatted = formatSql(sql);
        for (const value of protectedText) assert.ok(formatted.includes(value));
        assert.equal(splitSql(formatted).length, 2);
        const outlined = statementOutline(sql);
        assert.equal(outlined.error, undefined);
        assert.deepEqual(
            outlined.statements.map(statement => statement.operation),
            ['read', 'read'],
        );
    });
}

test('BOM and Unicode positions select the exact statement and omit comments in labels', () => {
    const first = "SELECT '🙂;é' AS note";
    const second = 'SELECT {n:UInt64}';
    const sql = `\uFEFF-- hello 你好\n${first};\n\uFEFF${second}`;
    const outlined = statementOutline(sql);
    assert.deepEqual(
        outlined.statements.map(statement => statement.label),
        [first, second],
    );
    assert.equal(selectedStatement(sql, sql.indexOf(second)).sql, second);
    assert.equal(outlined.statements[1].from, sql.indexOf(second));
    for (const statement of tokenizedStatements(sql)) {
        for (const token of statement.tokens)
            assert.equal(sql.slice(token.from, token.to), token.text);
    }
});

for (const whitespace of ['\u0085', '\u180e', '\u200b', '\u200c', '\u200d', '\u2060', '\uFEFF']) {
    test(`native and fallback recognize ClickHouse whitespace ${whitespace.codePointAt(0).toString(16)}`, () => {
        const sql = `${whitespace}SELECT${whitespace}1${whitespace};${whitespace}SELECT 2${whitespace}`;
        assert.deepEqual(fallback.scan(sql).tokens, sqlLexer.scan(sql).tokens);
        assert.equal(fallback.scan(sql).error, undefined);
        assert.deepEqual(
            splitSql(sql).map(statement => statement.sql),
            [`SELECT${whitespace}1`, 'SELECT 2'],
        );
    });
}

test('native numbers and operators retain their full source tokens', () => {
    const sql = 'SELECT 0xFF, 0b10, 1e-3, .5, x -> x+1, a::UInt64, x >= 1, x != 2';
    const symbols = lexSql(sql)
        .filter(token => token.kind === 'symbol')
        .map(token => token.text);
    for (const value of ['0xFF', '0b10', '1e-3', '->', '::', '>=', '!='])
        assert.ok(symbols.includes(value), value);
});

test('typed parameters ignore native heredocs, curly strings and comments', () => {
    const sql =
        'SELECT $123${ignored:UInt64}$123$, ‘{also_ignored:String}’, {n:Tuple(String, Decimal(18, 2))} # {comment:UInt64}';
    assert.deepEqual(parameterNames(sql), [{ name: 'n', type: 'Tuple(String, Decimal(18, 2))' }]);
    assert.doesNotThrow(() => guardSql(sql, { n: "('hello', 1.25)" }));
});

test('double-slash comments cannot supply parameters or guard commands', () => {
    const sql = 'SELECT 1 // DROP; {missing:UInt64}\n';
    assert.equal(hasSqlComments(sql), true);
    assert.deepEqual(parameterNames(sql), []);
    assert.doesNotThrow(() => guardSql(sql));
    assert.equal(
        fallback.scan(sql).tokens.some(token => token.text === 'DROP'),
        false,
    );
});

test('formatting restores dollar replacement sequences literally', () => {
    const value = "$tag$$& $$ $` $' from  events$tag$";
    assert.ok(formatSql(`SELECT ${value} AS note FROM events`).includes(value));
});

test('native quoted values cannot inject guard keywords or fake output formats', () => {
    for (const sql of [
        'SELECT $123$DROP; FORMAT CSV$123$',
        'SELECT ‘DROP; FORMAT CSV’',
        'SELECT “SYSTEM” FROM events',
    ])
        assert.doesNotThrow(() => guardSql(sql));
    assert.throws(() => guardSql('SELECT $123$hello$123$ FORMAT CSV'), {
        code: 'READ_ONLY_SQL',
    });
    assert.throws(() => guardSql('SELECT $123$hello$123$; DELETE FROM t'), {
        code: 'SINGLE_STATEMENT',
    });
});

test('native lexical errors keep source positions and never retry through fallback', () => {
    const prefix = "\uFEFFSELECT '🙂' ";
    for (const suffix of ['!', '#comment', 'é', '\0']) {
        assert.throws(() => lexSql(prefix + suffix), { position: prefix.length });
        assert.throws(() => guardSql(prefix + suffix), { code: 'SQL_BOUNDARY' });
    }
    assert.equal(hasSqlComments('SELECT $123$-- /* # $123$, ‘-- text’'), false);
    assert.equal(hasSqlComments("SELECT '🙂' /* unfinished"), true);
    assert.ok(formatSql(prefix + '! from  events').endsWith('! from  events'));
});

test('fifty statements preserve heredocs, operation previews and cursor positions', () => {
    const sql = Array.from({ length: 50 }, (_, i) => `SELECT $${i}$😀;${i}$${i}$ AS value`).join(
        ';\n',
    );
    const statements = tokenizedStatements(sql);
    assert.equal(statements.length, 50);
    assert.equal(statementOutline(sql).statements.length, 50);
    for (const statement of statements) {
        assert.equal(sql.slice(statement.from, statement.to), statement.sql);
        assert.equal(selectedStatement(sql, statement.from).sql, statement.sql);
        assert.equal(statement.tokens.filter(token => token.kind === 'quoted').length, 1);
    }
});

test('WASM memory growth and smaller subsequent queries preserve source offsets', () => {
    const value = 'é你好🙂;'.repeat(15_000);
    const sql = `SELECT '${value}' AS note; SELECT 2`;
    assert.ok(sql.length > 64_000);
    assert.equal(splitSql(sql).length, 2);
    assert.equal(lexSql(sql).find(token => token.kind === 'quoted').text, `'${value}'`);
    assert.deepEqual(
        splitSql('\uFEFFSELECT 1; SELECT 2').map(statement => statement.sql),
        ['SELECT 1', 'SELECT 2'],
    );
});

test('an initialized lexer propagates runtime failures without changing engines', async () => {
    let loads = 0;
    const lexer = await createSqlLexer(
        async () => {
            loads++;
        },
        () => {
            throw new Error('Tokenizer failed');
        },
    );
    assert.equal(lexer.engine, 'clickhouse');
    assert.throws(() => lexer.scan('SELECT 1'), { message: 'Tokenizer failed' });
    assert.equal(loads, 1);
    assert.equal(lexer.engine, 'clickhouse');
});

test('WASM startup failure keeps the real shared SQL API and guards available', () => {
    const sqlUrl = new URL('../../.core-build/src/shared/sql/sql.js', import.meta.url).href;
    const lexerUrl = new URL('../../.core-build/src/shared/sql/lexer.js', import.meta.url).href;
    const guardsUrl = new URL(
        '../../.core-build/src/backend/queries/execution/guards.js',
        import.meta.url,
    ).href;
    const output = execFileSync(
        process.execPath,
        [
            '--input-type=module',
            '--eval',
            `
        import assert from 'node:assert/strict';
        WebAssembly.instantiate = async () => { throw new Error('WASM blocked'); };
        const { splitSql, formatSql, parameterNames, lexSql } = await import(${JSON.stringify(sqlUrl)});
        const { sqlLexer } = await import(${JSON.stringify(lexerUrl)});
        const { guardSql } = await import(${JSON.stringify(guardsUrl)});
        assert.equal(sqlLexer.engine, 'fallback');
        const sql = '\\uFEFFSELECT $123$😀;DROP$123$; SELECT 2';
        assert.equal(splitSql(sql).length, 2);
        assert.ok(formatSql(sql).includes('$123$😀;DROP$123$'));
        assert.doesNotThrow(() => guardSql('SELECT ‘DROP; hello’'));
        assert.throws(() => guardSql('SELECT 1; DROP TABLE t'), { code: 'SINGLE_STATEMENT' });
        assert.throws(() => guardSql('SELECT 1 #comment'), { code: 'SQL_BOUNDARY' });
        assert.throws(() => lexSql('SELECT $123$unfinished'), { message: 'Unclosed heredoc' });
        assert.deepEqual(parameterNames('SELECT {n:UInt64}'), [{ name: 'n', type: 'UInt64' }]);
        console.log(sqlLexer.engine);
    `,
        ],
        { encoding: 'utf8' },
    );
    assert.equal(output.trim(), 'fallback');
});
