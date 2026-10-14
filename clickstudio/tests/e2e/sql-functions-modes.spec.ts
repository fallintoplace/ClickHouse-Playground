import { test, expect } from '@playwright/test';
import { setWorkspaceMode, workspacePath } from './helpers.js';
import { functionsWorkspace } from './sql-functions-helpers.js';
import { chooseChartOption as chooseSelectOption } from './chart-control-helpers.js';

test('Standard loads functions only when Objects is first opened', async ({ page }) => {
    const { requests } = await functionsWorkspace(page, {
        path: workspacePath('Standard'),
        existing: true,
        openObjects: false,
    });
    await expect(page.locator('.inspector-pane')).toHaveCount(0);
    expect(requests.filter(body => body.action === 'functions')).toHaveLength(0);
    await page.locator('.icon-rail').getByRole('button', { name: 'Objects', exact: true }).click();
    await expect(
        page.getByRole('button', { name: 'udf_map_remove SQL UDF', exact: true }),
    ).toBeVisible();
    expect(requests.filter(body => body.action === 'functions')).toHaveLength(1);
});

for (const mode of ['Standard', 'Experimental']) {
    test(`${mode} shows one loading indicator and keeps the pending request when Objects is reopened`, async ({
        page,
    }, info) => {
        const { requests } = await functionsWorkspace(page, {
            path: workspacePath(mode),
            existing: true,
            metadataDelay: 2500,
            waitForFunctions: false,
        });
        const spinner = page.locator('.object-refresh-action');
        await expect(spinner).toHaveClass(/is-loading/);
        await expect(spinner).toHaveAttribute('aria-label', 'Loading objects');
        await expect(page.locator('.object-explorer-section .loading-orbit')).toHaveCount(0);
        await expect(page.getByText('Loading functions…', { exact: true })).toHaveCount(0);
        await page
            .locator('.object-explorer-section')
            .screenshot({ path: info.outputPath('functions-spinner.png') });
        await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
        await page
            .locator('.icon-rail')
            .getByRole('button', { name: 'Objects', exact: true })
            .click();
        await expect(
            page.getByRole('button', { name: 'udf_map_remove SQL UDF', exact: true }),
        ).toBeVisible();
        await expect(spinner).not.toHaveClass(/is-loading/);
        expect(requests.filter(body => body.action === 'functions')).toHaveLength(1);
    });

    test(`${mode} reuses functions across panel switches and fetches again only on refresh`, async ({
        page,
    }) => {
        const { requests, state } = await functionsWorkspace(page, {
            path: workspacePath(mode),
            existing: true,
        });
        const count = (action: string) => requests.filter(body => body.action === action).length;
        const schemas = count('schema');
        expect(count('functions')).toBe(1);
        for (let attempt = 0; attempt < 2; attempt++) {
            await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
            await page
                .locator('.icon-rail')
                .getByRole('button', { name: 'Objects', exact: true })
                .click();
            await expect(
                page.getByRole('button', { name: 'udf_map_remove SQL UDF', exact: true }),
            ).toBeVisible();
        }
        await page
            .locator('.inspector-pane')
            .getByRole('navigation', { name: 'Workspace browser', exact: true })
            .getByRole('button', { name: 'AI', exact: true })
            .click();
        await page
            .locator('.inspector-pane')
            .getByRole('navigation', { name: 'Workspace browser', exact: true })
            .getByRole('button', { name: 'Objects', exact: true })
            .click();
        await expect(
            page.getByRole('button', { name: 'udf_map_remove SQL UDF', exact: true }),
        ).toBeVisible();
        await expect(
            page.getByRole('status', { name: 'Loading functions', exact: true }),
        ).toHaveCount(0);
        expect(count('functions')).toBe(1);
        expect(count('schema')).toBe(schemas);
        state.functions.push({
            name: 'fresh_function',
            parameters: ['x'],
            createQuery: 'CREATE FUNCTION fresh_function AS x -> x + 1',
        });
        await page.locator('.object-refresh-action').click();
        await expect(
            page.getByRole('button', { name: 'fresh_function SQL UDF', exact: true }),
        ).toBeVisible();
        expect(count('functions')).toBe(2);
    });

    test(`${mode} browses, searches, refreshes and tests SQL UDFs`, async ({ page }) => {
        const { state, requests } = await functionsWorkspace(page, {
            path: workspacePath(mode),
            existing: true,
        });
        const tree = page.getByRole('tree', { name: 'Objects', exact: true });
        const rootRows = tree.locator(':scope > .object-tree-branch > [role="treeitem"]');
        await expect(rootRows.first()).toContainText('default');
        await expect(rootRows.last()).toContainText('Functions');
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
            name: 'udf_increment',
            parameters: ['value'],
            createQuery: 'CREATE FUNCTION `udf_increment` AS (`value`) -> value + 1;',
        });
        await page.locator('.object-refresh-action').click();
        await tree.getByRole('button', { name: 'udf_increment SQL UDF', exact: true }).click();
        await chooseSelectOption(
            page,
            page.getByRole('combobox', { name: 'value input type', exact: true }),
            'integer',
        );
        await page.getByLabel('value', { exact: true }).fill('100');
        await page.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
        await expect(page.locator('.sql-function-output pre')).toHaveText('101');
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
        await dialog.getByLabel('Function name', { exact: true }).fill('udf_increment');
        await dialog.getByLabel('Parameter 1 name', { exact: true }).fill('value');
        await dialog.getByLabel('Expression', { exact: true }).fill('value + 1');
        await dialog.getByRole('button', { name: 'Create UDF', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await expect(page.locator('.sql-function-details h3')).toHaveText('udf_increment');
        await chooseSelectOption(
            page,
            page.getByRole('combobox', { name: 'value input type', exact: true }),
            'integer',
        );
        await page.getByLabel('value', { exact: true }).fill('100');
        await page.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
        await expect(page.locator('.sql-function-output pre')).toHaveText('101');
        expect(requests.filter(body => body.action === 'create-function')).toHaveLength(1);
        await page.locator('.object-back-button').click();
        await expect(
            page.getByRole('button', { name: 'udf_increment SQL UDF', exact: true }),
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
