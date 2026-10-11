import test from 'node:test';
import assert from 'node:assert/strict';
import {
    Compartment,
    EditorSelection,
    EditorState,
    StateEffect,
    Transaction,
} from '@codemirror/state';
import { history, undo, redo, undoDepth, redoDepth } from '@codemirror/commands';
import { foldEffect, foldedRanges, codeFolding } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import {
    restoreSqlEditorState,
    sqlDocumentEdit,
} from '../../.workspace-build/src/frontend/queries/editor/components/editor-session.js';

const extensions = [history(), codeFolding(), EditorState.allowMultipleSelections.of(true)];
const session = state => ({ state });
function commandState(state, command) {
    const success = command({
        state,
        dispatch: transaction => {
            state = transaction.state;
        },
    });
    assert.equal(success, true);
    return state;
}

test('fresh editor sessions clamp persisted selection to the document', () => {
    const state = restoreSqlEditorState(undefined, { value: 'abc', from: -5, to: 100, extensions });
    assert.equal(state.doc.toString(), 'abc');
    assert.equal(state.selection.main.anchor, 0);
    assert.equal(state.selection.main.head, 3);
});

test('restoring a draft retains history, redo, folds, selection direction, and secondary cursors', () => {
    let state = EditorState.create({ doc: 'SELECT (1)', extensions });
    state = state.update({
        changes: { from: 9, insert: ' + 2' },
        annotations: sqlDocumentEdit(),
    }).state;
    state = commandState(state, undo);
    state = state.update({
        selection: EditorSelection.create(
            [EditorSelection.range(5, 2), EditorSelection.cursor(8)],
            0,
        ),
        effects: foldEffect.of({ from: 7, to: 9 }),
    }).state;
    const restored = restoreSqlEditorState(session(state), {
        value: state.doc.toString(),
        from: 2,
        to: 5,
        extensions,
    });
    assert.equal(redoDepth(restored), 1);
    assert.deepEqual(restored.selection.toJSON(), state.selection.toJSON());
    assert.equal(foldedRanges(restored).size, 1);
    assert.equal(commandState(restored, redo).doc.toString(), 'SELECT (1 + 2)');
});

test('restoring a session installs fresh callbacks and compartments', () => {
    const oldListener = () => {};
    const newListener = () => {};
    const oldTheme = new Compartment();
    const newTheme = new Compartment();
    const state = EditorState.create({
        doc: 'abc',
        extensions: [
            extensions,
            EditorView.updateListener.of(oldListener),
            oldTheme.of(EditorState.tabSize.of(2)),
        ],
    });
    const restored = restoreSqlEditorState(session(state), {
        value: 'abc',
        from: 0,
        to: 0,
        extensions: [
            extensions,
            EditorView.updateListener.of(newListener),
            newTheme.of(EditorState.tabSize.of(4)),
        ],
    });
    assert.deepEqual(restored.facet(EditorView.updateListener), [newListener]);
    assert.equal(oldTheme.get(restored), undefined);
    assert.equal(restored.tabSize, 4);
});

test('changed draft SQL restores as its own undo step without joining earlier typing', () => {
    let state = EditorState.create({ doc: 'select 1', extensions });
    state = state.update({
        changes: { from: 8, insert: '2' },
        annotations: Transaction.userEvent.of('input.type'),
    }).state;
    let restored = restoreSqlEditorState(session(state), {
        value: 'SELECT 12',
        from: 9,
        to: 9,
        extensions,
    });
    assert.equal(undoDepth(restored), 2);
    restored = commandState(restored, undo);
    assert.equal(restored.doc.toString(), 'select 12');
    assert.equal(commandState(restored, undo).doc.toString(), 'select 1');
});

test('formatting is isolated from typing immediately before and after it', () => {
    let state = EditorState.create({ doc: 'select 1+2', extensions });
    state = state.update({
        changes: { from: state.doc.length, insert: '3' },
        annotations: Transaction.userEvent.of('input.type'),
    }).state;
    state = state.update({
        changes: { from: 0, to: state.doc.length, insert: 'SELECT 1 + 23' },
        annotations: sqlDocumentEdit(),
    }).state;
    state = state.update({
        changes: { from: state.doc.length, insert: '4' },
        annotations: Transaction.userEvent.of('input.type'),
    }).state;
    state = commandState(state, undo);
    assert.equal(state.doc.toString(), 'SELECT 1 + 23');
    state = commandState(state, undo);
    assert.equal(state.doc.toString(), 'select 1+23');
    assert.equal(commandState(state, undo).doc.toString(), 'select 1+2');
});

test('draft sessions never share undo history', () => {
    let first = restoreSqlEditorState(undefined, { value: 'one', from: 0, to: 0, extensions });
    first = first.update({ changes: { from: 3, insert: '!' } }).state;
    const second = restoreSqlEditorState(undefined, { value: 'two', from: 0, to: 0, extensions });
    assert.equal(undoDepth(second), 0);
    assert.equal(commandState(first, undo).doc.toString(), 'one');
    assert.equal(second.doc.toString(), 'two');
});

test('restoring dynamically appended extensions keeps active snippet navigation', async () => {
    const { snippet, hasNextSnippetField, nextSnippetField } =
        await import('@codemirror/autocomplete');
    let state = EditorState.create({ extensions });
    const appendedExtensions = [];
    snippet('SELECT ${1:id} FROM ${2:events} WHERE ${1:id} > 0;${0}')(
        {
            state,
            dispatch: transaction => {
                for (const effect of transaction.effects)
                    if (effect.is(StateEffect.appendConfig)) appendedExtensions.push(effect.value);
                state = transaction.state;
            },
        },
        null,
        0,
        0,
    );
    assert.equal(hasNextSnippetField(state), true);
    let restored = restoreSqlEditorState(
        { state, appendedExtensions },
        {
            value: state.doc.toString(),
            from: state.selection.main.from,
            to: state.selection.main.to,
            extensions,
        },
    );
    assert.equal(hasNextSnippetField(restored), true);
    restored = commandState(restored, nextSnippetField);
    assert.equal(
        restored.sliceDoc(restored.selection.main.from, restored.selection.main.to),
        'events',
    );
});
