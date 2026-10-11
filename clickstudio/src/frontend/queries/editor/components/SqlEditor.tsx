import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useMemo,
    useRef,
} from 'react';
import type { RefCallback } from 'react';
import { EditorState, Compartment, StateEffect, StateField } from '@codemirror/state';
import {
    Decoration,
    EditorView,
    hoverTooltip,
    keymap,
    lineNumbers,
    highlightActiveLine,
    drawSelection,
    rectangularSelection,
    type DecorationSet,
} from '@codemirror/view';
import {
    defaultKeymap,
    history,
    historyKeymap,
    indentWithTab,
    indentSelection,
} from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { bracketMatching, foldGutter, foldKeymap, syntaxHighlighting } from '@codemirror/language';
import {
    autocompletion,
    nextSnippetField,
    prevSnippetField,
    type CompletionContext,
    type CompletionResult,
} from '@codemirror/autocomplete';
import { sql } from '@codemirror/lang-sql';
import { closeLintPanel, lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { lexicalDiagnostic } from './editor-diagnostics';
import type { ApiError } from '../../../../shared/common/errors';
import type { Schema } from '../../../../shared/database/schema/types';
import type { SqlErrorRange } from '../sql-error';
import {
    nativeDiagnosticForStatement,
    nativeHighlightRanges,
    type NativeDiagnostic,
    type NativeHighlightType,
    type NativeParseSnapshot,
    type NativeParseStatement,
    type NativeParserStatus,
} from '../../../../shared/sql/parser';
import { formatSql, hasSqlComments, quoteIdentifier } from '../../../../shared/sql/sql';
import {
    activeStatementIndex,
    completionTarget,
    matchingNames,
    tableAliases as aliasesFor,
    tableAlias,
} from '../tools';
import {
    appendSqlSnippet,
    clickhouseSnippetCompletions,
    sqlEditorTools,
    sqlStatementOutline,
    sqlLexicalContext,
} from './editor-tools';
import {
    clickhouse,
    clickhouseFunctions,
    keywordCompletions,
    sqlEditorTheme,
    sqlHighlightStyle,
} from './editor-language';
import {
    indexedTable,
    indexSchema,
    tableColumns,
    tablesInDatabase,
    sqlCompletionProtected,
    sqlHoverTarget,
    schemaHoverInfo,
    type SchemaIndex,
} from '../schema-context';
import {
    captureSqlEditorSession,
    restoreSqlEditorState,
    sqlDocumentEdit,
    type SqlEditorSessions,
} from './editor-session';
import { clickHouseNativeParser } from '../parser/clickhouse-native-parser';
import { ScrollEdgeFrame } from '../../../ui/components/ScrollEdgeShadows';
const setNativeDecorations = StateEffect.define<DecorationSet>();
const nativeDecorations = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update: (value, transaction) => {
        if (transaction.docChanged) value = Decoration.none;
        for (const effect of transaction.effects) {
            if (effect.is(setNativeDecorations)) value = effect.value;
        }
        return value;
    },
    provide: field => EditorView.decorations.from(field),
});
const setServerErrorDecorations = StateEffect.define<DecorationSet>();
const serverErrorDecorations = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update: (value, transaction) => {
        if (transaction.docChanged) value = Decoration.none;
        for (const effect of transaction.effects) {
            if (effect.is(setServerErrorDecorations)) value = effect.value;
        }
        return value;
    },
    provide: field => EditorView.decorations.from(field),
});
const setSqlMapHighlight = StateEffect.define<DecorationSet>();
const sqlMapHighlight = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update: (value, transaction) => {
        if (transaction.docChanged || transaction.selection !== undefined) value = Decoration.none;
        for (const effect of transaction.effects) {
            if (effect.is(setSqlMapHighlight)) value = effect.value;
        }
        return value;
    },
    provide: field => EditorView.decorations.from(field),
});
const nativeDecorationClasses: Partial<Record<NativeHighlightType, string>> = {
    function: 'cm-native-function',
    alias: 'cm-native-alias',
    substitution: 'cm-native-substitution',
    string_escape: 'cm-native-string-escape',
    string_metacharacter: 'cm-native-string-metacharacter',
};

