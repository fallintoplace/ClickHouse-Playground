import { test, expect, type Locator, type Page } from '@playwright/test';
import type { MergeTreePartsSnapshot } from '../../src/shared/database/explorer/storage/parts.js';
import { trust } from './helpers.js';

const snapshot: MergeTreePartsSnapshot = {
    database: 'analytics',
    table: 'events',
    parts: [
        {
            active: true,
            partition: '2026-09',
            name: '202609_1_1_0',
            rows: '120000',
            marks: '15',
            compressedBytes: '4096',
            uncompressedBytes: '8192',
            level: 0,
            minBlockNumber: '1',
            maxBlockNumber: '1',
            modifiedAt: '2026-09-24 08:00:00',
            diskName: 'default',
        },
        {
            active: false,
            partition: '2026-10',
            name: '202610_2_2_0',
            rows: '35000',
            marks: '5',
            compressedBytes: '512',
            uncompressedBytes: '1024',
            level: 0,
            minBlockNumber: '2',
            maxBlockNumber: '2',
            modifiedAt: '2026-10-01 08:00:00',
            diskName: 'cold',
        },
    ],
    totalParts: '2',
    activeParts: '1',
    inactiveParts: '1',
    truncated: false,
    measuredAt: '2026-10-13T08:00:00Z',
    totals: { rows: '155000', marks: '20', compressedBytes: '4608', uncompressedBytes: '9216' },
};

async function openParts(page: Page, data = snapshot, theme?: string) {
    await page.route('**/api/connections/*/table-parts', route => route.fulfill({ json: data }));
    await trust(page);
    if (theme) await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
    if (!(await page.locator('.inspector-pane').isVisible()))
        await page
            .locator('.icon-rail')
            .getByRole('button', { name: 'Objects', exact: true })
            .click();
    await page.getByRole('button', { name: 'events MergeTree', exact: true }).click();
    await page.getByRole('button', { name: 'Visualize parts', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'MergeTree parts', exact: true });
    await expect(dialog.locator('.parts-overview')).toBeVisible();
    return dialog;
}

async function expectChartFits(viewport: Locator) {
    await expect
        .poll(() =>
            viewport.locator('svg').evaluate(element => {
                if (!(element instanceof SVGSVGElement)) throw new Error('Expected an SVG');
                const canvas = element.viewBox.baseVal;
                const bounds = element.getBoundingClientRect();
                return (
                    Math.abs(canvas.width - bounds.width) < 1 &&
                    Math.abs(canvas.height - bounds.height) < 1
                );
            }),
        )
        .toBe(true);
}

