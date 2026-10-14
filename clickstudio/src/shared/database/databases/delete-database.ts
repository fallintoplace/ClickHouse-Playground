import { isRecord } from '../../common/values.js';
import { lexSql, quoteIdentifier } from '../../sql/sql.js';
import { isValidTableDatabase } from '../tables/create-table.js';
import { isSystemDatabaseName } from '../tables/delete-table.js';

export function canDropDatabase(database: string) {
    return (
        isValidTableDatabase(database) &&
        database.toLowerCase() !== 'default' &&
        !isSystemDatabaseName(database)
    );
}

export function dropDatabaseSql(database: string) {
    return `DROP DATABASE IF EXISTS ${quoteIdentifier(database)}`;
}

export function isDatabaseDrop(value: unknown): value is { database: string; queryId: string } {
    return (
        isRecord(value) && typeof value.database === 'string' && typeof value.queryId === 'string'
    );
}

export function sqlReferencesQualifiedDatabase(sql: string, database: string) {
    try {
        const tokens = lexSql(sql);
        return tokens.some((token, index) => {
            if (token.kind !== 'word' || !/^(?:FROM|JOIN)$/i.test(token.text)) return false;
            const source = tokens[index + 1];
            return Boolean(
                source &&
                ((source.kind === 'word' && source.text === database) ||
                    source.text === quoteIdentifier(database) ||
                    source.text === `"${database.replaceAll('"', '""')}"`) &&
                tokens[index + 2]?.text === '.',
            );
        });
    } catch {
        return false;
    }
}
