import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import {
    EditorView,
    keymap,
    lineNumbers,
    placeholder as editorPlaceholder,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, indentOnInput } from '@codemirror/language';
import { python } from '@codemirror/lang-python';
import { sql } from '@codemirror/lang-sql';
import {
    clickhouse,
    sqlEditorTheme,
    sqlHighlightStyle,
} from '../../queries/editor/components/editor-language';

export function FunctionCodeEditor({
    value,
    onChange,
    language,
    label,
    placeholder = '',
    maxLength,
    disabled = false,
}: {
    value: string;
    onChange: (value: string) => void;
    language: 'python' | 'sql';
    label: string;
    placeholder?: string;
    maxLength?: number;
    disabled?: boolean;
}) {
    const element = useRef<HTMLDivElement>(null);
    const view = useRef<EditorView>(undefined);
    const changed = useRef(onChange);
    const initial = useRef(value);
    const configuration = useRef({ language, label, placeholder, maxLength });
    changed.current = onChange;
    useEffect(() => {
        if (!element.current) return;
        const config = configuration.current;
        const editor = new EditorView({
            parent: element.current,
            state: EditorState.create({
                doc: initial.current,
                extensions: [
                    lineNumbers(),
                    config.language === 'python' ? python() : sql({ dialect: clickhouse }),
                    history(),
                    indentOnInput(),
                    keymap.of([
                        ...defaultKeymap,
                        ...historyKeymap,
                        ...(config.language === 'python' ? [indentWithTab] : []),
                    ]),
                    syntaxHighlighting(sqlHighlightStyle),
                    sqlEditorTheme(false),
                    EditorView.lineWrapping,
                    editorPlaceholder(config.placeholder),
                    EditorState.transactionFilter.of(transaction =>
                        config.maxLength === undefined ||
                        transaction.newDoc.length <= config.maxLength
                            ? transaction
                            : [],
                    ),
                    EditorView.contentAttributes.of({
                        'aria-label': config.label,
                        role: 'textbox',
                        tabindex: '0',
                        'aria-multiline': 'true',
                        ...(config.maxLength === undefined
                            ? {}
                            : { 'aria-description': `Maximum ${config.maxLength} characters.` }),
                    }),
                    EditorView.updateListener.of(update => {
                        if (update.docChanged) changed.current(update.state.doc.toString());
                    }),
                ],
            }),
        });
        view.current = editor;
        return () => {
            editor.destroy();
            view.current = undefined;
        };
    }, []);
    useEffect(() => {
        const editor = view.current;
        if (editor && editor.state.doc.toString() !== value)
            editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
    }, [value]);
    return <div ref={element} className="function-code-editor" inert={disabled} />;
}
