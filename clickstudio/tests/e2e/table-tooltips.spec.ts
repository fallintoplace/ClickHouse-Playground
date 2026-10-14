import { test, expect } from '@playwright/test';
import { replaceSql, runButton, trust } from './helpers.js';
import { chooseExistingTable, mockWritableWorkspace, schema } from './import-helpers.js';
import { chooseChartOption } from './chart-control-helpers.js';

test('Result tooltips follow clipping and new result data without covering controls', async ({
    page,
}) => {
    const nestedType = `Tuple(${Array.from({ length: 30 }, (_, index) => `field_${index} String`).join(', ')})`;
    const longValue = '<value> "quoted" & 日本語 '.repeat(30);
    let type = nestedType;
    let rows = [['short'], [longValue]];
    await page.route(
        url => url.pathname.endsWith('/result'),
        async route => {
            const response = await route.fetch();
            const result = await response.json();
            await route.fulfill({
                response,
                json: {
                    ...result,
                    columns: [{ name: 'value', type }],
                    rows,
                    totalRows: rows.length,
                    offset: 0,
                    nextOffset: null,
                },
            });
        },
    );
    await trust(page);
    await runButton(page).click();
    const header = page.locator('.data-table th[data-type-group]');
    const cells = page.locator('.data-table tbody td:not(.row-number)');
    await expect(header).toHaveAttribute('title', `value\n${nestedType}`);
    await expect(header).toHaveAccessibleName(`value ${nestedType}`);
    await expect(cells.first()).toHaveAttribute('title', '');
    await expect(cells.last()).toHaveAttribute('title', longValue);
    await expect(cells.last()).toHaveText(longValue.trim());
    await cells.last().hover();
    await expect(page.getByRole('tooltip')).toHaveCount(0);

    type = 'String';
    rows = [['replacement']];
    await replaceSql(page, 'SELECT 2 AS value');
    await runButton(page).click();
    await expect(cells).toHaveText(['replacement']);
    await expect(cells.first()).toHaveAttribute('title', '');
    await expect(header).toHaveAttribute('title', '');
    await header.locator('small').evaluate(element => {
        element.style.maxWidth = '10px';
    });
    await expect(header).toHaveAttribute('title', 'value\nString');
    await header.locator('small').evaluate(element => {
        element.style.removeProperty('max-width');
    });
    await expect(header).toHaveAttribute('title', '');
    await page.setViewportSize({ width: 900, height: 720 });
    await expect(header).toHaveAttribute('title', '');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
});

test('Import preview, mapping and review use native titles only for clipped text', async ({
    page,
}) => {
    const column = 'a_long_source_and_destination_column_name_'.repeat(3);
    const value = 'a long imported value '.repeat(40);
    const fields = { [column]: column, value: 'value' };
    const rows = [{ [column]: value, value: 'short' }];
    await mockWritableWorkspace(page, ['demo.events'], {
        ...schema,
        columns: [column, 'value'].map(name => ({ ...schema.columns[0]!, name, type: 'String' })),
    });
    await page.route('**/api/imports/preview', route =>
        route.fulfill({
            status: 201,
            json: {
                id: 'tooltip-input',
                name: 'rows.json',
                format: 'json',
                columns: Object.keys(fields),
                rows,
                rowCount: 1,
            },
        }),
    );
    await page.route('**/api/imports/tooltip-input/mapping', route =>
        route.fulfill({
            json: {
                id: 'tooltip-mapping',
                inputId: 'tooltip-input',
                connectionId: 'live',
                table: 'demo.events',
                fields,
                rows,
                rowCount: 1,
            },
        }),
    );
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await dialog.getByLabel('Choose a CSV, JSON, or NDJSON file').setInputFiles({
        name: 'rows.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(rows)),
    });
    await dialog.getByRole('button', { name: 'Read file and continue', exact: true }).click();
    const preview = dialog.locator('.import-preview-table');
    await expect(preview.locator('thead th').first()).toHaveAttribute('title', column);
    await expect(preview.locator('thead th').last()).toHaveAttribute('title', '');
    await expect(preview.locator('tbody td').first()).toHaveAttribute('title', value);
    await expect(preview.locator('tbody td').last()).toHaveAttribute('title', '');
    await chooseExistingTable(dialog);
    const mapping = dialog.locator('.import-column-map');
    await expect(mapping.locator('tbody th').first()).toHaveAttribute('title', column);
    await expect(mapping.locator('.import-column-type').first()).toHaveAttribute('title', '');
    await mapping.locator('tbody th').first().hover();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Review import', exact: true }).click();
    const review = dialog.getByRole('region', { name: 'Review import', exact: true });
    const reviewRows = review.getByRole('table', { name: 'Rows to import', exact: true });
    await expect(reviewRows.locator('tbody td').first()).toHaveAttribute('title', '');
    await expect(reviewRows.locator('tbody td').first()).toHaveText(value.trim());
    const reviewMapping = review.getByRole('table', { name: 'Import column mapping', exact: true });
    await expect(reviewMapping.locator('tbody th').first()).toHaveAttribute('title', column);
    await expect(reviewMapping.locator('tbody tr').first().locator('td').first()).toHaveAttribute(
        'title',
        column,
    );
    await expect(dialog.getByRole('button', { name: 'Import rows', exact: true })).toBeEnabled();
});

