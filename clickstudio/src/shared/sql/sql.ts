import { scanSql } from './lexer.js';
import { isSqlWhitespace, SqlSyntaxError, type Token } from './lexer-types.js';

export { SqlSyntaxError, type Token } from './lexer-types.js';

export interface Statement {
    sql: string;
    from: number;
    to: number;
}
export const EXPLORATION_FORMAT_ERROR = 'FORMAT is not allowed in exploration SQL';

/** A boundary lexer, not a SQL parser or an authorization boundary. */
export function lexSql(sql: string): Token[] {
    const scan = scanSql(sql);
    if (scan.error) throw scan.error;
    return scan.tokens;
}

export function hasTopLevelOutputFormat(sql: string): boolean {
    const tokens = lexSql(sql);
    let depth = 0;
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]!;
        if (token.kind === 'symbol') {
            if (token.text === '(') depth++;
            else if (token.text === ')') depth = Math.max(0, depth - 1);
            continue;
        }
        if (depth !== 0 || token.kind !== 'word' || token.text.toUpperCase() !== 'FORMAT') continue;
        if (tokens[i + 1]?.kind !== 'word') continue;
        let afterFormat = i + 2;
        if (tokens[afterFormat]?.kind === 'symbol' && tokens[afterFormat]?.text === ';')
            afterFormat++;
        if (afterFormat === tokens.length) return true;
    }
    return false;
}

export function splitSql(sql: string): Statement[] {
    return tokenizedStatements(sql).map(({ sql, from, to }) => ({ sql, from, to }));
}

export function tokenizedStatements(sql: string): Array<Statement & { tokens: Token[] }> {
    const tokens = lexSql(sql),
        result: Array<Statement & { tokens: Token[] }> = [];
    let from = 0,
        statementTokens: Token[] = [];
    for (const token of tokens) {
        if (token.text === ';' && token.kind === 'symbol') {
            if (statementTokens.length)
                result.push({ ...trimStatement(sql, from, token.from), tokens: statementTokens });
            from = token.to;
            statementTokens = [];
        } else statementTokens.push(token);
    }
    if (statementTokens.length)
        result.push({ ...trimStatement(sql, from, sql.length), tokens: statementTokens });
    return result;
}
function trimStatement(sql: string, from: number, to: number): Statement {
    while (from < to && isSqlWhitespace(sql[from]!)) from++;
    while (to > from && isSqlWhitespace(sql[to - 1]!)) to--;
    return { sql: sql.slice(from, to), from, to };
}
export function selectedStatement(sql: string, from: number, to = from): Statement | undefined {
    if (to > from) {
        const selection = trimStatement(sql, from, to);
        return splitSql(selection.sql).length ? selection : undefined;
    }
    const all = splitSql(sql);
    return (
        all.find(s => from >= s.from && from <= s.to) ?? all.find(s => s.from > from) ?? all.at(-1)
    );
}

export function hasSqlComments(sql: string): boolean {
    return scanSql(sql).hasComments;
}

/**
 * A conservative layout helper for the editor. It only changes whitespace and
 * clause boundaries; quoted values and comments are protected byte-for-byte.
 * This is intentionally a formatter, not a SQL parser or a semantic rewrite.
 */
export function formatSql(sql: string): string {
    const protectedParts: string[] = [];
    let markerPrefix = '\uE000WB_FMT_';
    while (sql.includes(markerPrefix)) markerPrefix += '_';
    const protectedText = (value: string) => {
        const marker = `${markerPrefix}${protectedParts.length}\uE001`;
        protectedParts.push(value);
        return marker;
    };
    let masked = '';
    let from = 0;
    for (const range of scanSql(sql).protectedRanges) {
        masked += sql.slice(from, range.from);
        const value = sql.slice(range.from, range.to);
        masked += protectedText(value);
        if (value.endsWith('\n')) masked += '\n';
        from = range.to;
    }
    masked += sql.slice(from);
    masked = masked
        .replace(/[ \t\r]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n+/g, '\n')
        .trim();
    masked = masked.replace(/\s*;\s*/g, ';\n');
    masked = masked.replace(
        /\s+(FROM|PREWHERE|WHERE|GROUP BY|HAVING|ORDER BY|LIMIT|OFFSET|UNION ALL|UNION DISTINCT|SETTINGS|FORMAT)\b/gi,
        (_match, keyword: string) => `\n${keyword.toUpperCase()}`,
    );
    masked = masked.replace(
        /\s+(LEFT|RIGHT|FULL|INNER|CROSS)?\s*JOIN\b/gi,
        (_match, side: string | undefined) => `\n${side ? `${side.toUpperCase()} ` : ''}JOIN`,
    );
    masked = masked.replace(
        /\s+(AND|OR)\s+/gi,
        (_match, keyword: string) => `\n  ${keyword.toUpperCase()} `,
    );
    masked = masked
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .join('\n');
    for (let index = 0; index < protectedParts.length; index++) {
        const marker = `${markerPrefix}${index}\uE001`;
        const value = protectedParts[index]!;
        if (value.endsWith('\n')) masked = masked.replaceAll(marker + '\n', () => value);
        masked = masked.replaceAll(marker, () => value);
    }
    return masked;
}
export function quoteIdentifier(name: string): string {
    return '`' + name.replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`';
}

export function quoteStringLiteral(value: string): string {
    return "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

export interface SqlParameter {
    name: string;
    type: string;
}

export function parameterNames(sql: string): SqlParameter[] {
    const tokens = lexSql(sql),
        out = new Map<string, string>();
    for (let i = 0; i < tokens.length; i++) {
        if (
            tokens[i]?.text !== '{' ||
            tokens[i + 1]?.kind !== 'word' ||
            tokens[i + 2]?.text !== ':'
        )
            continue;
        const name = tokens[i + 1]!.text,
            start = tokens[i + 2]!.to;
        let end = i + 3;
        while (end < tokens.length && tokens[end]!.text !== '}') end++;
        if (end === tokens.length) throw new SqlSyntaxError('Unclosed parameter', tokens[i]!.from);
        const type = sql.slice(start, tokens[end]!.from).trim();
        if (!type || (out.has(name) && out.get(name) !== type))
            throw new SqlSyntaxError('Conflicting parameter type', start);
        out.set(name, type);
        i = end;
    }
    return [...out].map(([name, type]) => ({ name, type }));
}
