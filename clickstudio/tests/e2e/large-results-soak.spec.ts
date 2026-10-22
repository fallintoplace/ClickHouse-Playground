import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import type { Run } from '../../src/shared/queries/execution/types.js';
import { DEFAULT_LIMITS } from '../../src/shared/queries/execution/settings.js';
import { DEFAULT_RESULT_PAGE_ROWS } from '../../src/shared/queries/execution/limits.js';
import {
    jsonRecord,
    openBlankSql,
    openResultFilter,
    replaceSql,
    runButton,
    trust,
} from './helpers.js';

type Workload = {
    name: 'wide' | 'capped';
    retainedRows: number;
    incomingRows: number;
    columns: number;
};

type FrameStats = {
    frames: number;
    maxFrameGapMs: number;
    p95FrameGapMs: number;
    framesOver50Ms: number;
};

type HeapStats = {
    heapUsedBytes: number;
    heapTotalBytes: number;
    documents: number;
    nodes: number;
    jsEventListeners: number;
};

declare global {
    interface Window {
        __clickstudioSoakProbe?: {
            start: () => void;
            stop: () => FrameStats;
        };
    }
}

const WIDE: Workload = {
    name: 'wide',
    retainedRows: 5_000,
    incomingRows: 5_000,
    columns: 40,
};
const CAPPED: Workload = {
    name: 'capped',
    retainedRows: 1_000,
    incomingRows: 100_000,
    columns: 20,
};

function columnsFor(workload: Workload) {
    return Array.from({ length: workload.columns }, (_, index) => ({
        name: 'column_' + index,
        type: index % 4 === 0 ? 'String' : 'UInt64',
    }));
}

function rowsFor(workload: Workload, offset: number, count: number): string[][] {
    const length = Math.max(0, Math.min(count, workload.retainedRows - offset));
    return Array.from({ length }, (_, rowIndex) => {
        const number = offset + rowIndex;
        return Array.from({ length: workload.columns }, (_, columnIndex) => {
            if (columnIndex === 0) return 'entry-' + String(number).padStart(6, '0');
            if (columnIndex % 4 === 0) return 'value-' + number + '-' + columnIndex;
            return String((number * 31 + columnIndex) % 1_000_000);
        });
    });
}

async function mockLargeResultRuns(page: Page) {
    const runs = new Map<string, { run: Run; workload: Workload }>();
    const resultRequests: Array<{ id: string; offset: number; count: number }> = [];
    let snapshotRequests = 0;

    await page.route('**/api/runs**', async route => {
        const request = route.request();
        const url = new URL(request.url());

        if (url.pathname === '/api/runs' && request.method() === 'POST') {
            const input = jsonRecord(request.postDataJSON(), 'Run request');
            if (typeof input.connectionId !== 'string' || typeof input.sql !== 'string')
                throw new Error('Run request must specify a connection and SQL.');
            const index = runs.size;
            const workload = index % 2 === 0 ? WIDE : CAPPED;
            const id = 'browser-soak-' + (index + 1);
            const createdAt = new Date(Date.UTC(2026, 9, 19, 0, 0, index)).toISOString();
            const status = workload.name === 'capped' ? 'truncated' : 'succeeded';
            const columns = columnsFor(workload);
            const run: Run = {
                dataSource: 'fixture',
                id,
                queryId: 'browser-soak-query-' + (index + 1),
                owner: 'local-owner',
                connectionId: input.connectionId,
                sql: input.sql,
                kind: 'query',
                parameters: {},
                limits: { ...DEFAULT_LIMITS },
                tags: {},
                status,
                createdAt,
                startedAt: createdAt,
                finishedAt: createdAt,
                elapsedMs: 1,
                rowCount: workload.retainedRows,
                bytes: workload.retainedRows * workload.columns * 12,
                columns,
                warnings:
                    status === 'truncated'
                        ? ['The result reached the row cap and may be incomplete.']
                        : [],
                sequence: index + 1,
                resultState: 'reopenable',
                requestedBy: 'local-owner',
                executedAs: 'fixture-reader',
                permissionSnapshot: { readonly: true, role: 'viewer' },
                retryPolicy: 'never',
            };
            runs.set(id, { run, workload });
            await route.fulfill({ json: run });
            return;
        }

        if (url.pathname === '/api/runs' && request.method() === 'GET') {
            await route.fulfill({ json: [...runs.values()].map(item => item.run) });
            return;
        }

        const match = url.pathname.match(
            /^\/api\/runs\/(browser-soak-\d+)(?:\/(snapshot|result))?$/,
        );
        if (!match) {
            await route.continue();
            return;
        }
        const record = runs.get(match[1]!);
        if (!record) {
            await route.fulfill({ status: 404, json: { error: 'Unknown mock run' } });
            return;
        }

        const { run, workload } = record;
        const snapshot = {
            runId: run.id,
            queryId: run.queryId,
            columns: run.columns,
            completeness:
                workload.name === 'capped' ? ('truncated' as const) : ('complete' as const),
            ...(workload.name === 'capped' ? { truncationReason: 'rows' as const } : {}),
            createdAt: run.createdAt,
        };

        if (match[2] === 'snapshot') {
            snapshotRequests++;
            await route.fulfill({
                json: {
                    ...snapshot,
                    rows: rowsFor(workload, 0, workload.retainedRows),
                },
            });
            return;
        }
        if (match[2] === 'result') {
            const offset = Number(url.searchParams.get('offset') ?? 0);
            const count = Number(url.searchParams.get('count') ?? DEFAULT_RESULT_PAGE_ROWS);
            if (
                !Number.isSafeInteger(offset) ||
                offset < 0 ||
                !Number.isSafeInteger(count) ||
                count < 1
            ) {
                await route.fulfill({ status: 400, json: { error: 'Invalid page request' } });
                return;
            }
            resultRequests.push({ id: run.id, offset, count });
            await route.fulfill({
                json: {
                    ...snapshot,
                    rows: rowsFor(workload, offset, count),
                    offset,
                    totalRows: workload.retainedRows,
                    nextOffset: offset + count < workload.retainedRows ? offset + count : null,
                },
            });
            return;
        }
        await route.fulfill({ json: run });
    });

    return { runs, resultRequests, snapshots: () => snapshotRequests };
}

