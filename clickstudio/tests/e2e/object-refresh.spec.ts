import { test, expect, type Page } from '@playwright/test';
import { functionsWorkspace } from './sql-functions-helpers.js';
import { workspacePath } from './helpers.js';
import { jsonRecord } from '../helpers/type-guards.js';
import { cloudSchema } from '../helpers/cloud-fixtures.js';
import { PLAYGROUND_CONNECTION } from '../../src/shared/database/connections/playground.js';
import type { Schema } from '../../src/shared/database/schema/types.js';
import { fileURLToPath } from 'node:url';

function gate() {
    let release = () => {};
    const promise = new Promise<void>(resolve => {
        release = resolve;
    });
    return { promise, release };
}

const refreshButton = (page: Page) => page.locator('.object-refresh-action');
const sqlFunction = (page: Page) =>
    page.getByRole('button', { name: 'udf_map_remove SQL UDF', exact: true });
const table = (page: Page, name = 'events', engine = 'MergeTree') =>
    page.getByRole('button', { name: `${name} ${engine}`, exact: true });

async function mountSchema(page: Page) {
    await page.evaluate(() => {
        const container = document.createElement('div');
        container.id = 'schema-refresh-harness';
        container.style.cssText = 'position:fixed;inset:0;background:white;z-index:100';
        document.body.append(container);
    });
    const fixture = fileURLToPath(new URL('./fixtures/schema-refresh.tsx', import.meta.url));
    await page.addScriptTag({ type: 'module', url: `/@fs${fixture}` });
    await expect(page.getByLabel('Schema names', { exact: true })).toHaveText('events');
}

for (const mode of ['Standard', 'Experimental']) {
    test(`${mode} retains Playground rows and search while a forced refresh is pending`, async ({
        page,
    }) => {
        const pending = gate();
        let requests = 0;
        const paths: string[] = [];
        await page.route('https://sql-clickhouse.clickhouse.com:8443/**', route => route.abort());
        await page.route('**/api/connections', route =>
            route.fulfill({ json: [PLAYGROUND_CONNECTION] }),
        );
        await page.route('**/api/connections/playground/schema*', async route => {
            requests++;
            paths.push(route.request().url());
            if (requests > 1) await pending.promise;
            await route.fulfill({ json: { ...cloudSchema, connectionId: 'playground' } });
        });
        try {
            await page.goto(`${workspacePath(mode)}?connection=playground`);
            if (mode === 'Standard')
                await page
                    .locator('.icon-rail')
                    .getByRole('button', { name: 'Objects', exact: true })
                    .click();
            await expect(table(page)).toBeVisible();
            await page.getByTestId('schema-search').fill('events');
            await refreshButton(page).click();
            await expect(refreshButton(page)).toBeDisabled();
            await expect(refreshButton(page)).toHaveAttribute('aria-label', 'Refreshing objects');
            await expect(table(page)).toBeVisible();
            await expect(page.getByTestId('schema-search')).toHaveValue('events');
            await expect(page.locator('.object-explorer-section .inspector-empty')).toHaveCount(0);
            await refreshButton(page).evaluate(button => {
                if (button instanceof HTMLButtonElement) {
                    button.click();
                    button.click();
                }
            });
            await expect.poll(() => requests).toBe(2);
            expect(new URL(paths[1]!).searchParams.get('refresh')).toBe('true');
            expect(paths.some(path => path.includes('functions'))).toBe(false);
            pending.release();
            await expect(refreshButton(page)).toBeEnabled();
            await expect(table(page)).toBeVisible();
        } finally {
            pending.release();
            await page.unrouteAll({ behavior: 'wait' });
        }
    });

    test(`${mode} keeps cached Cloud rows and waits for the slowest catalog`, async ({ page }) => {
        await functionsWorkspace(page, { existing: true, path: workspacePath(mode) });
        await expect(refreshButton(page)).toBeEnabled();
        const schema = gate(),
            functions = gate(),
            python = gate();
        const requests: string[] = [];
        await page.route('**/api/cloud', async route => {
            const body = jsonRecord(route.request().postDataJSON());
            const action = String(body.action);
            if (action === 'schema') {
                requests.push(action);
                await schema.promise;
                return route.fulfill({
                    json: {
                        ...cloudSchema,
                        tables: [
                            { database: 'default', name: 'events', engine: 'ReplacingMergeTree' },
                        ],
                    },
                });
            }
            if (action === 'functions') {
                requests.push(action);
                await functions.promise;
                return route.fallback();
            }
            if (action === 'executable-functions') {
                requests.push(action);
                await python.promise;
                return route.fallback();
            }
            return route.fallback();
        });
        try {
            const initialTablePosition = await table(page).boundingBox();
            await refreshButton(page).click();
            await expect(sqlFunction(page)).toBeVisible();
            await expect(table(page)).toBeVisible();
            expect((await table(page).boundingBox())?.y).toBe(initialTablePosition?.y);
            await expect(page.locator('.object-explorer-section .inspector-empty')).toHaveCount(0);
            await expect(
                page.getByRole('status', { name: 'Loading functions', exact: true }),
            ).toHaveCount(0);
            await expect(
                page.getByText('Loading executable functions...', { exact: true }),
            ).toHaveCount(0);
            await expect(
                page.getByRole('button', { name: 'Create SQL UDF', exact: true }),
            ).toBeDisabled();
            await expect(page.locator('.python-functions-tree')).toBeVisible();
            await expect(
                page.getByRole('button', { name: 'Create Python UDF', exact: true }),
            ).toBeDisabled();
            schema.release();
            await expect(table(page, 'events', 'ReplacingMergeTree')).toBeVisible();
            await expect(refreshButton(page)).toBeDisabled();
            functions.release();
            await expect(
                page.getByRole('button', { name: 'Create SQL UDF', exact: true }),
            ).toBeEnabled();
            await expect(refreshButton(page)).toBeDisabled();
            python.release();
            await expect(refreshButton(page)).toBeEnabled();
            expect(requests.sort()).toEqual(['executable-functions', 'functions', 'schema']);
        } finally {
            schema.release();
            functions.release();
            python.release();
            await page.unrouteAll({ behavior: 'wait' });
        }
    });
}

