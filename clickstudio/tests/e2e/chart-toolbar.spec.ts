import { setWorkspaceMode, runButton, trust } from './helpers.js';
import { test, expect, type Locator, type Page } from '@playwright/test';
import type { Result } from '../../src/shared/queries/results/types.js';
import { chooseChartOption } from './chart-control-helpers.js';

test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
});

async function mockSnapshot(
    page: Page,
    data: Pick<Result, 'columns' | 'rows'> & Partial<Pick<Result, 'completeness'>>,
) {
    await page.route('**/api/runs/*/snapshot', async route => {
        const response = await route.fetch();
        await route.fulfill({
            response,
            json: { ...(await response.json()), ...data, totalRows: data.rows.length },
        });
    });
}

async function openChart(page: Page) {
    await trust(page);
    await runButton(page).click();
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    const snapshot = page.waitForResponse(response =>
        new URL(response.url()).pathname.endsWith('/snapshot'),
    );
    await results.getByRole('tab', { name: 'Chart', exact: true }).click();
    await snapshot;
    await expect(results.locator('.chart-toolbar')).toBeVisible();
    await expect(results.getByRole('button', { name: 'Chart details', exact: true })).toHaveCount(
        0,
    );
    await expect(
        results.getByRole('dialog', { name: 'Chart details', exact: true, includeHidden: true }),
    ).toHaveCount(0);
    return results;
}

async function expectToolbarFits(toolbar: Locator) {
    await expect
        .poll(() =>
            toolbar.evaluate(element => {
                const bounds = element.getBoundingClientRect();
                return [
                    ...element.querySelectorAll(
                        '.chart-controls > label, .chart-controls > .chart-popover-control, h3',
                    ),
                ].every(control => {
                    const rect = control.getBoundingClientRect();
                    return (
                        rect.left >= bounds.left &&
                        rect.right <= bounds.right &&
                        rect.top >= bounds.top &&
                        rect.bottom <= bounds.bottom
                    );
                });
            }),
        )
        .toBe(true);
}

async function expectPopoverFits(page: Page, popup: Locator) {
    await expect(popup).toBeVisible();
    const viewport = page.viewportSize()!;
    await expect
        .poll(() =>
            popup.evaluate((element, viewport) => {
                const bounds = element.getBoundingClientRect();
                return (
                    bounds.width > 0 &&
                    bounds.left >= 8 &&
                    bounds.top >= 8 &&
                    bounds.right <= viewport.width - 8 &&
                    bounds.bottom <= viewport.height - 8
                );
            }, viewport),
        )
        .toBe(true);
}