test('Comparison keeps exact metric details and styling after redundant titles are removed', async ({
    page,
}) => {
    await trust(page);
    for (const sql of ['SELECT 1 AS value', 'SELECT 2 AS value']) {
        await replaceSql(page, sql);
        const submitted = page.waitForResponse(
            response =>
                response.request().method() === 'POST' &&
                new URL(response.url()).pathname === '/api/runs',
        );
        await runButton(page).click();
        const run = await (await submitted).json();
        await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', run.queryId);
        await expect(page.locator('.execution-bar')).toHaveAttribute(
            'data-run-status',
            'succeeded',
        );
    }
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await results.getByRole('tab', { name: 'Insights', exact: true }).click();
    await results.getByRole('button', { name: 'Compare runs', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Compare query runs', exact: true });
    const duration = dialog
        .getByRole('row')
        .filter({ has: page.getByRole('rowheader', { name: /^Duration/ }) })
        .locator('td')
        .first();
    await expect(duration).toHaveAttribute('title', /^\d+$/);
    await expect(duration).toContainText(' ms');
    const retained = dialog
        .getByRole('row')
        .filter({ has: page.getByRole('rowheader', { name: /^Retained result rows/ }) })
        .locator('td')
        .first();
    await expect(retained).toHaveAttribute('title', '');
    await expect(retained).toHaveCSS('font-size', '16px');
    await expect(retained).toHaveCSS('font-weight', '650');
    await retained.hover();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Swap ⇄', exact: true }).click();
    await expect(retained).toHaveAttribute('title', '');
    await expect(duration).toHaveAttribute('title', /^\d+$/);
});

test('Heatmaps keep native context and suppress redundant axis titles', async ({ page }) => {
    await page.route('**/api/runs/*/snapshot', async route => {
        const response = await route.fetch();
        const snapshot = await response.json();
        await route.fulfill({
            response,
            json: {
                ...snapshot,
                columns: [
                    { name: 'artist', type: 'String' },
                    { name: 'title', type: 'String' },
                    { name: 'plays', type: 'UInt64' },
                ],
                rows: [
                    ['Avicii', 'Around Town', 5],
                    ['Beck', "Don't Turn the Lights On", 8],
                    ['Bastille', 'Supermassive Black Hole', 12_345],
                ],
                completeness: 'complete',
            },
        });
    });
    await trust(page);
    await runButton(page).click();
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await results.getByRole('tab', { name: 'Chart', exact: true }).click();
    await chooseChartOption(
        page,
        results.getByRole('combobox', { name: 'Type', exact: true }),
        'heatmap',
    );
    const table = results.locator('.heatmap-grid');
    await expect(table.locator('.heatmap-row-label').first()).toHaveAttribute('title', '');
    const headers = table.locator('thead .heatmap-axis-label');
    await expect(headers).toHaveText(['Avicii', 'Bastille', 'Beck']);
    await expect(table.locator('.heatmap-row-label')).toHaveText([
        'Around Town',
        "Don't Turn the Lights On",
        'Supermassive Black Hole',
    ]);
    await expect(table).toHaveCSS('table-layout', 'fixed');
    await expect(headers.first()).toHaveCSS('white-space', 'normal');
    const columnWidths = await headers.evaluateAll(elements =>
        elements.map(element => element.getBoundingClientRect().width),
    );
    expect(columnWidths.every(width => Math.abs(width - columnWidths[0]!) < 1)).toBe(true);
    const cell = table.getByLabel('Around Town, Avicii: 5', { exact: true });
    await expect(cell).toHaveAttribute('title', 'title: Around Town · artist: Avicii · plays: 5');
    await cell.hover();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
});