for (const theme of ['Light', 'Dark']) {
    test(`${theme} charts fill the available space and keep labels readable after resizing`, async ({
        page,
    }, info) => {
        const firstPart = snapshot.parts[0];
        if (!firstPart) throw new Error('Expected a part in the fixture');
        await page.setViewportSize({ width: 1600, height: 1000 });
        const dialog = await openParts(
            page,
            { ...snapshot, parts: [firstPart], totalParts: '1', inactiveParts: '0' },
            theme,
        );
        await dialog.getByRole('button', { name: 'Treemap', exact: true }).click();
        const viewport = dialog.locator('.parts-graph-viewport');
        const svg = viewport.locator('svg');
        await expectChartFits(viewport);
        const chartBox = await viewport.boundingBox();
        const dialogBox = await dialog.boundingBox();
        expect(chartBox).not.toBeNull();
        expect(dialogBox).not.toBeNull();
        expect(chartBox!.height).toBeGreaterThan(dialogBox!.height * 0.5);
        const part = svg.locator('.is-part-cell');
        const partBox = await part.boundingBox();
        expect(partBox).not.toBeNull();
        expect(partBox!.width).toBeGreaterThan(chartBox!.width * 0.95);
        expect(partBox!.height).toBeGreaterThan(chartBox!.height * 0.9);
        await expect(dialog.locator('.parts-inspector')).toBeInViewport();
        await dialog.screenshot({ path: info.outputPath('parts-treemap.png') });

        await part.focus();
        await page.keyboard.press('Enter');
        await expect(dialog.locator('.parts-inspector')).toContainText(firstPart.name);
        for (const layout of ['Galaxy', 'Treemap']) {
            await dialog.getByRole('button', { name: layout, exact: true }).click();
            await svg.locator('.is-part-cell').focus();
            await page.keyboard.press('Enter');
            for (const size of [
                { width: 920, height: 650 },
                { width: 1440, height: 900 },
            ]) {
                await page.setViewportSize(size);
                await expectChartFits(viewport);
                await expect
                    .poll(() =>
                        svg.locator('.parts-cell-label').evaluate(element => {
                            if (!(element instanceof SVGGraphicsElement))
                                throw new Error('Expected an SVG label');
                            const matrix = element.getScreenCTM();
                            return (
                                parseFloat(getComputedStyle(element).fontSize) *
                                (matrix ? Math.hypot(matrix.a, matrix.b) : 0)
                            );
                        }),
                    )
                    .toBeGreaterThanOrEqual(11.9);
                await expect(dialog.locator('.parts-inspector')).toContainText(firstPart.name);
            }
            await dialog.getByRole('button', { name: 'Zoom into partition 2026-09' }).click();
            await expect(dialog.locator('.parts-breadcrumb')).toContainText('2026-09');
            await page.setViewportSize({ width: 1000, height: 800 });
            await expect(svg.locator('.is-part-cell')).toBeInViewport();
            await dialog.locator('.parts-breadcrumb button').click();
            await expect(dialog.locator('.parts-breadcrumb')).not.toContainText('2026-09');
        }
        await dialog.getByRole('button', { name: 'Inactive 0', exact: true }).click();
        await expect(viewport).toHaveCount(0);
        await dialog.getByRole('button', { name: 'All', exact: true }).click();
        await expect(svg.locator('.parts-cell-label')).toHaveText(firstPart.name);
        await expect
            .poll(() => dialog.evaluate(element => element.scrollWidth <= element.clientWidth))
            .toBe(true);
    });
}

for (const theme of ['Light', 'Dark']) {
    test(`${theme} parts view keeps every metric once and updates filtered totals`, async ({
        page,
    }) => {
        const dialog = await openParts(page, snapshot, theme);
        const accent = theme === 'Dark' ? 'rgb(250, 255, 105)' : 'rgb(98, 55, 25)';
        const partsTab = dialog
            .getByRole('group', { name: 'Storage views', exact: true })
            .getByRole('button', { name: 'Parts', exact: true });
        await expect(partsTab).toHaveCSS('color', accent);
        await expect(partsTab).toHaveCSS('border-bottom-color', accent);
        await expect(dialog.locator('.parts-breadcrumb button')).toHaveCSS('color', accent);
        await expect(dialog.locator('.parts-map-size b').first()).toHaveCSS(
            'background-color',
            accent,
        );
        await expect(dialog.locator('.parts-overview dd')).toHaveText([
            '1',
            '1',
            '4.5 KiB',
            '155,000',
        ]);
        const metricControl = dialog.getByRole('group', { name: 'MergeTree parts', exact: true });
        const firstRow = dialog.locator('.parts-map-row').first();
        for (const [metric, labels, values] of [
            ['Compressed size', ['Compressed size', 'Rows', 'Marks'], ['4.0 KiB', '120,000', '15']],
            ['Rows', ['Rows', 'Compressed size', 'Marks'], ['120,000', '4.0 KiB', '15']],
            ['Marks', ['Marks', 'Compressed size', 'Rows'], ['15', '4.0 KiB', '120,000']],
        ] as const) {
            await metricControl.getByRole('button', { name: metric, exact: true }).click();
            await expect(dialog.locator('.parts-map-columns .parts-map-metrics > span')).toHaveText(
                labels,
            );
            await expect(firstRow.locator('.parts-map-size strong')).toHaveText(values[0]);
            await expect(
                firstRow.locator('.parts-map-metrics > span:not(.parts-map-size)'),
            ).toHaveText(values.slice(1));
        }
        await firstRow.focus();
        await page.keyboard.press('Enter');
        await expect(firstRow).toHaveAttribute('aria-pressed', 'true');
        await expect(dialog.locator('.parts-inspector')).toContainText('202609_1_1_0');
        await dialog.getByRole('button', { name: 'Inactive 1', exact: true }).click();
        await expect(dialog.locator('.parts-overview dd')).toHaveText([
            '1',
            '1',
            '512 B',
            '35,000',
        ]);
        await expect(dialog.locator('.parts-inspector')).toContainText('Select a part');
        await dialog
            .getByRole('button', { name: 'Zoom into partition 2026-10', exact: true })
            .click();
        await expect(dialog.locator('.parts-breadcrumb')).toContainText('2026-10');
        await dialog.locator('.parts-breadcrumb button').click();
        await expect(dialog.locator('.parts-breadcrumb')).not.toContainText('2026-10');
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(
            page.getByRole('button', { name: 'Visualize parts', exact: true }),
        ).toBeFocused();
    });
}

