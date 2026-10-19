import { expect, test, type Locator, type Page } from '@playwright/test';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { DEFAULT_RESULT_PAGE_ROWS } from '../../src/shared/queries/execution/limits.js';
import { jsonRecord, openBlankSql, openResultFilter, replaceSql, runButton } from './helpers.js';

type BrowserSample = {
    cycle: number;
    scenario: 'scan' | 'bounded' | 'unbounded';
    sourceRows: number;
    retainedRows: number;
    runAndRenderMs: number;
    backendMs: number;
    filterMs?: number;
    lastPageMs?: number;
    maxFrameGapMs: number;
    p95FrameGapMs: number;
    observedFrames: number;
    frameGapsOver50Ms: number;
    heapAfterCloseBytes: number;
    domNodesAfterClose: number;
};

declare global {
    interface Window {
        __clickstudioLiveFrameProbe?: {
            start: () => void;
            stop: () => {
                maxGapMs: number;
                p95GapMs: number;
                frames: number;
                gapsOver50Ms: number;
            };
        };
    }
}

const SOURCE_ROWS = 5_000_000;
const EXPECTED_SUM = ((BigInt(SOURCE_ROWS) * BigInt(SOURCE_ROWS - 1)) / 2n).toString();
const WIDE_SQL =
    [
        'SELECT number AS id',
        "concat('group-', toString(number % 32)) AS category",
        ...Array.from({ length: 20 }, (_, index) => 'number + ' + index + ' AS metric_' + index),
    ].join(', ') +
    ' FROM numbers(' +
    SOURCE_ROWS +
    ') LIMIT 6000';
const SCAN_SQL = 'SELECT sum(number) AS total FROM numbers(' + SOURCE_ROWS + ')';
const UNBOUNDED_SQL = 'SELECT * FROM numbers(' + SOURCE_ROWS + ')';

function requiredString(record: Record<string, unknown>, key: string): string {
    const value = record[key];
    if (typeof value !== 'string') throw new Error('Missing string field: ' + key);
    return value;
}

function requiredNumber(record: Record<string, unknown>, key: string): number {
    const value = record[key];
    if (typeof value !== 'number' || !Number.isFinite(value))
        throw new Error('Missing numeric field: ' + key);
    return value;
}

async function assertWideRow(row: Locator) {
    const cells = row.locator('td');
    await expect(cells).toHaveCount(23);
    const id = Number(await cells.nth(1).innerText());
    expect(Number.isSafeInteger(id)).toBe(true);
    expect(id).toBeGreaterThanOrEqual(0);
    expect(id).toBeLessThan(SOURCE_ROWS);
    await expect(cells.nth(2)).toHaveText('group-' + (id % 32));
    await expect(cells.nth(3)).toHaveText(String(id));
    await expect(cells.nth(22)).toHaveText(String(id + 19));
}

