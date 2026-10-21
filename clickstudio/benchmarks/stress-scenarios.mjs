import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { collectCompactStream } from '../.core-build/src/backend/database/clickhouse/result-stream.js';
import { scanFallbackSql } from '../.core-build/src/shared/sql/fallback-lexer.js';
import {
    countRowsByCategory,
    exportCsv,
} from '../.core-build/src/shared/queries/results/results.js';
import {
    categoryAxisLayout,
    fitCategoryTicks,
    formatCount,
} from '../.workspace-build/src/frontend/queries/results/charts/chart-helpers.js';
import { chunkPayload, makeCategoryRows } from './fixtures.mjs';
import {
    makeDistinctLabels,
    makeLargeCompactPayload,
    makeLargeSqlInput,
    makeWideResult,
} from './stress-fixtures.mjs';

// Real collector path: production passes a large-cell context on every local run,
// even when the result contains only short values. Time parsing and inspection
// together, excluding deterministic fixture generation and network transport.
function wideStreamWithLargeCellContextCase(count, width) {
    const fixture = makeWideResult(count, width);
    const payload = Buffer.from(
        [
            JSON.stringify(fixture.columns.map(column => column.name)),
            JSON.stringify(fixture.columns.map(column => column.type)),
            ...fixture.rows.map(JSON.stringify),
        ].join('\n') + '\n',
    );
    const chunks = chunkPayload(payload, 4_096);
    const context = {
        store: {
            save: () => {
                throw new Error('Short cells must not be detached');
            },
        },
        ownerKey: 'benchmark',
        runId: 'wide-result',
        referenceToken: 'benchmark-token',
    };
    return {
        id: `stream/large-cell-scan/${count}-rows-${width}-columns`,
        group: 'stream',
        description: 'Parse wide JSONCompact rows with production large-cell inspection enabled',
        async: true,
        units: 'cells',
        unitsPerOperation: count * width,
        run: () =>
            collectCompactStream(Readable.from(chunks), { rows: count, bytes: 5_000_000 }, context),
        verify: output => {
            assert.equal(output.truncated, false);
            assert.equal(output.rows.length, count);
            assert.equal(output.columns.length, width);
            assert.deepEqual(output.rows[0], fixture.rows[0]);
            assert.deepEqual(output.rows.at(-1), fixture.rows.at(-1));
        },
    };
}

function fragmentedStreamCase(chunkSize) {
    const { payload, value } = makeLargeCompactPayload();
    const chunks = chunkPayload(payload, chunkSize);
    return {
        id: 'stream/large-unicode/1-mib/' + chunkSize + '-byte-chunks',
        group: 'stream',
        description: 'Parse a Unicode JSONCompact row split across small network chunks',
        async: true,
        units: 'bytes',
        unitsPerOperation: payload.length,
        run: () => collectCompactStream(Readable.from(chunks), { rows: 20_000, bytes: 5_000_000 }),
        verify: output => {
            assert.equal(output.truncated, false);
            assert.equal(output.rows.length, 1);
            assert.equal(output.rows[0][1], value);
        },
    };
}

function distinctCategoryCase(count) {
    const rows = makeCategoryRows(count, count);
    return {
        id: 'chart/category-count/' + count + '-unique-categories',
        group: 'chart',
        description: 'Aggregate high-cardinality categorical results',
        units: 'rows',
        unitsPerOperation: count,
        run: () => countRowsByCategory(rows, 0),
        verify: groups => {
            assert.equal(groups.length, count);
            assert.equal(
                groups.reduce((sum, group) => sum + group.count, 0),
                count,
            );
        },
    };
}

function chartAxisCase(count) {
    const labels = makeDistinctLabels(count);
    return {
        id: 'chart/category-axis/' + count + '-long-labels',
        group: 'chart',
        description: 'Compute category axis widths and positions for long distinct labels',
        units: 'labels',
        unitsPerOperation: count,
        run: () => categoryAxisLayout(labels, 652),
        verify: model => {
            assert.equal(model.positions.length, count);
            assert.ok(model.width >= 652);
            assert.ok(model.positions[0] < model.positions.at(-1));
        },
    };
}

