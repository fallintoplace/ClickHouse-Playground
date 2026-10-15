import { expect, test, type Page } from '@playwright/test';
import type { Result } from '../../src/shared/queries/results/types.js';
import { chooseChartOption } from './chart-control-helpers.js';
import { openSqlExamples, runButton, trust } from './helpers.js';

type SnapshotData = Pick<Result, 'columns' | 'rows'>;
const cities: SnapshotData = {
    columns: [
        { name: 'city', type: 'String' },
        { name: 'location', type: 'Point' },
        { name: 'alternate', type: 'Point' },
        { name: 'longitude', type: 'Float64' },
        { name: 'latitude', type: 'Float64' },
        { name: 'events', type: 'UInt64' },
    ],
    rows: [
        ['Berlin', [13, 52], [14, 53], 13, 52, 10],
        ['Paris', [2, 48], [3, 49], 2, 48, 20],
    ],
};

async function mockSnapshot(page: Page, data: () => SnapshotData) {
    await page.route('**/api/runs/*/snapshot', async route => {
        const response = await route.fetch();
        const current = data();
        await route.fulfill({
            response,
            json: { ...(await response.json()), ...current, totalRows: current.rows.length },
        });
    });
}

async function openChart(page: Page, mode = 'Experimental') {
    await trust(page, mode);
    await runButton(page).click();
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await results.getByRole('tab', { name: 'Chart', exact: true }).click();
    await expect(results.locator('.chart-toolbar')).toBeVisible();
    return results;
}

test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 1000 });
});

for (const failure of ['unavailable', 'invalid'])
    test(`NYC retains its returned cells with world context if the local basemap is ${failure}`, async ({
        page,
    }) => {
        await page.route('**/geo/nyc-boroughs.geojson', route =>
            route.fulfill({
                status: failure === 'unavailable' ? 404 : 200,
                contentType: 'application/json',
                body: JSON.stringify({ type: 'FeatureCollection', features: [] }),
            }),
        );
        await trust(page);
        const dialog = await openSqlExamples(page);
        await dialog.getByTestId('sql-example-category-all').click();
        await dialog.getByTestId('sql-example-nyc-taxi-after-dark').click();
        await dialog.getByTestId('run-sql-example').click();
        const stage = page.locator('.geo-stage');
        await expect(stage).toHaveAttribute('data-basemap', 'world');
        await expect.poll(() => stage.locator('.geo-country').count()).toBeGreaterThan(100);
        await expect(stage.locator('.geo-feature.is-area')).toHaveCount(96);
        await expect(stage.locator('.geo-borough, .geo-context')).toHaveCount(0);
    });

