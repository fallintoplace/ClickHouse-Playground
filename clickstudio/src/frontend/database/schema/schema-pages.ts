import type { Schema } from '../../../shared/database/schema/types.js';

export function hasSchemaPage(schema: Schema) {
    return Object.values(schema.pagination ?? {}).some(offset => offset !== undefined);
}

export function schemaPagePath(
    connectionId: string,
    pagination?: Schema['pagination'],
    refresh = false,
) {
    const params = new URLSearchParams();
    if (refresh) params.set('refresh', 'true');
    for (const [kind, offset] of Object.entries(pagination ?? {})) {
        if (offset !== undefined) params.set(`${kind.slice(0, -1)}Offset`, String(offset));
    }
    const query = params.size ? `?${params}` : '';
    return `/connections/${encodeURIComponent(connectionId)}/schema${query}`;
}

function mergeByKey<T>(left: T[], right: T[], key: (value: T) => string) {
    const values = new Map(left.map(value => [key(value), value]));
    for (const value of right) values.set(key(value), value);
    return [...values.values()];
}

export function mergeSchemaPages(current: Schema, next: Schema): Schema {
    return {
        ...next,
        databases: [...new Set([...(current.databases ?? []), ...(next.databases ?? [])])],
        tables: mergeByKey(current.tables, next.tables, table =>
            JSON.stringify([table.database, table.name]),
        ),
        columns: mergeByKey(current.columns, next.columns, column =>
            JSON.stringify([column.database, column.table, column.name]),
        ),
        dictionaries: current.dictionaries ?? next.dictionaries,
        warnings: [...new Set([...current.warnings, ...next.warnings])],
        metadataWarnings: [
            ...new Set([...(current.metadataWarnings ?? []), ...(next.metadataWarnings ?? [])]),
        ],
    };
}

export async function reloadSchemaPages(
    pageCount: number,
    loadPage: (pagination?: Schema['pagination']) => Promise<Schema>,
    signal: AbortSignal,
) {
    signal.throwIfAborted();
    let schema = await loadPage();
    signal.throwIfAborted();
    let pages = 1;
    while (pages < pageCount && hasSchemaPage(schema)) {
        const next = await loadPage(schema.pagination);
        signal.throwIfAborted();
        schema = mergeSchemaPages(schema, next);
        pages++;
    }
    return { schema, pages };
}