async function installFrameProbe(page: Page) {
    await page.addInitScript(() => {
        const gaps: number[] = [];
        let enabled = false;
        let previousFrame = 0;
        const tick = (now: number) => {
            if (enabled && previousFrame > 0 && document.visibilityState === 'visible') {
                if (gaps.length < 50_000) gaps.push(now - previousFrame);
            }
            previousFrame = now;
            requestAnimationFrame(tick);
        };
        window.__clickstudioSoakProbe = {
            start() {
                gaps.length = 0;
                previousFrame = 0;
                enabled = true;
            },
            stop() {
                enabled = false;
                const sorted = [...gaps].sort((left, right) => left - right);
                return {
                    frames: sorted.length,
                    maxFrameGapMs: sorted.at(-1) ?? 0,
                    p95FrameGapMs: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0,
                    framesOver50Ms: sorted.filter(gap => gap > 50).length,
                };
            },
        };
        requestAnimationFrame(tick);
    });
}

async function memorySnapshot(session: CDPSession): Promise<HeapStats> {
    await session.send('HeapProfiler.collectGarbage');
    const heap = await session.send('Runtime.getHeapUsage');
    const dom = await session.send('Memory.getDOMCounters');
    return {
        heapUsedBytes: heap.usedSize,
        heapTotalBytes: heap.totalSize,
        documents: dom.documents,
        nodes: dom.nodes,
        jsEventListeners: dom.jsEventListeners,
    };
}

function renderSummary(report: {
    cycles: number;
    measurements: Array<{
        cycle: number;
        workload: string;
        runRenderMs: number;
        filterMs: number;
        lastPageMs: number;
        frame: FrameStats;
        afterClose: HeapStats;
    }>;
}): string {
    const lines = [
        '## ClickHouse Playground large-result browser soak (diagnostic only)',
        '',
        'Real Chromium UI with deterministic mocked API responses. Timings are not CI gates.',
        'The 100,000-row case models a server-side row cap; it does not send 100,000 rows to the browser.',
        'Post-close safeguards allow up to 128 MiB heap growth and 12,000 extra DOM nodes after warmup.',
        '',
        '| Cycle | Workload | Run + render (ms) | Filter (ms) | Last page (ms) | Worst frame (ms) | After-GC heap (MB) |',
        '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
    ];
    for (const item of report.measurements) {
        lines.push(
            '| ' +
                item.cycle +
                ' | ' +
                item.workload +
                ' | ' +
                item.runRenderMs.toFixed(1) +
                ' | ' +
                item.filterMs.toFixed(1) +
                ' | ' +
                item.lastPageMs.toFixed(1) +
                ' | ' +
                item.frame.maxFrameGapMs.toFixed(1) +
                ' | ' +
                (item.afterClose.heapUsedBytes / 1_000_000).toFixed(1) +
                ' |',
        );
    }
    const first = report.measurements[0]?.afterClose;
    const last = report.measurements.at(-1)?.afterClose;
    if (first && last) {
        lines.push(
            '',
            'After-close heap change: ' +
                ((last.heapUsedBytes - first.heapUsedBytes) / 1_000_000).toFixed(1) +
                ' MB; DOM node change: ' +
                (last.nodes - first.nodes) +
                '; event listener change: ' +
                (last.jsEventListeners - first.jsEventListeners),
        );
    }
    return lines.join('\n') + '\n';
}

