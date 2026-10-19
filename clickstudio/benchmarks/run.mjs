import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { collectCompactStream } from '../.core-build/src/backend/database/clickhouse/result-stream.js';
import {
    countRowsByCategory,
    countRowsOverTime,
    filterRows,
    prepareHeatmap,
    previewResultCell,
} from '../.core-build/src/shared/queries/results/results.js';
import {
    buildIndexedObjectExplorer,
    indexObjectExplorer,
} from '../.workspace-build/src/frontend/database/explorer/objects/object-explorer-model.js';
import { prepareChartSelection } from '../.workspace-build/src/frontend/queries/results/charts/controls/chart-selection.js';
import { prepareChartView } from '../.workspace-build/src/frontend/queries/results/charts/rendering/chart-view-model.js';
import { copy } from '../.workspace-build/src/frontend/ui/copy.js';
import {
    chunkPayload,
    makeCategoryRows,
    makeChartResult,
    makeCompactPayload,
    makeExplorerSchema,
    makeHeatmapRows,
    makeTimeRows,
} from './fixtures.mjs';
import { markdownSummary, parseRunOptions, runSuite } from './lib/measure.mjs';
import { boundaryScenarios } from './boundary-scenarios.mjs';
import { stressScenarios } from './stress-scenarios.mjs';
import { pipelineScenarios } from './pipeline-scenarios.mjs';
import { makeWideResult } from './stress-fixtures.mjs';

function streamCase(count, chunkSize) {
    const payload = makeCompactPayload(count);
    const chunks = chunkPayload(payload, chunkSize);
    return {
        id: 'stream/' + count + '-rows/' + chunkSize + '-byte-chunks',
        group: 'stream',
        description: 'JSONCompact stream retained from prebuilt Buffer chunks',
        async: true,
        units: 'rows',
        unitsPerOperation: count,
        run: () => collectCompactStream(Readable.from(chunks), { rows: 20_000, bytes: 5_000_000 }),
        verify: result => {
            assert.equal(result.rows.length, count);
            assert.equal(result.truncated, false);
            assert.equal(result.columns.length, 3);
        },
    };
}

function categoryCase(count) {
    const rows = makeCategoryRows(count, 32);
    return {
        id: 'chart/category-count/' + count + '-rows',
        group: 'chart',
        description: 'Aggregate categories and sort by frequency',
        units: 'rows',
        unitsPerOperation: count,
        run: () => countRowsByCategory(rows, 0),
        verify: groups => {
            assert.equal(groups.length, 32);
            assert.equal(
                groups.reduce((total, group) => total + group.count, 0),
                count,
            );
        },
    };
}

function timeCase(count) {
    const rows = makeTimeRows(count);
    return {
        id: 'chart/time-count/' + count + '-rows',
        group: 'chart',
        description: 'Group time buckets, rank series and sort timestamps',
        units: 'rows',
        unitsPerOperation: count,
        run: () => countRowsOverTime(rows, 0, 1, 5),
        verify: result => {
            assert.equal(result.excludedRows, 0);
            const total = result.series
                .flatMap(series => series.points)
                .reduce((sum, point) => sum + point.count, 0);
            assert.equal(total, count);
        },
    };
}

function heatmapCase(count) {
    const rows = makeHeatmapRows(count);
    return {
        id: 'chart/heatmap/' + count + '-rows',
        group: 'chart',
        description: 'Aggregate repeated cells under the heatmap cell budget',
        units: 'rows',
        unitsPerOperation: count,
        run: () => prepareHeatmap(rows, 0, 1, 2),
        verify: result => {
            assert.equal(result.processedRows, count);
            assert.equal(result.tooLarge, false);
            assert.equal(result.cells.size, 96);
        },
    };
}

function filterCase(count, cached = true) {
    const rows = makeCategoryRows(count, 32);
    const searchableRows = cached
        ? rows.map(row =>
              row.map(value => JSON.stringify(value).toLocaleLowerCase()).join('\u0001'),
          )
        : undefined;
    const matches = rows.filter(row => row[0] === 'group-7').length;
    return {
        id: 'result/' + (cached ? 'filter/' : 'filter-cold/') + count + '-rows',
        group: 'result',
        description: cached
            ? 'Search a retained result page with cached cell text'
            : 'Cold search without a precomputed text index',
        units: 'rows',
        unitsPerOperation: count,
        run: () => filterRows(rows, 'group-7', searchableRows),
        verify: result => {
            assert.equal(result.length, matches);
            assert.ok(result.every(row => row[0] === 'group-7'));
        },
    };
}

