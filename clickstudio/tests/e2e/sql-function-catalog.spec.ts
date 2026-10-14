import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import { functionsWorkspace } from './sql-functions-helpers.js';
import { workspacePath } from './helpers.js';
import { jsonRecord } from '../helpers/type-guards.js';

async function mountCatalog(page: Page) {
    await page.evaluate(() => {
        const container = document.createElement('div');
        container.id = 'function-catalog-harness';
        container.style.cssText = 'position:fixed;inset:0;background:white;z-index:100';
        document.body.append(container);
    });
    const fixture = fileURLToPath(new URL('./fixtures/function-catalog.tsx', import.meta.url));
    await page.addScriptTag({ type: 'module', url: `/@fs${fixture}` });
}

test('Catalog clears on trust loss and loads a fresh catalog when trust is granted again', async ({
    page,
}) => {
    const { state, requests } = await functionsWorkspace(page, {
        path: workspacePath('Standard'),
        existing: true,
        openObjects: false,
    });
    await mountCatalog(page);
    const names = page.getByLabel('Cached functions', { exact: true });
    await expect(names).toContainText('udf_map_remove');
    expect(requests.filter(body => body.action === 'functions')).toHaveLength(1);
    const trust = page.getByRole('button', { name: 'Toggle catalog trust', exact: true });
    await trust.click();
    await expect(names).toBeEmpty();
    await expect(page.getByLabel('Catalog status', { exact: true })).toHaveText('idle');
    state.functions = [];
    await trust.click();
    await expect.poll(() => requests.filter(body => body.action === 'functions').length).toBe(2);
    await expect(page.getByLabel('Catalog status', { exact: true })).toHaveText('idle');
    await expect(names).toBeEmpty();
    expect(requests.filter(body => body.action === 'functions')).toHaveLength(2);
});

for (const field of ['host', 'database', 'username', 'testedAt']) {
    test(`Catalog discards a delayed response after the connection ${field} changes`, async ({
        page,
    }) => {
        const { state } = await functionsWorkspace(page, {
            path: workspacePath('Standard'),
            existing: true,
            openObjects: false,
        });
        let count = 0;
        let release = () => {};
        const pending = new Promise<void>(resolve => {
            release = resolve;
        });
        await page.route('**/api/cloud', async route => {
            const body = jsonRecord(route.request().postDataJSON());
            if (body.action !== 'functions') return route.fallback();
            count++;
            if (count > 1) return route.fallback();
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
        });
        const names = page.getByLabel('Cached functions', { exact: true });
        try {
            await mountCatalog(page);
            await expect.poll(() => count).toBe(1);
            state.functions = [
                {
                    name: 'current_function',
                    parameters: ['x'],
                    createQuery: 'CREATE FUNCTION current_function AS x -> x',
                },
            ];
            await page
                .getByRole('button', { name: `Change catalog ${field}`, exact: true })
                .click();
            await expect(names).toHaveText('current_function');
        } finally {
            release();
            await page.unrouteAll({ behavior: 'wait' });
        }
        await expect(names).toHaveText('current_function');
        expect(count).toBe(2);
    });
}

test('Refresh rebinds selected functions to new definitions and clears removed selections', async ({
    page,
}) => {
    const { state } = await functionsWorkspace(page, {
        path: workspacePath('Standard'),
        existing: true,
        openObjects: false,
    });
    await mountCatalog(page);
    await expect(page.getByLabel('Cached functions', { exact: true })).toContainText(
        'udf_map_remove',
    );
    await page.getByRole('button', { name: 'Select first function', exact: true }).click();
    const selected = page.getByLabel('Selected function definition', { exact: true });
    await expect(selected).not.toBeEmpty();
    state.functions[0] = {
        ...state.functions[0]!,
        createQuery: 'CREATE FUNCTION updated AS x -> x + 1',
    };
    await page.getByRole('button', { name: 'Refresh catalog', exact: true }).click();
    await expect(selected).toHaveText('CREATE FUNCTION updated AS x -> x + 1');
    state.functions = [];
    await page.getByRole('button', { name: 'Refresh catalog', exact: true }).click();
    await expect(selected).toBeEmpty();
});
