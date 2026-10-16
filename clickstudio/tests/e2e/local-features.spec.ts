import { test, expect, type Page, type Download } from '@playwright/test';
import type { Result, ResultPage } from '../../src/shared/queries/results/types.js';
import { PLAYGROUND_CONNECTION } from '../../src/shared/database/connections/playground.js';
import type { CloudConnectionTest } from '../../src/frontend/database/connections/cloud-connection.js';
import { setWorkspaceMode, trust } from './helpers.js';
import { arrayValue, decodeValue, jsonRecord, stringValue } from '../helpers/type-guards.js';
import { isResult } from '../../src/frontend/queries/execution/execution-validation.js';
import { cloudSchema } from '../helpers/cloud-fixtures.js';

const cloudConnectionTest: CloudConnectionTest = {
    host: 'service.region.provider.clickhouse.cloud:8443',
    database: 'default',
    username: 'demo',
    serverVersion: '26.1',
    queryLog: { available: true },
    queryLogSource: 'user_query_log',
    replication: { available: false, reason: 'Unavailable in this test.' },
    progress: { available: false, reason: 'Unavailable in this test.' },
    cancellation: { available: false, reason: 'Unavailable in this test.' },
    explain: { available: false, reason: 'Unavailable in this test.' },
    explainPlan: { available: false, reason: 'Unavailable in this test.' },
    explainAnalyze: { available: false, reason: 'Unavailable in this test.' },
    queryTree: { available: false, reason: 'Unavailable in this test.' },
    explainPipeline: { available: false, reason: 'Unavailable in this test.' },
    pipeline: { available: false, reason: 'Unavailable in this test.' },
    traceLog: { available: false, reason: 'Unavailable in this test.' },
    documentation: { available: false, reason: 'Unavailable in this test.' },
    parameters: { available: false, reason: 'Unavailable in this test.' },
};

