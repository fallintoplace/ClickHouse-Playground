import test from 'node:test';
import assert from 'node:assert/strict';
import { createSqlLexer, sqlLexer } from '../../.core-build/src/shared/sql/lexer.js';
import { selectedStatement } from '../../.core-build/src/shared/sql/sql.js';
import { createSqlDocumentContext } from '../../.core-build/src/frontend/queries/editor/sql-editor-helpers.js';

const nativeScan = sqlLexer.scan;
const fallback = await createSqlLexer(async () => {
    throw new Error('WASM unavailable');
});

function expectedSelection(sql, from, to = from) {
    try {
        return selectedStatement(sql, from, to);
    } catch {
        return undefined;
    }
}

for (const [engine, scan] of [
    ['clickhouse', nativeScan],
    ['fallback', fallback.scan],
]) {
    test(`${engine} document context reuses SQL boundaries for every cursor position`, t => {
        const tokenize = t.mock.method(sqlLexer, 'scan', scan);
        for (const sql of [
            '',
            '\uFEFF \n',
            '-- comments only;\n/* nested /* ; */ comment */',
            '; ; SELECT 1;;;\n SELECT 2; -- trailing comment',
            "SELECT 'é你好🙂;text', `a;b`;\n SELECT 2",
            '/* leading comment */ SELECT $tag$a;b$tag$; SELECT 2;',
            "SELECT 1; SELECT 'unfinished",
            'SELECT 1; /* unfinished',
        ]) {
            const positions = Array.from({ length: sql.length + 4 }, (_, index) => index - 1);
            const expected = positions.map(position => expectedSelection(sql, position));
            const before = tokenize.mock.callCount();
            const context = createSqlDocumentContext(sql);
            assert.equal(tokenize.mock.callCount(), before + 1);
            for (const [index, position] of positions.entries()) {
                assert.deepEqual(
                    context.selectedStatement(position),
                    expected[index],
                    `${JSON.stringify(sql)} at ${position}`,
                );
            }
            assert.equal(tokenize.mock.callCount(), before + 1);
        }
    });

    test(`${engine} selected text is validated separately from its document`, t => {
        t.mock.method(sqlLexer, 'scan', scan);
        const sql = "  SELECT 1;\n SELECT 'unfinished";
        const context = createSqlDocumentContext(sql);
        assert.equal(context.statementCount, undefined);
        assert.equal(context.selectedStatement(4), undefined);
        assert.deepEqual(context.selectedStatement(0, 10), {
            sql: 'SELECT 1',
            from: 2,
            to: 10,
        });
        assert.equal(context.selectedStatement(sql.indexOf("'"), sql.length), undefined);

        for (const text of [
            "SELECT 'a;b'; SELECT 2; -- tail",
            'SELECT $tag$a;b$tag$; SELECT 2',
            '/* comment */ SELECT 1; SELECT 2;',
            "SELECT 1; SELECT 'unfinished",
        ]) {
            const document = createSqlDocumentContext(text);
            for (let from = 0; from <= text.length; from++) {
                for (let to = from; to <= text.length; to++) {
                    assert.deepEqual(
                        document.selectedStatement(from, to),
                        expectedSelection(text, from, to),
                        `${JSON.stringify(text)} selection ${from}:${to}`,
                    );
                }
            }
        }
    });

    test(`${engine} document edits refresh counts and ranges without invalidating older contexts`, t => {
        const tokenize = t.mock.method(sqlLexer, 'scan', scan);
        const original = createSqlDocumentContext('SELECT 1; SELECT 2');
        const edited = createSqlDocumentContext('SELECT 12345; SELECT 3; SELECT 4');
        const incomplete = createSqlDocumentContext("SELECT 12345; SELECT 'unfinished");
        const repaired = createSqlDocumentContext("SELECT 12345; SELECT 'finished'");
        assert.equal(tokenize.mock.callCount(), 4);
        assert.equal(original.statementCount, 2);
        assert.equal(edited.statementCount, 3);
        assert.equal(incomplete.statementCount, undefined);
        assert.equal(repaired.statementCount, 2);
        assert.deepEqual(original.selectedStatement(12), {
            sql: 'SELECT 2',
            from: 10,
            to: 18,
        });
        assert.deepEqual(edited.selectedStatement(15), {
            sql: 'SELECT 3',
            from: 14,
            to: 22,
        });
        assert.equal(incomplete.selectedStatement(15), undefined);
        assert.deepEqual(repaired.selectedStatement(15), {
            sql: "SELECT 'finished'",
            from: 14,
            to: 31,
        });
        assert.equal(original.selectedStatement(1), original.selectedStatement(7));
        assert.equal(tokenize.mock.callCount(), 4);
    });
}
