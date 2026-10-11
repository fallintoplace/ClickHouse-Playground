import { forEachDiagnostic, type Diagnostic } from '@codemirror/lint';
import { EditorState, Transaction } from '@codemirror/state';
import { heredocMarkerAt, type SqlScan } from '../../../../shared/sql/lexer-types.js';

export function lexicalDiagnostic(sql: string, scan: SqlScan): Diagnostic | undefined {
    const error = scan.error;
    if (!error) return undefined;
    const from = Math.max(0, Math.min(error.position, sql.length));
    const width = heredocMarkerAt(sql, from)?.length ?? (sql.startsWith('/*', from) ? 2 : 1);
    return {
        from,
        to: Math.min(sql.length, from + width),
        severity: 'error',
        message: error.message,
        source: 'SQL',
    };
}

// Lint navigation selects diagnostic text without a user event. Keep it a caret so
// opening an issue cannot silently turn the next Run into a selected-text Run.
export const diagnosticNavigation = EditorState.transactionFilter.of(transaction => {
    const selection = transaction.selection?.main;
    if (
        !selection ||
        selection.empty ||
        transaction.docChanged ||
        !transaction.scrollIntoView ||
        transaction.annotation(Transaction.userEvent)
    )
        return transaction;
    let diagnosticSelection = false;
    forEachDiagnostic(transaction.startState, (_diagnostic, from, to) => {
        if (selection.from === from && selection.to === to) diagnosticSelection = true;
    });
    return diagnosticSelection
        ? [transaction, { selection: { anchor: selection.to }, sequential: true }]
        : transaction;
});
