import { heredocMarkerAt, isSqlWhitespace, stopSqlScan, type SqlScan } from './lexer-types.js';

function scanBlockComment(sql: string, start: number) {
    let end = start + 2;
    let depth = 1;
    while (end < sql.length && depth) {
        if (sql.startsWith('/*', end)) {
            depth++;
            end += 2;
        } else if (sql.startsWith('*/', end)) {
            depth--;
            end += 2;
        } else end++;
    }
    return { end, closed: depth === 0 };
}

function closingQuote(opening: string): string | undefined {
    if (opening === '‘') return '’';
    if (opening === '“') return '”';
    if (opening === "'" || opening === '"' || opening === '`') return opening;
    return undefined;
}

function scanQuotedValue(sql: string, start: number, quote: string) {
    if (sql[start] !== quote) {
        const closing = sql.indexOf(quote, start + 1);
        return { end: closing < 0 ? sql.length : closing + 1, closed: closing >= 0 };
    }
    let end = start + 1;
    while (end < sql.length) {
        if (sql[end] === '\\') {
            end = Math.min(sql.length, end + 2);
            continue;
        }
        if (sql[end] === quote) {
            if (sql[end + 1] === quote) {
                end += 2;
                continue;
            }
            return { end: end + 1, closed: true };
        }
        end++;
    }
    return { end, closed: false };
}

function readProtectedToken(sql: string, start: number, scan: SqlScan): number | undefined {
    if (
        sql.startsWith('--', start) ||
        sql.startsWith('//', start) ||
        sql.startsWith('# ', start) ||
        sql.startsWith('#!', start)
    ) {
        const newline = sql.indexOf('\n', start);
        const end = newline < 0 ? sql.length : newline + 1;
        scan.hasComments = true;
        scan.protectedRanges.push({ from: start, to: end });
        return end;
    }
    if (sql.startsWith('/*', start)) {
        scan.hasComments = true;
        const comment = scanBlockComment(sql, start);
        if (!comment.closed) return stopSqlScan(scan, sql, start, 'Unclosed block comment');
        scan.protectedRanges.push({ from: start, to: comment.end });
        return comment.end;
    }
    const quote = closingQuote(sql[start]!);
    if (quote) {
        const quoted = scanQuotedValue(sql, start, quote);
        if (!quoted.closed)
            return stopSqlScan(scan, sql, start, 'Unclosed quoted value or identifier');
        scan.protectedRanges.push({ from: start, to: quoted.end });
        scan.tokens.push({
            text: sql.slice(start, quoted.end),
            from: start,
            to: quoted.end,
            kind: 'quoted',
        });
        return quoted.end;
    }
    if (sql[start] !== '$') return undefined;
    const marker = heredocMarkerAt(sql, start);
    if (!marker) return undefined;
    const closing = sql.indexOf(marker, start + marker.length);
    if (closing < 0) return stopSqlScan(scan, sql, start, 'Unclosed heredoc');
    const end = closing + marker.length;
    scan.protectedRanges.push({ from: start, to: end });
    scan.tokens.push({ text: sql.slice(start, end), from: start, to: end, kind: 'quoted' });
    return end;
}

export function scanFallbackSql(sql: string): SqlScan {
    const scan: SqlScan = { tokens: [], protectedRanges: [], hasComments: false };
    for (let from = 0; from < sql.length;) {
        const ch = sql[from]!;
        if (isSqlWhitespace(ch)) {
            from++;
            continue;
        }
        const protectedEnd = readProtectedToken(sql, from, scan);
        if (protectedEnd !== undefined) {
            from = protectedEnd;
            continue;
        }
        if (ch === '#' || (ch.charCodeAt(0) > 0x7f && ch !== '−') || ch === '\0') {
            stopSqlScan(scan, sql, from, 'Unrecognized SQL token');
            break;
        }
        let to = from + 1;
        const word = /[A-Za-z_$]/.test(ch);
        if (word) while (to < sql.length && /[A-Za-z0-9_$]/.test(sql[to]!)) to++;
        scan.tokens.push({ text: sql.slice(from, to), from, to, kind: word ? 'word' : 'symbol' });
        from = to;
    }
    return scan;
}
