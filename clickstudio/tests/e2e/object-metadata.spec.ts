import { test, expect, type Page } from '@playwright/test';
import { functionsWorkspace } from './sql-functions-helpers.js';
import { workspacePath } from './helpers.js';
import { fileURLToPath } from 'node:url';
import { jsonRecord } from '../helpers/type-guards.js';

async function mountMetadata(page: Page) {
    await page.evaluate(() => {
        const container = document.createElement('div');
        container.id = 'object-metadata-harness';
        container.style.cssText = 'position:fixed;inset:0;background:var(--panel);z-index:100';
        document.body.append(container);
    });
    const fixture = fileURLToPath(new URL('./fixtures/object-metadata.tsx', import.meta.url));
    await page.addScriptTag({ type: 'module', url: `/@fs${fixture}` });
}

async function harnessWorkspace(page: Page) {
    return functionsWorkspace(page, {
        path: workspacePath('Standard'),
        openObjects: false,
        executableFunctions: [{ name: 'python_double', createQuery: '' }],
        tablePermissions: { create: true, dropDatabase: true },
    });
}

async function setupMetadata(page: Page, mode: string) {
    const { state, requests } = await functionsWorkspace(page, {
        path: workspacePath(mode),
        existing: true,
        openObjects: false,
        executableFunctions: [{ name: 'python_double', createQuery: '' }],
        tablePermissions: { create: true, insert: true, drop: true, dropDatabase: true },
    });
    const objects = page
        .locator('.icon-rail')
        .getByRole('button', { name: 'Objects', exact: true });
    await objects.click();
    await expect(
        page.getByRole('button', { name: 'python_double Executable UDF', exact: true }),
    ).toBeVisible();
    await expect(
        page.getByRole('button', { name: 'New table in default', exact: true }),
    ).toBeVisible();
    return { state, requests, objects };
}

test('Metadata stays lazy until Objects opens in Standard', async ({ page }) => {
    const { requests } = await harnessWorkspace(page);
    expect(
        requests.filter(body =>
            ['executable-functions', 'table-permissions'].includes(String(body.action)),
        ),
    ).toHaveLength(0);
});

test('StrictMode coalesces database checks and clears both metadata caches when trust is revoked', async ({
    page,
}) => {
    const { state, requests } = await harnessWorkspace(page);
    await mountMetadata(page);
    const names = page.getByLabel('Cached Python UDFs');
    await expect(names).toHaveText('python_double');
    await expect(page.getByLabel('First database actions')).toHaveText('allowed');
    await expect(page.getByLabel('Second database actions')).toHaveText('allowed');
    expect(requests.filter(body => body.action === 'table-permissions')).toHaveLength(1);
    expect(requests.filter(body => body.action === 'executable-functions')).toHaveLength(1);
    await page.getByRole('button', { name: 'Toggle metadata trust' }).click();
    await expect(names).toBeEmpty();
    await expect(page.getByLabel('First database actions')).toHaveText('denied');
    state.executableFunctions = [{ name: 'current_python', createQuery: '' }];
    await page.getByRole('button', { name: 'Toggle metadata trust' }).click();
    await expect(names).toHaveText('current_python');
    await expect(page.getByLabel('First database actions')).toHaveText('allowed');
    expect(requests.filter(body => body.action === 'table-permissions')).toHaveLength(2);
    expect(requests.filter(body => body.action === 'executable-functions')).toHaveLength(2);
});

for (const field of ['host', 'database', 'username', 'testedAt']) {
    test(`Metadata ignores delayed Python and permission responses after ${field} changes`, async ({
        page,
    }) => {
        const { state } = await harnessWorkspace(page);
        let pythonRequests = 0;
        let permissionRequests = 0;
        let release = () => {};
        const pending = new Promise<void>(resolve => {
            release = resolve;
        });
        await page.route('**/api/cloud', async route => {
            const body = jsonRecord(route.request().postDataJSON());
            if (body.action === 'executable-functions') {
                pythonRequests++;
                if (pythonRequests > 1) return route.fallback();
                const functions = structuredClone(state.executableFunctions);
                await pending;
                return route.fulfill({ json: { functions } });
            }
            if (body.action === 'table-permissions') {
                permissionRequests++;
                if (permissionRequests > 1)
                    return route.fulfill({ json: { create: false, dropDatabase: false } });
                await pending;
                return route.fulfill({ json: { create: true, dropDatabase: true } });
            }
            return route.fallback();
        });
        const names = page.getByLabel('Cached Python UDFs');
        try {
            await mountMetadata(page);
            await expect.poll(() => pythonRequests).toBe(1);
            await expect.poll(() => permissionRequests).toBe(1);
            state.executableFunctions = [{ name: 'current_python', createQuery: '' }];
            await page.getByRole('button', { name: `Change metadata ${field}` }).click();
            await expect(names).toHaveText('current_python');
            await expect(page.getByLabel('First database actions')).toHaveText('denied');
        } finally {
            release();
            await page.unrouteAll({ behavior: 'wait' });
        }
        await expect(names).toHaveText('current_python');
        await expect(page.getByLabel('First database actions')).toHaveText('denied');
        expect(pythonRequests).toBe(2);
        expect(permissionRequests).toBe(2);
    });
}

