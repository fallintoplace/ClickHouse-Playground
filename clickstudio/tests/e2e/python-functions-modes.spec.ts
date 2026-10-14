import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { functionsWorkspace } from './sql-functions-helpers.js';
import { workspacePath } from './helpers.js';
import { chooseChartOption as chooseSelectOption } from './chart-control-helpers.js';

for (const mode of ['Standard', 'Experimental']) {
    test(`${mode} browses, searches, refreshes and tests executable UDFs`, async ({ page }) => {
        const { state, requests } = await functionsWorkspace(page, { path: workspacePath(mode) });
        state.executableFunctions.push(
            { name: 'python_double', createQuery: '' },
            { name: 'count_tokens', createQuery: '' },
        );
        await page.locator('.object-refresh-action').click();
        const tree = page.locator('.python-functions-tree');
        const double = tree.getByRole('button', {
            name: 'python_double Executable UDF',
            exact: true,
        });
        const tokens = tree.getByRole('button', {
            name: 'count_tokens Executable UDF',
            exact: true,
        });
        await expect(double).toBeVisible();
        await expect(tokens).toBeVisible();
        await page.getByTestId('schema-search').fill('python_double');
        await expect(double).toBeVisible();
        await expect(tokens).toHaveCount(0);
        await page.getByRole('button', { name: 'Clear object search', exact: true }).click();
        await double.click();
        await chooseSelectOption(
            page,
            page.getByRole('combobox', { name: 'Test argument 1 type', exact: true }),
            'Int64',
        );
        await page.getByLabel('arg1', { exact: true }).fill('21');
        await page.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
        await expect(page.locator('.sql-function-output')).toHaveText('"42"');
        expect(requests.find(request => request.action === 'run')?.sql).toContain(
            "`python_double`(CAST('21', 'Int64'))",
        );
        await page.getByRole('tab', { name: 'Deployment', exact: true }).click();
        await expect(
            page.getByRole('button', { name: 'Reload pool SQL', exact: true }),
        ).toBeVisible();
    });

    test(`${mode} exports the token-counting ZIP without management credentials`, async ({
        page,
    }) => {
        await functionsWorkspace(page, { path: workspacePath(mode) });
        await page.getByRole('button', { name: 'Create Python UDF', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Create Python UDF', exact: true });
        await chooseSelectOption(
            page,
            dialog.getByRole('combobox', { name: 'Template', exact: true }),
            '2',
        );
        const pending = page.waitForEvent('download');
        await dialog.getByRole('button', { name: 'Export ZIP', exact: true }).click();
        const download = await pending;
        expect(download.suggestedFilename()).toBe('count_tokens.zip');
        const downloadPath = await download.path();
        expect(downloadPath).toBeTruthy();
        const files = unzipSync(new Uint8Array(await readFile(downloadPath!)));
        expect(Object.keys(files).some(name => name.startsWith('tiktoken_cache/'))).toBe(true);
        expect(strFromU8(files['requirements.txt']!)).toContain('tiktoken==0.14.0');
        expect(JSON.parse(strFromU8(files['function.json']!))).toMatchObject({
            functionName: 'count_tokens',
            returnType: 'UInt64',
            format: 'JSONEachRow',
            sendChunkHeader: true,
        });
    });

    test(`${mode} recovers executable metadata after access is restored`, async ({ page }) => {
        const { state } = await functionsWorkspace(page, {
            path: workspacePath(mode),
            existing: true,
            executableError: true,
        });
        await expect(page.locator('.python-functions-tree')).toHaveCount(0);
        await expect(page.locator('.sql-functions-tree')).toBeVisible();
        state.executableError = false;
        await page.locator('.object-refresh-action').click();
        await expect(
            page.getByRole('button', { name: 'Create Python UDF', exact: true }),
        ).toBeEnabled();
        state.executableError = true;
        await page.locator('.object-refresh-action').click();
        await expect(page.locator('.python-functions-tree')).toHaveCount(0);
        await expect(page.locator('.sql-functions-tree')).toBeVisible();
    });

    test(`${mode} exposes Cloud deployment only after management access is enabled`, async ({
        page,
    }) => {
        let sessions = 0;
        await page.route('**/api/python-functions/**', route => {
            const path = new URL(route.request().url()).pathname;
            if (path.endsWith('/capabilities'))
                return route.fulfill({ json: { available: true, reason: '' } });
            if (path.endsWith('/session')) {
                sessions++;
                return route.fulfill({
                    json: {
                        available: true,
                        reason: '',
                        serviceId: 'service-id',
                        serviceName: 'Cloud test',
                    },
                });
            }
            if (path.endsWith('/status')) return route.fulfill({ json: { versions: [] } });
            return route.fulfill({ status: 404, json: {} });
        });
        await functionsWorkspace(page, { path: workspacePath(mode) });
        await page.getByRole('button', { name: 'Create Python UDF', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Create Python UDF', exact: true });
        await expect(
            dialog.getByRole('button', { name: 'Publish function', exact: true }),
        ).toHaveCount(0);
        expect(sessions).toBe(0);
        await dialog
            .getByRole('button', { name: 'Enable deployment session', exact: true })
            .click();
        const publish = dialog.getByRole('button', { name: 'Publish function', exact: true });
        await expect(publish).toBeDisabled();
        await chooseSelectOption(
            page,
            dialog.getByRole('combobox', { name: 'Target service', exact: true }),
            'service-id',
        );
        await expect(publish).toBeEnabled();
        expect(sessions).toBe(1);
    });
}
