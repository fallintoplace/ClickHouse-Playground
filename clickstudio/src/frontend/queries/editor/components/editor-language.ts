import { EditorView } from '@codemirror/view';
import { HighlightStyle } from '@codemirror/language';
import { SQLDialect } from '@codemirror/lang-sql';
import { tags } from '@lezer/highlight';
import { CLICKHOUSE_KEYWORDS } from '../sql-editor-helpers';

export const sqlHighlightStyle = HighlightStyle.define([
    { tag: tags.keyword, color: 'var(--editor-keyword)', fontWeight: '600' },
    { tag: tags.number, color: 'var(--editor-number)' },
    { tag: [tags.bool, tags.null], color: 'var(--editor-literal)' },
    { tag: [tags.string, tags.escape], color: 'var(--editor-string)' },
    { tag: tags.special(tags.string), color: 'var(--editor-foreground)' },
    { tag: tags.standard(tags.name), color: 'var(--editor-function)' },
    { tag: tags.comment, color: 'var(--editor-comment)' },
    { tag: tags.typeName, color: 'var(--editor-type)' },
    { tag: [tags.operator, tags.punctuation], color: 'var(--editor-punctuation)' },
]);
export const sqlEditorTheme = (dark: boolean) =>
    EditorView.theme(
        {
            '&': {
                height: '100%',
                backgroundColor: 'var(--panel)',
                color: 'var(--editor-foreground)',
            },
            '.cm-scroller': {
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--font-size-scale-12)',
                lineHeight: '1.55',
                fontVariantLigatures: 'none',
                fontVariantNumeric: 'tabular-nums',
            },
            '.cm-gutters': {
                backgroundColor: 'var(--panel)',
                color: 'var(--muted)',
                border: 'none',
                fontFamily: 'var(--font-mono)',
                fontVariantNumeric: 'tabular-nums',
            },
            '.cm-content': { minHeight: '220px', caretColor: 'var(--editor-foreground)' },
            '.cm-activeLine': { backgroundColor: 'var(--editor-active-line)' },
            '.cm-activeLineGutter': { backgroundColor: 'var(--editor-active-gutter)' },
            '.cm-cursor': { borderLeftColor: 'var(--text)' },
            '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
                backgroundColor: 'var(--editor-selection)',
            },
        },
        { dark },
    );
export const clickhouseFunctions = [
    ['count', 'Aggregate count of rows'],
    ['sum', 'Aggregate numeric values'],
    ['avg', 'Average numeric values'],
    ['min', 'Minimum value'],
    ['max', 'Maximum value'],
    ['uniq', 'Approximate distinct count'],
    ['uniqExact', 'Exact distinct count'],
    ['quantile', 'Approximate quantile aggregate'],
    ['median', 'Median aggregate'],
    ['toDate', 'Convert a value to Date'],
    ['toDateTime', 'Convert a value to DateTime'],
    ['toStartOfDay', 'Round a DateTime down to the day'],
    ['toStartOfHour', 'Round a DateTime down to the hour'],
    ['now', 'Current server DateTime'],
    ['today', 'Current server Date'],
    ['numbers', 'Generate a sequence of numbers'],
    ['arrayJoin', 'Expand an array into rows'],
    ['arrayMap', 'Map a lambda over an array'],
    ['arrayFilter', 'Filter an array with a lambda'],
    ['multiIf', 'Multi-branch conditional'],
    ['ifNull', 'Replace NULL with a fallback'],
    ['coalesce', 'Return the first non-NULL value'],
] as const;

export const clickhouse = SQLDialect.define({
    keywords: CLICKHOUSE_KEYWORDS.toLowerCase().replace(/\bnull\b/g, ''),
    types: 'String Bool UInt8 UInt16 UInt32 UInt64 UInt128 UInt256 Int8 Int16 Int32 Int64 Int128 Int256 Float32 Float64 Date Date32 DateTime DateTime64 Nullable Array Tuple Map Decimal LowCardinality UUID JSON'.toLowerCase(),
    builtin: clickhouseFunctions.map(([name]) => name.toLowerCase()).join(' '),
    doubleQuotedStrings: false,
    identifierQuotes: '`"',
    hashComments: true,
    slashComments: true,
    backslashEscapes: true,
    doubleDollarQuotedStrings: true,
});