for (const mode of ['Standard', 'Experimental'])
    for (const theme of [mode === 'Standard' ? 'Light' : 'Dark']) {
        test(`${theme} ${mode} charts keep their controls compact and measures accessible`, async ({
            page,
        }, info) => {
            await page.setViewportSize({ width: 1440, height: 1000 });
            let runs = 0;
            const errors: string[] = [];
            page.on('request', request => {
                if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs')
                    runs++;
            });
            page.on('pageerror', error => errors.push(error.message));
            await mockSnapshot(page, {
                columns: [
                    { name: 'city', type: 'String' },
                    ...Array.from({ length: 7 }, (_, index) => ({
                        name: `value_${index + 1}`,
                        type: 'UInt64',
                    })),
                ],
                rows: ['Berlin', 'Warsaw', 'Paris'].map((city, index) => [
                    city,
                    ...Array.from({ length: 7 }, (_, measure) => index + measure + 1),
                ]),
                completeness: 'truncated',
            });
            const results = await openChart(page);
            await setWorkspaceMode(page, mode);
            await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
            const toolbar = results.locator('.chart-toolbar');
            const measures = toolbar.getByRole('button', { name: 'Measures', exact: true });
            await expect(toolbar.locator('h3, .eyebrow')).toHaveCount(0);
            await expect(results.locator('.chart-title-row')).toHaveCount(0);
            await expect
                .poll(() => toolbar.evaluate(element => element.getBoundingClientRect().height))
                .toBeLessThanOrEqual(44);
            await expect(results.locator('.chart-footer')).toContainText('retained prefix only');
            await measures.press('Enter');
            const popup = results.getByRole('dialog', { name: 'Measures', exact: true });
            const group = popup.getByRole('group', { name: 'Measures', exact: true });
            await expect(group.getByLabel('value_1', { exact: true })).toBeFocused();
            await expect(group.getByRole('checkbox', { checked: true })).toHaveCount(4);
            for (const name of ['value_2', 'value_3', 'value_4'])
                await group.getByLabel(name, { exact: true }).uncheck();
            await expect(group.getByLabel('value_1', { exact: true })).toBeDisabled();
            await expect(results.locator('.chart-bar')).toHaveCount(3);
            for (const name of ['value_2', 'value_3', 'value_4', 'value_5'])
                await group.getByLabel(name, { exact: true }).check();
            await expect(group.getByRole('checkbox', { checked: true })).toHaveCount(5);
            await expect(group.getByLabel('value_6', { exact: true })).toBeEnabled();
            await expect(group.getByLabel('value_7', { exact: true })).toBeEnabled();
            await group.getByLabel('value_1', { exact: true }).uncheck();
            await expect(toolbar.locator('.chart-measure-summary')).toHaveText('value_2 +3');
            await group.getByLabel('value_6', { exact: true }).check();
            await expect(results.locator('.chart-bar')).toHaveCount(15);
            await expect(toolbar.locator('.chart-measure-summary')).toHaveText('value_2 +4');
            await expect
                .poll(() =>
                    results.evaluate(element => {
                        const colors = [
                            ...element.querySelectorAll(
                                '.chart-measures label:has(input:checked) > span',
                            ),
                        ].map(element => getComputedStyle(element).backgroundColor);
                        const legendColors = [
                            ...element.querySelectorAll('.chart-footer .chart-legend-dot'),
                        ].map(element => getComputedStyle(element).backgroundColor);
                        return JSON.stringify(colors) === JSON.stringify(legendColors);
                    }),
                )
                .toBe(true);
            await page.keyboard.press('Escape');
            await expect(popup).toBeHidden();
            await expect(measures).toBeFocused();
            await measures.press('Enter');
            await toolbar.getByRole('combobox', { name: 'Type', exact: true }).click();
            await expect(popup).toBeHidden();
            await page.keyboard.press('Escape');

            for (const width of [1440, 900]) {
                await page.setViewportSize({ width, height: 1000 });
                await expectToolbarFits(toolbar);
                expect(
                    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
                ).toBeLessThanOrEqual(1);
                await measures.click();
                await expectPopoverFits(page, popup);
                await popup.getByRole('button', { name: 'Close Measures', exact: true }).click();
                await expect(
                    toolbar.getByRole('button', { name: 'Chart details', exact: true }),
                ).toHaveCount(0);
                if (width === 1440)
                    await page.screenshot({
                        path: info.outputPath(`chart-toolbar-${width}.png`),
                    });
            }

            await page.setViewportSize({ width: 1440, height: 1000 });
            await chooseChartOption(
                page,
                results.getByRole('combobox', { name: 'Type', exact: true }),
                'line',
            );
            await expect(results.locator('.chart-line')).toHaveCount(5);
            expect(runs).toBe(1);
            expect(errors).toEqual([]);
        });
    }

