import type { Schema, SchemaTable } from '../../../shared/database/schema/types.js';
import type { SqlScan } from '../../../shared/sql/lexer-types.js';
import { identifierText, tableAlias, tableAliases } from './tools.js';

export type SchemaIndex = {
    columns: Schema['columns'];
    columnsByTable: Map<string, Schema['columns']>;
    tables: Schema['tables'];
    tablesByName: Map<string, SchemaTable>;
    tablesByFoldedName: Map<string, SchemaTable | null>;
};
const tableKey = (database: string, table: string) => `${database}\u0000${table}`;

export function indexSchema(schema: Schema | undefined, database?: string): SchemaIndex {
    const columns = schema?.columns ?? [];
    const columnsByTable = new Map<string, Schema['columns']>();
    const tablesByName = new Map<string, SchemaTable>();
    const shortNames = new Map<string, SchemaTable[]>();
    for (const column of columns) {
        const key = tableKey(column.database, column.table);
        const grouped = columnsByTable.get(key) ?? [];
        grouped.push(column);
        columnsByTable.set(key, grouped);
    }
    for (const table of schema?.tables ?? []) {
        tablesByName.set(`${table.database}.${table.name}`, table);
        const short = table.name;
        const matches = shortNames.get(short) ?? [];
        matches.push(table);
        shortNames.set(short, matches);
    }
    for (const [name, matches] of shortNames) {
        const preferred = matches.find(table => table.database === database);
        const table = preferred ?? (matches.length === 1 ? matches[0] : undefined);
        if (table) tablesByName.set(name, table);
    }
    const tablesByFoldedName = new Map<string, SchemaTable | null>();
    for (const [name, table] of tablesByName) {
        const key = name.toLowerCase();
        tablesByFoldedName.set(key, tablesByFoldedName.has(key) ? null : table);
    }
    return {
        columns,
        columnsByTable,
        tables: schema?.tables ?? [],
        tablesByName,
        tablesByFoldedName,
    };
}

export function indexedTable(index: SchemaIndex, name: string): SchemaTable | undefined {
    return (
        index.tablesByName.get(name) ??
        index.tablesByFoldedName.get(name.toLowerCase()) ??
        undefined
    );
}

export function tableColumns(index: SchemaIndex, table: SchemaTable): Schema['columns'] {
    return index.columnsByTable.get(tableKey(table.database, table.name)) ?? [];
}

export function tablesInDatabase(index: SchemaIndex, database: string): Schema['tables'] {
    const exact = index.tables.filter(table => table.database === database);
    if (exact.length) return exact;
    const folded = index.tables.filter(
        table => table.database.toLowerCase() === database.toLowerCase(),
    );
    return new Set(folded.map(table => table.database)).size === 1 ? folded : [];
}

export function sqlCompletionProtected(scan: SqlScan, source: string, position: number): boolean {
    return scan.protectedRanges.some(range => {
        if (position >= range.from && position < range.to) return true;
        if (position !== range.to || range.to !== source.length) return false;
        const text = source.slice(range.from, range.to);
        const lineComment = /^(?:--|\/\/|# |#!)/.test(text) && !text.endsWith('\n');
        return lineComment || scan.error?.position === range.from;
    });
}

export type SqlHoverTarget = {
    from: number;
    to: number;
    parts: string[];
    functionCall: boolean;
};

export function sqlHoverTarget(scan: SqlScan, position: number): SqlHoverTarget | undefined {
    const tokens = scan.tokens;
    const at = tokens.findIndex(token => position >= token.from && position < token.to);
    if (at < 0 || identifierText(tokens[at]) === undefined) return undefined;
    let start = at;
    let end = at;
    while (tokens[start - 1]?.text === '.' && identifierText(tokens[start - 2]) !== undefined)
        start -= 2;
    while (tokens[end + 1]?.text === '.' && identifierText(tokens[end + 2]) !== undefined) end += 2;
    const parts: string[] = [];
    for (let i = start; i <= end; i += 2) parts.push(identifierText(tokens[i])!);
    return {
        from: tokens[start]!.from,
        to: tokens[end]!.to,
        parts,
        functionCall: tokens[end + 1]?.text === '(',
    };
}

export function schemaHoverInfo(
    index: SchemaIndex,
    statement: string,
    { parts }: SqlHoverTarget,
): string | undefined {
    const aliases = tableAliases(statement);
    const name = parts.at(-1)!;
    const qualifier = parts.slice(0, -1).join('.');
    const table = qualifier
        ? indexedTable(index, tableAlias(aliases, qualifier) ?? qualifier)
        : undefined;
    let columns: Schema['columns'];
    if (qualifier) {
        columns = table ? tableColumns(index, table) : [];
    } else {
        const referenced = [...new Set(aliases.values())].flatMap(value => {
            const item = indexedTable(index, value);
            return item ? tableColumns(index, item) : [];
        });
        columns = aliases.size ? referenced : index.columns;
    }
    const exact = columns.filter(column => column.name === name);
    const matches = exact.length
        ? exact
        : columns.filter(column => column.name.toLowerCase() === name.toLowerCase());
    if (matches.length === 1) {
        const column = matches[0]!;
        return `${column.database}.${column.table}.${column.name} · ${column.type}${column.comment ? ` · ${column.comment}` : ''}`;
    }
    const hoveredTable = indexedTable(index, parts.join('.'));
    return hoveredTable
        ? `${hoveredTable.database}.${hoveredTable.name} · ${hoveredTable.engine}`
        : undefined;
}
