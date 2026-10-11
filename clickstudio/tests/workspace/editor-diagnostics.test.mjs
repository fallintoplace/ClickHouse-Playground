import test from 'node:test';
import assert from 'node:assert/strict';
import { lexicalDiagnostic } from '../../.workspace-build/src/frontend/queries/editor/components/editor-diagnostics.js';
import { createSqlLexer, sqlLexer } from '../../.workspace-build/src/shared/sql/lexer.js';

const fallback = await createSqlLexer(async () => {
    throw new Error('WASM unavailable');
});

for (const lexer of [sqlLexer, fallback]) {
    for (const [tail, width, message] of [
        ["'unfinished", 1, 'Unclosed quoted value or identifier'],
        ['"unfinished', 1, 'Unclosed quoted value or identifier'],
        ['`unfinished', 1, 'Unclosed quoted value or identifier'],
        ['/* unfinished', 2, 'Unclosed block comment'],
        ['$tag$unfinished', 5, 'Unclosed heredoc'],
        ['$$unfinished', 2, 'Unclosed heredoc'],
        ['§', 1, 'Unrecognized SQL token'],
    ]) {
        test(`${lexer.engine} marks the opening token after multiline Unicode SQL: ${tail}`, () => {
            const prefix = "SELECT '你好🙂';\nSELECT ";
            const sql = prefix + tail;
            assert.deepEqual(lexicalDiagnostic(sql, lexer.scan(sql)), {
                from: prefix.length,
                to: prefix.length + width,
                severity: 'error',
                message,
                source: 'SQL',
            });
        });
    }
    test(`${lexer.engine} clears lexical diagnostics for corrected and empty SQL`, () => {
        for (const sql of [
            '',
            '  -- comment',
            "SELECT 'finished'",
            'SELECT "column"',
            'SELECT `column`',
            'SELECT /* closed */ 1',
            'SELECT $tag$closed$tag$',
        ])
            assert.equal(lexicalDiagnostic(sql, lexer.scan(sql)), undefined);
    });
}