test('Long chart columns can be searched without growing the toolbar', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const names = Array.from(
        { length: 60 },
        (_, index) => `measure_${index}_${'long_column_name_'.repeat(4)}`,
    );
    await mockSnapshot(page, {
        columns: [
            { name: 'city', type: 'String' },
            ...names.map(name => ({ name, type: 'UInt64' })),
        ],
        rows: [
            ['Berlin', ...names.map(() => 1)],
            ['Warsaw', ...names.map(() => 2)],
        ],
    });
    const results = await openChart(page);
    const toolbar = results.locator('.chart-toolbar');
    await expectToolbarFits(toolbar);
    const before = await toolbar.boundingBox();
    const xAxis = toolbar.getByRole('combobox', { name: 'X axis', exact: true });
    await xAxis.click();
    const search = results.getByRole('searchbox', { name: 'Search x axis', exact: true });
    await search.fill(names.at(-1)!);
    await expect(results.getByRole('option')).toHaveCount(1);
    await expect(results.getByRole('option')).toHaveText(names.at(-1)!);
    await results.getByRole('option').click();
    await expect(xAxis).toHaveAttribute('data-value', String(names.length));
    await expectToolbarFits(toolbar);
    await expect(search).toBeHidden();
    await toolbar.getByRole('button', { name: 'Measures', exact: true }).click();
    const popup = results.getByRole('dialog', { name: 'Measures', exact: true });
    await expectPopoverFits(page, popup);
    expect(
        await popup.evaluate(element => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(1);
    await popup.getByLabel(names.at(-1)!, { exact: true }).check();
    await expect(popup).toBeVisible();
    await expect(results.locator('.chart-footer')).toContainText(names.at(-1)!);
    expect((await toolbar.boundingBox())!.height).toBe(before!.height);
    await page.setViewportSize({ width: 900, height: 800 });
    await expect(popup).toBeHidden();
});

test('Short numeric line charts show every X-axis label that fits', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const rows = Array.from({ length: 5 }, (_value, index) => [index, index * index]);
    await mockSnapshot(page, {
        columns: [
            { name: 'number', type: 'UInt64' },
            { name: 'square', type: 'UInt64' },
        ],
        rows,
    });
    const results = await openChart(page);
    const toolbar = results.locator('.chart-toolbar');
    await expect(toolbar.locator('.chart-control-label')).toHaveText([
        'Type',
        'X axis',
        'Measures',
    ]);
    await chooseChartOption(
        page,
        toolbar.getByRole('combobox', { name: 'Type', exact: true }),
        'line',
    );
    await expect(results.locator('.chart-x-labels tspan')).toHaveText(['0', '1', '2', '3', '4']);
    await expectToolbarFits(toolbar);
});

