import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { functionsWorkspace } from './sql-functions-helpers.js';
import { workspacePath } from './helpers.js';

test('Standard keeps Python management hidden and makes no executable metadata requests', async ({
    page,
}) => {
    const { requests } = await functionsWorkspace(page, {
        path: workspacePath('Standard'),
        existing: true,
    });
    await expect(page.getByRole('button', { name: 'Create Python UDF', exact: true })).toHaveCount(
        0,
    );
    expect(requests.some(request => request.action === 'executable-functions')).toBe(false);
});

for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
]) {
    test(`Experimental exports an inspectable ZIP without management keys at ${viewport.width}px`, async ({
        page,
    }, info) => {
        await page.setViewportSize(viewport);
        await functionsWorkspace(page);
        await page.getByRole('button', { name: 'Create Python UDF', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Create Python UDF', exact: true });
        await expect(dialog.getByRole('textbox', { name: 'Python source' })).toContainText(
            'SequenceMatcher',
        );
        const pending = page.waitForEvent('download');
        await dialog.getByRole('button', { name: 'Export ZIP', exact: true }).click();
        const downloaded = await pending;
        expect(downloaded.suggestedFilename()).toBe('py_similarity.zip');
        const path = await downloaded.path();
        expect(path).toBeTruthy();
        const files = unzipSync(new Uint8Array(await readFile(path!)));
        expect(Object.keys(files).sort()).toEqual(['function.json', 'function.xml', 'main.py']);
        expect(strFromU8(files['main.py']!)).toContain('SequenceMatcher');
        const bounds = await dialog.boundingBox();
        expect(bounds).toBeTruthy();
        expect(bounds!.width).toBeLessThanOrEqual(viewport.width);
        expect(bounds!.height).toBeLessThanOrEqual(viewport.height);
        expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(
            true,
        );
        await dialog.screenshot({ path: info.outputPath(`python-creator-${viewport.width}.png`) });
        await dialog.getByLabel('Function name', { exact: true }).fill('_invalid');
        await expect(
            dialog.getByRole('button', { name: 'Export ZIP', exact: true }),
        ).toBeDisabled();
    });
}

test('Python tester routes typed SQL and query results through the existing runner', async ({
    page,
}) => {
    const { state, requests } = await functionsWorkspace(page);
    state.executableFunctions.push({ name: 'python_double', createQuery: '' });
    await page.locator('.object-refresh-action').click();
    await page.getByRole('button', { name: 'python_double Executable UDF', exact: true }).click();
    await page.getByLabel('Test argument 1 type', { exact: true }).selectOption('Int64');
    await page.getByLabel('arg1', { exact: true }).fill('21');
    await page.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
    await expect(page.locator('.sql-function-output')).toHaveText('"42"');
    expect(requests.find(request => request.action === 'run')?.sql).toContain(
        "`python_double`(CAST('21', 'Int64'))",
    );
    await page.getByRole('button', { name: 'Add argument', exact: true }).click();
    await expect(page.getByLabel('arg2', { exact: true })).toBeVisible();
    await expect(page.locator('.sql-function-output')).toHaveCount(0);
    await page.getByRole('button', { name: 'Remove argument', exact: true }).click();
    await expect(page.getByLabel('arg2', { exact: true })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Definition', exact: true }).click();
    await expect(
        page.getByText('Source is unavailable for this installed executable function.'),
    ).toBeVisible();
    await page.getByRole('tab', { name: 'Deployment', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Reload pool SQL', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete function', exact: true })).toHaveCount(0);
});

test('Cloud timeout disables another publish until actual state has been checked and expired sessions can be renewed', async ({
    page,
}) => {
    let reads = 0,
        writes = 0,
        expired = false;
    await page.route('**/api/python-functions/**', route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/capabilities'))
            return route.fulfill({ json: { available: true, reason: '' } });
        if (path.endsWith('/session'))
            return route.fulfill({
                json: {
                    available: true,
                    reason: '',
                    serviceId: 'service-id',
                    serviceName: 'Cloud test',
                },
            });
        if (path.endsWith('/status')) {
            if (expired)
                return route.fulfill({
                    status: 401,
                    json: {
                        error: {
                            code: 'UDF_SESSION',
                            message: 'Enable a new 15-minute management session.',
                        },
                    },
                });
            reads++;
            return route.fulfill({ json: { versions: [] } });
        }
        if (path.endsWith('/publish')) {
            writes++;
            return route.fulfill({
                status: 502,
                json: {
                    error: { code: 'UDF_UNKNOWN', message: 'Cloud request did not complete.' },
                },
            });
        }
        return route.fulfill({ status: 404, json: {} });
    });
    await functionsWorkspace(page);
    await page.getByRole('button', { name: 'Create Python UDF', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create Python UDF', exact: true });
    await dialog.getByRole('button', { name: 'Enable deployment session', exact: true }).click();
    await dialog.getByLabel('Target service', { exact: true }).selectOption('service-id');
    const publish = dialog.getByRole('button', { name: 'Publish function', exact: true });
    await expect(publish).toBeEnabled();
    await publish.click();
    await expect(publish).toBeDisabled();
    await expect(
        dialog.getByText('Outcome unknown. Check Cloud status before another deployment attempt.'),
    ).toBeVisible();
    expect(writes).toBe(1);
    const before = reads;
    await dialog.getByRole('button', { name: 'Check Cloud status', exact: true }).click();
    await expect(publish).toBeEnabled();
    expect(reads).toBeGreaterThan(before);
    expired = true;
    await dialog.getByRole('button', { name: 'Check Cloud status', exact: true }).click();
    await expect(
        dialog.getByRole('button', { name: 'Enable deployment session', exact: true }),
    ).toBeVisible();
});