for (const width of [1000, 920]) {
    test(`Parts remain aligned and scroll within the dialog at ${width}px`, async ({ page }) => {
        const dialog = await openParts(page);
        await page.setViewportSize({ width, height: 800 });
        const viewport = dialog.locator('.parts-graph-viewport');
        await expect
            .poll(() => dialog.evaluate(element => element.scrollWidth <= element.clientWidth))
            .toBe(true);
        await expect
            .poll(() => viewport.evaluate(element => element.scrollWidth > element.clientWidth))
            .toBe(true);
        const header = dialog.locator('.parts-map-columns .parts-map-metrics > span').last();
        const value = dialog
            .locator('.parts-map-row')
            .first()
            .locator('.parts-map-metrics > span')
            .last();
        const headerBox = await header.boundingBox();
        const valueBox = await value.boundingBox();
        expect(headerBox).not.toBeNull();
        expect(valueBox).not.toBeNull();
        expect(Math.abs((headerBox?.x ?? 0) - (valueBox?.x ?? 0))).toBeLessThan(1);
        await viewport.evaluate(element => {
            element.scrollLeft = element.scrollWidth;
        });
        await expect(header).toBeInViewport();
        await expect(value).toBeInViewport();
    });
}

test('Truncated parts label sampled totals and retain exact large row counts', async ({ page }) => {
    const firstPart = snapshot.parts[0];
    if (!firstPart) throw new Error('Expected a part in the fixture');
    const dialog = await openParts(page, {
        ...snapshot,
        parts: [{ ...firstPart, rows: '9007199254740993' }],
        totalParts: '1001',
        activeParts: '1000',
        inactiveParts: '1',
        truncated: true,
    });
    await expect(dialog.locator('.parts-overview dt')).toHaveText([
        'Active',
        'Inactive',
        'Loaded sample · Compressed size',
        'Loaded sample · Rows',
    ]);
    await expect(dialog.locator('.parts-overview dd').last()).toHaveText('9,007,199,254,740,993');
    await expect(dialog.locator('.parts-graph-meta')).toContainText(
        'Showing 1 of 1,001 all parts.',
    );
    await expect(dialog.locator('.parts-map-row .parts-map-metrics')).toContainText(
        '9,007,199,254,740,993',
    );
});

test('Short windows can scroll to the part inspector and footer', async ({ page }) => {
    const dialog = await openParts(page);
    await page.setViewportSize({ width: 1280, height: 400 });
    const content = dialog.getByRole('region', { name: 'MergeTree parts', exact: true });
    for (const layout of ['Part map', 'Treemap', 'Galaxy']) {
        await dialog.getByRole('button', { name: layout, exact: true }).click();
        if (layout !== 'Part map') await expectChartFits(content.locator('.parts-graph-viewport'));
        await content.evaluate(element => {
            element.scrollTop = element.scrollHeight;
        });
        await expect(content.locator('.parts-inspector')).toBeInViewport();
        await expect(content.locator('.parts-explorer-footer')).toBeInViewport();
    }
    const dialogBox = await dialog.boundingBox();
    const contentBox = await content.boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(contentBox).not.toBeNull();
    expect((contentBox?.y ?? 0) + (contentBox?.height ?? 0)).toBeLessThanOrEqual(
        (dialogBox?.y ?? 0) + (dialogBox?.height ?? 0),
    );
});