function countRuns(page: Page) {
    let count = 0;
    page.on('request', request => {
        if (
            request.method() === 'POST' &&
            ['/api/runs', '/api/scripts'].includes(new URL(request.url()).pathname)
        )
            count++;
    });
    return () => count;
}
async function resultPage(
    page: Page,
    transform: (
        result: Result,
    ) => Partial<Result> & Partial<Pick<ResultPage, 'offset' | 'totalRows' | 'nextOffset'>>,
) {
    await page.route(
        url => url.pathname.endsWith('/result'),
        async route => {
            const response = await route.fetch();
            const result = decodeValue(await response.json(), isResult, 'Result response');
            await route.fulfill({ response, json: { ...result, ...transform(result) } });
        },
    );
}
async function run(page: Page) {
    await page.getByTestId('run-button').click();
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await expect(results.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
    return results;
}
async function downloadedText(download: Download): Promise<string> {
    const stream = await download.createReadStream();
    if (!stream) throw new Error('Download stream unavailable');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
}

test('Duplicate result-column names keep their values in the correct positions', async ({
    page,
}) => {
    const runs = countRuns(page);
    await resultPage(page, result => ({
        ...result,
        columns: [
            { name: 'same', type: 'String' },
            { name: 'same', type: 'UInt64' },
        ],
        rows: [['text', '9007199254740993']],
    }));
    await trust(page);
    const results = await run(page);
    const headers = results.getByRole('table').locator('thead th');
    await expect(headers).toHaveCount(3);
    await expect(headers.nth(1)).toContainText('same');
    await expect(headers.nth(2)).toContainText('same');
    const cells = results.getByRole('table').locator('tbody tr').first().locator('td');
    await expect(cells.nth(1)).toHaveText('text');
    await expect(cells.nth(2)).toHaveText('9007199254740993');
    expect(runs()).toBe(1);
});

for (const mode of ['Standard', 'Experimental']) {
    test(`${mode} manages duplicate columns without rerunning the query`, async ({ page }) => {
        const runs = countRuns(page);
        await resultPage(page, result => ({
            ...result,
            columns: [
                { name: 'same', type: 'String' },
                { name: 'same', type: 'UInt64' },
                { name: 'payload', type: 'String' },
            ],
            rows: [['text', '9007199254740993', 'large payload']],
        }));
        await trust(page, mode);
        await setWorkspaceMode(page, mode);

        const results = await run(page);
        const table = results.getByRole('table', { name: 'Retained query rows' });
        await results.getByRole('button', { name: 'Columns: 3 of 3 shown' }).click();
        const dialog = page.getByRole('dialog', { name: 'Manage columns' });
        const search = dialog.getByRole('searchbox', { name: 'Search by name or type' });
        await expect(search).toBeFocused();
        await search.fill('UInt64');
        await dialog.getByRole('checkbox', { name: 'Hide same · column 2' }).click();
        await expect(table.locator('thead th[data-type-group]')).toHaveCount(2);
        await expect(dialog.getByText('2 of 3 columns shown')).toBeVisible();

        await dialog.getByRole('button', { name: 'Restore defaults' }).click();
        await search.fill('');
        await dialog.getByRole('button', { name: 'Pin payload to the left' }).click();
        await expect(table.locator('thead th[data-pinned-column]')).toHaveCount(1);
        await expect(table.locator('tbody td[data-column-index="2"]')).toHaveAttribute(
            'data-pinned-column',
        );
        expect(runs()).toBe(1);

        const nextRun = page.waitForRequest(request => {
            const url = new URL(request.url());
            return request.method() === 'POST' && url.pathname === '/api/runs';
        });
        await Promise.all([nextRun, page.getByTestId('run-button').click()]);
        await expect.poll(runs).toBe(2);
        await expect(table.locator('thead th[data-type-group]')).toHaveCount(3);
        await expect(table.locator('thead th[data-pinned-column]')).toHaveCount(0);
    });

    test(`${mode} inspects and downloads the full value behind a bounded preview`, async ({
        page,
    }) => {
        const fullValue = `${'large-😀-value '.repeat(300)}end`;
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await resultPage(page, result => ({
            ...result,
            columns: [
                { name: 'payload', type: 'String' },
                { name: 'structure', type: 'JSON' },
            ],
            rows: [[fullValue, { nested: [1, 2, { detail: 'kept' }] }]],
        }));
        await trust(page, mode);
        await setWorkspaceMode(page, mode);

        const results = await run(page);
        const table = results.getByRole('table', { name: 'Retained query rows' });
        const payload = table.locator('tbody button').nth(0);
        const preview = (await payload.textContent()) ?? '';
        expect(preview.length).toBeLessThanOrEqual(180);
        expect(preview).not.toContain('end');
        await payload.click();

        const dialog = page.getByRole('dialog', { name: 'payload' });
        await expect(dialog.locator('.result-cell-inspector-value')).toHaveText(fullValue);
        await dialog.getByRole('button', { name: 'Copy value' }).click();
        await expect(dialog.getByRole('status')).toHaveText('Copied full value.');
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(fullValue);
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            dialog.getByRole('button', { name: 'Download full value' }).click(),
        ]);
        expect(download.suggestedFilename()).toBe('payload-column-1-row-1.txt');
        expect(await downloadedText(download)).toBe(fullValue);
        await dialog.getByRole('button', { name: 'Close cell inspector' }).click();

        await table.locator('tbody button').nth(1).click();
        const objectDialog = page.getByRole('dialog', { name: 'structure' });
        await expect(objectDialog.locator('.result-cell-inspector-value')).toContainText(
            '"detail": "kept"',
        );
    });

    test(`${mode} explains why a retained result is incomplete`, async ({ page }) => {
        await resultPage(page, result => ({
            ...result,
            columns: [{ name: 'value', type: 'String' }],
            rows: [['retained']],
            completeness: 'truncated',
            truncationReason: 'bytes',
            offset: 0,
            totalRows: 1,
            nextOffset: null,
        }));
        await trust(page, mode);
        await setWorkspaceMode(page, mode);

        const results = await run(page);
        await expect(results.locator('.result-retention-notice')).toContainText(
            '1 retained row. The 2 MB result-size limit was reached',
        );
        await expect(results.locator('.result-retention-notice')).toContainText(
            'the full result is not available here',
        );
    });
}

test('Result export downloads the complete retained CSV from the server', async ({ page }) => {
    const runs = countRuns(page);
    await trust(page);
    await run(page);
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const exportDialog = page.getByRole('dialog', { name: 'Export', exact: true });
    await expect(exportDialog).toBeVisible();
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        exportDialog.getByRole('button', { name: /Export rows \(\.csv\)/ }).click(),
    ]);
    const csv = await downloadedText(download);
    expect(csv.split('\r\n')).toHaveLength(8);
    expect(csv.split('\r\n')[0]).toBe('day,events');
    expect(csv).toContain('2026-01-07,70');
    expect(runs()).toBe(1);
});