test('Large retained results remain usable across repeated runs and cleanup', async ({
    page,
}, testInfo) => {
    const cycles = Number(process.env.BROWSER_SOAK_CYCLES ?? 4);
    expect(Number.isSafeInteger(cycles) && cycles >= 2 && cycles <= 24).toBe(true);
    test.setTimeout(cycles > 4 ? 12 * 60_000 : 6 * 60_000);

    const measurements: Array<{
        cycle: number;
        workload: Workload['name'];
        runRenderMs: number;
        filterMs: number;
        lastPageMs: number;
        scrollMs: number;
        chartMs: number | null;
        rowsInDom: number;
        frame: FrameStats;
        afterClose: HeapStats;
    }> = [];
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await installFrameProbe(page);
    const mocks = await mockLargeResultRuns(page);
    const report = {
        schemaVersion: 2,
        createdAt: new Date().toISOString(),
        gitSha: process.env.GITHUB_SHA ?? null,
        browser: 'chromium',
        cycles,
        workloads: [WIDE, CAPPED],
        note: 'Report only. Mocked ClickHouse API, real React/browser UI. Frame gaps and forced-GC heap samples are diagnostics, not leak or latency guarantees.',
        baseline: null as HeapStats | null,
        measurements,
        pageErrors,
        maxResultPageSize: DEFAULT_RESULT_PAGE_ROWS,
        pageRequests: mocks.resultRequests,
        snapshotRequests: 0,
    };

    try {
        await trust(page, 'Standard');
        await expect(page.locator('.cm-content')).toBeVisible();
        const session = await page.context().newCDPSession(page);
        report.baseline = await memorySnapshot(session);

        for (let index = 0; index < cycles; index++) {
            const workload = index % 2 === 0 ? WIDE : CAPPED;
            await openBlankSql(page);
            await replaceSql(
                page,
                'SELECT number, number * 2 AS value FROM numbers(' +
                    workload.incomingRows +
                    ') /* browser-soak-' +
                    index +
                    ' */',
            );

            await page.evaluate(() => window.__clickstudioSoakProbe?.start());
            const startedAt = performance.now();
            await runButton(page).click();
            const results = page.getByRole('region', { name: 'Query results', exact: true });
            const table = results.getByRole('table', { name: 'Retained query rows' });
            await expect(page.locator('.execution-bar')).toHaveAttribute(
                'data-run-status',
                workload.name === 'capped' ? 'truncated' : 'succeeded',
            );
            await expect(table).toBeVisible();
            await expect(table.locator('tbody tr')).toHaveCount(DEFAULT_RESULT_PAGE_ROWS);
            const runRenderMs = performance.now() - startedAt;
            await expect(table.locator('thead th')).toHaveCount(workload.columns + 1);
            await expect(table.locator('tbody tr').first().locator('td').nth(1)).toHaveText(
                'entry-000000',
            );

            const filterStart = performance.now();
            const filter = await openResultFilter(results);
            await filter.fill('entry-000007');
            await expect(table.locator('tbody tr')).toHaveCount(1);
            await expect(table.locator('tbody tr .row-number')).toHaveText('8');
            await filter.fill('');
            await expect(table.locator('tbody tr')).toHaveCount(DEFAULT_RESULT_PAGE_ROWS);
            const filterMs = performance.now() - filterStart;

            const pageCount = workload.retainedRows / DEFAULT_RESULT_PAGE_ROWS;
            const lastPageStart = performance.now();
            await expect(results.locator('.result-pages-toggle')).toHaveText('1/' + pageCount);
            await results.locator('.result-pages-toggle').click();
            await results.getByRole('button', { name: 'Last page', exact: true }).click();
            await expect(results.locator('.result-pages-toggle')).toHaveText(
                pageCount + '/' + pageCount,
            );
            await expect(table.locator('tbody tr .row-number').last()).toHaveText(
                String(workload.retainedRows),
            );
            const lastPageMs = performance.now() - lastPageStart;
            const lastRow = table.locator('tbody tr').last();
            const lastIndex = workload.retainedRows - 1;
            await expect(lastRow.locator('td').nth(1)).toHaveText(
                'entry-' + String(lastIndex).padStart(6, '0'),
            );
            await expect(lastRow.locator('td').nth(2)).toHaveText(
                String((lastIndex * 31 + 1) % 1_000_000),
            );
            expect(
                mocks.resultRequests.some(
                    request =>
                        request.id === 'browser-soak-' + (index + 1) &&
                        request.offset === workload.retainedRows - DEFAULT_RESULT_PAGE_ROWS,
                ),
                'Last page must request its own bounded slice from the API',
            ).toBe(true);

            const scrollStart = performance.now();
            const scroll = results.locator('.data-table-scroll');
            const horizontal = await scroll.evaluate(element => {
                element.scrollLeft = element.scrollWidth;
                element.scrollTop = element.scrollHeight;
                return {
                    position: element.scrollLeft,
                    maximum: element.scrollWidth - element.clientWidth,
                };
            });
            expect(horizontal.maximum).toBeGreaterThan(0);
            expect(horizontal.position).toBeGreaterThan(0);
            const scrollMs = performance.now() - scrollStart;

            let chartMs: number | null = null;
            if (index === 0) {
                const chartStart = performance.now();
                await results.getByRole('tab', { name: 'Chart', exact: true }).click();
                await expect(results.locator('.chart-canvas svg[role="img"]')).toBeVisible();
                await results.getByRole('tab', { name: 'Table', exact: true }).click();
                await expect(table).toBeVisible();
                chartMs = performance.now() - chartStart;
            }
            const rowsInDom = await table.locator('tbody tr').count();
            expect(rowsInDom).toBeLessThanOrEqual(DEFAULT_RESULT_PAGE_ROWS);
            const frame = await page.evaluate(() => window.__clickstudioSoakProbe!.stop());
            expect(frame.frames).toBeGreaterThan(0);

            const closeTab = page.locator(
                '[role="tablist"][aria-label="SQL documents"] button[aria-label^="Close "]',
            );
            await closeTab.last().click();
            await expect(page.locator('.cm-content')).toBeVisible();
            const afterClose = await memorySnapshot(session);
            const warmup = measurements[0]?.afterClose;
            if (warmup) {
                expect(
                    afterClose.heapUsedBytes - warmup.heapUsedBytes,
                    'Post-GC heap growth after closing tabs must stay below 128 MiB',
                ).toBeLessThan(128 * 1024 * 1024);
                expect(
                    afterClose.nodes - warmup.nodes,
                    'Detached results must not accumulate thousands of DOM nodes',
                ).toBeLessThan(12_000);
            }
            measurements.push({
                cycle: index + 1,
                workload: workload.name,
                runRenderMs,
                filterMs,
                lastPageMs,
                scrollMs,
                chartMs,
                rowsInDom,
                frame,
                afterClose,
            });
        }

        expect(mocks.runs.size).toBe(cycles);
        expect(pageErrors).toEqual([]);
        expect(mocks.resultRequests.length).toBeGreaterThanOrEqual(cycles);
        expect(
            mocks.resultRequests.every(request => request.count <= DEFAULT_RESULT_PAGE_ROWS),
        ).toBe(true);
    } finally {
        report.snapshotRequests = mocks.snapshots();
        const json = JSON.stringify(report, null, 2) + '\n';
        await mkdir('benchmarks/results', { recursive: true });
        await writeFile('benchmarks/results/browser-large-results.json', json);
        await testInfo.attach('browser-large-results.json', {
            body: Buffer.from(json),
            contentType: 'application/json',
        });
        if (process.env.GITHUB_STEP_SUMMARY)
            await appendFile(process.env.GITHUB_STEP_SUMMARY, renderSummary(report));
    }
});
