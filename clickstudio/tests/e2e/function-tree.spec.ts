import { expect, test, type Page } from '@playwright/test';
import { functionsWorkspace } from './sql-functions-helpers.js';
import { cloudSchema } from '../helpers/cloud-fixtures.js';
import { jsonRecord } from '../helpers/type-guards.js';

async function groupedWorkspace(page: Page, path = '/experimental') {
    const fixture = await functionsWorkspace(page, { existing: true, path });
    fixture.state.executableFunctions = [{ name: 'python_double', createQuery: '' }];
    await page.route('**/api/cloud', route => {
        if (jsonRecord(route.request().postDataJSON()).action !== 'schema') return route.fallback();
        return route.fulfill({
            json: {
                ...cloudSchema,
                databases: ['default', 'BEATLES_DB'],
                tables: [
                    ...cloudSchema.tables,
                    { database: 'BEATLES_DB', name: 'albums', engine: 'MergeTree' },
                ],
            },
        });
    });
    const refresh = page.locator('.object-refresh-action');
    await expect(refresh).toBeEnabled();
    await refresh.click();
    await expect(refresh).toBeEnabled();
    return fixture;
}

for (const theme of ['Dark', 'Light']) {
    for (const width of [1280, 390]) {
        test(`${theme} groups SQL and Python below databases with aligned spacing at ${width}px`, async ({
            page,
        }, info) => {
            await page.setViewportSize({ width, height: 900 });
            const { state } = await groupedWorkspace(page);
            await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
            const rootRows = page.locator('.object-tree > .object-tree-branch > .object-tree-row');
            await expect(rootRows).toHaveCount(3);
            await expect(rootRows.nth(0)).toHaveClass(/is-database/);
            await expect(rootRows.nth(1)).toHaveClass(/is-database/);
            await expect(rootRows.nth(2).locator('.object-tree-label')).toHaveText('Functions');
            await expect(rootRows.nth(2).locator('.object-tree-count')).toHaveText(
                String(state.functions.length + 1),
            );
            const tree = page.locator('.functions-tree');
            const sql = tree.locator('.sql-functions-tree > .object-tree-row');
            const python = tree.locator('.python-functions-tree > .object-tree-row');
            await expect(sql).toHaveAttribute('aria-level', '2');
            await expect(python).toHaveAttribute('aria-level', '2');
            await expect(sql.locator('.object-tree-label')).toHaveText('SQL UDFs');
            await expect(python.locator('.object-tree-label')).toHaveText('Python UDFs');
            for (const leaf of await tree.locator('.is-leaf').all())
                await expect(leaf).toHaveAttribute('aria-level', '3');
            expect(await tree.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(
                true,
            );
            expect(await sql.evaluate(element => element.getBoundingClientRect().height)).toBe(
                await python.evaluate(element => element.getBoundingClientRect().height),
            );
            await tree.scrollIntoViewIfNeeded();
            await page.locator('.object-tree-scroll').screenshot({
                path: info.outputPath('grouped-functions.png'),
            });
            await tree.getByRole('button', { name: 'Create SQL UDF', exact: true }).click();
            const sqlDialog = page.getByRole('dialog', {
                name: 'Create SQL Function',
                exact: true,
            });
            await expect(sqlDialog).toBeVisible();
            await sqlDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
            await tree.getByRole('button', { name: 'Create Python UDF', exact: true }).click();
            await expect(
                page.getByRole('dialog', { name: 'Create Python UDF', exact: true }),
            ).toBeVisible();
        });
    }
}

test('Functions preserves subgroup collapse state and search expands matching rows without changing it', async ({
    page,
}) => {
    await groupedWorkspace(page);
    const tree = page.locator('.functions-tree');
    const sql = page.getByRole('button', { name: 'udf_map_remove SQL UDF', exact: true });
    const python = page.getByRole('button', {
        name: 'python_double Executable UDF',
        exact: true,
    });
    await tree.getByRole('button', { name: 'Collapse SQL UDFs', exact: true }).click();
    await tree.getByRole('button', { name: 'Collapse Python UDFs', exact: true }).click();
    await tree.getByRole('button', { name: 'Collapse Functions', exact: true }).click();
    await expect(tree.locator('.sql-functions-tree, .python-functions-tree')).toHaveCount(0);
    await tree.getByRole('button', { name: 'Expand Functions', exact: true }).click();
    await expect(sql).toHaveCount(0);
    await expect(python).toHaveCount(0);
    await expect(tree.getByRole('button', { name: 'Expand SQL UDFs', exact: true })).toBeVisible();
    await expect(
        tree.getByRole('button', { name: 'Expand Python UDFs', exact: true }),
    ).toBeVisible();
    await tree.getByRole('button', { name: 'Collapse Functions', exact: true }).click();
    const search = page.getByTestId('schema-search');
    await search.fill('python_double');
    await expect(python).toBeVisible();
    await expect(tree.locator(':scope > .object-tree-row .object-tree-count')).toHaveText('1');
    await search.fill('map_remove');
    await expect(sql).toBeVisible();
    await expect(python).toHaveCount(0);
    await expect(tree.locator(':scope > .object-tree-row .object-tree-count')).toHaveText('1');
    await search.fill('missing_function');
    await expect(tree.locator(':scope > .object-tree-row .object-tree-count')).toHaveText('0');
    await expect(tree.getByText('No matching functions.', { exact: true })).toHaveCount(2);
    await search.clear();
    await expect(tree.getByRole('button', { name: 'Expand Functions', exact: true })).toBeVisible();
    await tree.getByRole('button', { name: 'Expand Functions', exact: true }).click();
    await expect(sql).toHaveCount(0);
    await expect(python).toHaveCount(0);
    await tree.getByRole('button', { name: 'Expand Python UDFs', exact: true }).click();
    await python.click();
    await page.locator('.object-back-button').click();
    await expect(tree.getByRole('button', { name: 'Expand SQL UDFs', exact: true })).toBeVisible();
    await expect(python).toBeVisible();
});

test('Standard shows the same SQL and Python Functions hierarchy', async ({ page }) => {
    const { requests, state } = await groupedWorkspace(page, '/');
    const tree = page.locator('.functions-tree');
    await expect(tree.locator('.sql-functions-tree > .object-tree-row')).toHaveAttribute(
        'aria-level',
        '2',
    );
    await expect(tree.locator(':scope > .object-tree-row .object-tree-count')).toHaveText(
        String(state.functions.length + state.executableFunctions.length),
    );
    await expect(tree.locator('.python-functions-tree > .object-tree-row')).toHaveAttribute(
        'aria-level',
        '2',
    );
    await expect(
        tree.getByRole('button', { name: 'python_double Executable UDF', exact: true }),
    ).toBeVisible();
    await expect(
        tree.getByRole('button', { name: 'Create Python UDF', exact: true }),
    ).toBeEnabled();
    expect(requests.some(request => request.action === 'executable-functions')).toBe(true);
});

test('an empty available Functions group stays collapsible and retains its create actions', async ({
    page,
}) => {
    await functionsWorkspace(page);
    const tree = page.locator('.functions-tree');
    const refresh = page.locator('.object-refresh-action');
    await expect(refresh).toBeEnabled();
    await expect(tree.locator(':scope > .object-tree-row .object-tree-count')).toHaveText('0');
    await tree.getByRole('button', { name: 'Collapse Functions', exact: true }).click();
    await expect(tree.locator('.sql-functions-tree, .python-functions-tree')).toHaveCount(0);
    await refresh.click();
    await expect(refresh).toBeEnabled();
    await expect(tree.getByRole('button', { name: 'Expand Functions', exact: true })).toBeVisible();
    await tree.getByRole('button', { name: 'Expand Functions', exact: true }).click();
    await expect(tree.getByRole('button', { name: 'Create SQL UDF', exact: true })).toBeEnabled();
    await expect(
        tree.getByRole('button', { name: 'Create Python UDF', exact: true }),
    ).toBeEnabled();
});

test('an unavailable catalog hides the entire Functions group, including its empty parent', async ({
    page,
}) => {
    const { state } = await functionsWorkspace(page, { canCreate: false, canDrop: false });
    const refresh = page.locator('.object-refresh-action');
    await expect(refresh).toBeEnabled();
    await expect(page.locator('.functions-tree')).toHaveCount(0);
    state.executableFunctions = [{ name: 'python_double', createQuery: '' }];
    await refresh.click();
    await expect(refresh).toBeEnabled();
    const tree = page.locator('.functions-tree');
    await expect(tree.locator('.sql-functions-tree')).toHaveCount(0);
    await expect(tree.locator('.python-functions-tree')).toBeVisible();
    await expect(tree.getByRole('button', { name: 'Create Python UDF', exact: true })).toHaveCount(
        0,
    );
    state.executableError = true;
    await refresh.click();
    await expect(refresh).toBeEnabled();
    await expect(tree).toHaveCount(0);
});