test('Cloud refresh retains function catalogs after transient failures and removes denied metadata', async ({
    page,
}) => {
    const { state } = await functionsWorkspace(page, { existing: true });
    state.executableFunctions = [{ name: 'python_double', createQuery: 'original' }];
    await refreshButton(page).click();
    await expect(
        page.getByRole('button', { name: 'python_double Executable UDF', exact: true }),
    ).toBeVisible();
    let denied = false;
    await page.route('**/api/cloud', async route => {
        const body = jsonRecord(route.request().postDataJSON());
        if (body.action === 'functions' || body.action === 'executable-functions')
            return route.fulfill({
                status: denied ? 403 : 502,
                json: {
                    error: {
                        code: denied ? 'FUNCTION_PERMISSION' : 'CLICKHOUSE_ERROR',
                        message: denied ? 'Access denied.' : 'Temporary outage.',
                    },
                },
            });
        return route.fallback();
    });
    await expect(refreshButton(page)).toBeEnabled();
    await refreshButton(page).click();
    await expect(page.getByText(/SQL functions could not refresh/)).toBeVisible();
    await expect(page.getByText(/Python functions could not refresh/)).toBeVisible();
    await expect(sqlFunction(page)).toBeVisible();
    await expect(
        page.getByRole('button', { name: 'python_double Executable UDF', exact: true }),
    ).toBeVisible();
    await expect(refreshButton(page)).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Create SQL UDF', exact: true })).toBeDisabled();
    denied = true;
    await refreshButton(page).click();
    await expect(page.locator('.sql-functions-tree, .python-functions-tree')).toHaveCount(0);
    await expect(refreshButton(page)).toBeEnabled();
    await expect(table(page)).toBeVisible();
});

