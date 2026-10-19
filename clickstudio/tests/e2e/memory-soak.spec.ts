import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { openBlankSql, replaceSql, runButton } from './helpers.js';

test('Browser query lifecycle collects heap and DOM diagnostics', async ({ page }, testInfo) => {
    const cycles = Number(process.env.MEMORY_SOAK_CYCLES ?? 8);
    expect(Number.isSafeInteger(cycles) && cycles >= 1 && cycles <= 100).toBe(true);
    test.setTimeout(cycles > 8 ? 10 * 60_000 : 120_000);
    const session = await page.context().newCDPSession(page);
    await page.goto('/?connection=demo');
    await expect(page.locator('.cm-content')).toBeVisible();

    const measurements: Array<{
        phase: string;
        cycle: number;
        heapUsedBytes: number;
        heapTotalBytes: number;
        documents: number;
        nodes: number;
        jsEventListeners: number;
    }> = [];
    const sample = async (phase: string, cycle: number) => {
        await session.send('HeapProfiler.collectGarbage');
        const heap = await session.send('Runtime.getHeapUsage');
        const dom = await session.send('Memory.getDOMCounters');
        measurements.push({
            phase,
            cycle,
            heapUsedBytes: heap.usedSize,
            heapTotalBytes: heap.totalSize,
            documents: dom.documents,
            nodes: dom.nodes,
            jsEventListeners: dom.jsEventListeners,
        });
    };

    await sample('baseline', 0);
    for (let index = 0; index < cycles; index++) {
        await openBlankSql(page);
        await replaceSql(page, 'SELECT ' + (index + 1) + ' AS memory_probe');
        await runButton(page).click();
        await expect(page.locator('.execution-bar')).toHaveAttribute(
            'data-run-status',
            'succeeded',
        );
        await expect(
            page.getByRole('region', { name: 'Query results', exact: true }),
        ).toBeVisible();

        const closeTab = page.locator(
            '[role="tablist"][aria-label="SQL documents"] button[aria-label^="Close "]',
        );
        await closeTab.last().click();
        if ((index + 1) % 4 === 0 || index + 1 === cycles) {
            await sample('after-close', index + 1);
        }
    }
    await page.reload();
    await expect(page.locator('.cm-content')).toBeVisible();
    await sample('after-reload', cycles);

    const report = {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        cycles,
        note: 'Diagnostic only: saved history intentionally stays retained.',
        measurements,
    };
    const json = JSON.stringify(report, null, 2) + '\n';
    await mkdir('benchmarks/results', { recursive: true });
    await writeFile('benchmarks/results/browser-memory.json', json);
    await testInfo.attach('browser-memory.json', {
        body: Buffer.from(json),
        contentType: 'application/json',
    });
});
