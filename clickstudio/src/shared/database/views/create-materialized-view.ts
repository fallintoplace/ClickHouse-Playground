import { quoteIdentifier, tokenizedStatements } from '../../sql/sql.js';

export function materializedViewSelect(sql: string): string | undefined {
    try {
        const statements = tokenizedStatements(sql);
        const statement = statements[0];
        if (
            statements.length !== 1 ||
            !statement ||
            !['SELECT', 'WITH'].includes(statement.tokens[0]?.text.toUpperCase() ?? '')
        )
            return undefined;
        return statement.sql;
    } catch {
        return undefined;
    }
}

export function createMaterializedViewSql(
    database: string,
    name: string,
    target: { database: string; name: string },
    selectSql: string,
): string {
    const query = materializedViewSelect(selectSql);
    if (!query) throw new Error('Choose a single SELECT query.');
    const qualified = (database: string, name: string) =>
        `${quoteIdentifier(database)}.${quoteIdentifier(name)}`;
    return `CREATE MATERIALIZED VIEW ${qualified(database, name.trim())}\nTO ${qualified(target.database, target.name)}\nAS\n${query}\n;`;
}
