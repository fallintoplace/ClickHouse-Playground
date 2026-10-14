import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, indentOnInput } from '@codemirror/language';
import { python } from '@codemirror/lang-python';
import { sqlEditorTheme, sqlHighlightStyle } from '../../queries/editor/components/editor-language';

export function PythonFunctionEditor({
    value,
    onChange,
    disabled = false,
}: {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
}) {
    const element = useRef<HTMLDivElement>(null);
    const view = useRef<EditorView>(undefined);
    const changed = useRef(onChange);
    const initial = useRef(value);
    changed.current = onChange;
    useEffect(() => {
        if (!element.current) return;
        const editor = new EditorView({
            parent: element.current,
            state: EditorState.create({
                doc: initial.current,
                extensions: [
                    lineNumbers(),
                    python(),
                    history(),
                    indentOnInput(),
                    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
                    syntaxHighlighting(sqlHighlightStyle),
                    sqlEditorTheme(false),
                    EditorView.lineWrapping,
                    EditorView.contentAttributes.of({
                        'aria-label': 'Python source',
                        role: 'textbox',
                        'aria-multiline': 'true',
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
    return <div ref={element} className="python-function-editor" inert={disabled} />;
}