function decorationsForNativeResults(statements: readonly NativeParseStatement[]): DecorationSet {
    const ranges = statements
        .flatMap(statement =>
            nativeHighlightRanges(statement.sql, statement.from, statement.result.highlights),
        )
        .flatMap(range =>
            nativeDecorationClasses[range.type]
                ? [
                      {
                          from: range.from,
                          to: range.to,
                          className: nativeDecorationClasses[range.type]!,
                      },
                  ]
                : [],
        )
        .sort((left, right) => left.from - right.from || left.to - right.to);
    return Decoration.set(
        ranges.map(range =>
            Decoration.mark({ class: range.className }).range(range.from, range.to),
        ),
        true,
    );
}

function completionSource(context: CompletionContext, index: SchemaIndex): CompletionResult | null {
    const source = context.state.doc.toString();
    if (sqlCompletionProtected(context.state.field(sqlLexicalContext), source, context.pos))
        return null;
    const line = context.state.doc.lineAt(context.pos);
    const target = completionTarget(
        context.state.sliceDoc(line.from, context.pos),
        context.explicit,
    );
    if (!target) return null;
    const { qualifier, prefix } = target;
    const statements = context.state.field(sqlStatementOutline).statements;
    const statement = statements[activeStatementIndex(statements, context.pos)];
    const aliases = aliasesFor(statement?.sql ?? '');
    const tableName = qualifier ? (tableAlias(aliases, qualifier) ?? qualifier) : undefined;
    const table = tableName ? indexedTable(index, tableName) : undefined;
    let candidates: typeof index.columns;

    if (table) {
        candidates = tableColumns(index, table);
    } else if (qualifier) {
        candidates = [];
    } else {
        candidates = index.columns;
    }
    const columns = matchingNames(candidates, column => column.name, prefix).map(column => ({
        label: column.name,
        apply: quoteIdentifier(column.name),
        type: 'variable',
        detail: `${column.type} · ${column.database}.${column.table}`,
    }));
    let tableCandidates: typeof index.tables;

    if (qualifier) {
        if (table) {
            tableCandidates = [];
        } else {
            tableCandidates = tablesInDatabase(index, qualifier);
        }
    } else {
        tableCandidates = index.tables;
    }
    const tables = matchingNames(
        tableCandidates,
        item => (qualifier ? item.name : `${item.database}.${item.name}`),
        prefix,
    ).map(item => ({
        label: qualifier ? item.name : `${item.database}.${item.name}`,
        apply: qualifier
            ? quoteIdentifier(item.name)
            : `${quoteIdentifier(item.database)}.${quoteIdentifier(item.name)}`,
        type: 'class',
        detail: item.engine,
    }));
    const functions = qualifier
        ? []
        : clickhouseFunctions.map(([label, detail]) => ({ label, type: 'function', detail }));
    // Prefix-capped schema options must be recomputed as the user types, not cached with validFor.
    return {
        from: line.from + target.from,
        options: [
            ...functions,
            ...(qualifier ? [] : keywordCompletions),
            ...tables,
            ...columns,
            ...(qualifier ? [] : clickhouseSnippetCompletions),
        ],
    };
}
export interface EditorHandle {
    insert: (text: string) => void;
    insertSnippet: (template: string) => boolean;
    focus: () => void;
    revealRange: (from: number, to: number) => void;
    indent: () => void;
    formatBuiltIn: (source: string) => void;
    retryNativeParser: () => void;
    formatNative: () => Promise<'formatted' | 'fallback' | 'unavailable' | 'rejected'>;
    snapshot: () => {
        sql: string;
        from: number;
        to: number;
    };
}
export interface SqlEditorProps {
    value: string;
    documentId: string;
    sessions: SqlEditorSessions;
    database?: string;
    from: number;
    to: number;
    schema?: Schema;
    dark: boolean;
    parserStatus: NativeParserStatus;
    error?: ApiError;
    errorRange?: SqlErrorRange;
    onChange: (value: string) => void;
    onSelection: (from: number, to: number) => void;
    onNativeParserStatus?: (status: NativeParserStatus) => void;
    onNativeParseSnapshot?: (snapshot?: NativeParseSnapshot) => void;
}
function snapshotEditor(editor: EditorView | undefined, fallback: SqlEditorProps) {
    const state = editor?.state;
    const selection = state?.selection.main;
    return {
        sql: state?.doc.toString() ?? fallback.value,
        from: selection?.from ?? fallback.from,
        to: selection?.to ?? fallback.to,
    };
}

function formatEditorBuiltIn(editor: EditorView | undefined, source: string) {
    if (!editor || editor.state.doc.toString() !== source) return;
    const formatted = formatSql(source);
    if (formatted !== source)
        editor.dispatch({
            changes: { from: 0, to: editor.state.doc.length, insert: formatted },
            annotations: sqlDocumentEdit(),
        });
    editor.focus();
}

