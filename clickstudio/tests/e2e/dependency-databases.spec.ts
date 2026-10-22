import { test, expect, type Page } from '@playwright/test';
import { trust } from './helpers.js';
import { jsonRecord, stringValue } from '../helpers/type-guards.js';

async function databaseMetadata(page: Page) {
    const requestedDatabases: string[] = [];
    await page.route('**/api/connections/demo/schema*', async route => {
        const response = await route.fetch();
        await route.fulfill({
            response,
            json: {
                ...jsonRecord(await response.json(), 'Schema response'),
                databases: ['demo', 'analytics', 'empty_db', 'analytics'],
            },
        });
    });
    await page.route('**/api/connections/demo/native-explorer', route => {
        const request = jsonRecord(route.request().postDataJSON(), 'Lineage request');
        const database = stringValue(request.database, 'Lineage database');
        requestedDatabases.push(database);
        return route.fulfill({
            json: {
                kind: 'lineage',
                database,
                observedAt: '2026-10-14T12:00:00.000Z',
                source: 'clickhouse',
                nodes: [],
                edges: [],
                truncated: false,
                notes: [],
            },
        });
    });
    return requestedDatabases;
}

for (const theme of ['Light', 'Dark']) {
    test(`${theme} dependency database select searches all databases and loads an empty database`, async ({
        page,
    }) => {
        const requests = await databaseMetadata(page);
        await trust(page);
        await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
        await page.getByRole('button', { name: 'View dependencies', exact: true }).click();
        const dialog = page.getByRole('dialog', {
            name: 'Materialized view dependencies',
            exact: true,
        });
        const database = dialog.getByRole('combobox', { name: 'Lineage database', exact: true });
        await expect(database).toHaveAttribute('data-value', 'demo');
        await expect(dialog.locator('.native-lineage-database select')).toHaveCount(0);
        await database.click();
        await expect(dialog.getByRole('option')).toHaveText(['demo', 'analytics', 'empty_db']);
        await dialog
            .getByRole('searchbox', { name: 'Search lineage database', exact: true })
            .fill('empty');
        await expect(dialog.getByRole('option')).toHaveText(['empty_db']);
        await page.keyboard.press('Enter');
        await expect(database).toHaveAttribute('data-value', 'empty_db');
        await expect(dialog.getByRole('status')).toContainText('empty_db');
        expect(requests).toContain('empty_db');
        await expect(database).toBeFocused();
        await database.click();
        await dialog.getByRole('option', { name: 'analytics', exact: true }).click();
        await expect(dialog.getByRole('status')).toContainText('analytics');
        expect(requests).toContain('analytics');
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
    });
}

test('Help dependencies uses the same searchable database list', async ({ page }) => {
    const requests = await databaseMetadata(page);
    await trust(page);
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    const help = page.getByRole('dialog', { name: 'Explore ClickHouse Playground', exact: true });
    await help.getByTestId('help-section-dependencies').click();
    const database = help.getByRole('combobox', { name: 'Lineage database', exact: true });
    await database.click();
    await expect(help.getByRole('option')).toHaveText(['demo', 'analytics', 'empty_db']);
    await help.getByRole('option', { name: 'empty_db', exact: true }).click();
    await expect(database).toHaveAttribute('data-value', 'empty_db');
    await expect(
        help.getByText('No connected views found for this database.', { exact: true }),
    ).toBeVisible();
    expect(requests).toContain('empty_db');
});
