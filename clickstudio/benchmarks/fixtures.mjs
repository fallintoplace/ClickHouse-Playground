const START_TIME = Date.UTC(2026, 9, 19, 10, 0, 0);

export function makeTimeRows(count, groups = 24) {
    return Array.from({ length: count }, (_, index) => [
        new Date(START_TIME + index * 60_000).toISOString(),
        'group-' + (index % groups),
        (index * 17) % 10_000,
    ]);
}

export function makeCategoryRows(count, categories = 32) {
    return Array.from({ length: count }, (_, index) => [
        'group-' + (index % categories),
        (index * 37) % 1000,
        index % 13 === 0 ? null : { owner: 'user-' + (index % 50), enabled: true },
    ]);
}

export function makeHeatmapRows(count) {
    return Array.from({ length: count }, (_, index) => [
        'x-' + (index % 8),
        'y-' + (Math.floor(index / 8) % 12),
        (index * 17) % 97,
    ]);
}

export function makeCompactPayload(count) {
    const rows = [
        JSON.stringify(['id', 'category', 'value']),
        JSON.stringify(['UInt64', 'String', 'UInt64']),
    ];
    for (let index = 0; index < count; index++) {
        rows.push(
            JSON.stringify([String(index), 'group-' + (index % 32), String((index * 17) % 1000)]),
        );
    }
    return Buffer.from(rows.join('\n') + '\n');
}

export function chunkPayload(payload, size) {
    const chunks = [];
    for (let offset = 0; offset < payload.length; offset += size)
        chunks.push(payload.subarray(offset, offset + size));
    return chunks;
}

export function makeExplorerSchema(count, columnsPerTable = 6) {
    const tables = [];
    const columns = [];
    const databases = Array.from({ length: 8 }, (_, index) => 'db_' + index);
    for (let index = 0; index < count; index++) {
        const database = databases[index % databases.length];
        const name = 'events_' + index;
        tables.push({
            database,
            name,
            engine: 'MergeTree',
            orderBy: 'created_at',
            projections: [{ name: 'by_time', type: 'Normal', sortingKey: 'created_at' }],
            skipIndexes: [],
        });
        for (let column = 0; column < columnsPerTable; column++) {
            columns.push({
                database,
                table: name,
                name: 'metric_' + column,
                type: column % 2 ? 'String' : 'UInt64',
                defaultKind: '',
                comment: '',
            });
        }
    }
    return {
        connectionId: 'benchmark',
        fetchedAt: '2026-10-19T00:00:00.000Z',
        databases,
        tables,
        columns,
        dictionaries: [],
        warnings: [],
        truncated: false,
    };
}

export function makeChartResult(rows, category = false) {
    return {
        runId: 'benchmark',
        queryId: 'benchmark',
        createdAt: '2026-10-19T00:00:00.000Z',
        completeness: 'complete',
        columns: category
            ? [
                  { name: 'category', type: 'String' },
                  { name: 'value', type: 'UInt64' },
                  { name: 'details', type: 'JSON' },
              ]
            : [
                  { name: 'time', type: 'DateTime' },
                  { name: 'group', type: 'String' },
                  { name: 'value', type: 'UInt64' },
              ],
        rows,
    };
}
