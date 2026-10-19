import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { collectCompactStream } from '../.core-build/src/backend/database/clickhouse/result-stream.js';
import {
    exportCsv,
    filterRows,
    previewResultCell,
} from '../.core-build/src/shared/queries/results/results.js';
import { chunkPayload, makeCompactPayload } from './fixtures.mjs';
import { makeWideResult } from './stress-fixtures.mjs';

const FIRST_PAGE_ROWS = 50;
const CHUNK_BYTES = 4_096;

// Use the same large-cell inspection path as live local queries. The fixtures
// contain short values, so any detached-cell write is a correctness regression.
const shortCellContext = {
    store: {
        save: () => {
            throw new Error('The benchmark contains no detachable cells');
        },
    },
    ownerKey: 'benchmark',
    runId: 'query-result-pipeline',
    referenceToken: 'benchmark-token',
};

function wideCompactChunks(result) {
    const lines = [
        JSON.stringify(result.columns.map(column => column.name)),
        JSON.stringify(result.columns.map(column => column.type)),
        ...result.rows.map(row => JSON.stringify(row)),
    ];
    return chunkPayload(Buffer.from(lines.join('\n') + '\n'), CHUNK_BYTES);
}

function previewRows(rows) {
    return rows.slice(0, FIRST_PAGE_ROWS).map(row => row.map(value => previewResultCell(value)));
}

function firstPageCase() {
    const count = 1_000;
    const width = 20;
    const chunks = wideCompactChunks(makeWideResult(count, width));
    return {
        id: 'pipeline/first-page/1000-rows-20-columns',
        group: 'pipeline',
        description: 'Parse a streamed result, filter it, and format the first visible page',
        async: true,
        units: 'input cells',
        unitsPerOperation: count * width,
        run: async () => {
            const result = await collectCompactStream(
                Readable.from(chunks),
                { rows: count, bytes: 5_000_000 },
                shortCellContext,
            );
            const matches = filterRows(result.rows, 'group-7');
            return { result, matches: matches.length, visible: previewRows(matches) };
        },
        verify: output => {
            assert.equal(output.result.truncated, false);
            assert.equal(output.result.rows.length, count);
            assert.equal(output.result.columns.length, width);
            assert.equal(output.matches, 25);
            assert.equal(output.visible.length, 25);
            assert.equal(output.visible[0].length, width);
            assert.equal(output.visible[0][0], 'group-7');
            assert.equal(output.visible.at(-1)[0], 'group-7');
        },
    };
}

function wideExportCase() {
    const count = 5_000;
    const width = 40;
    const chunks = wideCompactChunks(makeWideResult(count, width));
    return {
        id: 'pipeline/csv-export/5000-rows-40-columns',
        group: 'pipeline',
        description: 'Parse a wide stream and serialize its complete retained result to CSV',
        async: true,
        units: 'input cells',
        unitsPerOperation: count * width,
        run: async () => {
            const result = await collectCompactStream(
                Readable.from(chunks),
                { rows: count, bytes: 8_000_000 },
                shortCellContext,
            );
            return { result, csv: exportCsv(result) };
        },
        verify: output => {
            assert.equal(output.result.truncated, false);
            assert.equal(output.result.rows.length, count);
            assert.equal(output.result.columns.length, width);
            assert.ok(output.csv.startsWith('column_0,column_1,'));
            assert.equal(output.csv.split('\r\n').length, count + 1);
            assert.ok(output.csv.endsWith(output.result.rows.at(-1).join(',')));
        },
    };
}

function boundedFirstPageCase() {
    const incomingRows = 100_000;
    const retainedRows = 1_000;
    const chunks = chunkPayload(makeCompactPayload(incomingRows), CHUNK_BYTES);
    return {
        id: 'pipeline/row-cap/100000-input-1000-retained',
        group: 'pipeline',
        description:
            'Stop an oversized SELECT result, release the source, and preview retained rows',
        async: true,
        units: 'retained rows',
        unitsPerOperation: retainedRows,
        run: async () => {
            let chunksRead = 0;
            let sourceClosed = false;
            async function* source() {
                try {
                    for (const chunk of chunks) {
                        chunksRead++;
                        yield chunk;
                    }
                } finally {
                    sourceClosed = true;
                }
            }
            const result = await collectCompactStream(source(), {
                rows: retainedRows,
                bytes: 5_000_000,
            });
            return { result, chunksRead, sourceClosed, visible: previewRows(result.rows) };
        },
        verify: output => {
            assert.equal(output.result.truncated, true);
            assert.equal(output.result.truncationReason, 'rows');
            assert.equal(output.result.rows.length, retainedRows);
            assert.equal(output.result.rows.at(-1)[0], '999');
            assert.equal(output.sourceClosed, true);
            assert.ok(output.chunksRead < chunks.length / 2, 'The input must stop early');
            assert.equal(output.visible.length, FIRST_PAGE_ROWS);
            assert.equal(output.visible[0][0], '0');
            assert.equal(output.visible.at(-1)[0], '49');
        },
    };
}

export function pipelineScenarios() {
    return [firstPageCase(), wideExportCase(), boundedFirstPageCase()];
}
