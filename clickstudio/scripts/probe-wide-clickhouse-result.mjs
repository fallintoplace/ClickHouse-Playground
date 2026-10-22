import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { createClient } from '@clickhouse/client';

// Inspect the raw server protocol without passing it through ClickHouse Playground's parser.
// This diagnoses whether a wide-result failure is caused by server output or
// by application framing and retention logic.
const sql =
    [
        'SELECT number AS id',
        "concat('group-', toString(number % 32)) AS category",
        ...Array.from({ length: 20 }, (_, index) => 'number + ' + index + ' AS metric_' + index),
    ].join(', ') + ' FROM numbers(5000000) LIMIT 6000';
const expectedColumns = 22;
const targetRows = 5_100;

const client = createClient({
    url: process.env.CLICKHOUSE_URL ?? 'http://127.0.0.1:8123',
    database: process.env.CLICKHOUSE_DATABASE ?? 'default',
    username: process.env.CLICKHOUSE_USER ?? 'clickstudio_reader',
    password: process.env.CLICKHOUSE_PASSWORD ?? '',
    request_timeout: 60_000,
});
const decoder = new StringDecoder('utf8');
let pending = '';
let stage = 0;
let checkedRows = 0;
let headers = [];

try {
    const response = await client.exec({
        query: sql + '\nFORMAT JSONCompactEachRowWithNamesAndTypes',
        query_id: 'clickstudio-wide-probe-' + randomUUID(),
        clickhouse_settings: {
            readonly: '1',
            max_execution_time: 30,
            max_memory_usage: String(536_870_912),
            max_threads: 4,
            max_result_rows: '100000',
            max_result_bytes: '50000000',
            result_overflow_mode: 'throw',
            max_rows_to_read: '100000000',
            max_bytes_to_read: '5000000000',
            output_format_json_quote_64bit_integers: 1,
            output_format_json_quote_decimals: 1,
        },
    });
    outer: for await (const chunk of response.stream) {
        const decoded = decoder.write(chunk);
        pending += decoded;
        let newline = pending.indexOf('\n');
        while (newline >= 0) {
            const line = pending.slice(0, newline);
            pending = pending.slice(newline + 1);
            newline = pending.indexOf('\n');
            if (!line.trim()) continue;
            const row = JSON.parse(line);
            assert.ok(Array.isArray(row), 'Compact stream must contain arrays');
            if (stage === 0) {
                headers = row;
                assert.equal(headers.length, expectedColumns, 'Column-name count');
                stage++;
            } else if (stage === 1) {
                assert.equal(row.length, headers.length, 'Column-type count');
                stage++;
            } else {
                if (row.length !== headers.length) {
                    throw new Error(
                        'Raw ClickHouse output width mismatch at data row ' +
                            checkedRows +
                            ': expected ' +
                            headers.length +
                            ', received ' +
                            row.length +
                            ', names=' +
                            JSON.stringify(headers.slice(0, 3)) +
                            ', rowPreview=' +
                            JSON.stringify(row.slice(0, 2)).slice(0, 400),
                    );
                }
                const id = Number(row[0]);
                assert.ok(Number.isSafeInteger(id) && id >= 0 && id < 5_000_000);
                assert.equal(row[1], 'group-' + (id % 32), 'Category must match row ID');
                assert.equal(String(row[2]), String(id), 'First metric must match row ID');
                assert.equal(String(row[21]), String(id + 19), 'Last metric must match row ID');
                checkedRows++;
                if (checkedRows >= targetRows) break outer;
            }
        }
    }
    assert.equal(stage, 2, 'Both metadata rows must arrive');
    assert.equal(checkedRows, targetRows, 'The requested raw rows must arrive');
    console.log(
        'Raw compact output: ' +
            headers.length +
            ' columns, ' +
            checkedRows +
            ' checked rows, no width mismatches',
    );
} finally {
    await client.close();
}