test('Cloud refresh stages all previously loaded pages and retains the old range if a later page fails', async ({
    page,
}) => {
    await functionsWorkspace(page, { existing: true });
    let fresh = false,
        fail = false;
    const requests: number[] = [];
    const later = gate();
    await page.route('**/api/cloud', async route => {
        const body = jsonRecord(route.request().postDataJSON());
        if (body.action !== 'schema') return route.fallback();
        const offset = Number(body.tableOffset ?? 0);
        requests.push(offset);
        if (fresh && offset === 10) {
            await later.promise;
            if (fail)
                return route.fulfill({
                    status: 502,
                    json: { error: { code: 'CLICKHOUSE_ERROR', message: 'Page unavailable.' } },
                });
        }
        const name = `${fresh ? 'fresh' : 'old'}_${offset}`;
        const schema: Schema = {
            ...cloudSchema,
            tables: [{ database: 'default', name, engine: 'MergeTree' }],
            columns: [],
            truncated: offset < 20,
            pagination: offset < 20 ? { tables: offset + 10 } : {},
        };
        return route.fulfill({ json: schema });
    });
    try {
        await expect(refreshButton(page)).toBeEnabled();
        await refreshButton(page).click();
        await expect(table(page, 'old_0')).toBeVisible();
        await page.getByRole('button', { name: 'Load more metadata', exact: true }).click();
        await expect(table(page, 'old_10')).toBeVisible();
        await page.getByRole('button', { name: 'Load more metadata', exact: true }).click();
        await expect(table(page, 'old_20')).toBeVisible();
        fresh = true;
        fail = true;
        requests.length = 0;
        await refreshButton(page).click();
        await expect.poll(() => requests).toEqual([0, 10]);
        await expect(table(page, 'old_0')).toBeVisible();
        await expect(table(page, 'fresh_0')).toHaveCount(0);
        later.release();
        await expect(page.getByText(/Showing previous schema/)).toBeVisible();
        await expect(refreshButton(page)).toBeEnabled();
        await expect(table(page, 'old_20')).toBeVisible();
        fail = false;
        requests.length = 0;
        await refreshButton(page).click();
        await expect(table(page, 'fresh_20')).toBeVisible();
        await expect(refreshButton(page)).toBeEnabled();
        expect(requests).toEqual([0, 10, 20]);
        await expect(table(page, 'old_0')).toHaveCount(0);
        await expect(page.getByText(/Showing previous schema/)).toHaveCount(0);
    } finally {
        later.release();
        await page.unrouteAll({ behavior: 'wait' });
    }
});

test('schema refresh cannot overlap loading another Cloud page', async ({ page }) => {
    await functionsWorkspace(page);
    const pending = gate();
    await page.route('**/api/cloud', async route => {
        const body = jsonRecord(route.request().postDataJSON());
        if (body.action !== 'schema') return route.fallback();
        if (body.tableOffset) await pending.promise;
        return route.fulfill({
            json: { ...cloudSchema, truncated: true, pagination: { tables: 10 } },
        });
    });
    try {
        await expect(refreshButton(page)).toBeEnabled();
        await refreshButton(page).click();
        await expect(refreshButton(page)).toBeEnabled();
        await page.getByRole('button', { name: 'Load more metadata', exact: true }).click();
        await expect(refreshButton(page)).toBeDisabled();
        pending.release();
        await expect(refreshButton(page)).toBeEnabled();
    } finally {
        pending.release();
        await page.unrouteAll({ behavior: 'wait' });
    }
});