for (const mode of ['Standard', 'Experimental']) {
    for (const [id, name, count] of [
        ['clickhouse-geo-cities', 'Native Point cities', 20],
        ['clickhouse-geo-flight-routes', 'Intercontinental flight paths', 8],
        ['nyc-taxi-after-dark', 'NYC after dark', 96],
    ] as const)
        test(`${mode} ${id} opens Geography by default from SQL examples`, async ({
            page,
        }, info) => {
            await trust(page, mode);
            const dialog = await openSqlExamples(page);
            await expect(
                dialog.getByRole('button', { name: 'ClickHouse', exact: true }),
            ).toHaveCount(0);
            await expect(dialog.getByRole('button', { name: 'Cities', exact: true })).toHaveCount(
                0,
            );
            await dialog.getByTestId('sql-example-category-all').click();
            await dialog.getByTestId(`sql-example-${id}`).click();
            await expect(dialog.locator('.sql-example-preview h3')).toHaveText(`${name}.sql`);
            await expect(dialog.locator('.sql-example-preview')).toContainText('Geography');
            await dialog.getByTestId('run-sql-example').click();
            const results = page.getByRole('region', { name: 'Query results', exact: true });
            await expect(
                results.getByRole('combobox', { name: 'Type', exact: true }),
            ).toContainText('Geography');
            await expect(results.locator('.geo-map')).toBeVisible();
            await expect(results.locator('.geo-feature')).toHaveCount(count);
            await expect(results.locator('.geo-map-caption')).toContainText(
                `${count} valid features`,
            );
            if (id === 'nyc-taxi-after-dark') {
                const boxes = await results.locator('.geo-feature.is-area').evaluateAll(paths =>
                    paths.map(path => {
                        if (!(path instanceof SVGGraphicsElement))
                            throw new Error('Expected an SVG geometry path');
                        const box = path.getBBox();
                        const rendered = path.getBoundingClientRect();
                        const stage = path.closest('.geo-stage')?.getBoundingClientRect();
                        if (!stage) throw new Error('Expected the map stage');
                        return {
                            x: box.x,
                            y: box.y,
                            width: box.width,
                            height: box.height,
                            visible:
                                rendered.top >= stage.top &&
                                rendered.bottom <= stage.bottom &&
                                rendered.left >= stage.left &&
                                rendered.right <= stage.right,
                        };
                    }),
                );
                expect(new Set(boxes.map(box => JSON.stringify(box))).size).toBe(count);
                for (const box of boxes) {
                    expect(box.width).toBeGreaterThan(0);
                    expect(box.width).toBeLessThan(480);
                    expect(box.height).toBeGreaterThan(0);
                    expect(box.height).toBeLessThan(235);
                    expect(box.visible).toBe(true);
                }
                await expect(results.locator('.geo-borough')).toHaveCount(5);
                await expect(results.locator('.geo-context-labels')).toContainText('Manhattan');
                await expect(results.locator('.geo-context-labels')).toContainText('Brooklyn');
                await expect(results.locator('.geo-context-labels')).toContainText('East River');
                await results.locator('.geo-stage').screenshot({
                    path: info.outputPath(`nyc-after-dark-${mode}.png`),
                });
                const map = results.locator('.geo-map');
                const origin = () =>
                    map.evaluate(svg => {
                        const matrix = svg.querySelector('g')?.getScreenCTM();
                        if (!matrix) throw new Error('Expected the map viewport transform');
                        const point = new DOMPoint(0, 0).matrixTransform(matrix);
                        return { x: point.x, y: point.y };
                    });
                const initial = await origin();
                const bounds = await map.boundingBox();
                if (!bounds) throw new Error('Expected the map viewport bounds');
                const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
                await page.mouse.move(start.x, start.y);
                await page.mouse.down();
                await page.mouse.move(start.x + 60, start.y + 30);
                await page.mouse.up();
                await expect
                    .poll(async () => {
                        const moved = await origin();
                        return (
                            Math.abs(moved.x - initial.x - 60) < 1 &&
                            Math.abs(moved.y - initial.y - 30) < 1
                        );
                    })
                    .toBe(true);
                await results.getByRole('button', { name: 'Fit', exact: true }).click();
                await expect.poll(origin).toEqual(initial);
                const cell = results.locator('.geo-feature.is-area').first();
                const details = results.locator('.geo-selection');
                const cellBounds = await cell.boundingBox();
                if (!cellBounds) throw new Error('Expected the pickup cell bounds');
                const cellCenter = {
                    x: cellBounds.x + cellBounds.width / 2,
                    y: cellBounds.y + cellBounds.height / 2,
                };
                await page.mouse.move(cellCenter.x, cellCenter.y);
                await page.mouse.down();
                await page.mouse.move(cellCenter.x + 60, cellCenter.y + 30);
                await page.mouse.up();
                await expect(details).toContainText('Select a point, line, or region');
                await expect
                    .poll(async () => {
                        const moved = await origin();
                        return Math.abs(moved.x - initial.x - 60) < 1;
                    })
                    .toBe(true);
                await results.getByRole('button', { name: 'Fit', exact: true }).click();
                await expect.poll(origin).toEqual(initial);
                await cell.click();
                await expect(details).toContainText('Midtown-Midtown South');
                await expect(details).toContainText('avg_night_fare_usd');
                await expect(details).toContainText('h3_cell');
                await expect(details).toContainText('52436');
                await expect(details).toContainText('night_share_pct');
                await expect(details).toContainText('31.9');
                await map.click({ position: { x: 15, y: 15 } });
                await expect(details).toContainText('Select a point, line, or region');
            }
        });

    test(`${mode} Geography reuses the chart toolbar and preserves setup without running SQL`, async ({
        page,
    }, info) => {
        let runs = 0;
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => {
            if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs')
                runs++;
        });
        await mockSnapshot(page, () => cities);
        const results = await openChart(page, mode);
        const type = results.getByRole('combobox', { name: 'Type', exact: true });
        await chooseChartOption(page, type, 'geography');
        await expect(results.locator('.geo-map')).toBeVisible();
        await expect(results.locator('.geo-feature.geo-point')).toHaveCount(2);
        await expect(results.getByRole('tab', { name: 'Map', exact: true })).toHaveCount(0);
        await expect(results.locator('.results-chart-tools > .chart-toolbar')).toBeVisible();
        await expect(results.locator('.results-content .chart-toolbar')).toHaveCount(0);
        await expect(results.getByRole('combobox', { name: 'X axis', exact: true })).toHaveCount(0);
        await expect(results.locator('.geo-map-caption')).toContainText('2 valid features');
        const setup = results.getByRole('button', { name: 'Setup', exact: true });
        await setup.click();
        const popup = results.getByRole('dialog', { name: 'Setup', exact: true });
        await chooseChartOption(
            page,
            popup.getByRole('combobox', { name: 'Source', exact: true }),
            'geometry:2',
        );
        await chooseChartOption(
            page,
            popup.getByRole('combobox', { name: 'Label', exact: true }),
            '',
        );
        await chooseChartOption(
            page,
            popup.getByRole('combobox', { name: 'Measure', exact: true }),
            '',
        );
        await chooseChartOption(
            page,
            popup.getByRole('combobox', { name: 'Coordinate order', exact: true }),
            'yx',
        );
        await page.keyboard.press('Escape');
        await expect(popup).toBeHidden();
        await expect(setup).toBeFocused();
        await chooseChartOption(page, type, 'bar');
        await expect(results.locator('.geo-map')).toHaveCount(0);
        await chooseChartOption(page, type, 'geography');
        await setup.click();
        await expect(popup.getByRole('combobox', { name: 'Source', exact: true })).toHaveAttribute(
            'data-value',
            'geometry:2',
        );
        await expect(
            popup.getByRole('combobox', { name: 'Coordinate order', exact: true }),
        ).toHaveAttribute('data-value', 'yx');
        await expect(popup.getByRole('combobox', { name: 'Label', exact: true })).toHaveAttribute(
            'data-value',
            '',
        );
        await expect(popup.getByRole('combobox', { name: 'Measure', exact: true })).toHaveAttribute(
            'data-value',
            '',
        );
        await page.keyboard.press('Escape');
        for (const width of [1440, 900]) {
            await page.setViewportSize({ width, height: 1000 });
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
            ).toBeLessThanOrEqual(1);
            await setup.click();
            await expect
                .poll(async () => {
                    const bounds = await popup.boundingBox();
                    return Boolean(bounds && bounds.x >= 8 && bounds.x + bounds.width <= width - 8);
                })
                .toBe(true);
            await page.keyboard.press('Escape');
        }
        await page.screenshot({ path: info.outputPath(`geography-${mode}.png`) });
        await page.reload();
        await results.getByRole('tab', { name: 'Chart', exact: true }).click();
        await expect(type).toHaveAttribute('data-value', 'geography');
        await expect(results.locator('.geo-map')).toBeVisible();
        await setup.click();
        await expect(popup.getByRole('combobox', { name: 'Source', exact: true })).toHaveAttribute(
            'data-value',
            'geometry:2',
        );
        expect(runs).toBe(1);
        expect(errors).toEqual([]);
    });

    test(`${mode} geometry without numeric measures can switch between row counts and Geography`, async ({
        page,
    }) => {
        await mockSnapshot(page, () => ({
            columns: [{ name: 'location', type: 'Point' }],
            rows: [[[0, 0]], [[13, 52]]],
        }));
        const results = await openChart(page, mode);
        const type = results.getByRole('combobox', { name: 'Type', exact: true });
        await chooseChartOption(page, type, 'geography');
        await expect(results.locator('.geo-feature.geo-point')).toHaveCount(2);
        await chooseChartOption(page, type, 'bar');
        await expect(results.locator('.chart-row-count-type')).toHaveText('Rows');
        await chooseChartOption(page, type, 'geography');
        await expect(results.locator('.geo-map')).toBeVisible();
    });
}

