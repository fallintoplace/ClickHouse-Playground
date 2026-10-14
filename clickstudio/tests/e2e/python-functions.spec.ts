import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { functionsWorkspace } from './sql-functions-helpers.js';
import { setWorkspaceMode, workspacePath } from './helpers.js';
import { PLAYGROUND_CONNECTION } from '../../src/shared/database/connections/playground.js';
import { cloudSchema } from '../helpers/cloud-fixtures.js';

test('Python ZIP export includes offline tokenizer assets without management credentials', async ({
    page,
}) => {
    await functionsWorkspace(page);
    await page.getByRole('button', { name: 'Create Python UDF', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create Python UDF', exact: true });
    const pending = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export ZIP', exact: true }).click();
    expect((await pending).suggestedFilename()).toBe('py_similarity.zip');
    await dialog.getByLabel('Template', { exact: true }).selectOption('2');
    const tokenDownload = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export ZIP', exact: true }).click();
    const tokenizer = await tokenDownload;
    expect(tokenizer.suggestedFilename()).toBe('count_tokens.zip');
    const tokenizerPath = await tokenizer.path();
    expect(tokenizerPath).toBeTruthy();
    const files = unzipSync(new Uint8Array(await readFile(tokenizerPath!)));
    expect(Object.keys(files).some(name => name.startsWith('tiktoken_cache/'))).toBe(true);
    expect(strFromU8(files['requirements.txt']!)).toContain('tiktoken==0.14.0');
});

for (const mode of ['Standard', 'Experimental']) {
    test(`${mode} hides all Functions on Playground without querying function metadata`, async ({
        page,
    }) => {
        const requests: string[] = [];
        page.on('request', request => {
            const path = new URL(request.url()).pathname;
            if (path.startsWith('/api/')) requests.push(path);
        });
        await page.route('**/api/connections', route =>
            route.fulfill({ json: [PLAYGROUND_CONNECTION] }),
        );
        await page.route('**/api/connections/playground/schema*', route =>
            route.fulfill({ json: { ...cloudSchema, connectionId: 'playground' } }),
        );
        await page.goto(`${workspacePath(mode)}?connection=playground`);
        if (mode === 'Standard')
            await page
                .locator('.icon-rail')
                .getByRole('button', { name: 'Objects', exact: true })
                .click();
        await expect(
            page.getByRole('button', { name: 'events MergeTree', exact: true }),
        ).toBeVisible();
        await expect(page.locator('.sql-functions-tree, .python-functions-tree')).toHaveCount(0);
        await expect(page.getByRole('button', { name: /Create (SQL|Python) UDF/ })).toHaveCount(0);
        await expect(page.getByTestId('schema-search')).not.toHaveAttribute(
            'placeholder',
            /functions/,
        );
        expect(requests.some(url => url.includes('functions'))).toBe(false);
    });

    test(`${mode} hides empty Functions without creation privileges and restores them after refresh`, async ({
        page,
    }) => {
        const { state } = await functionsWorkspace(page, {
            path: workspacePath(mode),
            canCreate: false,
            canDrop: false,
        });
        await expect(page.locator('.sql-functions-tree, .python-functions-tree')).toHaveCount(0);
        await expect(page.getByTestId('schema-search')).not.toHaveAttribute(
            'placeholder',
            /functions/,
        );
        state.canCreate = true;
        await page.locator('.object-refresh-action').click();
        await expect(
            page.getByRole('button', { name: 'Create SQL UDF', exact: true }),
        ).toBeEnabled();
        if (mode === 'Experimental')
            await expect(
                page.getByRole('button', { name: 'Create Python UDF', exact: true }),
            ).toBeVisible();
        state.canCreate = false;
        await page.locator('.object-refresh-action').click();
        await expect(page.locator('.sql-functions-tree, .python-functions-tree')).toHaveCount(0);
    });
}

test('Experimental hides Functions on sample data and after disconnecting Cloud', async ({
    page,
}) => {
    await page.goto('/experimental');
    await expect(page.locator('.object-explorer-section')).toBeVisible();
    await expect(page.locator('.sql-functions-tree, .python-functions-tree')).toHaveCount(0);
    await functionsWorkspace(page);
    await expect(
        page.getByRole('button', { name: 'Create Python UDF', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Disconnect Cloud', exact: true }).click();
    await expect(page.locator('.connection-trigger')).not.toContainText('CLICKHOUSE CLOUD');
    await expect(page.locator('.sql-functions-tree, .python-functions-tree')).toHaveCount(0);
    await expect(page.getByTestId('schema-search')).not.toHaveAttribute('placeholder', /functions/);
});

test('Experimental hides denied Python metadata and recovers without hiding available SQL functions', async ({
    page,
}) => {
    const { state } = await functionsWorkspace(page, { existing: true, executableError: true });
    await expect(page.locator('.python-functions-tree')).toHaveCount(0);
    await expect(page.getByText('Function access denied.', { exact: true })).toHaveCount(0);
    await expect(
        page.getByRole('button', { name: 'udf_map_remove SQL UDF', exact: true }),
    ).toBeVisible();
    state.executableError = false;
    await page.locator('.object-refresh-action').click();
    await expect(
        page.getByRole('button', { name: 'Create Python UDF', exact: true }),
    ).toBeVisible();
    state.executableError = true;
    state.metadataError = true;
    await page.locator('.object-refresh-action').click();
    await expect(page.locator('.sql-functions-tree, .python-functions-tree')).toHaveCount(0);
    await expect(page.getByTestId('schema-search')).not.toHaveAttribute('placeholder', /functions/);
});

test('Existing Python functions remain testable without creation privileges', async ({ page }) => {
    const { state } = await functionsWorkspace(page, { canCreate: false, canDrop: false });
    state.executableFunctions.push({ name: 'python_double', createQuery: '' });
    await page.locator('.object-refresh-action').click();
    await expect(page.locator('.sql-functions-tree')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create Python UDF', exact: true })).toHaveCount(
        0,
    );
    await page.getByRole('button', { name: 'python_double Executable UDF', exact: true }).click();
    await page.getByLabel('Test argument 1 type', { exact: true }).selectOption('Int64');
    await page.getByLabel('arg1', { exact: true }).fill('21');
    await page.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
    await expect(page.locator('.sql-function-output')).toHaveText('"42"');
    await setWorkspaceMode(page, 'Standard');
    await expect(page.locator('.python-functions-tree, .sql-function-details')).toHaveCount(0);
});

for (const kind of ['SQL', 'Python']) {
    test(`${kind} creator closes when access is revoked and never reopens itself after recovery`, async ({
        page,
    }) => {
        const { state } = await functionsWorkspace(page, { existing: true });
        await page.getByRole('button', { name: `Create ${kind} UDF`, exact: true }).click();
        const dialog = page.getByRole('dialog', {
            name: kind === 'SQL' ? 'Create SQL Function' : 'Create Python UDF',
            exact: true,
        });
        await dialog.getByLabel('Function name', { exact: true }).fill('my_custom_udf');
        if (kind === 'Python') state.executableError = true;
        else state.canCreate = false;
        const refresh = () =>
            page.locator('.object-refresh-action').evaluate(element => {
                if (element instanceof HTMLButtonElement) element.click();
            });
        await refresh();
        await expect(dialog).toHaveCount(0);
        state.executableError = false;
        state.canCreate = true;
        await refresh();
        await expect(
            page.getByRole('button', { name: `Create ${kind} UDF`, exact: true }),
        ).toBeEnabled();
        await expect(dialog).toHaveCount(0);
        await page.getByRole('button', { name: `Create ${kind} UDF`, exact: true }).click();
        await expect(dialog).toBeVisible();
    });
}

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

for (const { viewport, theme } of [
    { viewport: { width: 1280, height: 900 }, theme: 'Dark' },
    { viewport: { width: 1280, height: 900 }, theme: 'Light' },
    { viewport: { width: 390, height: 844 }, theme: 'Dark' },
    { viewport: { width: 390, height: 844 }, theme: 'Light' },
]) {
    test(`Experimental exports an inspectable ZIP in ${theme} without management keys at ${viewport.width}px`, async ({
        page,
    }, info) => {
        await page.setViewportSize(viewport);
        await functionsWorkspace(page);
        await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
        await page.getByRole('button', { name: 'Create Python UDF', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Create Python UDF', exact: true });
        await expect(dialog.getByLabel('Function name', { exact: true })).toBeFocused();
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
        const name = dialog.getByLabel('Function name', { exact: true });
        await expect(name).toHaveCSS('border-top-style', 'solid');
        const nameBounds = await name.boundingBox();
        expect(nameBounds!.height).toBeLessThanOrEqual(40);
        const editor = dialog.locator('.python-function-editor');
        await editor.scrollIntoViewIfNeeded();
        const editorBounds = await editor.boundingBox();
        const footerBounds = await dialog.locator('.creation-dialog-footer').boundingBox();
        expect(editorBounds!.y + editorBounds!.height).toBeLessThanOrEqual(footerBounds!.y + 1);
        await name.scrollIntoViewIfNeeded();
        await dialog.screenshot({
            path: info.outputPath(`python-creator-${theme}-${viewport.width}.png`),
        });
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
