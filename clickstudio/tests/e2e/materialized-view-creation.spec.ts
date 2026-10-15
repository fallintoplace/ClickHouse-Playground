import { test, expect } from '@playwright/test';
import { openStatementResults, replaceSql, runButton, setWorkspaceMode, trust } from './helpers.js';

for (const theme of ['Light', 'Dark']) {
    test(`${theme} Experimental prepares materialized view SQL from the displayed result`, async ({
        page,
    }, info) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        let executions = 0;
        page.on('request', request => {
            if (request.method() === 'POST' && /\/api\/(runs|scripts)$/.test(request.url()))
                executions++;
        });
        await page.route('**/api/connections/demo/schema*', async route => {
            const response = await route.fetch();
            const schema = await response.json();
            await route.fulfill({
                response,
                json: {
                    ...schema,
                    tables: [
                        ...schema.tables,
                        { database: 'reports', name: 'daily_values', engine: 'MergeTree' },
                        { database: 'system', name: 'query_log', engine: 'MergeTree' },
                        { database: 'demo', name: 'plain_view', engine: 'View' },
                    ],
                },
            });
        });
        await trust(page);
        await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
        const source = 'SELECT {minimum:UInt64} AS value FROM demo.events LIMIT 5';
        await replaceSql(page, `${source};`);
        await page.locator('.parameter-field input').fill('42');
        await runButton(page).click();
        await expect(page.locator('.data-table')).toBeVisible();
        await replaceSql(page, 'SELECT 999 AS edited_after_execution;');

        const trigger = page.getByRole('button', { name: 'Result actions', exact: true });
        await trigger.focus();
        await page.keyboard.press('ArrowDown');
        const action = page.getByRole('menuitem', { name: 'Create materialized view…' });
        await expect(action).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(trigger).toBeFocused();
        await expect(action).toHaveCount(0);
        await trigger.click();
        await action.click();
        const dialog = page.getByRole('dialog', { name: 'Create materialized view', exact: true });
        await expect(dialog.getByRole('textbox', { name: 'View name' })).toBeFocused();
        await expect(dialog.getByRole('button', { name: 'Open SQL', exact: true })).toBeDisabled();
        await dialog.getByRole('textbox', { name: 'View name' }).fill('event_values_mv');
        await dialog.getByRole('combobox', { name: 'Target table' }).click();
        await expect(
            page.getByRole('option', { name: 'demo.daily_rollup', exact: true }),
        ).toHaveCount(0);
        await expect(
            page.getByRole('option', { name: 'demo.plain_view', exact: true }),
        ).toHaveCount(0);
        await expect(
            page.getByRole('option', { name: 'system.query_log', exact: true }),
        ).toHaveCount(0);
        await page.getByRole('option', { name: 'reports.daily_values', exact: true }).click();
        await dialog.screenshot({ path: info.outputPath('materialized-view-dialog.png') });
        const before = executions;
        await dialog.getByRole('button', { name: 'Open SQL', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await expect(page.locator('.cm-content')).toHaveText(
            `CREATE MATERIALIZED VIEW \`demo\`.\`event_values_mv\`TO \`reports\`.\`daily_values\`AS${source};`,
            { useInnerText: false },
        );
        await expect(page.locator('.parameter-field input')).toHaveValue('42');
        expect(executions).toBe(before);
        await page.screenshot({ path: info.outputPath('materialized-view-sql.png') });
    });
}

test('Materialized view creation uses the selected script statement', async ({ page }) => {
    await trust(page);
    await replaceSql(page, 'SELECT 1 AS first_value; SELECT 2 AS second_value;');
    await runButton(page).click();
    await expect(page.getByRole('button', { name: 'Result actions', exact: true })).toBeVisible();
    await expect(page.locator('.script-running-results')).toHaveCount(0);
    const menu = await openStatementResults(page);
    await menu.getByRole('menuitemradio').nth(1).click();
    await page.getByRole('button', { name: 'Result actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Create materialized view…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create materialized view', exact: true });
    await dialog.getByRole('textbox', { name: 'View name' }).fill('second_mv');
    await dialog.getByRole('button', { name: 'Open SQL', exact: true }).click();
    await expect(page.locator('.cm-content')).toContainText('SELECT 2 AS second_value');
    await expect(page.locator('.cm-content')).not.toContainText('SELECT 1 AS first_value');
});

test('Materialized view actions are Experimental only and dismiss without changing SQL', async ({
    page,
}) => {
    await trust(page, 'Standard');
    await runButton(page).click();
    await expect(page.locator('.data-table')).toBeVisible();
    const trigger = page.getByRole('button', { name: 'Result actions', exact: true });
    await expect(trigger).toHaveCount(0);
    await setWorkspaceMode(page, 'Experimental');
    const sql = await page.locator('.cm-content').innerText();
    await trigger.click();
    await page.locator('.results-row-summary').click();
    await expect(page.getByRole('menu', { name: 'Result actions' })).toHaveCount(0);
    await trigger.click();
    await page.getByRole('menuitem', { name: 'Create materialized view…' }).click();
    await page.keyboard.press('Escape');
    await expect(
        page.getByRole('dialog', { name: 'Create materialized view', exact: true }),
    ).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(await page.locator('.cm-content').innerText()).toBe(sql);
});

test('Materialized view creation explains when no target tables are available', async ({
    page,
}) => {
    await page.route('**/api/connections/demo/schema*', async route => {
        const response = await route.fetch();
        await route.fulfill({
            response,
            json: { ...(await response.json()), tables: [], columns: [] },
        });
    });
    await trust(page);
    await replaceSql(page, 'SELECT 1 AS value;');
    await runButton(page).click();
    await page.getByRole('button', { name: 'Result actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Create materialized view…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create materialized view', exact: true });
    await dialog.getByRole('textbox', { name: 'View name' }).fill('empty_target_mv');
    await expect(dialog.getByText('Create a target table first.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Open SQL', exact: true })).toBeDisabled();
});