for (const [description, data] of Object.entries<SnapshotData>({
    'invalid native geometry': {
        columns: [
            { name: 'location', type: 'Point' },
            { name: 'value', type: 'UInt64' },
        ],
        rows: [
            [null, 1],
            [[181, 52], 2],
        ],
    },
    'invalid coordinates': {
        columns: [
            { name: 'longitude', type: 'Float64' },
            { name: 'latitude', type: 'Float64' },
        ],
        rows: [
            [null, null],
            [999, 999],
        ],
    },
    'unrelated numeric columns': {
        columns: [
            { name: 'x', type: 'Float64' },
            { name: 'y', type: 'Float64' },
        ],
        rows: [
            [13, 52],
            [14, 53],
        ],
    },
    'empty geo result': { columns: cities.columns, rows: [] },
})) {
    test(`Geography is hidden for ${description}`, async ({ page }) => {
        await mockSnapshot(page, () => data);
        const results = await openChart(page);
        await results.getByRole('combobox', { name: 'Type', exact: true }).click();
        await expect(results.getByRole('option', { name: 'Geography', exact: true })).toHaveCount(
            0,
        );
    });
}

test('Geography uses a later valid source and falls back when a rerun has no valid geo data', async ({
    page,
}) => {
    let data: SnapshotData = {
        ...cities,
        rows: cities.rows.map(row => [row[0]!, null, ...row.slice(2)]),
    };
    await mockSnapshot(page, () => data);
    const results = await openChart(page);
    const type = results.getByRole('combobox', { name: 'Type', exact: true });
    await chooseChartOption(page, type, 'geography');
    await expect(results.locator('.geo-feature.geo-point')).toHaveCount(2);
    await results.getByRole('button', { name: 'Setup', exact: true }).click();
    await expect(
        results
            .getByRole('dialog', { name: 'Setup', exact: true })
            .getByRole('combobox', { name: 'Source', exact: true }),
    ).toHaveAttribute('data-value', 'geometry:2');
    await page.keyboard.press('Escape');
    data = {
        columns: [
            { name: 'category', type: 'String' },
            { name: 'value', type: 'UInt64' },
        ],
        rows: [
            ['A', 1],
            ['B', 2],
        ],
    };
    await runButton(page).click();
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'succeeded');
    await results.getByRole('tab', { name: 'Chart', exact: true }).click();
    await expect(type).toHaveAttribute('data-value', 'bar');
    await expect(results.locator('.geo-map')).toHaveCount(0);
    await type.click();
    await expect(results.getByRole('option', { name: 'Geography', exact: true })).toHaveCount(0);
});

