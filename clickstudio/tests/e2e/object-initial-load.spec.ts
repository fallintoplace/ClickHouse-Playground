import { test, expect, type Page } from '@playwright/test';
import { functionsWorkspace } from './sql-functions-helpers.js';
import { connectPreviewCloud } from './cloud-import-helpers.js';
import { workspacePath } from './helpers.js';
import { jsonRecord } from '../helpers/type-guards.js';
import { cloudSchema } from '../helpers/cloud-fixtures.js';
import { PLAYGROUND_CONNECTION } from '../../src/shared/database/connections/playground.js';

function gate() {
    let release = () => {};
    const promise = new Promise<void>(resolve => {
        release = resolve;
    });
    return { promise, release };
}

async function expectSingleLoader(page: Page) {
    const explorer = page.locator('.object-explorer-section');
    await expect(explorer.locator('.object-refresh-action.is-loading')).toHaveCount(1);
    await expect(explorer.locator('.loading-orbit')).toHaveCount(0);
    await expect(explorer.locator('.object-refresh-action')).toHaveAttribute('aria-busy', 'true');
    await expect(explorer.locator('.object-refresh-action')).toHaveAttribute(
        'aria-label',
        'Loading objects',
    );
    await expect(explorer.locator('.inspector-empty')).toHaveCount(0);
}

for (const mode of ['Standard', 'Experimental']) {
    for (const first of ['schema', 'functions']) {
        test(`${mode} initial Cloud load has one indicator when ${first} finishes first`, async ({
            page,
        }) => {
            await functionsWorkspace(page, { existing: true, path: workspacePath(mode) });
            await expect(page.locator('.object-refresh-action')).toBeEnabled();
            const schema = gate(),
                functions = gate(),
                python = gate();
            await page.route('**/api/cloud', async route => {
                const body = jsonRecord(route.request().postDataJSON());
                if (body.action === 'schema') await schema.promise;
                if (body.action === 'functions') await functions.promise;
                if (body.action === 'executable-functions') await python.promise;
                return route.fallback();
            });
            try {
                await connectPreviewCloud(page, workspacePath(mode));
                if ((await page.locator('.object-explorer-section').count()) === 0)
                    await page
                        .locator('.icon-rail')
                        .getByRole('button', { name: 'Objects', exact: true })
                        .click();
                await expectSingleLoader(page);
                if (first === 'schema') {
                    schema.release();
                    await expect(
                        page.getByRole('button', { name: 'events MergeTree', exact: true }),
                    ).toBeVisible();
                } else {
                    functions.release();
                    await expect(
                        page.getByRole('button', { name: 'udf_map_remove SQL UDF', exact: true }),
                    ).toBeVisible();
                }
                await expectSingleLoader(page);
                schema.release();
                functions.release();
                await expect(
                    page.getByRole('button', { name: 'events MergeTree', exact: true }),
                ).toBeVisible();
                await expect(
                    page.getByRole('button', { name: 'udf_map_remove SQL UDF', exact: true }),
                ).toBeVisible();
                if (mode === 'Experimental') await expectSingleLoader(page);
                python.release();
                await expect(page.locator('.object-refresh-action')).toBeEnabled();
                await expect(page.locator('.object-refresh-action')).not.toHaveClass(/is-loading/);
            } finally {
                schema.release();
                functions.release();
                python.release();
                await page.unrouteAll({ behavior: 'wait' });
            }
        });
    }

    test(`${mode} initial Playground load uses the same single indicator`, async ({ page }) => {
        const pending = gate();
        await page.route('https://sql-clickhouse.clickhouse.com:8443/**', route => route.abort());
        await page.route('**/api/connections', route =>
            route.fulfill({ json: [PLAYGROUND_CONNECTION] }),
        );
        await page.route('**/api/connections/playground/schema*', async route => {
            await pending.promise;
            return route.fulfill({ json: { ...cloudSchema, connectionId: 'playground' } });
        });
        try {
            await page.goto(`${workspacePath(mode)}?connection=playground`);
            if (mode === 'Standard')
                await page
                    .locator('.icon-rail')
                    .getByRole('button', { name: 'Objects', exact: true })
                    .click();
            await expectSingleLoader(page);
            pending.release();
            await expect(
                page.getByRole('button', { name: 'events MergeTree', exact: true }),
            ).toBeVisible();
            await expect(page.locator('.object-refresh-action')).toBeEnabled();
        } finally {
            pending.release();
            await page.unrouteAll({ behavior: 'wait' });
        }
    });

    test(`${mode} initial Cloud schema failure keeps one indicator until functions settle`, async ({
        page,
    }) => {
        await functionsWorkspace(page, { existing: true, path: workspacePath(mode) });
        await expect(page.locator('.object-refresh-action')).toBeEnabled();
        const pending = gate();
        await page.route('**/api/cloud', async route => {
            const body = jsonRecord(route.request().postDataJSON());
            if (body.action === 'schema')
                return route.fulfill({
                    status: 502,
                    json: { error: { code: 'CLICKHOUSE_ERROR', message: 'Schema unavailable.' } },
                });
            if (body.action === 'functions' || body.action === 'executable-functions')
                await pending.promise;
            return route.fallback();
        });
        try {
            await connectPreviewCloud(page, workspacePath(mode));
            if ((await page.locator('.object-explorer-section').count()) === 0)
                await page
                    .locator('.icon-rail')
                    .getByRole('button', { name: 'Objects', exact: true })
                    .click();
            await expect(page.locator('.object-explorer-section .callout-error')).toContainText(
                'Schema unavailable.',
            );
            await expectSingleLoader(page);
            pending.release();
            await expect(
                page.getByRole('button', { name: 'udf_map_remove SQL UDF', exact: true }),
            ).toBeVisible();
            await expect(page.locator('.object-refresh-action')).toBeEnabled();
        } finally {
            pending.release();
            await page.unrouteAll({ behavior: 'wait' });
        }
    });
}
