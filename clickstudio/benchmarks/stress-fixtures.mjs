/** Synthetic workloads are created before timing. */
export function makeDistinctLabels(count) {
    return Array.from(
        { length: count },
        (_, index) => 'category-' + String(index).padStart(5, '0') + '-with-long-label',
    );
}

export function makeWideResult(count, width) {
    const columns = Array.from({ length: width }, (_, index) => ({
        name: 'column_' + index,
        type: index === 0 ? 'String' : 'UInt64',
    }));
    const rows = Array.from({ length: count }, (_, index) =>
        Array.from({ length: width }, (_, column) =>
            column === 0 ? 'group-' + (index % 40) : String((index * (column + 17)) % 10000),
        ),
    );
    return { columns, rows };
}

export function makeLargeCompactPayload() {
    const value = '🧪'.repeat(256 * 1024);
    const payload = Buffer.from(
        JSON.stringify(['id', 'text']) +
            '\n' +
            JSON.stringify(['UInt64', 'String']) +
            '\n' +
            JSON.stringify(['1', value]) +
            '\n',
    );
    return { payload, value };
}

export function makeLargeSqlInput(maxCharacters = 200_000) {
    const statement = "SELECT number, sum(value) FROM events WHERE region = 'eu';\n";
    return statement.repeat(Math.floor(maxCharacters / statement.length));
}
