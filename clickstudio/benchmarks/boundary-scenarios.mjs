import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { collectCompactStream } from '../.core-build/src/backend/database/clickhouse/result-stream.js';
import { exportCsv } from '../.core-build/src/shared/queries/results/results.js';
import { chunkPayload, makeCompactPayload } from './fixtures.mjs';
import { makeLargeCompactPayload } from './stress-fixtures.mjs';

function streamLimitCase(reason) {
    const inputRows = 5_000;
    const limits =
        reason === 'rows' ? { rows: 1_000, bytes: 5_000_000 } : { rows: 20_000, bytes: 16_384 };
    const chunks = chunkPayload(makeCompactPayload(inputRows), 4_096);
    return {
        id: 'stream/truncation/' + reason + '/' + inputRows + '-input-rows',
        group: 'stream',
        description: 'Stop collecting a large result at the ' + reason + ' cap',
        async: true,
        units: reason === 'rows' ? 'retained rows' : 'retained bytes',
        unitsPerOperation: reason === 'rows' ? limits.rows : limits.bytes,
        run: () => collectCompactStream(Readable.from(chunks), limits),
        verify: result => {
            assert.equal(result.truncated, true);
            assert.equal(result.truncationReason, reason);
            assert.equal(result.columns.length, 3);
            assert.ok(result.rows.length > 0 && result.rows.length < inputRows);
            assert.deepEqual(result.rows[0], ['0', 'group-0', '0']);
            assert.equal(result.rows.at(-1)[0], String(result.rows.length - 1));
            if (reason === 'rows') assert.equal(result.rows.length, limits.rows);
            else assert.ok(result.bytes <= limits.bytes);
        },
    };
}

function oversizedCellCase() {
    const { payload } = makeLargeCompactPayload();
    const chunks = chunkPayload(payload, 256);
    const byteLimit = 65_536;
    return {
        id: 'stream/truncation/oversized-unicode-row',
        group: 'stream',
        description: 'Reject a 1 MiB Unicode row before allocating it as a retained result',
        async: true,
        units: 'byte cap',
        unitsPerOperation: byteLimit,
        run: () =>
            collectCompactStream(Readable.from(chunks), {
                rows: 1_000,
                bytes: byteLimit,
            }),
        verify: result => {
            assert.equal(result.truncated, true);
            assert.equal(result.truncationReason, 'bytes');
            assert.equal(result.columns.length, 2);
            assert.equal(result.rows.length, 0);
            assert.ok(result.bytes <= byteLimit);
        },
    };
}

function csvEscapingCase() {
    const cases = [
        { row: ['hello,world', '42', '"quoted"'], csv: '"hello,world",42,"""quoted"""' },
        { row: ['=SUM(A1:A2)', '-42', 'line\nbreak'], csv: '\'=SUM(A1:A2),-42,"line\nbreak"' },
        { row: ['  @alert', '0', 'safe'], csv: "'  @alert,0,safe" },
        { row: ['normal', '13', 'a,b'], csv: 'normal,13,"a,b"' },
    ];
    const count = 5_000;
    const columns = [
        { name: 'text', type: 'String' },
        { name: 'value', type: 'Int64' },
        { name: 'details', type: 'String' },
    ];
    const rows = Array.from({ length: count }, (_, index) => cases[index % cases.length].row);
    const expectedCsv = [
        'text,value,details',
        ...Array.from({ length: count }, (_, index) => cases[index % cases.length].csv),
    ].join('\r\n');
    const expectedHash = createHash('sha256').update(expectedCsv).digest('hex');
    return {
        id: 'result/csv/5000-rows-escaping',
        group: 'result',
        description: 'CSV quoting, Unicode-safe line breaks and spreadsheet-formula escaping',
        units: 'cells',
        unitsPerOperation: count * columns.length,
        run: () => exportCsv({ columns, rows }),
        verify: csv => {
            assert.equal(csv.length, expectedCsv.length);
            assert.equal(createHash('sha256').update(csv).digest('hex'), expectedHash);
        },
    };
}

export function boundaryScenarios() {
    return [
        streamLimitCase('rows'),
        streamLimitCase('bytes'),
        oversizedCellCase(),
        csvEscapingCase(),
    ];
}
