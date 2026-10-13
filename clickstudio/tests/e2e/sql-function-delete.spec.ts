import { test, expect } from '@playwright/test';
import { functionsWorkspace } from './sql-functions-helpers.js';
import { workspacePath } from './helpers.js';
import { jsonRecord } from '../helpers/type-guards.js';

const name = 'udf_array_remove_at';

for (const mode of ['Standard', 'Experimental']) {
    test(`${mode} deletes only the exactly confirmed function and refreshes discovery`, async ({
        page,
    }, info) => {
        const { state, requests } = await functionsWorkspace(page, {
            existing: true,
            path: workspacePath(mode),
            canCreate: false,
        });
        await page.getByRole('button', { name: `${name} SQL UDF`, exact: true }).click();
        const button = page.getByRole('button', { name: 'Delete function', exact: true });
        await expect(button).toBeEnabled();
        await button.click();
        const dialog = page.getByRole('dialog', { name: 'Delete function', exact: true });
        const confirm = dialog.getByRole('button', { name: 'Delete function', exact: true });
        const input = dialog.getByRole('textbox');
        await expect(input).toBeFocused();
        await expect(dialog).toContainText('across all databases');
        for (const value of ['', name.toUpperCase(), `${name} `, ` ${name}`]) {
            await input.fill(value);
            await expect(confirm).toBeDisabled();
            await input.press('Enter');
        }
        expect(requests.filter(body => body.action === 'drop-function')).toHaveLength(0);
        await input.fill(name);
        await dialog.screenshot({ path: info.outputPath('delete-function.png') });
        await confirm.click();
        await expect(dialog).toHaveCount(0);
        await expect(page.locator('.sql-function-details')).toHaveCount(0);
        await expect(
            page.getByRole('button', { name: `${name} SQL UDF`, exact: true }),
        ).toHaveCount(0);
        await expect(
            page.getByRole('button', { name: 'udf_map_remove SQL UDF', exact: true }),
        ).toBeVisible();
        expect(requests.filter(body => body.action === 'drop-function')).toEqual([
            expect.objectContaining({ name, confirmation: name }),
        ]);
        expect(state.functions.map(fn => fn.name)).toEqual(['udf_map_remove']);
        expect(requests.filter(body => body.action === 'functions').length).toBeGreaterThan(1);
    });

    test(`${mode} keeps deletion disabled without DROP even when CREATE is granted`, async ({
        page,
    }) => {
        const { requests } = await functionsWorkspace(page, {
            existing: true,
            path: workspacePath(mode),
            canDrop: false,
        });
        await expect(
            page.getByRole('button', { name: 'Create SQL UDF', exact: true }),
        ).toBeEnabled();
        await page.getByRole('button', { name: `${name} SQL UDF`, exact: true }).click();
        const button = page.getByRole('button', { name: 'Delete function', exact: true });
        await expect(button).toBeDisabled();
        await expect(button).toHaveAttribute('title', 'DROP FUNCTION privilege is required.');
        expect(requests.filter(body => body.action === 'drop-function')).toHaveLength(0);
    });

    test(`${mode} cancellation restores focus and never deletes`, async ({ page }) => {
        const { requests } = await functionsWorkspace(page, {
            existing: true,
            path: workspacePath(mode),
        });
        await page.getByRole('button', { name: `${name} SQL UDF`, exact: true }).click();
        const button = page.getByRole('button', { name: 'Delete function', exact: true });
        const dialog = page.getByRole('dialog', { name: 'Delete function', exact: true });
        await button.click();
        await dialog.getByRole('textbox').fill(name);
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(button).toBeFocused();
        await button.click();
        await expect(dialog.getByRole('textbox')).toHaveValue('');
        await page.mouse.click(4, 4);
        await expect(dialog).toHaveCount(0);
        await button.click();
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        expect(requests.filter(body => body.action === 'drop-function')).toHaveLength(0);
    });

    test(`${mode} pending deletion prevents duplicate submission and dismissal`, async ({
        page,
    }) => {
        const { state, requests } = await functionsWorkspace(page, {
            existing: true,
            path: workspacePath(mode),
        });
        state.dropDelay = 1500;
        await page.getByRole('button', { name: `${name} SQL UDF`, exact: true }).click();
        await page.getByRole('button', { name: 'Delete function', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Delete function', exact: true });
        await dialog.getByRole('textbox').fill(name);
        await dialog.getByRole('button', { name: 'Delete function', exact: true }).click();
        await expect(dialog.getByRole('button', { name: 'Deleting…', exact: true })).toBeDisabled();
        await expect(dialog.getByRole('textbox')).toBeDisabled();
        await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
        await expect(
            dialog.getByRole('button', { name: 'Close Delete function', exact: true }),
        ).toBeDisabled();
        await page.keyboard.press('Escape');
        await page.keyboard.press('Enter');
        await page.mouse.click(4, 4);
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveCount(0);
        expect(requests.filter(body => body.action === 'drop-function')).toHaveLength(1);
    });

    test(`${mode} revoked permission leaves the function intact and never retries automatically`, async ({
        page,
    }) => {
        const { state, requests } = await functionsWorkspace(page, {
            existing: true,
            path: workspacePath(mode),
        });
        state.failDrop = true;
        await page.getByRole('button', { name: `${name} SQL UDF`, exact: true }).click();
        await page.getByRole('button', { name: 'Delete function', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Delete function', exact: true });
        await dialog.getByRole('textbox').fill(name);
        await dialog.getByRole('button', { name: 'Delete function', exact: true }).click();
        await expect(dialog.getByRole('alert')).toContainText(
            'DROP FUNCTION privilege was revoked.',
        );
        await expect(dialog.getByRole('alert')).toContainText('Refresh Functions');
        await expect(
            dialog.getByRole('button', { name: 'Delete function', exact: true }),
        ).toBeEnabled();
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(page.locator('.sql-function-details')).toBeVisible();
        expect(state.functions).toHaveLength(2);
        expect(requests.filter(body => body.action === 'drop-function')).toHaveLength(1);
    });

    test(`${mode} deletion is disabled while a function test runs`, async ({ page }) => {
        const { state } = await functionsWorkspace(page, {
            existing: true,
            path: workspacePath(mode),
        });
        state.runDelay = 1500;
        await page.getByRole('button', { name: `${name} SQL UDF`, exact: true }).click();
        await page.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
        await expect(
            page.getByRole('button', { name: 'Delete function', exact: true }),
        ).toBeDisabled();
        await expect(page.locator('.sql-function-output')).toHaveText('[10, 30, 40]');
        await expect(
            page.getByRole('button', { name: 'Delete function', exact: true }),
        ).toBeEnabled();
    });
}

test('Light narrow deletion dialog fits a long function name', async ({ page }, info) => {
    await page.setViewportSize({ width: 900, height: 620 });
    const { state } = await functionsWorkspace(page, { existing: true });
    const longName = 'function_' + 'x'.repeat(100);
    state.functions[0]!.name = longName;
    await page.locator('.object-refresh-action').click();
    await page.getByRole('radio', { name: 'Light theme', exact: true }).click();
    await page.getByRole('button', { name: `${longName} SQL UDF`, exact: true }).click();
    await page.getByRole('button', { name: 'Delete function', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete function', exact: true });
    await expect(dialog).toBeInViewport();
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await dialog.getByRole('textbox').fill(longName);
    await dialog.screenshot({ path: info.outputPath('delete-function-light.png') });
});

test('A late deletion response does not close another connection’s selected function', async ({
    page,
}) => {
    const { requests } = await functionsWorkspace(page, { existing: true });
    let release = () => {};
    const pending = new Promise<void>(resolve => {
        release = resolve;
    });
    await page.route('**/api/cloud', async route => {
        const body = jsonRecord(route.request().postDataJSON(), 'Cloud request');
        if (body.action !== 'drop-function') return route.fallback();
        await pending;
        return route.fulfill({ json: { name } });
    });
    try {
        await page.getByRole('button', { name: `${name} SQL UDF`, exact: true }).click();
        await page.getByRole('button', { name: 'Delete function', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Delete function', exact: true });
        await dialog.getByRole('textbox').fill(name);
        await dialog.getByRole('button', { name: 'Delete function', exact: true }).click();
        await expect(dialog.getByRole('button', { name: 'Deleting…', exact: true })).toBeDisabled();
        await page.evaluate(() =>
            document.querySelector<HTMLButtonElement>('.cloud-topbar-disconnect')?.click(),
        );
        await expect(dialog).toHaveCount(0);
        await page.getByRole('button', { name: 'Connect Cloud', exact: true }).click();
        const connect = page.getByRole('dialog', { name: 'Connect to your service', exact: true });
        await connect
            .getByLabel('HTTPS host')
            .fill('another.region.provider.clickhouse.cloud:8443');
        await connect.getByLabel('Database').fill('default');
        await connect.getByLabel('Username').fill('demo');
        await connect.getByLabel('Password').fill('demo-password');
        await connect.getByRole('button', { name: 'Connect service', exact: true }).click();
        await page.getByRole('button', { name: `${name} SQL UDF`, exact: true }).click();
        const discoveries = requests.filter(body => body.action === 'functions').length;
        const response = page.waitForResponse(
            response =>
                response.url().endsWith('/api/cloud') &&
                jsonRecord(response.request().postDataJSON(), 'Cloud request').action ===
                    'drop-function',
        );
        release();
        await (await response).finished();
        await page.evaluate(
            () =>
                new Promise<void>(resolve =>
                    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
                ),
        );
        await expect(page.locator('.sql-function-details h3')).toHaveText(name);
        expect(requests.filter(body => body.action === 'functions')).toHaveLength(discoveries);
        await expect(
            page.getByRole('dialog', { name: 'Delete function', exact: true }),
        ).toHaveCount(0);
    } finally {
        release();
    }
});
