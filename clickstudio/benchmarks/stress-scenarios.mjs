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
        csvCase(20_000, 12),
        sqlCase(),
    ];
}
