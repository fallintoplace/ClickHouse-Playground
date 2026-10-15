import { test, expect, type Page } from '@playwright/test';
import { functionsWorkspace } from './sql-functions-helpers.js';
import { workspacePath } from './helpers.js';
import { fileURLToPath } from 'node:url';
import { jsonRecord } from '../helpers/type-guards.js';

const refreshedSqlFunction = {
    name: 'current_sql',
    parameters: ['value'],
    createQuery: 'CREATE FUNCTION current_sql AS (value) -> value;',
};

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
        existing: true,
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
            ['functions', 'executable-functions', 'table-permissions'].includes(
                String(body.action),
            ),
        ),
    ).toHaveLength(0);
});

test('StrictMode coalesces metadata requests and clears all catalogs when trust is revoked', async ({
    page,
}) => {
    const { state, requests } = await harnessWorkspace(page);
    await mountMetadata(page);
    const names = page.getByLabel('Cached Python UDFs');
    const sqlNames = page.getByLabel('Cached SQL UDFs');
    await expect(sqlNames).toHaveText(state.functions.map(fn => fn.name).join(','));
    await expect(names).toHaveText('python_double');
    await expect(page.getByLabel('First database actions')).toHaveText('allowed');
    await expect(page.getByLabel('Second database actions')).toHaveText('allowed');
    expect(requests.filter(body => body.action === 'table-permissions')).toHaveLength(1);
    expect(requests.filter(body => body.action === 'executable-functions')).toHaveLength(1);
    expect(requests.filter(body => body.action === 'functions')).toHaveLength(1);
    await page.getByRole('button', { name: 'Toggle metadata trust' }).click();
    await expect(names).toBeEmpty();
    await expect(sqlNames).toBeEmpty();
    await expect(page.getByLabel('First database actions')).toHaveText('denied');
    state.executableFunctions = [{ name: 'current_python', createQuery: '' }];
    state.functions = [refreshedSqlFunction];
    await page.getByRole('button', { name: 'Toggle metadata trust' }).click();
    await expect(names).toHaveText('current_python');
    await expect(sqlNames).toHaveText('current_sql');
    await expect(page.getByLabel('First database actions')).toHaveText('allowed');
    expect(requests.filter(body => body.action === 'table-permissions')).toHaveLength(2);
    expect(requests.filter(body => body.action === 'executable-functions')).toHaveLength(2);
    expect(requests.filter(body => body.action === 'functions')).toHaveLength(2);
});

for (const field of ['host', 'database', 'username', 'testedAt', 'refresh']) {
    test(`Metadata ignores superseded catalog and permission responses after ${field}`, async ({
        page,
    }) => {
        const { state } = await harnessWorkspace(page);
        let sqlRequests = 0;
        let pythonRequests = 0;
        let permissionRequests = 0;
        let release = () => {};
        const pending = new Promise<void>(resolve => {
            release = resolve;
        });
        await page.route('**/api/cloud', async route => {
            const body = jsonRecord(route.request().postDataJSON());
            if (body.action === 'functions') {
                sqlRequests++;
                if (sqlRequests > 1) return route.fallback();
                const functions = structuredClone(state.functions);
                await pending;
                return route.fulfill({
                    json: {
                        functions,
                        canCreate: true,
                        canDrop: true,
                        createReason: '',
                        dropReason: '',
                    },
                });
            }
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
        const sqlNames = page.getByLabel('Cached SQL UDFs');
        try {
            await mountMetadata(page);
            await expect.poll(() => sqlRequests).toBe(1);
            await expect.poll(() => pythonRequests).toBe(1);
            await expect.poll(() => permissionRequests).toBe(1);
            state.executableFunctions = [{ name: 'current_python', createQuery: '' }];
            state.functions = [refreshedSqlFunction];
            const action = field === 'refresh' ? 'Refresh metadata' : `Change metadata ${field}`;
            await page.getByRole('button', { name: action, exact: true }).click();
            await expect(sqlNames).toHaveText('current_sql');
            await expect(names).toHaveText('current_python');
            await expect(page.getByLabel('First database actions')).toHaveText('denied');
        } finally {
            release();
            await page.unrouteAll({ behavior: 'wait' });
        }
        await expect(names).toHaveText('current_python');
        await expect(page.getByLabel('First database actions')).toHaveText('denied');
        await expect(sqlNames).toHaveText('current_sql');
        expect(sqlRequests).toBe(2);
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

for (const deniedStatus of [401, 403]) {
    test(`Catalog refreshes retain transient data but evict it after HTTP ${deniedStatus}`, async ({
        page,
    }) => {
        const { state } = await harnessWorkspace(page);
        await mountMetadata(page);
        for (const name of ['SQL', 'Python']) {
            await expect(page.getByLabel(`${name} catalog availability`)).toHaveText('available');
            await expect(page.getByLabel(`Cached ${name} UDFs`)).not.toBeEmpty();
        }
        let failureStatus = 0;
        await page.route('**/api/cloud', route => {
            const { action } = jsonRecord(route.request().postDataJSON());
            if (!failureStatus || !['functions', 'executable-functions'].includes(String(action)))
                return route.fallback();
            return route.fulfill({
                status: failureStatus,
                json: {
                    error: {
                        code: 'CATALOG_REFRESH',
                        message: `Catalog refresh failed: ${failureStatus}`,
                    },
                },
            });
        });
        for (const [index, status] of [502, deniedStatus, 502].entries()) {
            failureStatus = status;
            await page.getByRole('button', { name: 'Refresh metadata', exact: true }).click();
            for (const name of ['SQL', 'Python']) {
                const error = `Catalog refresh failed: ${status}`;
                await expect(page.getByLabel(`${name} catalog error`, { exact: true })).toHaveText(
                    error,
                );
                await expect(page.getByLabel(`${name} catalog refresh error`)).toHaveText(error);
                await expect(page.getByLabel(`${name} catalog status`)).toHaveText('idle');
                await expect(page.getByLabel(`${name} catalog availability`)).toHaveText(
                    index === 0 ? 'available' : 'unavailable',
                );
                const names = page.getByLabel(`Cached ${name} UDFs`);
                if (index === 0) await expect(names).not.toBeEmpty();
                else await expect(names).toBeEmpty();
            }
        }
        failureStatus = 0;
        state.functions = [];
        state.executableFunctions = [];
        await page.getByRole('button', { name: 'Refresh metadata', exact: true }).click();
        for (const name of ['SQL', 'Python']) {
            await expect(page.getByLabel(`${name} catalog availability`)).toHaveText('available');
            await expect(page.getByLabel(`Cached ${name} UDFs`)).toBeEmpty();
            await expect(page.getByLabel(`${name} catalog error`, { exact: true })).toBeEmpty();
            await expect(page.getByLabel(`${name} catalog refresh error`)).toBeEmpty();
        }
    });
}