export const SqlEditor = forwardRef<EditorHandle, SqlEditorProps>(function SqlEditor(props, ref) {
    const element = useRef<HTMLDivElement>(null),
        view = useRef<EditorView | undefined>(undefined),
        current = useRef(props),
        language = useRef(new Compartment()),
        theme = useRef(new Compartment());
    const setScrollViewport = useRef<RefCallback<HTMLElement> | null>(null);
    const nativeDiagnostics = useRef<NativeDiagnostic[]>([]),
        validationRevision = useRef(0);
    current.current = props;
    const schemaIndex = useMemo(
            () => indexSchema(props.schema, props.database),
            [props.schema, props.database],
        ),
        schemaIndexRef = useRef(schemaIndex);
    schemaIndexRef.current = schemaIndex;
    const applyDiagnostics = useCallback(() => {
        const editor = view.current;
        if (!editor) return;
        const lexical = lexicalDiagnostic(
            editor.state.doc.toString(),
            editor.state.field(sqlLexicalContext),
        );
        const diagnostics: Diagnostic[] = nativeDiagnostics.current.map(item => ({
            ...item,
            severity: 'error' as const,
            source: 'ClickHouse native parser',
        }));
        if (lexical) diagnostics.unshift(lexical);
        const duplicateLexicalError =
            lexical &&
            current.current.error?.code === 'SQL_SYNTAX' &&
            lexical.from === current.current.errorRange?.from &&
            lexical.message === current.current.error.message;
        const errorRange = duplicateLexicalError ? undefined : current.current.errorRange;
        const position = errorRange?.from;
        const from =
            position === undefined
                ? undefined
                : Math.max(0, Math.min(position, editor.state.doc.length));
        const to =
            from === undefined
                ? undefined
                : Math.max(from, Math.min(errorRange?.to ?? from + 1, editor.state.doc.length));
        if (from !== undefined && to !== undefined) {
            diagnostics.push({
                from,
                to,
                severity: 'error',
                message: current.current.error?.message ?? 'ClickHouse reported an error here.',
                source:
                    current.current.error?.code === 'SQL_SYNTAX'
                        ? 'SQL selection'
                        : 'ClickHouse server',
            });
            const decorations =
                editor.state.doc.length > 0
                    ? [
                          Decoration.line({ class: 'cm-server-error-line' }).range(
                              editor.state.doc.lineAt(from).from,
                          ),
                          ...(to > from
                              ? [
                                    Decoration.mark({ class: 'cm-server-error-token' }).range(
                                        from,
                                        to,
                                    ),
                                ]
                              : []),
                      ]
                    : [];
            editor.dispatch({
                effects: setServerErrorDecorations.of(Decoration.set(decorations, true)),
            });
        } else {
            editor.dispatch({ effects: setServerErrorDecorations.of(Decoration.none) });
        }
        editor.dispatch(setDiagnostics(editor.state, diagnostics));
        closeLintPanel(editor);
    }, []);
    const languageExtension = useCallback(() => sql({ dialect: clickhouse }), []);
    const invalidateNativeValidation = useCallback(() => {
        validationRevision.current++;
    }, []);
    const themeExtension = () => sqlEditorTheme(current.current.dark);
    useLayoutEffect(() => {
        if (!element.current) return;
        const p = current.current;
        const session = p.sessions.get(p.documentId);
        const appendedExtensions = [...(session?.appendedExtensions ?? [])];
        const restoredScroll =
            session?.state.doc.toString() === p.value ? session.scroll : undefined;
        let scrollMeasured = false;
        const editor = new EditorView({
            parent: element.current,
            scrollTo: restoredScroll,
            state: restoreSqlEditorState(session, {
                value: p.value,
                from: p.from,
                to: p.to,
                extensions: [
                    sqlEditorTools(),
                    nativeDecorations,
                    serverErrorDecorations,
                    sqlMapHighlight,
                    lineNumbers(),
                    lintGutter(),
                    history(),
                    drawSelection(),
                    highlightActiveLine(),
                    rectangularSelection(),
                    bracketMatching(),
                    foldGutter(),
                    highlightSelectionMatches(),
                    syntaxHighlighting(sqlHighlightStyle),
                    autocompletion({
                        override: [context => completionSource(context, schemaIndexRef.current)],
                    }),
                    hoverTooltip((view, pos) => {
                        const target = sqlHoverTarget(view.state.field(sqlLexicalContext), pos);
                        if (!target) return null;
                        const statements = view.state.field(sqlStatementOutline).statements;
                        const statement = statements[activeStatementIndex(statements, pos)];
                        const fn =
                            target.functionCall && target.parts.length === 1
                                ? clickhouseFunctions.find(
                                      ([name]) =>
                                          name.toLowerCase() === target.parts[0]!.toLowerCase(),
                                  )
                                : undefined;
                        const info = fn
                            ? `${fn[0]}() · ${fn[1]}`
                            : schemaHoverInfo(schemaIndexRef.current, statement?.sql ?? '', target);
                        if (!info) return null;
                        return {
                            pos: target.from,
                            end: target.to,
                            above: true,
                            create: () => {
                                const dom = document.createElement('div');
                                dom.className = 'sql-hover';
                                dom.textContent = info;
                                return { dom };
                            },
                        };
                    }),
                    language.current.of(languageExtension()),
                    theme.current.of(themeExtension()),
                    EditorState.allowMultipleSelections.of(true),
                    EditorView.contentAttributes.of({
                        'aria-label': 'SQL editor',
                        spellcheck: 'false',
                    }),
                    keymap.of([
                        { key: 'Tab', run: nextSnippetField, shift: prevSnippetField },
                        ...defaultKeymap,
                        ...historyKeymap,
                        ...searchKeymap,
                        ...foldKeymap,
                        indentWithTab,
                    ]),
                    EditorView.updateListener.of(update => {
                        for (const transaction of update.transactions)
                            for (const effect of transaction.effects)
                                if (effect.is(StateEffect.appendConfig))
                                    appendedExtensions.push(effect.value);
                        if (update.docChanged) {
                            nativeDiagnostics.current = [];
                            invalidateNativeValidation();
                            current.current.onChange(update.state.doc.toString());
                        }
                        if (update.docChanged || update.selectionSet) {
                            const s = update.state.selection.main;
                            current.current.onSelection(s.from, s.to);
                        }
                    }),
                ],
            }),
        });
        view.current = editor;
        editor.requestMeasure({
            read: () => null,
            write: () => {
                scrollMeasured = true;
            },
        });
        setScrollViewport.current?.(editor.scrollDOM);
        return () => {
            const captured = captureSqlEditorSession(editor, appendedExtensions);
            if (restoredScroll && !scrollMeasured) captured.scroll = restoredScroll;
            p.sessions.set(p.documentId, captured);
            setScrollViewport.current?.(null);
            editor.destroy();
            view.current = undefined;
        };
    }, [languageExtension, invalidateNativeValidation]);
    useEffect(() => {
        const v = view.current;
        if (v && v.state.doc.toString() !== props.value) {
            const { from, to } = current.current;
            v.dispatch({
                changes: { from: 0, to: v.state.doc.length, insert: props.value },
                annotations: sqlDocumentEdit(),
                selection: {
                    anchor: Math.min(from, props.value.length),
                    head: Math.min(to, props.value.length),
                },
            });
        }
    }, [props.value]);
    useEffect(() => {
        return clickHouseNativeParser.subscribe(status =>
            current.current.onNativeParserStatus?.(status),
        );
    }, []);
    useEffect(() => {
        const editor = view.current,
            revision = ++validationRevision.current;
        nativeDiagnostics.current = [];
        applyDiagnostics();
        editor?.dispatch({ effects: setNativeDecorations.of(Decoration.none) });
        current.current.onNativeParseSnapshot?.(undefined);
        if (!editor || props.parserStatus !== 'ready') return;
        const source = editor.state.doc.toString();
        const outline = editor.state.field(sqlStatementOutline);
        if (outline.error || !outline.statements.length) return;
        const statements = outline.statements.map(statement => ({
            from: statement.from,
            to: statement.to,
            sql: statement.sql,
        }));
        const timer = window.setTimeout(() => {
            const startedAt = performance.now();
            void clickHouseNativeParser
                .parseMany(statements.map(statement => statement.sql))
                .then(results => {
                    if (
                        revision !== validationRevision.current ||
                        editor.state.doc.toString() !== source
                    )
                        return;
                    const parsedStatements: NativeParseStatement[] = statements.map(
                        (statement, index) => ({
                            ...statement,
                            result: results[index] ?? {},
                        }),
                    );
                    const snapshot: NativeParseSnapshot = {
                        statements: parsedStatements,
                        elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
                    };
                    nativeDiagnostics.current = results.flatMap((result, index) => {
                        const error = result.error,
                            statement = statements[index];
                        return error && statement
                            ? [nativeDiagnosticForStatement(statement.sql, statement.from, error)]
                            : [];
                    });
                    editor.dispatch({
                        effects: setNativeDecorations.of(
                            decorationsForNativeResults(parsedStatements),
                        ),
                    });
                    current.current.onNativeParseSnapshot?.(snapshot);
                    applyDiagnostics();
                })
                .catch(() => {
                    if (
                        revision !== validationRevision.current ||
                        editor.state.doc.toString() !== source
                    )
                        return;
                    nativeDiagnostics.current = [];
                    editor.dispatch({ effects: setNativeDecorations.of(Decoration.none) });
                    current.current.onNativeParseSnapshot?.(undefined);
                    applyDiagnostics();
                });
        }, 250);
        return () => {
            invalidateNativeValidation();
            window.clearTimeout(timer);
        };
    }, [props.parserStatus, props.value, applyDiagnostics, invalidateNativeValidation]);
    useEffect(() => {
        const v = view.current;
        if (!v) return;
        const from = Math.min(props.from, v.state.doc.length),
            to = Math.min(props.to, v.state.doc.length);
        if (v.state.selection.main.from !== from || v.state.selection.main.to !== to)
            v.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
    }, [props.from, props.to]);
    useEffect(() => {
        view.current?.dispatch({ effects: theme.current.reconfigure(themeExtension()) });
    }, [props.dark]);
    useEffect(() => applyDiagnostics(), [props.error, props.errorRange, applyDiagnostics]);
    useImperativeHandle(
        ref,
        () => ({
            insert: text => {
                const v = view.current;
                if (v) {
                    v.dispatch(v.state.replaceSelection(text));
                    v.focus();
                }
            },
            insertSnippet: template => {
                const editor = view.current;
                return editor ? appendSqlSnippet(editor, template) : false;
            },
            focus: () => view.current?.focus(),
            revealRange: (from, to) => {
                const editor = view.current;
                if (!editor) return;
                const start = Math.max(0, Math.min(from, editor.state.doc.length));
                const end = Math.max(start, Math.min(to, editor.state.doc.length));
                const highlight =
                    end > start
                        ? Decoration.set([
                              Decoration.mark({ class: 'cm-sql-map-highlight' }).range(start, end),
                          ])
                        : Decoration.none;
                editor.dispatch({
                    effects: [
                        setSqlMapHighlight.of(highlight),
                        EditorView.scrollIntoView(start, { y: 'center' }),
                    ],
                });
            },
            indent: () => {
                if (view.current) indentSelection(view.current);
            },
            formatBuiltIn: source => formatEditorBuiltIn(view.current, source),
            retryNativeParser: () => clickHouseNativeParser.retry(),
            formatNative: async () => {
                const editor = view.current;
                if (!editor) return 'rejected';
                const outline = editor.state.field(sqlStatementOutline);
                if (outline.error || !outline.statements.length) return 'rejected';
                const before = editor.state.doc.toString(),
                    statements = outline.statements;
                if (statements.some(statement => hasSqlComments(statement.sql))) return 'fallback';
                try {
                    const results = await clickHouseNativeParser.formatMany(
                        statements.map(statement => statement.sql),
                    );
                    if (view.current !== editor || editor.state.doc.toString() !== before)
                        return 'rejected';
                    const invalid: NativeDiagnostic[] = [];
                    results.forEach((result, index) => {
                        const error = result.error,
                            statement = statements[index];
                        if (error && statement)
                            invalid.push(
                                nativeDiagnosticForStatement(statement.sql, statement.from, error),
                            );
                    });
                    if (invalid.length) {
                        nativeDiagnostics.current = invalid;
                        applyDiagnostics();
                        return 'rejected';
                    }
                    const changes = statements.flatMap((statement, index) => {
                        const formatted = results[index]?.sql;
                        return formatted !== undefined && formatted !== statement.sql
                            ? [{ from: statement.from, to: statement.to, insert: formatted }]
                            : [];
                    });
                    if (changes.length)
                        editor.dispatch({ changes, annotations: sqlDocumentEdit() });
                    editor.focus();
                    return 'formatted';
                } catch {
                    return 'unavailable';
                }
            },
            snapshot: () => snapshotEditor(view.current, current.current),
        }),
        [applyDiagnostics],
    );
    return (
        <ScrollEdgeFrame<HTMLElement> className="sql-editor-scroll-frame">
            {setViewport => {
                setScrollViewport.current = setViewport;
                return <div className="sql-editor" ref={element} />;
            }}
        </ScrollEdgeFrame>
    );
});
