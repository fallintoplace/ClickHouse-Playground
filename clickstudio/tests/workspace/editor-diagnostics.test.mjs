import test from 'node:test';
import assert from 'node:assert/strict';
import {
    diagnosticNavigation,
    lexicalDiagnostic,
} from '../../.workspace-build/src/frontend/queries/editor/components/editor-diagnostics.js';
import { EditorState, Transaction } from '@codemirror/state';
import { nextDiagnostic, setDiagnostics } from '@codemirror/lint';
import { createSqlLexer, sqlLexer } from '../../.workspace-build/src/shared/sql/lexer.js';

const fallback = await createSqlLexer(async () => {
    throw new Error('WASM unavailable');
});

test('diagnostic navigation cycles through multi-character spans without selecting SQL', () => {
    let state = EditorState.create({
        doc: 'aaaa bbbb',
        selection: { anchor: 9 },
        extensions: [diagnosticNavigation],
    });
    state = state.update(
        setDiagnostics(state, [
            { from: 0, to: 4, severity: 'error', message: 'first' },
            { from: 5, to: 9, severity: 'error', message: 'second' },
        ]),
    ).state;
    const view = {
        get state() {
            return state;
        },
        dispatch(spec) {
            state = state.update(spec).state;
        },
        plugin() {
            return undefined;
        },
    };
    for (const expected of [4, 9, 4, 9]) {
        assert.equal(nextDiagnostic(view), true);
        assert.equal(state.selection.main.empty, true);
        assert.equal(state.selection.main.head, expected);
    }
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

test('diagnostic navigation keeps a caret while explicit selections still select SQL', () => {
    let state = EditorState.create({
        doc: "SELECT 'unfinished",
        extensions: [diagnosticNavigation],
    });
    const diagnostic = lexicalDiagnostic(state.doc.toString(), sqlLexer.scan(state.doc.toString()));
    state = state.update(setDiagnostics(state, [diagnostic])).state;
    const navigation = state.update({
        selection: { anchor: diagnostic.from, head: diagnostic.to },
        scrollIntoView: true,
    });
    assert.equal(navigation.state.selection.main.empty, true);
    assert.equal(navigation.state.selection.main.from, diagnostic.to);
    for (const event of ['select.pointer', 'select']) {
        const explicit = state.update({
            selection: { anchor: diagnostic.from, head: diagnostic.to },
            scrollIntoView: true,
            annotations: Transaction.userEvent.of(event),
        });
        assert.equal(explicit.state.selection.main.empty, false);
    }
    const unrelated = state.update({ selection: { anchor: 0, head: 6 }, scrollIntoView: true });
    assert.equal(unrelated.state.selection.main.to, 6);
});
