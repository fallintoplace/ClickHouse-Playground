import { TABLE_PREVIEW_ROW_LIMIT } from './limits.js';
import { lexSql, splitSql } from '../../sql/sql.js';

export function fullResultExportSql(sql: string, generatedPreviewLimit?: string): string {
    const statements = splitSql(sql);
    const statement = statements[0]?.sql ?? sql;
    if (statements.length !== 1 || generatedPreviewLimit !== String(TABLE_PREVIEW_ROW_LIMIT))
        return statement;

    const tokens = lexSql(statement);
    if (tokens.length < 2) return statement;
    const limit = tokens[tokens.length - 2]!;
    const value = tokens[tokens.length - 1]!;
    if (
        limit.kind !== 'word' ||
        limit.text.toUpperCase() !== 'LIMIT' ||
        value.text !== String(TABLE_PREVIEW_ROW_LIMIT)
    )
        return statement;

    let depth = 0;
    for (const token of tokens.slice(0, -2)) {
        if (token.kind !== 'symbol') continue;
        if (token.text === '(') depth++;
        else if (token.text === ')') depth = Math.max(0, depth - 1);
    }
    if (depth !== 0) return statement;

    return `${statement.slice(0, limit.from).trimEnd()}${statement.slice(value.to)}`.trimEnd();
}
