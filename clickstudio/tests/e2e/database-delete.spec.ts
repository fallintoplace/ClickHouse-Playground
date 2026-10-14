import { test, expect, type Page } from '@playwright/test';
import { mockCloudEndpoint } from './cloud-import-helpers.js';
import { workspacePath } from './helpers.js';
import { cloudConnectionTest, cloudSchema } from '../helpers/cloud-fixtures.js';
import { jsonRecord } from '../helpers/type-guards.js';

async function databaseWorkspace(
    page: Page,
    mode = 'Experimental',
    activeDatabase = 'default',
    canDrop = true,
) {
    await page.route('**/api/session', route =>
        route.fulfill({
            json: {
                principal: { id: 'test-owner', role: 'owner' },
                requiresLogin: false,
                demo: false,
            },
        }),
    );
    await mockCloudEndpoint(page);
    const requests: Record<string, unknown>[] = [];
    const state = {
        databases: ['default', 'BEATLES_DB', 'empty_db', 'system', 'INFORMATION_SCHEMA'],
        canDrop,
        failDrop: false,
        dropDelay: 0,
    };
    await page.route('**/api/cloud', async route => {
        const body = jsonRecord(route.request().postDataJSON());
        requests.push(body);
        switch (body.action) {
            case 'test':
                return route.fulfill({ json: cloudConnectionTest({ database: activeDatabase }) });
            case 'schema':
                return route.fulfill({
                    json: {
                        ...cloudSchema,
                        databases: state.databases,
                        tables: state.databases.includes('BEATLES_DB')
                            ? [
                                  ...cloudSchema.tables,
                                  { database: 'BEATLES_DB', name: 'songs', engine: 'MergeTree' },
                              ]
                            : cloudSchema.tables,
                    },
                });
            case 'table-permissions':
                return route.fulfill({
                    json: { create: true, insert: true, drop: true, dropDatabase: state.canDrop },
                });
            case 'drop-database':
                if (state.dropDelay)
                    await new Promise(resolve => setTimeout(resolve, state.dropDelay));
                if (state.failDrop)
                    return route.fulfill({
                        status: 403,
                        json: {
                            error: {
                                code: 'DENIED',
                                message: 'DROP DATABASE privilege was revoked.',
                            },
                        },
                    });
                state.databases = state.databases.filter(name => name !== body.database);
                return route.fulfill({ json: { database: body.database, queryId: 'drop-id' } });
            default:
                return route.fallback();
        }
    });
    await page.goto(workspacePath(mode));
    await page.getByRole('button', { name: 'Connect Cloud', exact: true }).click();
    const connect = page.getByRole('dialog', { name: 'Connect to your service', exact: true });
    await connect.getByLabel('HTTPS host').fill('service.region.provider.clickhouse.cloud:8443');
    await connect.getByLabel('Database').fill(activeDatabase);
    await connect.getByLabel('Username').fill('demo');
    await connect.getByLabel('Password').fill('demo-password');
    await connect.getByRole('button', { name: 'Connect service', exact: true }).click();
    if (mode === 'Standard')
        await page
            .locator('.icon-rail')
            .getByRole('button', { name: 'Objects', exact: true })
            .click();
    if (canDrop)
        await expect(
            page.getByRole('button', { name: 'Delete database BEATLES_DB', exact: true }),
        ).toBeVisible();
    else
        await expect(
            page.getByRole('button', { name: 'New table in BEATLES_DB', exact: true }),
        ).toBeVisible();
    return { state, requests };
}

for (const mode of ['Standard', 'Experimental']) {
    test(`${mode} shows database trash beside plus and deletes only the exactly confirmed database`, async ({
        page,
    }, info) => {
        const { state, requests } = await databaseWorkspace(page, mode);
        const trash = page.getByRole('button', { name: 'Delete database BEATLES_DB', exact: true });
        const plus = page.getByRole('button', { name: 'New table in BEATLES_DB', exact: true });
        await page.mouse.move(0, 0);
        await expect(trash).toHaveCSS('opacity', '1');
        const trashBounds = await trash.boundingBox();
        const plusBounds = await plus.boundingBox();
        expect(trashBounds!.x).toBeLessThan(plusBounds!.x);
        expect(Math.abs(trashBounds!.y - plusBounds!.y)).toBeLessThan(1);
        const permissionRequests = requests.filter(body => body.action === 'table-permissions');
        await page.getByTestId('open-ai').click();
        await page
            .locator('.icon-rail')
            .getByRole('button', { name: 'Objects', exact: true })
            .click();
        await expect(trash).toBeVisible();
        await expect(plus).toBeVisible();
        expect(requests.filter(body => body.action === 'table-permissions')).toEqual(
            permissionRequests,
        );
        for (const protectedName of ['default', 'system', 'INFORMATION_SCHEMA'])
            await expect(
                page.getByRole('button', { name: `Delete database ${protectedName}`, exact: true }),
            ).toHaveCount(0);
        await page
            .locator('.object-explorer-section')
            .screenshot({ path: info.outputPath('database-trash.png') });
        await trash.click();
        const dialog = page.getByRole('dialog', { name: 'Delete database', exact: true });
        const input = dialog.getByRole('textbox');
        const confirm = dialog.getByRole('button', { name: 'Delete database', exact: true });
        await expect(input).toBeFocused();
        await expect(dialog).toContainText('all tables and data');
        await expect(dialog).toContainText('service.clickhouse.cloud:8443');
        for (const value of ['', 'beatles_db', 'BEATLES_DB ', ' BEATLES_DB']) {
            await input.fill(value);
            await expect(confirm).toBeDisabled();
            await input.press('Enter');
        }
        expect(requests.filter(body => body.action === 'drop-database')).toHaveLength(0);
        await input.fill('BEATLES_DB');
        await dialog.screenshot({ path: info.outputPath('delete-database.png') });
        await confirm.click();
        await expect(dialog).toHaveCount(0);
        await expect(trash).toHaveCount(0);
        await expect(
            page.getByRole('button', { name: 'Delete database empty_db', exact: true }),
        ).toBeVisible();
        expect(state.databases).not.toContain('BEATLES_DB');
        expect(requests.filter(body => body.action === 'drop-database')).toEqual([
            expect.objectContaining({ database: 'BEATLES_DB', confirmation: 'BEATLES_DB' }),
        ]);
    });
}

