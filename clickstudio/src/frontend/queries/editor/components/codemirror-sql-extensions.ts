import { StateField, Transaction, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { snippet } from '@codemirror/autocomplete';
import { scanSql } from '../../../../shared/sql/lexer.js';
import {
    appendQuerySeparator,
    statementOutline,
    type StatementOutline,
} from '../sql-editor-helpers.js';

// Cursor movement reuses the outline; only document edits invoke the boundary lexer.
export const sqlStatementOutline = StateField.define<StatementOutline>({
    create: state => statementOutline(state.doc.toString()),
    update: (outline, transaction) =>
        transaction.docChanged ? statementOutline(transaction.newDoc.toString()) : outline,
});

export const sqlLexicalContext = StateField.define({
    create: state => scanSql(state.doc.toString()),
    update: (context, transaction) =>
        transaction.docChanged ? scanSql(transaction.newDoc.toString()) : context,
});

export function appendSqlSnippet(view: EditorView, template: string): boolean {
    const outline = view.state.field(sqlStatementOutline);
    if (outline.error || view.state.readOnly) return false;
    const text = view.state.doc.toString();
    // One normal CodeMirror snippet edit: undoable, with linked fields and Tab navigation.
    snippet(appendQuerySeparator(text) + template)(
        {
            state: view.state,
            dispatch: transaction =>
                view.dispatch(
                    view.state.update({
                        changes: transaction.changes,
                        selection: transaction.selection,
                        effects: transaction.effects,
                        scrollIntoView: transaction.scrollIntoView,
                        annotations: [
                            isolateHistory.of('full'),
                            Transaction.userEvent.of('input.complete'),
                        ],
                    }),
                ),
        },
        null,
        text.length,
        text.length,
    );
    view.focus();
    return true;
}

export function sqlEditorTools(): Extension {
    return [
        sqlStatementOutline,
        sqlLexicalContext,
        EditorView.theme({
            '.cm-gutters': { zIndex: 'var(--z-editor-gutters)' },
        }),
    ];
}
