import { EditorState, StateEffect, Transaction, type Extension } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';

export type SqlEditorSession = {
    state: EditorState;
    scroll: ReturnType<EditorView['scrollSnapshot']>;
    appendedExtensions: Extension[];
    showDiagnostics?: boolean;
};
export type SqlEditorSessions = Map<string, SqlEditorSession>;

export const sqlDocumentEdit = () => [
    isolateHistory.of('full'),
    Transaction.userEvent.of('input.format'),
];

export function restoreSqlEditorState(
    session: SqlEditorSession | undefined,
    {
        value,
        from,
        to,
        extensions,
    }: {
        value: string;
        from: number;
        to: number;
        extensions: Extension;
    },
): EditorState {
    const selection = {
        anchor: Math.max(0, Math.min(from, value.length)),
        head: Math.max(0, Math.min(to, value.length)),
    };
    if (!session) return EditorState.create({ doc: value, selection, extensions });
    let state = session.state.update({
        effects: StateEffect.reconfigure.of([extensions, session.appendedExtensions ?? []]),
    }).state;
    if (state.doc.toString() !== value)
        state = state.update({
            changes: { from: 0, to: state.doc.length, insert: value },
            selection,
            annotations: sqlDocumentEdit(),
        }).state;
    return state;
}

export function captureSqlEditorSession(
    editor: EditorView,
    appendedExtensions: Extension[],
    showDiagnostics: boolean,
): SqlEditorSession {
    return {
        state: editor.state,
        scroll: editor.scrollSnapshot(),
        appendedExtensions,
        showDiagnostics,
    };
}
