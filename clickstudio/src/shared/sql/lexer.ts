import {
    isError,
    loadLexer,
    tokenizeSync,
    TokenType,
    type Token as NativeToken,
} from '@clickhouse/lexer';
import { scanFallbackSql } from './fallback-lexer.js';
import { heredocMarkerAt, stopSqlScan, type SqlScan, type Token } from './lexer-types.js';

export interface SqlLexer {
    engine: 'clickhouse' | 'fallback';
    scan: (sql: string) => SqlScan;
}

type NativeTokenizer = (sql: string) => NativeToken[];

function utf8Width(codePoint: number): number {
    if (codePoint < 0x80) return 1;
    if (codePoint < 0x800) return 2;
    if (codePoint < 0x10000) return 3;
    return 4;
}

function sourceOffsets(sql: string) {
    let bytes = 0;
    let index = 0;
    return (target: number, decodedLength?: number): number => {
        if (decodedLength !== undefined && target - bytes === decodedLength) {
            index += decodedLength;
            bytes = target;
            return index;
        }
        while (bytes < target && index < sql.length) {
            const codePoint = sql.codePointAt(index)!;
            bytes += utf8Width(codePoint);
            index += codePoint > 0xffff ? 2 : 1;
        }
        return index;
    };
}

function tokenKind(type: number): Token['kind'] {
    if (type === TokenType.BareWord) return 'word';
    if (
        type === TokenType.StringLiteral ||
        type === TokenType.QuotedIdentifier ||
        type === TokenType.HereDoc
    )
        return 'quoted';
    return 'symbol';
}

function lexicalError(type: number): string {
    if (type === TokenType.ErrorMultilineCommentIsNotClosed) return 'Unclosed block comment';
    if (
        type === TokenType.ErrorSingleQuoteIsNotClosed ||
        type === TokenType.ErrorDoubleQuoteIsNotClosed ||
        type === TokenType.ErrorBackQuoteIsNotClosed
    )
        return 'Unclosed quoted value or identifier';
    if (type === TokenType.ErrorWrongNumber) return 'Invalid numeric literal';
    if (type === TokenType.ErrorSingleExclamationMark || type === TokenType.ErrorSinglePipeMark)
        return 'Incomplete SQL operator';
    return 'Unrecognized SQL token';
}

function scanNativeSql(sql: string, tokenize: NativeTokenizer): SqlScan {
    const scan: SqlScan = { tokens: [], protectedRanges: [], hasComments: false };
    const position = sourceOffsets(sql);
    for (const native of tokenize(sql)) {
        const from = position(native.begin);
        const to = position(native.end, native.text.length);
        if (native.type === TokenType.Whitespace) continue;
        if (native.type === TokenType.Comment) {
            scan.hasComments = true;
            const commentTo = !sql.startsWith('/*', from) && sql[to] === '\n' ? to + 1 : to;
            scan.protectedRanges.push({ from, to: commentTo });
            continue;
        }
        if (isError(native.type)) {
            if (native.type === TokenType.ErrorMultilineCommentIsNotClosed) scan.hasComments = true;
            stopSqlScan(scan, sql, from, lexicalError(native.type));
            break;
        }
        const kind = tokenKind(native.type);
        if (kind !== 'quoted' && sql[from] === '$' && heredocMarkerAt(sql, from)) {
            stopSqlScan(scan, sql, from, 'Unclosed heredoc');
            break;
        }
        if (kind === 'quoted') scan.protectedRanges.push({ from, to });
        scan.tokens.push({ text: sql.slice(from, to), from, to, kind });
    }
    return scan;
}

export async function createSqlLexer(
    load: () => Promise<void> = loadLexer,
    tokenize: NativeTokenizer = tokenizeSync,
): Promise<SqlLexer> {
    try {
        await load();
        return { engine: 'clickhouse', scan: sql => scanNativeSql(sql, tokenize) };
    } catch {
        return { engine: 'fallback', scan: scanFallbackSql };
    }
}

export const sqlLexer = await createSqlLexer();

export function scanSql(sql: string): SqlScan {
    return sqlLexer.scan(sql);
}