test('Database deletion cancels with focus restored and supports empty databases', async ({
    page,
}) => {
    const { requests } = await databaseWorkspace(page);
    const trash = page.getByRole('button', { name: 'Delete database empty_db', exact: true });
    await trash.click();
    const dialog = page.getByRole('dialog', { name: 'Delete database', exact: true });
    await dialog.getByRole('textbox').fill('empty_db');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trash).toBeFocused();
    expect(requests.filter(body => body.action === 'drop-database')).toHaveLength(0);
    await trash.click();
    await expect(dialog.getByRole('textbox')).toHaveValue('');
    await dialog.getByRole('textbox').fill('empty_db');
    await dialog.getByRole('button', { name: 'Delete database', exact: true }).click();
    await expect(trash).toHaveCount(0);
});

test('Revoked database permission keeps the database intact and unlocks the dialog after failure', async ({
    page,
}) => {
    const { state, requests } = await databaseWorkspace(page);
    state.failDrop = true;
    await page.getByRole('button', { name: 'Delete database BEATLES_DB', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete database', exact: true });
    await dialog.getByRole('textbox').fill('BEATLES_DB');
    await dialog.getByRole('button', { name: 'Delete database', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('DROP DATABASE privilege was revoked.');
    await expect(dialog.getByRole('textbox')).toBeEnabled();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(state.databases).toContain('BEATLES_DB');
    expect(requests.filter(body => body.action === 'drop-database')).toHaveLength(1);
});

test('A denied database grant hides trash while keeping table creation available', async ({
    page,
}) => {
    const { requests } = await databaseWorkspace(page, 'Experimental', 'default', false);
    await expect(
        page.getByRole('button', { name: 'Delete database BEATLES_DB', exact: true }),
    ).toHaveCount(0);
    await expect(
        page.getByRole('button', { name: 'New table in BEATLES_DB', exact: true }),
    ).toBeVisible();
    expect(requests.filter(body => body.action === 'drop-database')).toHaveLength(0);
});

test('Pending database deletion prevents duplicate submission and dismissal', async ({ page }) => {
    const { state, requests } = await databaseWorkspace(page);
    state.dropDelay = 1200;
    await page.getByRole('button', { name: 'Delete database BEATLES_DB', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete database', exact: true });
    await dialog.getByRole('textbox').fill('BEATLES_DB');
    await dialog.getByRole('button', { name: 'Delete database', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Deleting…', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('textbox')).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCount(0);
    expect(requests.filter(body => body.action === 'drop-database')).toHaveLength(1);
});

test('Deleting the active database switches subsequent Cloud requests and the workspace to default', async ({
    page,
}) => {
    const { requests } = await databaseWorkspace(page, 'Experimental', 'BEATLES_DB');
    await page.getByRole('button', { name: 'Delete database BEATLES_DB', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete database', exact: true });
    await expect(dialog).toContainText('connection will switch to default');
    await dialog.getByRole('textbox').fill('BEATLES_DB');
    await dialog.getByRole('button', { name: 'Delete database', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
        page.getByRole('button', { name: 'Delete database empty_db', exact: true }),
    ).toBeVisible();
    await page.locator('.connection-trigger').click();
    await expect(page.getByRole('dialog', { name: 'Connection details' })).toContainText('default');
    const schemaRequests = requests.filter(body => body.action === 'schema');
    expect(jsonRecord(schemaRequests.at(-1)?.credentials).database).toBe('default');
});

test('A completed deletion reconciles the connection after navigating away while it is pending', async ({
    page,
}) => {
    const { state } = await databaseWorkspace(page, 'Experimental', 'BEATLES_DB');
    state.dropDelay = 1200;
    await page.getByRole('button', { name: 'Delete database BEATLES_DB', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete database', exact: true });
    await dialog.getByRole('textbox').fill('BEATLES_DB');
    const response = page.waitForResponse(
        response =>
            response.url().endsWith('/api/cloud') &&
            jsonRecord(response.request().postDataJSON()).action === 'drop-database',
    );
    await dialog.getByRole('button', { name: 'Delete database', exact: true }).click();
    await page.evaluate(() => {
        history.pushState(null, '', '/experimental?connection=demo');
        window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(dialog).toHaveCount(0);
    await (await response).finished();
    await page.evaluate(() => {
        history.pushState(null, '', '/experimental?connection=clickhouse-cloud');
        window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.locator('.connection-trigger').click();
    await expect(page.getByRole('dialog', { name: 'Connection details' })).toContainText('default');
    expect(state.databases).not.toContain('BEATLES_DB');
});
