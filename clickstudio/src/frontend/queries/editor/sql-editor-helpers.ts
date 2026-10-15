import {
    lexSql,
    tokenizedStatements,
    SqlSyntaxError,
    type Statement,
    type Token,
} from '../../../shared/sql/sql.js';

export interface OutlinedStatement extends Statement {
    label: string;
    operation: SqlOperation;
}
export interface StatementOutline {
    statements: OutlinedStatement[];
    error?: string;
}

export type SqlOperation = 'read' | 'insert' | 'update' | 'delete' | 'schema' | 'unknown';

function classifyAlterTokens(tokens: readonly Token[]): SqlOperation {
    let index =
        tokens.findIndex(token => token.kind === 'word' && token.text.toUpperCase() === 'TABLE') +
        1;
    if (index === 0) return 'schema';
    const isIdentifier = (token: Token | undefined) =>
        token?.kind === 'word' || token?.kind === 'quoted';
    if (
        tokens[index]?.kind === 'word' &&
        tokens[index]?.text.toUpperCase() === 'IF' &&
        tokens[index + 1]?.text.toUpperCase() === 'EXISTS'
    )
        index += 2;
    if (isIdentifier(tokens[index])) index++;
    while (tokens[index]?.text === '.' && isIdentifier(tokens[index + 1])) index += 2;
    if (
        tokens[index]?.kind === 'word' &&
        tokens[index]?.text.toUpperCase() === 'ON' &&
        tokens[index + 1]?.kind === 'word' &&
        tokens[index + 1]?.text.toUpperCase() === 'CLUSTER'
    ) {
        index += 2;
        if (isIdentifier(tokens[index])) index++;
    }
    const action = tokens[index]?.kind === 'word' ? tokens[index]?.text.toUpperCase() : undefined;
    if (action === 'UPDATE') return 'update';
    if (
        action === 'DELETE' ||
        (action === 'DROP' &&
            tokens[index + 1]?.kind === 'word' &&
            tokens[index + 1]?.text.toUpperCase() === 'PARTITION')
    )
        return 'delete';
    return 'schema';
}