test('A failed permission check stops loading and retries only on explicit refresh', async ({
    page,
}) => {
    await harnessWorkspace(page);
    let permissionRequests = 0;
    await page.route('**/api/cloud', route => {
        const body = jsonRecord(route.request().postDataJSON());
        if (body.action !== 'table-permissions') return route.fallback();
        permissionRequests++;
        if (permissionRequests === 1)
            return route.fulfill({
                status: 502,
                json: {
                    error: { code: 'UNAVAILABLE', message: 'Permission service unavailable.' },
                },
            });
        return route.fulfill({ json: { create: true, dropDatabase: true } });
    });
    await mountMetadata(page);
    await expect(page.getByLabel('First database actions')).toHaveText('denied');
    await page.getByRole('button', { name: 'Toggle metadata visibility' }).click();
    await page.getByRole('button', { name: 'Toggle metadata visibility' }).click();
    await expect(page.getByLabel('First database actions')).toHaveText('denied');
    expect(permissionRequests).toBe(1);
    await page.getByRole('button', { name: 'Refresh metadata' }).click();
    await expect(page.getByLabel('First database actions')).toHaveText('allowed');
    expect(permissionRequests).toBe(2);
});

test('Pending Python and database checks show spinners and finish across AI switches', async ({
    page,
}, info) => {
    const { state } = await harnessWorkspace(page);
    let pythonRequests = 0;
    let permissionRequests = 0;
    let release = () => {};
    const pending = new Promise<void>(resolve => {
        release = resolve;
    });
    await page.route('**/api/cloud', async route => {
        const body = jsonRecord(route.request().postDataJSON());
        if (body.action === 'executable-functions') pythonRequests++;
        else if (body.action === 'table-permissions') permissionRequests++;
        else return route.fallback();
        await pending;
        return route.fulfill({
            json:
                body.action === 'executable-functions'
                    ? { functions: state.executableFunctions }
                    : { create: true, dropDatabase: true },
        });
    });
    const objects = page
        .locator('.icon-rail')
        .getByRole('button', { name: 'Objects', exact: true });
    const pythonLoading = page.getByRole('status', { name: 'Loading Python UDFs', exact: true });
    const databaseLoading = page.getByRole('status', {
        name: 'Checking database actions for default',
        exact: true,
    });
    try {
        await objects.click();
        await expect(pythonLoading).toBeVisible();
        await expect(databaseLoading).toBeVisible();
        await expect(page.getByRole('button', { name: 'New table in default' })).toHaveCount(0);
        await page.locator('.object-explorer-section').screenshot({
            path: info.outputPath('pending-object-metadata.png'),
        });
        await page.getByTestId('open-ai').click();
        await objects.click();
        await expect(pythonLoading).toBeVisible();
        await expect(databaseLoading).toBeVisible();
        expect(pythonRequests).toBe(1);
        expect(permissionRequests).toBe(1);
    } finally {
        release();
        await page.unrouteAll({ behavior: 'wait' });
    }
    await expect(pythonLoading).toHaveCount(0);
    await expect(databaseLoading).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'python_double Executable UDF' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New table in default' })).toBeVisible();
});

test('Objects refresh updates Python UDFs and rechecks database action permissions', async ({
    page,
}) => {
    const { state, requests } = await setupMetadata(page, 'Standard');
    const initialPermissions = requests.filter(body => body.action === 'table-permissions').length;
    state.executableFunctions = [{ name: 'current_python', createQuery: '' }];
    let refreshPermissions = 0;
    await page.route('**/api/cloud', route => {
        if (jsonRecord(route.request().postDataJSON()).action !== 'table-permissions')
            return route.fallback();
        refreshPermissions++;
        return route.fulfill({ json: { create: false, dropDatabase: false } });
    });
    await page.locator('.object-refresh-action').click();
    await expect(page.getByRole('button', { name: 'current_python Executable UDF' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'python_double Executable UDF' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New table in default' })).toHaveCount(0);
    expect(requests.filter(body => body.action === 'executable-functions')).toHaveLength(2);
    expect(refreshPermissions).toBe(initialPermissions);
});

for (const mode of ['Standard', 'Experimental']) {
    test(`${mode} keeps Python UDFs and database actions cached across AI and closing Objects`, async ({
        page,
    }) => {
        const { requests, objects } = await setupMetadata(page, mode);
        const permissionCount = () =>
            requests.filter(body => body.action === 'table-permissions').length;
        const executableCount = () =>
            requests.filter(body => body.action === 'executable-functions').length;
        const executableRequests = executableCount();
        const databaseRequests = permissionCount();
        expect(executableRequests).toBe(1);
        for (let attempt = 0; attempt < 2; attempt++) {
            await page.getByTestId('open-ai').click();
            await expect(page.locator('.object-explorer-section')).toHaveCount(0);
            await objects.click();
            await expect(
                page.getByRole('button', { name: 'python_double Executable UDF', exact: true }),
            ).toBeVisible();
            await expect(
                page.getByRole('button', { name: 'New table in default', exact: true }),
            ).toBeVisible();
            expect(executableCount()).toBe(executableRequests);
            expect(permissionCount()).toBe(databaseRequests);
        }
        await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
        await objects.click();
        await expect(
            page.getByRole('button', { name: 'python_double Executable UDF', exact: true }),
        ).toBeVisible();
        expect(executableCount()).toBe(executableRequests);
        expect(permissionCount()).toBe(databaseRequests);
    });
}
