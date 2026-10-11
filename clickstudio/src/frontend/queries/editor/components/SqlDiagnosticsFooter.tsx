import type { RefObject } from 'react';
import type { EditorView } from '@codemirror/view';
import { nextDiagnostic, openLintPanel } from '@codemirror/lint';
import { Button } from '../../../ui/components/ui';

export function showSqlIssue(editor: EditorView | undefined) {
    if (!editor) return;
    nextDiagnostic(editor);
    openLintPanel(editor);
}

export function SqlDiagnosticsFooter({
    count,
    editor,
}: {
    count: number;
    editor: RefObject<EditorView | undefined>;
}) {
    if (!count) return null;
    return (
        <div className="sql-editor-diagnostics-footer" aria-live="polite">
            <Button
                variant="ghost"
                className="sql-issue-button"
                onClick={() => showSqlIssue(editor.current)}
            >
                {count} SQL {count === 1 ? 'issue' : 'issues'}
            </Button>
        </div>
    );
}
