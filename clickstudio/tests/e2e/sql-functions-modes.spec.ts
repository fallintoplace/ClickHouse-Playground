import { test, expect } from '@playwright/test';
import { setWorkspaceMode, workspacePath } from './helpers.js';
import { functionsWorkspace } from './sql-functions-helpers.js';

for (const mode of ['Standard', 'Experimental']) {
    test(`${mode} browses, searches, refreshes and tests SQL UDFs`, async ({ page }) => {
        const { state, requests } = await functionsWorkspace(page, {
            path: workspacePath(mode),
            existing: true,
        });
        const tree = page.getByRole('tree', { name: 'Objects', exact: true });
        await expect(tree.getByRole('treeitem').first()).toContainText('Functions');
        const search = page.getByTestId('schema-search');
        await expect(search).toHaveAttribute('placeholder', 'Search objects and functions…');
        await search.fill('udf_map');
        await expect(
            tree.getByRole('button', { name: 'udf_map_remove SQL UDF', exact: true }),
        ).toBeVisible();
        await expect(
            tree.getByRole('button', { name: 'udf_array_remove_at SQL UDF', exact: true }),
        ).toHaveCount(0);
        await page.getByRole('button', { name: 'Clear object search', exact: true }).click();
        state.functions.push({
            name: 'add_tax_demo',
            parameters: ['price'],
            createQuery: 'CREATE FUNCTION `add_tax_demo` AS (`price`) -> price * 1.19;',
        });
        await page.locator('.object-refresh-action').click();
        await tree.getByRole('button', { name: 'add_tax_demo SQL UDF', exact: true }).click();
        await page.getByLabel('price', { exact: true }).fill('100');
        await page.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
        await expect(page.locator('.sql-function-output pre')).toHaveText('119');
        expect(requests.filter(body => body.action === 'run')).toHaveLength(1);
        expect(requests.some(body => body.action === 'create-function')).toBe(false);
    });

    test(`${mode} creates a SQL UDF from an empty catalog and runs it`, async ({ page }) => {
        const { requests } = await functionsWorkspace(page, { path: workspacePath(mode) });
        await expect(
            page.getByText('No SQL UDFs on this server yet.', { exact: true }),
        ).toBeVisible();
        await page.getByRole('button', { name: 'Create SQL UDF', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Create SQL Function', exact: true });
        await dialog.getByLabel('Function name', { exact: true }).fill('add_tax_demo');
        await dialog.getByLabel('Parameters', { exact: true }).fill('price');
        await dialog.getByLabel('Expression', { exact: true }).fill('price * 1.19');
        await dialog.getByRole('button', { name: 'Create UDF', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await expect(page.locator('.sql-function-details h3')).toHaveText('add_tax_demo');
        await page.getByLabel('price', { exact: true }).fill('100');
        await page.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
        await expect(page.locator('.sql-function-output pre')).toHaveText('119');
        expect(requests.filter(body => body.action === 'create-function')).toHaveLength(1);
        await page.locator('.object-back-button').click();
        await expect(
            page.getByRole('button', { name: 'add_tax_demo SQL UDF', exact: true }),
        ).toBeVisible();
    });

    test(`${mode} tests existing SQL UDFs without creation privileges`, async ({ page }) => {
        const { requests } = await functionsWorkspace(page, {
            path: workspacePath(mode),
            existing: true,
            canCreate: false,
        });
        const create = page.getByRole('button', { name: 'Create SQL UDF', exact: true });
        await expect(create).toBeDisabled();
        await expect(create).toHaveAttribute('title', 'CREATE FUNCTION privilege is required.');
        await page
            .getByRole('button', { name: 'udf_array_remove_at SQL UDF', exact: true })
            .click();
        await page.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
        await expect(page.locator('.sql-function-output')).toHaveText('[10, 30, 40]');
        expect(requests.some(body => body.action === 'create-function')).toBe(false);
    });
}

test('Functions remain available after switching between workspace modes', async ({ page }) => {
    const { requests } = await functionsWorkspace(page, { existing: true });
    await page.getByRole('link', { name: 'Back to workspace', exact: true }).click();
    await expect(page.locator('.application')).toHaveAttribute('data-experience', 'beginner');
    await page.locator('.icon-rail').getByRole('button', { name: 'Objects', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Create SQL UDF', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'udf_array_remove_at SQL UDF', exact: true }).click();
    await expect(page.locator('.sql-function-details h3')).toHaveText('udf_array_remove_at');
    await page.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
    await expect(page.locator('.sql-function-output')).toHaveText('[10, 30, 40]');
    await setWorkspaceMode(page, 'Experimental');
    await page.locator('.icon-rail').getByRole('button', { name: 'Objects', exact: true }).click();
    await expect(page.locator('.sql-function-details h3')).toHaveText('udf_array_remove_at');
    await page.locator('.object-back-button').click();
    await expect(page.getByRole('button', { name: 'Create SQL UDF', exact: true })).toBeEnabled();
    await expect(
        page.getByRole('button', { name: 'udf_array_remove_at SQL UDF', exact: true }),
    ).toBeVisible();
    expect(requests.filter(body => body.action === 'run')).toHaveLength(1);
});