test('a collapsed function group stays collapsed during refresh and can be opened while pending', async ({
    page,
}) => {
    await functionsWorkspace(page, { existing: true });
    await expect(refreshButton(page)).toBeEnabled();
    await page.getByRole('button', { name: 'Collapse SQL UDFs', exact: true }).click();
    const pending = gate();
    await page.route('**/api/cloud', async route => {
        if (jsonRecord(route.request().postDataJSON()).action === 'functions')
            await pending.promise;
        return route.fallback();
    });
    try {
        await refreshButton(page).click();
        await expect(refreshButton(page)).toBeDisabled();
        await expect(sqlFunction(page)).toHaveCount(0);
        await page.getByRole('button', { name: 'Expand SQL UDFs', exact: true }).click();
        await expect(sqlFunction(page)).toBeVisible();
        pending.release();
        await expect(refreshButton(page)).toBeEnabled();
        await expect(sqlFunction(page)).toBeVisible();
    } finally {
        pending.release();
        await page.unrouteAll({ behavior: 'wait' });
    }
});

test('Cloud refresh preserves a scrolled tree while retaining and replacing its rows', async ({
    page,
}) => {
    await functionsWorkspace(page, { existing: true });
    const pending = gate();
    let hold = false;
    await page.route('**/api/cloud', async route => {
        if (jsonRecord(route.request().postDataJSON()).action !== 'schema') return route.fallback();
        if (hold) await pending.promise;
        return route.fulfill({
            json: {
                ...cloudSchema,
                tables: Array.from({ length: 100 }, (_, index) => ({
                    database: 'default',
                    name: `events_${index}`,
                    engine: 'MergeTree',
                })),
            },
        });
    });
    try {
        await expect(refreshButton(page)).toBeEnabled();
        await refreshButton(page).click();
        await expect(page.locator('.object-tree-row.is-object.is-table')).toHaveCount(100);
        await expect(refreshButton(page)).toBeEnabled();
        const scroll = page.locator('.object-tree-scroll');
        const position = await scroll.evaluate(element => {
            element.scrollTop = 400;
            return element.scrollTop;
        });
        expect(position).toBeGreaterThan(0);
        hold = true;
        await refreshButton(page).click();
        await expect(refreshButton(page)).toBeDisabled();
        expect(await scroll.evaluate(element => element.scrollTop)).toBe(position);
        pending.release();
        await expect(refreshButton(page)).toBeEnabled();
        expect(await scroll.evaluate(element => element.scrollTop)).toBe(position);
    } finally {
        pending.release();
        await page.unrouteAll({ behavior: 'wait' });
    }
});

for (const change of ['newer refresh', 'host', 'trust']) {
    test(`a schema response cannot restore stale data after ${change}`, async ({ page }) => {
        await functionsWorkspace(page, { openObjects: false });
        await mountSchema(page);
        const pending = gate();
        let requests = 0;
        await page.route('**/api/cloud', async route => {
            if (jsonRecord(route.request().postDataJSON()).action !== 'schema')
                return route.fallback();
            requests++;
            const first = requests === 1;
            if (first) await pending.promise;
            return route.fulfill({
                json: {
                    ...cloudSchema,
                    tables: [
                        {
                            database: 'default',
                            name: first ? 'stale' : 'current',
                            engine: 'MergeTree',
                        },
                    ],
                },
            });
        });
        try {
            await page.getByRole('button', { name: 'Refresh schema', exact: true }).click();
            await expect.poll(() => requests).toBe(1);
            await expect(page.getByLabel('Schema names', { exact: true })).toHaveText('events');
            if (change === 'trust') {
                await page
                    .getByRole('button', { name: 'Toggle schema trust', exact: true })
                    .click();
                await expect(page.getByLabel('Schema names', { exact: true })).toBeEmpty();
            } else {
                await page
                    .getByRole('button', {
                        name: change === 'host' ? 'Change schema host' : 'Refresh schema',
                        exact: true,
                    })
                    .click();
                await expect(page.getByLabel('Schema names', { exact: true })).toHaveText(
                    'current',
                );
            }
            pending.release();
            await page.unrouteAll({ behavior: 'wait' });
            await expect(page.getByLabel('Schema names', { exact: true })).toHaveText(
                change === 'trust' ? '' : 'current',
            );
            await expect(page.getByLabel('Schema status', { exact: true })).toHaveText('idle');
        } finally {
            pending.release();
            await page.unrouteAll({ behavior: 'wait' });
        }
    });
}