async function assertUnboundedRow(row: Locator) {
    const cells = row.locator('td');
    await expect(cells).toHaveCount(2);
    const value = Number(await cells.nth(1).innerText());
    expect(Number.isSafeInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(SOURCE_ROWS);
}

async function inspectUnexpectedSuccess(
    page: Page,
    runId: string,
    run: Record<string, unknown>,
    expected: 'succeeded' | 'truncated',
) {
    if (expected !== 'truncated' || run.status !== 'succeeded') return;
    const result = await page.request.get(
        '/api/runs/' + encodeURIComponent(runId) + '/result?count=2',
    );
    const actual = result.ok()
        ? ((await result.json()) as unknown)
        : { responseStatus: result.status() };
    const pageData = jsonRecord(actual, 'Unexpected successful run result');
    throw new Error(
        'Expected truncated result but ClickHouse reported success: ' +
            JSON.stringify({
                sql: run.sql,
                kind: run.kind,
                queryId: run.queryId,
                rowCount: run.rowCount,
                bytes: run.bytes,
                limits: run.limits,
                columns: run.columns,
                tags: run.tags,
                resultColumns: pageData.columns,
                resultRows: pageData.rows,
            }),
    );
}

async function runSql(page: Page, sql: string, status: 'succeeded' | 'truncated') {
    await openBlankSql(page);
    await replaceSql(page, sql);
    const createdResponse = page.waitForResponse(
        response =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === '/api/runs',
    );
    const started = performance.now();
    await runButton(page).click();
    const response = await createdResponse;
    expect(response.status()).toBe(202);
    const createdRaw: unknown = await response.json();
    const created = jsonRecord(createdRaw, 'New ClickHouse run');
    expect(created.sql, 'Server must execute the SQL currently in the editor').toBe(sql);
    const id = requiredString(created, 'id');
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    const table = results.getByRole('table', { name: 'Retained query rows' });
    let completed: Record<string, unknown> | undefined;
    await expect
        .poll(
            async () => {
                const response = await page.request.get('/api/runs/' + encodeURIComponent(id));
                expect(response.ok()).toBe(true);
                const raw: unknown = await response.json();
                const run = jsonRecord(raw, 'ClickHouse run');
                if (
                    ['failed', 'cancelled', 'timed_out', 'interrupted'].includes(String(run.status))
                ) {
                    // Include the actual app error, not just the rendered status, in CI failures.
                    throw new Error(
                        'Live ClickHouse run ' +
                            id +
                            ' ended with ' +
                            String(run.status) +
                            ': ' +
                            JSON.stringify(run.error ?? run.warnings ?? {}).slice(0, 2000),
                    );
                }
                await inspectUnexpectedSuccess(page, id, run, status);
                if (run.status === status) completed = run;
                return run.status;
            },
            { timeout: 60_000, intervals: [100, 300, 700, 1_000] },
        )
        .toBe(status);
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', status);
    await expect(table).toBeVisible();
    if (!completed) throw new Error('Expected a completed run from the live API.');
    const run = completed;
    expect(run.dataSource).toBe('clickhouse');
    expect(run.connectionId).toBe('local');
    expect(run.status).toBe(status);
    expect(run.resultState).toBe('reopenable');
    expect(run.sql).toBe(sql);
    return { id, results, table, run, runAndRenderMs: performance.now() - started };
}

function scenarioForCycle(cycle: number, cycles: number): BrowserSample['scenario'] {
    if (cycles >= 4 && cycle === cycles - 1) return 'unbounded';
    return cycle % 2 === 0 ? 'scan' : 'bounded';
}

function sqlForScenario(scenario: BrowserSample['scenario']): string {
    if (scenario === 'bounded') return WIDE_SQL;
    if (scenario === 'unbounded') return UNBOUNDED_SQL;
    return SCAN_SQL;
}

async function verifyCappedResult(
    output: Awaited<ReturnType<typeof runSql>>,
    scenario: 'bounded' | 'unbounded',
    pageRequests: Array<{ runId: string; offset: number; count: number }>,
) {
    const { results, table, run } = output;
    expect(requiredNumber(run, 'rowCount')).toBe(5_000);
    expect(requiredNumber(run, 'bytes')).toBeLessThanOrEqual(2_000_000);
    await expect(table.locator('tbody tr')).toHaveCount(DEFAULT_RESULT_PAGE_ROWS);

    let filterMs: number | undefined;
    if (scenario === 'bounded') {
        await expect(table.locator('thead th')).toHaveCount(23);
        await assertWideRow(table.locator('tbody tr').first());
        const filterStart = performance.now();
        const filter = await openResultFilter(results);
        await filter.fill('group-7');
        await expect(table.locator('tbody tr')).toHaveCount(7);
        await filter.fill('');
        await expect(table.locator('tbody tr')).toHaveCount(DEFAULT_RESULT_PAGE_ROWS);
        filterMs = performance.now() - filterStart;
    } else {
        await expect(table.locator('thead th')).toHaveCount(2);
        await assertUnboundedRow(table.locator('tbody tr').first());
    }

    const pageStart = performance.now();
    await results.locator('.result-pages-toggle').click();
    await results.getByRole('button', { name: 'Last page', exact: true }).click();
    await expect(results.locator('.result-pages-toggle')).toHaveText('25/25');
    await expect(table.locator('tbody .row-number').last()).toHaveText('5000');
    if (scenario === 'bounded') {
        await assertWideRow(table.locator('tbody tr').last());
    } else {
        await assertUnboundedRow(table.locator('tbody tr').last());
    }
    const lastPageMs = performance.now() - pageStart;
    expect(
        pageRequests.some(
            request =>
                request.runId === output.id &&
                request.offset === 5_000 - DEFAULT_RESULT_PAGE_ROWS &&
                request.count <= DEFAULT_RESULT_PAGE_ROWS,
        ),
        'Last page must load a bounded slice from the real backend',
    ).toBe(true);

    if (scenario === 'bounded') {
        const horizontal = await results.locator('.data-table-scroll').evaluate(element => {
            element.scrollLeft = element.scrollWidth;
            return element.scrollLeft;
        });
        expect(horizontal).toBeGreaterThan(0);
    }
    return { filterMs, lastPageMs };
}

async function abortFullExport(runId: string) {
    const apiUrl = 'http://127.0.0.1:' + (process.env.CLICKSTUDIO_API_PORT ?? '8080');
    const controller = new AbortController();
    const started = performance.now();
    let bytesReceived = 0;
    let csvPreview = '';
    const decoder = new TextDecoder();
    try {
        const response = await fetch(
            apiUrl + '/api/runs/' + encodeURIComponent(runId) + '/full-export',
            { signal: controller.signal },
        );
        expect(response.ok, 'Full export must start successfully').toBe(true);
        expect(response.headers.get('content-type')).toContain('text/csv');
        expect(response.headers.get('content-disposition')).toContain('attachment');
        if (!response.body) throw new Error('CSV full export did not return a stream');
        const reader = response.body.getReader();
        while (bytesReceived < 128 * 1024) {
            const next = await reader.read();
            if (next.done) throw new Error('The full export completed before the abort test');
            bytesReceived += next.value.byteLength;
            csvPreview = (csvPreview + decoder.decode(next.value, { stream: true })).slice(0, 4096);
            expect(bytesReceived).toBeLessThan(2_000_000);
        }
        expect(csvPreview).toContain('metric_19');
        expect(csvPreview).toContain('category');
    } finally {
        // The server should receive a closed response and abort the ClickHouse export.
        controller.abort();
    }
    return { bytesReceived, timeToFirst128KiBMs: performance.now() - started };
}

test('Real ClickHouse millions-row execution stays usable in the browser', async ({
    page,
}, info) => {
    test.skip(
        process.env.CLICKHOUSE_INTEGRATION !== '1',
        'Requires a running local ClickHouse and a non-demo ClickStudio server.',
    );
    const cycles = Number(process.env.LIVE_BROWSER_SOAK_CYCLES ?? 4);
    expect(Number.isSafeInteger(cycles) && cycles >= 2 && cycles <= 16).toBe(true);
    test.setTimeout(8 * 60_000);

    const measurements: BrowserSample[] = [];
    const pageErrors: string[] = [];
    const pageRequests: Array<{ runId: string; offset: number; count: number }> = [];
    let exportSample: Awaited<ReturnType<typeof abortFullExport>> | null = null;
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => {
        const path = new URL(request.url());
        const match = path.pathname.match(/^\/api\/runs\/([^/]+)\/result$/);
        if (!match) return;
        pageRequests.push({
            runId: decodeURIComponent(match[1]!),
            offset: Number(path.searchParams.get('offset') ?? 0),
            count: Number(path.searchParams.get('count') ?? DEFAULT_RESULT_PAGE_ROWS),
        });
    });

    await page.addInitScript(() => {
        const gaps: number[] = [];
        let enabled = false;
        let previous = 0;
        let maxGapMs = 0;
        let gapsOver50Ms = 0;
        const tick = (now: number) => {
            if (enabled && previous > 0 && document.visibilityState === 'visible') {
                const gap = now - previous;
                if (gaps.length < 50_000) gaps.push(gap);
                maxGapMs = Math.max(maxGapMs, gap);
                if (gap > 50) gapsOver50Ms++;
            }
            previous = now;
            requestAnimationFrame(tick);
        };
        window.__clickstudioLiveFrameProbe = {
            start() {
                gaps.length = 0;
                previous = 0;
                maxGapMs = 0;
                gapsOver50Ms = 0;
                enabled = true;
            },
            stop() {
                enabled = false;
                const sorted = [...gaps].sort((left, right) => left - right);
                return {
                    maxGapMs,
                    p95GapMs: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0,
                    frames: sorted.length,
                    gapsOver50Ms,
                };
            },
        };
        requestAnimationFrame(tick);
    });

    const report = {
        schemaVersion: 2,
        createdAt: new Date().toISOString(),
        gitSha: process.env.GITHUB_SHA ?? null,
        server: 'Live ClickHouse via ClickStudio HTTP API (CI Docker image: 24.6)',
        sourceRows: SOURCE_ROWS,
        cycles,
        note: 'Real ClickHouse and browser. Aggregates scan five million rows, and a final unbounded SELECT * tests retained-result capping. Wide SELECT has LIMIT 6000. Heap and frame timings are diagnostic.',
        measurements,
        pageRequests,
        pageErrors,
    };

    try {
        const healthResponse = await page.request.get('/api/health');
        expect(healthResponse.ok()).toBe(true);
        const healthRaw: unknown = await healthResponse.json();
        expect(jsonRecord(healthRaw, 'ClickStudio health').demo).toBe(false);
        // Prepare an explicitly trusted local connection through the real API.
        // Avoid coupling a performance soak to the connection-picker dialog workflow.
        const intent = { 'x-clickstudio-intent': '1' };
        const tested = await page.request.post('/api/connections/local/test', {
            headers: intent,
            data: {},
        });
        expect(tested.ok(), 'The real local ClickHouse connection must pass its test').toBe(true);
        const trusted = await page.request.post('/api/connections/local/trust', {
            headers: intent,
            data: { trusted: true, confirmation: 'local' },
        });
        expect(trusted.ok(), 'The local ClickHouse connection must be trusted').toBe(true);
        await page.goto('/?connection=local');
        await expect(page.locator('.connection-trigger')).toContainText('Local ClickHouse');
        await expect(runButton(page)).toBeEnabled();
        const session = await page.context().newCDPSession(page);

        for (let cycle = 0; cycle < cycles; cycle++) {
            const scenario = scenarioForCycle(cycle, cycles);
            const sql = sqlForScenario(scenario);
            await page.evaluate(() => window.__clickstudioLiveFrameProbe?.start());
            const output = await runSql(page, sql, scenario === 'scan' ? 'succeeded' : 'truncated');
            const retainedRows = requiredNumber(output.run, 'rowCount');
            let filterMs: number | undefined;
            let lastPageMs: number | undefined;
            if (scenario === 'scan') {
                expect(retainedRows).toBe(1);
                await expect(output.table.locator('tbody tr')).toHaveCount(1);
                await expect(output.table.locator('tbody')).toContainText(EXPECTED_SUM);
            } else {
                const checked = await verifyCappedResult(output, scenario, pageRequests);
                filterMs = checked.filterMs;
                lastPageMs = checked.lastPageMs;

                if (scenario === 'bounded' && exportSample === null) {
                    exportSample = await abortFullExport(output.id);
                    expect(exportSample.bytesReceived).toBeGreaterThanOrEqual(128 * 1024);
                    const original = await page.request.get(
                        '/api/runs/' + encodeURIComponent(output.id),
                    );
                    const originalRaw: unknown = await original.json();
                    expect(jsonRecord(originalRaw, 'Original run after export').status).toBe(
                        'truncated',
                    );
                }
            }

            const frames = await page.evaluate(() => window.__clickstudioLiveFrameProbe!.stop());
            expect(frames.frames).toBeGreaterThan(0);
            const closeTab = page.locator(
                '[role="tablist"][aria-label="SQL documents"] button[aria-label^="Close "]',
            );
            await closeTab.last().click();
            await expect(page.locator('.cm-content')).toBeVisible();
            await session.send('HeapProfiler.collectGarbage');
            const heap = await session.send('Runtime.getHeapUsage');
            const dom = await session.send('Memory.getDOMCounters');
            const warmup = measurements[0];
            if (warmup) {
                expect(
                    heap.usedSize - warmup.heapAfterCloseBytes,
                    'Heap growth after closing SQL tabs must stay below 128 MiB',
                ).toBeLessThan(128 * 1024 * 1024);
                expect(
                    dom.nodes - warmup.domNodesAfterClose,
                    'Detached results must not accumulate thousands of DOM nodes',
                ).toBeLessThan(12_000);
            }
            measurements.push({
                cycle: cycle + 1,
                scenario,
                sourceRows: SOURCE_ROWS,
                retainedRows,
                runAndRenderMs: output.runAndRenderMs,
                backendMs: requiredNumber(output.run, 'elapsedMs'),
                ...(filterMs === undefined ? {} : { filterMs }),
                ...(lastPageMs === undefined ? {} : { lastPageMs }),
                maxFrameGapMs: frames.maxGapMs,
                p95FrameGapMs: frames.p95GapMs,
                observedFrames: frames.frames,
                frameGapsOver50Ms: frames.gapsOver50Ms,
                heapAfterCloseBytes: heap.usedSize,
                domNodesAfterClose: dom.nodes,
            });
        }

        expect(pageRequests.length).toBeGreaterThanOrEqual(cycles);
        expect(
            pageRequests.every(
                request =>
                    Number.isSafeInteger(request.offset) &&
                    request.offset >= 0 &&
                    Number.isSafeInteger(request.count) &&
                    request.count > 0 &&
                    request.count <= DEFAULT_RESULT_PAGE_ROWS,
            ),
        ).toBe(true);
        expect(pageErrors).toEqual([]);
        expect(exportSample).not.toBeNull();
    } finally {
        const json = JSON.stringify({ ...report, exportSample }, null, 2) + '\n';
        await mkdir('benchmarks/results', { recursive: true });
        await writeFile('benchmarks/results/browser-live-clickhouse.json', json);
        await info.attach('browser-live-clickhouse.json', {
            body: Buffer.from(json),
            contentType: 'application/json',
        });
        if (process.env.GITHUB_STEP_SUMMARY) {
            const lines = [
                '## ClickStudio real ClickHouse browser soak',
                '',
                'Scans: 5,000,000 source rows. Wide previews: 22 columns, 6,000 source rows, 5,000 retained.',
                'Unbounded SELECT *: 5,000,000 source rows, with 5,000 retained; scheduled/default runs include this case.',
                'Full CSV download: streaming, aborted after at least 128 KiB. Timing and frame statistics are diagnostic.',
                'Post-close safeguards: 128 MiB heap growth and 12,000 DOM nodes after warmup.',
                '',
                '| Cycle | Scenario | Retained rows | Run + render (ms) | p95 frame (ms) | Heap after close (MB) |',
                '| --- | --- | ---: | ---: | ---: | ---: |',
                ...measurements.map(
                    sample =>
                        '| ' +
                        sample.cycle +
                        ' | ' +
                        sample.scenario +
                        ' | ' +
                        sample.retainedRows +
                        ' | ' +
                        sample.runAndRenderMs.toFixed(1) +
                        ' | ' +
                        sample.p95FrameGapMs.toFixed(1) +
                        ' | ' +
                        (sample.heapAfterCloseBytes / 1_000_000).toFixed(1) +
                        ' |',
                ),
                '',
            ];
            await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
        }
    }
});