test('UInt64 metrics keep their full values without overlapping adjacent columns', async ({
    page,
}) => {
    const firstPart = snapshot.parts[0];
    if (!firstPart) throw new Error('Expected a part in the fixture');
    await page.setViewportSize({ width: 920, height: 800 });
    const dialog = await openParts(page, {
        ...snapshot,
        parts: [{ ...firstPart, rows: '18446744073709551615', marks: '18446744073709551615' }],
    });
    const metricControl = dialog.getByRole('group', { name: 'MergeTree parts', exact: true });
    for (const metric of ['Compressed size', 'Rows', 'Marks']) {
        await metricControl.getByRole('button', { name: metric, exact: true }).click();
        await expect(dialog.locator('.parts-map-row .parts-map-metrics')).toContainText(
            '18,446,744,073,709,551,615',
        );
        expect(
            await dialog
                .locator('.parts-map-row .parts-map-metrics > span')
                .evaluateAll(elements =>
                    elements.every(element => element.scrollWidth <= element.clientWidth),
                ),
        ).toBe(true);
    }
});

test('Empty parts keep zero totals and the state message visible', async ({ page }) => {
    const dialog = await openParts(page, {
        ...snapshot,
        parts: [],
        totalParts: '0',
        activeParts: '0',
        inactiveParts: '0',
    });
    await expect(dialog.locator('.parts-overview dd')).toHaveText(['0', '0', '0 B', '0']);
    await expect(dialog.getByRole('status')).toHaveText('This table has no parts in this state.');
    await expect(dialog.locator('.parts-graph-viewport')).toHaveCount(0);
});

test('Help storage keeps the shared part headings aligned with the data', async ({ page }) => {
    await page.route('**/api/connections/*/table-parts', route =>
        route.fulfill({ json: snapshot }),
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await trust(page);
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    const help = page.getByRole('dialog', { name: 'Explore ClickHouse', exact: true });
    await help.getByTestId('help-section-storage').click();
    const parts = help.getByRole('region', { name: 'MergeTree parts', exact: true });
    await expect(parts.locator('.parts-map-row')).toHaveCount(2);
    const heading = await parts.locator('.parts-map-columns .parts-map-metrics').boundingBox();
    const row = await parts.locator('.parts-map-row .parts-map-metrics').first().boundingBox();
    expect(heading).not.toBeNull();
    expect(row).not.toBeNull();
    expect(Math.abs((heading?.x ?? 0) - (row?.x ?? 0))).toBeLessThan(1);
});

test('Narrow windows keep both charts readable and details reachable', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 700 });
    const dialog = await openParts(page);
    const content = dialog.getByRole('region', { name: 'MergeTree parts', exact: true });
    const viewport = content.locator('.parts-graph-viewport');
    for (const layout of ['Treemap', 'Galaxy']) {
        await dialog.getByRole('button', { name: layout, exact: true }).click();
        await page.setViewportSize({ width: 600, height: 650 });
        await expectChartFits(viewport);
        await content.evaluate(element => {
            element.scrollTop = element.scrollHeight;
        });
        await expect(content.locator('.parts-inspector')).toBeInViewport();
        await expect(content.locator('.parts-explorer-footer')).toBeInViewport();
        expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(
            true,
        );
    }
});

for (const width of [1440, 640]) {
    test(`Help charts fit at ${width}px after resizing and returning to Storage`, async ({
        page,
    }) => {
        await page.route('**/api/connections/*/table-parts', route =>
            route.fulfill({ json: snapshot }),
        );
        await page.setViewportSize({ width, height: 1000 });
        await trust(page);
        await page.getByRole('button', { name: 'Help', exact: true }).click();
        const help = page.getByRole('dialog', { name: 'Explore ClickHouse', exact: true });
        await help.getByTestId('help-section-storage').click();
        const parts = help.getByRole('region', { name: 'MergeTree parts', exact: true });
        const viewport = parts.locator('.parts-graph-viewport');
        for (const layout of ['Treemap', 'Galaxy']) {
            await parts.getByRole('button', { name: layout, exact: true }).click();
            await expectChartFits(viewport);
            await page.setViewportSize({ width: width > 850 ? 1000 : 600, height: 700 });
            await expectChartFits(viewport);
            await help.getByTestId('help-section-examples').click();
            await help.getByTestId('help-section-storage').click();
            await parts.getByRole('button', { name: layout, exact: true }).click();
            await expectChartFits(viewport);
            await page.setViewportSize({ width, height: 1000 });
            await expectChartFits(viewport);
        }
    });
}