test('Candlestick mappings open under Setup and keep their selections', async ({ page }) => {
    await mockSnapshot(page, {
        columns: [
            'time',
            'open',
            'high',
            'low',
            'close',
            'bid',
            'ask',
            'spread',
            'quote_activity',
        ].map(name => ({ name, type: name === 'time' ? 'DateTime' : 'Float64' })),
        rows: [
            ['2026-09-21 00:00:00', 10, 13, 9, 12, 11, 12, 1, 10],
            ['2026-09-21 01:00:00', 12, 13, 8, 9, 8, 9, 1, 20],
        ],
    });
    const results = await openChart(page);
    const toolbar = results.locator('.chart-toolbar');
    await expect(toolbar.getByRole('combobox', { name: 'Type', exact: true })).toHaveAttribute(
        'data-value',
        'candlestick',
    );
    await expect(results.locator('.chart-setup-fields .chart-select-trigger').first()).toBeHidden();
    await toolbar.getByRole('button', { name: 'Setup', exact: true }).press('Enter');
    const popup = results.getByRole('dialog', { name: 'Setup', exact: true });
    const open = popup.getByRole('combobox', { name: 'Open', exact: true });
    await expect(open).toBeFocused();
    await expect(open).toHaveAttribute('data-value', '1');
    const high = popup.getByRole('combobox', { name: 'High', exact: true });
    await high.click();
    await expect(
        results.locator('[role="option"][data-value="1"][aria-disabled="true"]'),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await chooseChartOption(page, popup.getByRole('combobox', { name: 'BID', exact: true }), '5');
    await chooseChartOption(page, popup.getByRole('combobox', { name: 'ASK', exact: true }), '6');
    await chooseChartOption(
        page,
        popup.getByRole('combobox', { name: 'Average spread (bps)', exact: true }),
        '7',
    );
    await chooseChartOption(
        page,
        popup.getByRole('combobox', { name: 'Quote updates', exact: true }),
        '8',
    );
    await page.keyboard.press('Escape');
    await expect(popup).toBeHidden();
    await expect(toolbar.getByRole('button', { name: 'Setup', exact: true })).toBeFocused();
    await expect(results.locator('.market-candle-body')).toHaveCount(2);
    await toolbar.getByRole('button', { name: 'Setup', exact: true }).click();
    await expect(popup.getByRole('combobox', { name: 'BID', exact: true })).toHaveAttribute(
        'data-value',
        '5',
    );
    await expect(
        popup.getByRole('combobox', { name: 'Quote updates', exact: true }),
    ).toHaveAttribute('data-value', '8');
    await page.setViewportSize({ width: 900, height: 800 });
    await expect(popup).toBeHidden();
    await expectToolbarFits(toolbar);
    await toolbar.getByRole('button', { name: 'Setup', exact: true }).click();
    await expectPopoverFits(page, popup);
});

test('Row-count charts use the compact toolbar and keep their grouping controls available', async ({
    page,
}) => {
    await mockSnapshot(page, {
        columns: [
            { name: 'time', type: 'DateTime' },
            { name: 'service', type: 'String' },
        ],
        rows: [
            ['2026-10-01 00:00:00', 'frontend'],
            ['2026-10-01 00:00:00', 'backend'],
            ['2026-10-01 01:00:00', 'frontend'],
        ],
    });
    const results = await openChart(page);
    const toolbar = results.locator('.chart-toolbar');
    await expect(toolbar.getByRole('heading')).toHaveCount(0);
    await expect(toolbar.locator('.eyebrow')).toHaveCount(0);
    await chooseChartOption(page, toolbar.getByLabel('Break down by', { exact: true }), '');
    await expect(toolbar.getByRole('heading')).toHaveCount(0);
    await chooseChartOption(page, toolbar.getByLabel('X axis', { exact: true }), '1');
    await expect(toolbar.getByRole('heading')).toHaveCount(0);
    await expect(results.locator('.chart-bar')).toHaveCount(2);
    await page.setViewportSize({ width: 900, height: 800 });
    await expectToolbarFits(toolbar);
});

test('Custom chart titles stay out of the toolbar without the details popup', async ({ page }) => {
    const title = 'Events across European cities';
    await page.addInitScript(
        title =>
            localStorage.setItem(
                'clickstudio:workspace:demo:v1',
                JSON.stringify({
                    version: 1,
                    activeId: 'custom-chart',
                    tabs: [
                        {
                            id: 'custom-chart',
                            name: 'Cities.sql',
                            sql: 'SELECT 1',
                            chart: { kind: 'bar', x: 0, ys: [1], title },
                        },
                    ],
                }),
            ),
        title,
    );
    await mockSnapshot(page, {
        columns: [
            { name: 'city', type: 'String' },
            { name: 'events', type: 'UInt64' },
        ],
        rows: [
            ['Berlin', 10],
            ['Warsaw', 15],
        ],
    });
    const results = await openChart(page);
    await expect(results.locator('.chart-toolbar h3')).toHaveCount(0);
    await expect
        .poll(() =>
            page.evaluate(() => {
                const workspace = JSON.parse(
                    localStorage.getItem('clickstudio:workspace:demo:v1') ?? '{}',
                );
                return workspace.tabs?.[0]?.chart?.title;
            }),
        )
        .toBe(title);
    await expect
        .poll(() =>
            results
                .locator('.chart-toolbar')
                .evaluate(element => element.getBoundingClientRect().height),
        )
        .toBeLessThanOrEqual(44);
    await page.setViewportSize({ width: 900, height: 800 });
    await expectToolbarFits(results.locator('.chart-toolbar'));
});

for (const count of [6, 20])
    test(`Restored ${count}-measure charts keep their series when changing the selection`, async ({
        page,
    }) => {
        await page.addInitScript(
            count =>
                localStorage.setItem(
                    'clickstudio:workspace:demo:v1',
                    JSON.stringify({
                        version: 1,
                        activeId: 'restored-chart',
                        tabs: [
                            {
                                id: 'restored-chart',
                                name: 'Metrics.sql',
                                sql: 'SELECT 1',
                                chart: {
                                    kind: 'bar',
                                    x: 0,
                                    ys: Array.from({ length: count }, (_, index) => index + 1),
                                    title: 'Query result',
                                },
                            },
                        ],
                    }),
                ),
            count,
        );
        await mockSnapshot(page, {
            columns: [
                { name: 'city', type: 'String' },
                ...Array.from({ length: 22 }, (_, index) => ({
                    name: `value_${index + 1}`,
                    type: 'UInt64',
                })),
            ],
            rows: [
                ['Berlin', ...Array.from({ length: 22 }, () => 1)],
                ['Warsaw', ...Array.from({ length: 22 }, () => 2)],
            ],
        });
        const results = await openChart(page);
        await results.getByRole('button', { name: 'Measures', exact: true }).click();
        const popup = results.getByRole('dialog', { name: 'Measures', exact: true });
        await expect(popup.getByRole('checkbox', { checked: true })).toHaveCount(count);
        await expect(popup).toContainText('Select up to 20 measures.');
        if (count === 20)
            await expect(popup.getByLabel('value_22', { exact: true })).toBeDisabled();
        await popup.getByLabel('value_1', { exact: true }).uncheck();
        await expect(results.locator('.chart-footer')).toContainText(
            `2 retained rows across ${count - 1} measures`,
        );
        await expect(popup.getByLabel(`value_${count}`, { exact: true })).toBeChecked();
        await popup.getByLabel('value_21', { exact: true }).check();
        await expect(results.locator('.chart-footer')).toContainText(
            `2 retained rows across ${count} measures`,
        );
        await expect(popup.getByRole('checkbox', { checked: true })).toHaveCount(count);
        if (count === 20)
            await expect(popup.getByLabel('value_22', { exact: true })).toBeDisabled();
    });

test('Scatter sampling stays visible without the details popup', async ({ page }) => {
    await mockSnapshot(page, {
        columns: [
            { name: 'distance', type: 'Float64' },
            { name: 'fare', type: 'Float64' },
        ],
        rows: Array.from({ length: 350 }, (_, index) => [index, index * 2]),
    });
    const results = await openChart(page);
    await chooseChartOption(
        page,
        results.getByRole('combobox', { name: 'Type', exact: true }),
        'scatter',
    );
    await expect(results.locator('.chart-point')).toHaveCount(240);
    await expect(results.locator('.chart-footer')).toContainText(
        '240 plotted points · 240 sampled rows from 350 retained rows',
    );
});

test('Row-count custom titles stay saved after axis and breakdown changes', async ({ page }) => {
    const title = 'Traffic across services';
    await page.addInitScript(
        title =>
            localStorage.setItem(
                'clickstudio:workspace:demo:v1',
                JSON.stringify({
                    version: 1,
                    activeId: 'count-chart',
                    tabs: [
                        {
                            id: 'count-chart',
                            name: 'Traffic.sql',
                            sql: 'SELECT 1',
                            chart: { kind: 'line', x: 0, groupBy: 1, ys: [], title },
                        },
                    ],
                }),
            ),
        title,
    );
    await mockSnapshot(page, {
        columns: [
            { name: 'time', type: 'DateTime' },
            { name: 'service', type: 'String' },
        ],
        rows: [
            ['2026-10-01 00:00:00', 'frontend'],
            ['2026-10-01 00:00:00', 'backend'],
        ],
    });
    const results = await openChart(page);
    const toolbar = results.locator('.chart-toolbar');
    await expect(toolbar.getByRole('heading')).toHaveCount(0);
    await chooseChartOption(
        page,
        toolbar.getByRole('combobox', { name: 'Break down by', exact: true }),
        '',
    );
    await expect(toolbar.getByRole('heading')).toHaveCount(0);
    await chooseChartOption(
        page,
        toolbar.getByRole('combobox', { name: 'X axis', exact: true }),
        '1',
    );
    await expect(results.locator('.chart-bar')).toHaveCount(2);
    await expect(toolbar.getByRole('heading')).toHaveCount(0);
    await expect
        .poll(() =>
            page.evaluate(() => {
                const workspace = JSON.parse(
                    localStorage.getItem('clickstudio:workspace:demo:v1') ?? '{}',
                );
                return workspace.tabs?.[0]?.chart?.title;
            }),
        )
        .toBe(title);
});

test('Changing chart types keeps the type selector mounted and focused', async ({ page }) => {
    await mockSnapshot(page, {
        columns: [
            { name: 'time', type: 'DateTime' },
            { name: 'open', type: 'Float64' },
            { name: 'high', type: 'Float64' },
            { name: 'low', type: 'Float64' },
            { name: 'close', type: 'Float64' },
        ],
        rows: [['2026-01-01 00:00:00', 10, 12, 9, 11]],
    });
    const results = await openChart(page);
    const type = results.getByRole('combobox', { name: 'Type', exact: true });
    const original = await type.elementHandle();
    expect(original).not.toBeNull();
    await type.focus();

    for (const kind of ['bar', 'candlestick', 'line', 'bar']) {
        await chooseChartOption(page, type, kind);
        await expect(type).toHaveAttribute('data-value', kind);
        await expect(type).toBeFocused();
        expect(await original!.evaluate(element => element.isConnected)).toBe(true);
    }
});