test('Local Cloud connection restores after refresh and exports retained rows from the browser workspace', async ({
    page,
}) => {
    const cloudActions: string[] = [];
    const cloudSessionMethods: string[] = [];
    const serverExportRequests: string[] = [];
    let savedCloudSession: {
        profile: { host: string; database: string; username: string };
        tested: CloudConnectionTest;
    } | null = null;
    await page.route('**/api/connections', async route => {
        const response = await route.fetch();
        const connections = arrayValue(await response.json(), 'Connection response');
        if (
            !connections.some(
                connection => jsonRecord(connection, 'Connection').id === PLAYGROUND_CONNECTION.id,
            )
        )
            connections.push(PLAYGROUND_CONNECTION);
        await route.fulfill({ response, json: connections });
    });
    await page.route('**/api/cloud/session', async route => {
        const method = route.request().method();
        cloudSessionMethods.push(method);
        if (method === 'GET') {
            await route.fulfill({ json: { session: savedCloudSession } });
            return;
        }
        if (method === 'POST') {
            const body = jsonRecord(route.request().postDataJSON(), 'Cloud session request');
            const credentialValues = jsonRecord(body.credentials, 'Cloud credentials');
            const credentials = {
                host: stringValue(credentialValues.host, 'Cloud host'),
                database: stringValue(credentialValues.database, 'Cloud database'),
                username: stringValue(credentialValues.username, 'Cloud username'),
            };
            savedCloudSession = { profile: credentials, tested: cloudConnectionTest };
            await route.fulfill({ json: cloudConnectionTest });
            return;
        }
        savedCloudSession = null;
        await route.fulfill({ status: 204 });
    });
    await page.route('**/api/cloud', async route => {
        const body = jsonRecord(route.request().postDataJSON(), 'Cloud request body');
        cloudActions.push(typeof body.action === 'string' ? body.action : '');
        if (body.action === 'test') {
            await route.fulfill({ json: cloudConnectionTest });
            return;
        }
        if (body.action === 'schema') {
            await route.fulfill({ json: cloudSchema });
            return;
        }
        if (body.action === 'run') {
            await route.fulfill({
                json: {
                    queryId:
                        typeof body.queryId === 'string' ? body.queryId : 'clickstudio-run-test',
                    columns: [
                        { name: 'day', type: 'Date' },
                        { name: 'events', type: 'UInt64' },
                    ],
                    rows: [
                        ['2026-01-01', '10'],
                        ['2026-01-02', '20'],
                    ],
                    elapsedMs: 8,
                    bytes: 32,
                    truncated: false,
                },
            });
            return;
        }
        await route.fulfill({
            status: 409,
            json: {
                error: {
                    code: 'UNEXPECTED_ACTION',
                    message: 'Unexpected Cloud action in this export test.',
                },
            },
        });
    });
    page.on('request', request => {
        const url = new URL(request.url());
        if (url.pathname.startsWith('/api/runs/') && url.pathname.endsWith('/export'))
            serverExportRequests.push(url.pathname);
    });

    await page.goto('/experimental');
    await page.getByRole('button', { name: 'Connect Cloud' }).click();
    const connectionDialog = page.getByRole('dialog', { name: 'Connect to your service' });
    await connectionDialog
        .getByLabel('HTTPS host')
        .fill('service.region.provider.clickhouse.cloud:8443');
    await connectionDialog.getByLabel('Database').fill('default');
    await connectionDialog.getByLabel('Username').fill('demo');
    await connectionDialog.getByLabel('Password').fill('demo-password');
    await connectionDialog.getByRole('button', { name: 'Connect service' }).click();
    await expect(page.locator('.connection-trigger .connection-env.is-cloud')).toHaveText('CLOUD');

    await page.getByTestId('run-button').click();
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    const resultTable = results.getByRole('table', { name: 'Retained query rows' });
    await expect(resultTable).toBeVisible();
    await expect(resultTable).toContainText('2026-01-02');

    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const exportDialog = page.getByRole('dialog', { name: 'Export', exact: true });
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        exportDialog.getByRole('button', { name: /Export rows \(\.csv\)/ }).click(),
    ]);
    const csv = await downloadedText(download);
    expect(csv.split('\r\n')[0]).toBe('day,events');
    expect(csv).toContain('2026-01-02,20');
    expect(cloudActions).toContain('run');
    expect(serverExportRequests).toEqual([]);

    await page.reload();
    await expect(page.locator('.connection-trigger .connection-env.is-cloud')).toHaveText('CLOUD');
    const firstConnect = cloudSessionMethods.indexOf('POST');
    expect(firstConnect).toBeGreaterThanOrEqual(0);
    expect(cloudSessionMethods.slice(firstConnect + 1)).toContain('GET');
    const restoredResults = await run(page);
    await expect(restoredResults.getByRole('table', { name: 'Retained query rows' })).toContainText(
        '2026-01-02',
    );
    expect(cloudActions.filter(action => action === 'run')).toHaveLength(2);
});

test('Wide retained results remain horizontally scrollable and keyboard accessible', async ({
    page,
}) => {
    await page.setViewportSize({ width: 900, height: 844 });
    await resultPage(page, result => ({
        ...result,
        columns: Array.from({ length: 10 }, (_, index) => ({
            name: `column_${index + 1}`,
            type: 'String',
        })),
        rows: [Array.from({ length: 10 }, (_, index) => `value ${index + 1}`)],
    }));
    await trust(page);

    const results = await run(page);
    const scroll = results.locator('.data-table-scroll');
    await expect(results.getByText('Scroll horizontally to view all 10 columns')).toHaveCount(0);
    await expect(scroll).toHaveAttribute('tabindex', '0');
    expect(await scroll.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);

    await scroll.focus();
    await scroll.press('ArrowRight');
    await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
});