function previewCase(count, width) {
    const { rows } = makeWideResult(count, width);
    return {
        id: 'result/preview/' + count + '-rows-' + width + '-columns',
        group: 'result',
        description: 'Format retained result cells without React table painting',
        units: 'cells',
        unitsPerOperation: count * width,
        run: () => rows.map(row => row.map(value => previewResultCell(value))),
        verify: previews => {
            assert.equal(previews.length, count);
            assert.equal(previews[0][0], 'group-0');
            assert.equal(previews.at(-1).length, width);
        },
    };
}

function explorerCases(count) {
    const schema = makeExplorerSchema(count);
    const index = indexObjectExplorer(schema);
    const matching = buildIndexedObjectExplorer(index, 'events_12', 'db_0');
    assert.ok(matching.visibleObjects > 0 && matching.visibleObjects < count);
    return [
        {
            id: 'explorer/index/' + count + '-objects',
            group: 'explorer',
            description: 'Build stable selections and column indexes from a fresh schema',
            units: 'objects',
            unitsPerOperation: count,
            run: () => indexObjectExplorer(schema),
            verify: result => assert.ok(result.selectionById.size >= count * 7),
        },
        {
            id: 'explorer/search/' + count + '-objects',
            group: 'explorer',
            description: 'Warm indexed object-and-column search',
            units: 'objects',
            unitsPerOperation: count,
            run: () => buildIndexedObjectExplorer(index, 'events_12', 'db_0'),
            verify: result => assert.equal(result.visibleObjects, matching.visibleObjects),
        },
    ];
}

function chartViewCase(count, category) {
    const rows = category ? makeCategoryRows(count) : makeTimeRows(count);
    const result = makeChartResult(rows, category);
    const chart = {
        kind: category ? 'bar' : 'line',
        title: 'Benchmark chart',
        x: 0,
        ys: [category ? 1 : 2],
    };
    const selection = prepareChartSelection(result, chart);
    const expectedRows = category ? count : Math.min(count, 240);
    return {
        id: 'chart/view-model/' + (category ? 'bar/' : 'line/') + count + '-rows',
        group: 'chart',
        description: 'Prepare chart plot model without React or SVG rendering',
        units: 'rows',
        unitsPerOperation: count,
        run: () =>
            prepareChartView({
                result,
                chart,
                chartCopy: copy.chart,
                categoryViewportWidth: 652,
                plotViewportWidth: 760,
                selection,
            }),
        verify: model => {
            assert.equal(model.chartRows.length, expectedRows);
            assert.equal(model.chartKind, category ? 'bar' : 'line');
        },
    };
}

function scenarios() {
    return [
        streamCase(1_000, 4096),
        streamCase(5_000, 4096),
        streamCase(1_000, 17),
        categoryCase(5_000),
        timeCase(5_000),
        timeCase(20_000),
        heatmapCase(5_000),
        filterCase(200),
        filterCase(1_000),
        filterCase(1_000, false),
        previewCase(1_000, 20),
        previewCase(5_000, 12),
        ...explorerCases(350),
        ...explorerCases(2_000),
        chartViewCase(5_000, false),
        chartViewCase(5_000, true),
        ...stressScenarios(),
        ...pipelineScenarios(),
        ...boundaryScenarios(),
    ];
}

async function benchmarkFingerprint() {
    const hash = createHash('sha256');
    for (const path of [
        'run.mjs',
        'fixtures.mjs',
        'stress-fixtures.mjs',
        'stress-scenarios.mjs',
        'pipeline-scenarios.mjs',
        'boundary-scenarios.mjs',
        'lib/measure.mjs',
    ]) {
        hash.update(path + '\0');
        hash.update(await readFile(new URL('./' + path, import.meta.url)));
        hash.update('\0');
    }
    return hash.digest('hex');
}

const options = parseRunOptions(process.argv.slice(2));
options.suiteHash = await benchmarkFingerprint();
const report = await runSuite(scenarios(), options);
const destination = resolve(options.output);
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log('Saved benchmark results to ' + destination);
if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, markdownSummary(report), 'utf8');