test('Geography is available from candlestick charts and can return to them', async ({ page }) => {
    await mockSnapshot(page, () => ({
        columns: [
            { name: 'time', type: 'DateTime' },
            ...['open', 'high', 'low', 'close'].map(name => ({ name, type: 'Float64' })),
            { name: 'location', type: 'Point' },
        ],
        rows: [
            ['2026-01-01 00:00:00', 10, 12, 8, 11, [13, 52]],
            ['2026-01-02 00:00:00', 11, 13, 9, 12, [2, 48]],
        ],
    }));
    const results = await openChart(page);
    const type = results.getByRole('combobox', { name: 'Type', exact: true });
    await expect(type).toHaveAttribute('data-value', 'candlestick');
    await chooseChartOption(page, type, 'geography');
    await expect(results.locator('.geo-map')).toBeVisible();
    await chooseChartOption(page, type, 'candlestick');
    await expect(results.locator('.market-candle-body')).toHaveCount(2);
});

test('Coordinate mappings stop applying when a rerun returns unrelated numeric columns', async ({
    page,
}) => {
    let data: SnapshotData = {
        columns: [
            { name: 'longitude', type: 'Float64' },
            { name: 'latitude', type: 'Float64' },
        ],
        rows: [
            [13, 52],
            [2, 48],
        ],
    };
    await mockSnapshot(page, () => data);
    const results = await openChart(page);
    const type = results.getByRole('combobox', { name: 'Type', exact: true });
    await chooseChartOption(page, type, 'geography');
    await expect(results.locator('.geo-map')).toBeVisible();
    data = {
        columns: [
            { name: 'age', type: 'UInt8' },
            { name: 'orders', type: 'UInt64' },
        ],
        rows: [
            [30, 15],
            [40, 20],
        ],
    };
    await runButton(page).click();
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'succeeded');
    await results.getByRole('tab', { name: 'Chart', exact: true }).click();
    await expect(type).toHaveAttribute('data-value', 'bar');
    await type.click();
    await expect(results.getByRole('option', { name: 'Geography', exact: true })).toHaveCount(0);
});

test('Row-count chart types select a matching dimension after leaving Geography', async ({
    page,
}) => {
    await mockSnapshot(page, () => ({
        columns: [
            { name: 'location', type: 'Point' },
            { name: 'time', type: 'DateTime' },
        ],
        rows: [
            [[13, 52], '2026-01-01 00:00:00'],
            [[2, 48], '2026-01-02 00:00:00'],
        ],
    }));
    const results = await openChart(page);
    const type = results.getByRole('combobox', { name: 'Type', exact: true });
    await expect(type).toHaveAttribute('data-value', 'line');
    await chooseChartOption(page, type, 'geography');
    await chooseChartOption(page, type, 'bar');
    await expect(type).toHaveAttribute('data-value', 'bar');
    await expect(results.getByRole('combobox', { name: 'X axis', exact: true })).toHaveAttribute(
        'data-value',
        '0',
    );
    await chooseChartOption(page, type, 'line');
    await expect(type).toHaveAttribute('data-value', 'line');
    await expect(results.getByRole('combobox', { name: 'X axis', exact: true })).toHaveAttribute(
        'data-value',
        '1',
    );
});