function chartTicksCase(count) {
    const labels = makeDistinctLabels(count);
    const positions = categoryAxisLayout(labels, 652).positions;
    const ticks = labels.map((label, index) => ({ label, position: positions[index] }));
    return {
        id: 'chart/category-ticks/' + count + '-long-labels',
        group: 'chart',
        description: 'Wrap high-cardinality labels for SVG axis ticks without DOM painting',
        units: 'labels',
        unitsPerOperation: count,
        run: () => fitCategoryTicks(ticks),
        verify: wrapped => {
            assert.equal(wrapped.length, count);
            assert.equal(wrapped[0].label, labels[0]);
            assert.equal(wrapped.at(-1).label, labels.at(-1));
            assert.ok(wrapped.every(tick => tick.lines.length <= 2));
        },
    };
}

function chartFormatCase(count) {
    const values = Array.from({ length: count }, (_, index) => index * 1001);
    return {
        id: 'chart/number-format/' + count + '-values',
        group: 'chart',
        description: 'Format row counts using the production formatter',
        units: 'values',
        unitsPerOperation: count,
        run: () => values.map(formatCount),
        verify: formatted => {
            assert.equal(formatted.length, count);
            assert.equal(formatted[0], '0');
        },
    };
}

function csvCase(count, width) {
    const result = makeWideResult(count, width);
    return {
        id: 'result/csv/' + count + '-rows-' + width + '-columns',
        group: 'result',
        description: 'Serialize a wide retained result to CSV',
        units: 'cells',
        unitsPerOperation: count * width,
        run: () => exportCsv(result),
        verify: csv => {
            assert.ok(csv.startsWith('column_0,column_1'));
            assert.equal(csv.split('\r\n').length, count + 1);
        },
    };
}

function csvLongTextCase(count) {
    const paragraph = 'ClickStudio text export '.repeat(100);
    const result = {
        columns: [
            { name: 'plain', type: 'String' },
            { name: 'quoted', type: 'String' },
        ],
        rows: Array.from({ length: count }, (_, index) => [
            index % 2 ? ' =SUM(A1)' + paragraph : paragraph,
            index % 2 ? paragraph + ',comma' : paragraph + '"quoted"',
        ]),
    };
    return {
        id: 'result/csv/' + count + '-rows-long-text',
        group: 'result',
        description: 'Serialize retained long text cells to CSV',
        units: 'cells',
        unitsPerOperation: count * 2,
        run: () => exportCsv(result),
        verify: csv => {
            assert.ok(csv.startsWith('plain,quoted\r\n'));
            assert.equal(csv.split('\r\n').length, count + 1);
            assert.ok(csv.includes('""quoted""'));
            assert.ok(csv.includes("' =SUM(A1)"));
        },
    };
}

function sqlCase() {
    const sql = makeLargeSqlInput();
    return {
        id: 'sql/fallback-scan/' + sql.length + '-chars',
        group: 'sql',
        description: 'Lex a large valid SQL script with the fallback lexer',
        units: 'characters',
        unitsPerOperation: sql.length,
        run: () => scanFallbackSql(sql),
        verify: scan => {
            assert.equal(scan.error, undefined);
            assert.ok(scan.tokens.length > 20_000);
        },
    };
}

export function stressScenarios() {
    return [
        wideStreamWithLargeCellContextCase(1_000, 100),
        wideStreamWithLargeCellContextCase(5_000, 100),
        fragmentedStreamCase(4096),
        fragmentedStreamCase(256),
        distinctCategoryCase(5_000),
        distinctCategoryCase(20_000),
        chartAxisCase(200),
        chartAxisCase(1_000),
        chartAxisCase(5_000),
        chartTicksCase(5_000),
        chartFormatCase(5_000),
        csvCase(5_000, 20),
        csvCase(5_000, 40),
        csvCase(20_000, 12),
        csvCase(20_000, 40),
        csvLongTextCase(1_000),
        sqlCase(),
    ];
}
