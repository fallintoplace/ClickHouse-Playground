import { test, expect } from '@playwright/test';
import {
    arrayValue,
    jsonRecord,
    openBlankSql,
    replaceSql,
    setWorkspaceMode,
    trust,
    workspacePath,
} from './helpers.js';

for (const theme of ['Dark', 'Light'])
    test(`SQL Map opens before trust without executing SQL in ${theme} mode`, async ({
        page,
    }, info) => {
        await page.route('**/api/connections', async route => {
            const response = await route.fetch();
            await route.fulfill({
                response,
                json: arrayValue(await response.json()).map(connection => ({
                    ...jsonRecord(connection),
                    trusted: false,
                })),
            });
        });
        const executions: string[] = [];
        page.on('request', request => {
            const pathname = new URL(request.url()).pathname;
            if (
                request.method() === 'POST' &&
                (/\/api\/(runs|scripts)$/.test(pathname) || pathname.endsWith('/query-tree'))
            )
                executions.push(pathname);
        });
        await page.goto(workspacePath('Experimental'));
        await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
        const button = page.getByTestId('run-action-sql-map');
        await expect(button).toBeEnabled();
        await expect(page.locator('.sql-flow-view')).toHaveCount(0);
        await button.click();
        const structure = page.locator('.sql-flow-view');
        const modes = page.locator('.results-title .sql-flow-mode-tabs');
        await expect(structure).toBeVisible();
        await expect(
            modes.getByRole('button', { name: 'Logical flow', exact: true }),
        ).toHaveAttribute('aria-pressed', 'true');
        await expect(modes.getByRole('button', { name: 'Analyzer', exact: true })).toBeDisabled();
        for (const width of [1440, 900]) {
            await page.setViewportSize({ width, height: 900 });
            await expect(button).toBeVisible();
            const rail = await page.locator('.editor-control-rail').boundingBox();
            const bounds = await button.boundingBox();
            expect(rail).toBeTruthy();
            expect(bounds).toBeTruthy();
            expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(rail!.x + rail!.width);
            await expect
                .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
                .toBeLessThanOrEqual(1);
        }
        await page.locator('.editor-control-rail').screenshot({
            path: info.outputPath('sql-map-button.png'),
        });
        expect(executions).toEqual([]);
        await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'ready');
    });

test('SQL Map follows the cursor statement and updates without executing SQL', async ({ page }) => {
    let executions = 0;
    page.on('request', request => {
        if (
            request.method() === 'POST' &&
            /\/api\/(runs|scripts)$/.test(new URL(request.url()).pathname)
        )
            executions++;
    });
    await page.goto(workspacePath('Experimental'));
    await replaceSql(
        page,
        'SELECT count() FROM analytics.first_table;\nSELECT count() FROM analytics.second_table;',
    );
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.press('ArrowDown');
    await page.getByTestId('run-action-sql-map').click();
    const structure = page.locator('.sql-flow-view');
    await expect(structure).toBeVisible();
    await expect(structure).toContainText('analytics.second_table');
    await expect(structure).not.toContainText('analytics.first_table');
    await replaceSql(page, 'SELECT count() FROM analytics.changed_table');
    await expect(structure).toContainText('analytics.changed_table');
    expect(executions).toBe(0);
});

test('SQL Map reopens collapsed output and handles an empty draft', async ({ page }) => {
    await page.goto(workspacePath('Experimental'));
    await openBlankSql(page);
    const button = page.getByTestId('run-action-sql-map');
    await button.click();
    const structure = page.locator('.sql-flow-view');
    await expect(structure.locator('.pipeline-graph-empty')).toBeVisible();
    await page.locator('.results-surface .panel-collapse-button').click();
    await expect(structure).toBeHidden();
    await button.click();
    await expect(structure).toBeVisible();
});

test('SQL Map opened without a run hides its output when switching to Standard', async ({
    page,
}) => {
    await page.goto(workspacePath('Experimental'));
    await page.getByTestId('run-action-sql-map').click();
    await expect(page.locator('.sql-flow-view')).toBeVisible();
    await setWorkspaceMode(page, 'Standard');
    await expect(page.getByTestId('run-action-sql-map')).toHaveCount(0);
    await expect(page.locator('.results-surface')).toHaveCount(0);
    await expect(page.locator('.workspace-panel-splitter')).toHaveCount(0);
    await setWorkspaceMode(page, 'Experimental');
    await expect(page.locator('.sql-flow-view')).toBeVisible();
});

test('SQL Map requests server analysis only after choosing Analyzer', async ({ page }) => {
    await trust(page);
    const requests: string[] = [];
    page.on('request', request => {
        const pathname = new URL(request.url()).pathname;
        if (
            request.method() === 'POST' &&
            (/\/api\/(runs|scripts)$/.test(pathname) || pathname.endsWith('/query-tree'))
        )
            requests.push(pathname);
    });
    await page.getByTestId('run-action-sql-map').click();
    const structure = page.locator('.sql-flow-view');
    const modes = page.locator('.results-title .sql-flow-mode-tabs');
    await expect(structure).toBeVisible();
    expect(requests).toEqual([]);
    await modes.getByRole('button', { name: 'Analyzer', exact: true }).click();
    await expect(structure.locator('[data-query-tree-type="QUERY"]')).toBeVisible();
    expect(requests).toEqual(['/api/connections/demo/query-tree']);
});

for (const action of ['explain', 'explain-plan', 'explain-pipeline', 'explain-analyze'])
    test(`SQL Map opens after ${action} without starting another run`, async ({ page }) => {
        await trust(page);
        let executions = 0;
        page.on('request', request => {
            if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs')
                executions++;
        });
        await page.getByTestId(`run-action-${action}`).click();
        await expect(page.locator('.execution-bar')).toHaveAttribute(
            'data-run-status',
            'succeeded',
        );
        await page.getByTestId('run-action-sql-map').click();
        await expect(page.locator('.sql-flow-view')).toBeVisible();
        await expect(page.getByRole('tab', { name: 'SQL map', exact: true })).toHaveAttribute(
            'aria-selected',
            'true',
        );
        await page.getByRole('tab', { name: 'Table', exact: true }).click();
        await expect(
            page.getByRole('table', { name: 'Retained query rows', exact: true }),
        ).toBeVisible();
        expect(executions).toBe(1);
    });