function classifyTokens(tokens: readonly Token[]): SqlOperation {
    const words = tokens
        .filter(token => token.kind === 'word')
        .map(token => token.text.toUpperCase());
    const first = words[0];
    if (!first) return 'unknown';
    if (['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'EXISTS', 'CHECK'].includes(first)) {
        if (
            first === 'SELECT' &&
            words.some((word, index) => word === 'INTO' && words[index + 1] === 'OUTFILE')
        )
            return 'unknown';
        return 'read';
    }
    if (first === 'WITH')
        return words.includes('SELECT') &&
            !words.some(word => ['INSERT', 'UPDATE', 'DELETE'].includes(word))
            ? 'read'
            : 'unknown';
    if (first === 'INSERT') return 'insert';
    if (first === 'UPDATE') return 'update';
    if (first === 'DELETE' || first === 'TRUNCATE' || first === 'DROP') return 'delete';
    if (first === 'ALTER') return classifyAlterTokens(tokens);
    if (['CREATE', 'RENAME', 'ATTACH', 'DETACH', 'EXCHANGE'].includes(first)) return 'schema';
    return 'unknown';
}

/** Uses the execution boundary lexer, so quoted semicolons never create fake queries. */
export function statementOutline(text: string): StatementOutline {
    try {
        return {
            statements: tokenizedStatements(text).map(({ tokens, ...statement }) => {
                const first = tokens[0];
                const preview = statement.sql
                    .slice((first?.from ?? statement.from) - statement.from)
                    .replace(/\s+/g, ' ')
                    .trim();
                return {
                    ...statement,
                    label: preview.length > 64 ? `${preview.slice(0, 61)}…` : preview,
                    operation: classifyTokens(tokens),
                };
            }),
        };
    } catch (error) {
        if (!(error instanceof SqlSyntaxError)) throw error;
        return { statements: [], error: error.message };
    }
}

/** Matches selectedStatement's cursor behavior in whitespace and at semicolons. */
export function activeStatementIndex(statements: readonly Statement[], position: number): number {
    if (!statements.length) return -1;
    const next = statements.findIndex(statement => position <= statement.to);
    return next < 0 ? statements.length - 1 : next;
}

/** Append a new query without replacing the selection or joining a trailing line comment. */
export function appendQuerySeparator(text: string): string {
    if (!text.length) return '';
    const last = lexSql(text).at(-1);
    if (!last || (last.kind === 'symbol' && last.text === ';')) return '\n\n';
    return text.slice(last.to).trim() ? '\n;\n\n' : ';\n\n';
}

export const CLICKHOUSE_KEYWORDS =
    'SELECT WITH FROM WHERE PREWHERE GROUP BY HAVING ORDER LIMIT OFFSET AS AND OR NOT NULL JOIN LEFT RIGHT INNER FULL CROSS ARRAY UNION ALL DISTINCT EXPLAIN SETTINGS SAMPLE FINAL FORMAT INTO CASE WHEN THEN ELSE END ON USING ASC DESC INSERT VALUES UPDATE DELETE ALTER CREATE DROP TRUNCATE RENAME ATTACH DETACH EXCHANGE TABLE DATABASE VIEW MATERIALIZED TEMPORARY IF EXISTS REPLACE ADD MODIFY COLUMN PARTITION ENGINE PRIMARY KEY TTL CODEC DEFAULT ALIAS SYSTEM SHOW DESCRIBE USE SET IN BETWEEN LIKE ILIKE IS GLOBAL ANY ASOF ANTI SEMI OUTER OVER WINDOW QUALIFY INTERSECT EXCEPT INTERVAL ROWS RANGE UNBOUNDED PRECEDING FOLLOWING CURRENT ROW';

const aliasKeywords = new Set(CLICKHOUSE_KEYWORDS.toLowerCase().split(' '));

export function identifierText(token: Token | undefined): string | undefined {
    if (token?.kind === 'word') return token.text;
    if (token?.kind !== 'quoted' || !['`', '"'].includes(token.text[0]!)) return undefined;
    const quote = token.text[0]!;
    return token.text
        .slice(1, -1)
        .replaceAll(quote + quote, quote)
        .replace(/\\([\\`"])/g, '$1');
}

/**
 * Best-effort table hints, not a SQL name resolver. Ignore comments, strings and table functions.
 */
export function tableAliases(text: string): Map<string, string> {
    const aliases = new Map<string, string>();
    let tokens: Token[];
    try {
        tokens = lexSql(text);
    } catch (error) {
        if (!(error instanceof SqlSyntaxError)) throw error;
        return aliases;
    }
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i]?.kind !== 'word' || !/^(FROM|JOIN)$/i.test(tokens[i]!.text)) continue;
        let next = i + 1;
        const first = identifierText(tokens[next]);
        if (first === undefined) continue;
        const parts = [first];
        next++;
        while (tokens[next]?.text === '.') {
            const part = identifierText(tokens[next + 1]);
            if (part === undefined) break;
            parts.push(part);
            next += 2;
        }
        if (tokens[next]?.text === '(') continue;
        const name = parts.join('.');
        aliases.set(name, name);
        aliases.set(parts.at(-1)!, name);
        if (tokens[next]?.kind === 'word' && tokens[next]?.text.toUpperCase() === 'AS') next++;
        const alias = identifierText(tokens[next]);
        if (
            alias !== undefined &&
            (tokens[next]?.kind === 'quoted' || !aliasKeywords.has(alias.toLowerCase()))
        )
            aliases.set(alias, name);
    }
    return aliases;
}

export function tableAlias(aliases: Map<string, string>, name: string): string | undefined {
    const exact = aliases.get(name);
    if (exact !== undefined) return exact;
    const matches = [...aliases].filter(([key]) => key.toLowerCase() === name.toLowerCase());
    return matches.length === 1 ? matches[0]![1] : undefined;
}
