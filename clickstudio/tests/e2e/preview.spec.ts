import { chooseImportOption } from './import-helpers.js';
import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { GEO_HELP_CITIES } from '../../src/frontend/help/previews/geo-help-examples.js';
import {
    openBlankSql,
    openSqlExamples,
    openWorkspacePanel,
    replaceSql,
    runButton,
    workspacePath,
} from './helpers.js';
import { chooseChartOption } from './chart-control-helpers.js';
import { jsonRecord } from '../helpers/type-guards.js';
import {
    previewCloudSchema,
    mockCloudEndpoint,
    connectPreviewCloud,
    chooseExistingCloudTable,
} from './cloud-import-helpers.js';

test('Playground dependencies reload legacy schema caches and list empty databases', async ({
    page,
}) => {
    await page.addInitScript(() =>
        localStorage.setItem(
            'clickstudio:playground-schema:v1',
            JSON.stringify({
                savedAt: Date.now(),
                schema: {
                    connectionId: 'playground',
                    fetchedAt: '2026-10-14',
                    tables: [],
                    columns: [],
                    warnings: [],
                    truncated: false,
                },
            }),
        ),
    );
    let catalogRequests = 0;
    await page.route('https://sql-clickhouse.clickhouse.com:8443/**', route => {
        const sql = route.request().postData() ?? '';
        let body = '[]\n[]\n';
        if (sql.includes('FROM system.databases')) {
            catalogRequests++;
            body = '["name"]\n["String"]\n["github"]\n["empty_db"]\n["analytics"]\n';
        } else if (sql.includes('sorting_key, primary_key, partition_key, sampling_key')) {
            body = [
                JSON.stringify([
                    'database',
                    'name',
                    'engine',
                    'sorting_key',
                    'primary_key',
                    'partition_key',
                    'sampling_key',
                    'total_rows',
                    'total_bytes',
                    'total_bytes_uncompressed',
                ]),
                JSON.stringify(Array.from({ length: 10 }, () => 'String')),
                JSON.stringify([
                    'github',
                    'events',
                    'MergeTree',
                    '',
                    '',
                    '',
                    '',
                    '1',
                    '100',
                    '200',
                ]),
                '',
            ].join('\n');
        }
        return route.fulfill({ body, contentType: 'text/plain' });
    });
    await page.goto('/experimental?connection=playground');
    await page.getByRole('button', { name: 'View dependencies', exact: true }).click();
    const dialog = page.getByRole('dialog', {
        name: 'Materialized view dependencies',
        exact: true,
    });
    const database = dialog.getByRole('combobox', { name: 'Lineage database', exact: true });
    await database.click();
    await expect(dialog.getByRole('option')).toHaveText(['github', 'empty_db', 'analytics']);
    await dialog.getByRole('option', { name: 'empty_db', exact: true }).click();
    await expect(database).toHaveAttribute('data-value', 'empty_db');
    await expect(dialog.getByRole('status')).toContainText('empty_db');
    expect(catalogRequests).toBe(1);
});

test('Static preview opens Standard at root and shares SQL with the Experimental URL', async ({
    page,
}) => {
    await page.addInitScript(() => localStorage.setItem('clickstudio:experience', 'expert'));
    const parserResponse = page.waitForResponse(
        response => new URL(response.url()).pathname === '/assets/clickhouse-parser.wasm',
    );
    await page.goto('/?connection=demo');
    expect((await parserResponse).status()).toBe(200);
    await expect(page.locator('.application')).toHaveAttribute('data-experience', 'beginner');
    await expect(page.locator('.navbar-mode-control, .experimental-workspace-status')).toHaveCount(
        0,
    );
    await openBlankSql(page);
    await replaceSql(page, 'SELECT 42 AS preserved_preview_draft');
    await page.goto('/experimental/?connection=demo');
    await expect(page.locator('.application')).toHaveAttribute('data-experience', 'expert');
    await expect(page.locator('.cm-content')).toContainText('SELECT 42 AS preserved_preview_draft');
    await page.reload();
    await expect(page.locator('.application')).toHaveAttribute('data-experience', 'expert');
    await expect(page.locator('.cm-content')).toContainText('SELECT 42 AS preserved_preview_draft');
    await page.getByRole('link', { name: 'Back to workspace', exact: true }).click();
    await expect(page).toHaveURL(/\/\?connection=demo$/);
    await expect(page.locator('.application')).toHaveAttribute('data-experience', 'beginner');
    await expect(page.locator('.cm-content')).toContainText('SELECT 42 AS preserved_preview_draft');
});

for (const hasRows of [true, false]) {
    test(`Legacy result history ${hasRows ? 'keeps rows' : 'stays silent without rows'} after reload`, async ({
        page,
    }) => {
        const queryRequests: string[] = [];
        await page.route('https://sql-clickhouse.clickhouse.com:8443/**', async route => {
            const sql = route.request().postData() ?? '';
            if (sql.includes('interview_query')) queryRequests.push(sql);
            await route.fulfill({ body: '[]\n[]\n', contentType: 'text/plain' });
        });
        await page.goto('/experimental?connection=demo');
        await expect(page.locator('.cm-content')).toBeVisible();
        await page.evaluate(hasRows => {
            const databaseKey = 'clickstudio:vercel-preview-database:v1';
            const database = JSON.parse(localStorage.getItem(databaseKey)!);
            const id = 'legacy-interview-result';
            const sql = 'SELECT 42 AS interview_query';
            const columns = [{ name: 'interview_query', type: 'UInt64' }];
            database.runs.push({
                ...database.runs[0],
                id,
                queryId: 'legacy-interview-query',
                connectionId: 'playground',
                dataSource: 'clickhouse',
                sql,
                columns,
                rowCount: 1,
                resultState: 'expired',
                resultExpiresAt: '2000-01-01T00:00:00.000Z',
            });
            if (hasRows)
                database.results.push({
                    runId: id,
                    queryId: 'legacy-interview-query',
                    columns,
                    rows: [['42']],
                    completeness: 'complete',
                    createdAt: '2000-01-01T00:00:00.000Z',
                    expiresAt: '2000-01-01T00:00:00.000Z',
                });
            localStorage.setItem(databaseKey, JSON.stringify(database));
            localStorage.setItem(
                'clickstudio:workspace:playground:v1',
                JSON.stringify({
                    version: 1,
                    activeId: id,
                    tabs: [
                        {
                            id,
                            name: 'Interview query.sql',
                            sql,
                            parameters: {},
                            chart: { kind: 'table', x: 0, ys: [], title: 'Query result' },
                            runIds: [id],
                            activeRunId: id,
                            checkpoints: [],
                            from: 0,
                            to: 0,
                            kind: 'query',
                            dependencies: [],
                        },
                    ],
                }),
            );
        }, hasRows);
        await page.goto('/experimental?connection=playground');
        await expect(page.locator('.cm-content')).toContainText('SELECT 42 AS interview_query');
        await expect(page.locator('.execution-bar')).toHaveAttribute(
            'data-query-id',
            'legacy-interview-query',
        );
        const results = page.getByRole('region', { name: 'Query results', exact: true });
        if (hasRows) await expect(results.locator('tbody')).toContainText('42');
        else {
            await expect(results.locator('.result-empty-state')).toHaveCount(0);
            await expect(results.locator('.result-loading')).toHaveCount(0);
            await expect(results.locator('#query-results-content')).toBeEmpty();
        }
        await expect(page.getByText('Result retention expired', { exact: true })).toHaveCount(0);
        await expect(page.getByText('No retained result', { exact: true })).toHaveCount(0);
        await page.reload();
        await expect(page.locator('.execution-bar')).toHaveAttribute(
            'data-query-id',
            'legacy-interview-query',
        );
        if (hasRows) await expect(results.locator('tbody')).toContainText('42');
        else await expect(results.locator('#query-results-content')).toBeEmpty();
        expect(queryRequests).toEqual([]);
    });
}

test('Footer shows version detection and keeps connection versions isolated in static preview', async ({
    page,
}) => {
    let releaseVersion: () => void = () => {};
    const versionGate = new Promise<void>(resolve => {
        releaseVersion = resolve;
    });
    await page.route('https://sql-clickhouse.clickhouse.com:8443/**', async route => {
        const sql = route.request().postData() ?? '';
        if (sql.includes('SELECT version() AS version')) {
            await versionGate;
            await route.fulfill({
                body: '["version"]\n["String"]\n["26.6.1.2326"]\n',
                contentType: 'text/plain',
            });
        } else {
            await route.fulfill({ body: '[]\n[]\n', contentType: 'text/plain' });
        }
    });
    await mockCloudEndpoint(page);
    try {
        await page.goto('/experimental');
        const version = page.getByTestId('server-version');
        await expect(version).toHaveText('ClickHouse …');
        await page.getByRole('button', { name: 'Connect Cloud', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Connect to your service' });
        await dialog.getByLabel('HTTPS host').fill('service.region.provider.clickhouse.cloud:8443');
        await dialog.getByLabel('Database').fill('default');
        await dialog.getByLabel('Username').fill('demo');
        await dialog.getByLabel('Password').fill('demo-password');
        await dialog.getByRole('button', { name: 'Connect service' }).click();
        await expect(version).toHaveText('ClickHouse 26.1');
        releaseVersion();
        await expect(version).toHaveText('ClickHouse 26.1');
        await page.locator('.connection-trigger').click();
        await page
            .getByRole('dialog', { name: 'Data source options' })
            .getByRole('button', { name: /ClickHouse Playground/ })
            .click();
        await expect(version).toHaveText('ClickHouse 26.6.1.2326');
        await page.locator('.connection-trigger').click();
        await expect(
            page
                .getByRole('dialog', { name: 'Data source options' })
                .getByRole('button', { name: /Sample data/ }),
        ).toHaveCount(0);
        await page.goto('/experimental?connection=demo');
        await expect(version).toHaveText('Sample data');
    } finally {
        releaseVersion();
    }
});

test('Connect Cloud matches neutral secondary controls in both themes', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/experimental');
    const connect = page.getByRole('button', { name: 'Connect Cloud', exact: true });
    const save = page.getByTestId('save-query');
    for (const theme of ['Dark', 'Light']) {
        await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute(
            'data-theme',
            `click-${theme.toLowerCase()}`,
        );
        await expect(connect).toHaveCSS('background-image', 'none');
        for (const property of ['background-color', 'border-color']) {
            await expect(connect).toHaveCSS(
                property,
                await save.evaluate(async (element, name) => {
                    await Promise.all(element.getAnimations().map(animation => animation.finished));
                    return getComputedStyle(element).getPropertyValue(name);
                }, property),
            );
        }
        await save.hover();
        await expect(save).toHaveCSS(
            'color',
            await page.locator('.brand-name').evaluate(element => getComputedStyle(element).color),
        );
        const hover = await save.evaluate(async element => {
            await Promise.all(element.getAnimations().map(animation => animation.finished));
            const style = getComputedStyle(element);
            return {
                background: style.backgroundColor,
                border: style.borderColor,
                text: style.color,
            };
        });
        await connect.hover();
        await expect(connect).toHaveCSS('background-color', hover.background);
        await expect(connect).toHaveCSS('border-color', hover.border);
        await expect(connect).toHaveCSS('color', hover.text);
    }
});

test('Cloud actions stay outside the source picker and disconnect preserves another source', async ({
    page,
}) => {
    await mockCloudEndpoint(page);
    await connectPreviewCloud(page);

    const disconnectButton = page.getByRole('button', { name: 'Disconnect Cloud' });
    await expect(disconnectButton).toBeVisible();

    await page.locator('.connection-trigger').click();
    await page
        .getByRole('dialog', { name: 'Data source options' })
        .getByRole('button', { name: /ClickHouse Playground/ })
        .click();
    await expect(page.locator('.connection-trigger')).toContainText('PLAYGROUND');
    await expect(disconnectButton).toBeVisible();

    await disconnectButton.click();
    await expect(page.locator('.connection-trigger')).toContainText('PLAYGROUND');
    await expect(page.getByRole('button', { name: 'Connect Cloud' })).toBeVisible();
});

test('Disconnecting the active Cloud source falls back to Playground', async ({ page }) => {
    await mockCloudEndpoint(page);
    await connectPreviewCloud(page);

    await page.getByRole('button', { name: 'Disconnect Cloud' }).click();

    await expect(page.locator('.connection-trigger')).toContainText('PLAYGROUND');
    await expect(page.getByRole('button', { name: 'Connect Cloud' })).toBeVisible();
});

test('Static production preview loads the native parser and exports retained sample results', async ({
    page,
}) => {
    const documentationRequests: string[] = [];
    page.on('request', request => {
        const payload = `${request.url()}\n${request.postData() ?? ''}`;
        if (payload.includes('system.documentation')) documentationRequests.push(payload);
    });
    const wasmResponsePromise = page.waitForResponse(
        response => new URL(response.url()).pathname === '/assets/clickhouse-parser.wasm',
    );
    await page.goto('/experimental?connection=demo');

    const wasmResponse = await wasmResponsePromise;
    expect(wasmResponse.status()).toBe(200);
    expect(wasmResponse.headers()['content-type']).toMatch(/^application\/wasm/);
    expect(Array.from((await wasmResponse.body()).subarray(0, 4))).toEqual([0, 97, 115, 109]);

    await openWorkspacePanel(page, 'parser');
    await expect(
        page.getByRole('status', { name: 'ClickHouse native parser: Ready' }),
    ).toBeVisible();
    await expect(page.getByRole('status', { name: 'SQL lexer: ClickHouse ready' })).toBeVisible();
    await expect(page.getByText('Syntax valid')).toBeVisible();

    await page.getByRole('button', { name: 'More workspace panels' }).click();
    await page.getByRole('menuitem', { name: 'Reference' }).click();
    await expect(page.getByTestId('reference-source')).toContainText(
        'Offline ClickHouse reference',
    );
    await page.getByTestId('reference-search').fill('MergeTree');
    const mergeTree = page.getByRole('option', { name: /MergeTree Table Engine/ }).first();
    await expect(mergeTree).toBeVisible();
    await mergeTree.click();
    const article = page.getByRole('article', { name: 'Table Engine: MergeTree' });
    await expect(article).toContainText('general-purpose engine');
    await expect(article.locator('.reference-markdown code')).toContainText('ORDER BY');
    await article.getByRole('button', { name: 'Insert name', exact: true }).click();
    await expect(page.locator('.cm-content')).toContainText('MergeTree');
    expect(documentationRequests).toEqual([]);

    await page
        .getByRole('navigation', { name: 'Workspace browser' })
        .getByRole('button', { name: 'Objects' })
        .click();
    await page.getByTestId('schema-search').fill('events');
    const table = page.getByRole('button', { name: 'events MergeTree', exact: true });
    await expect(table).toBeVisible();
    await table.click();

    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const exportDialog = page.getByRole('dialog', { name: 'Export' });
    const exportClose = exportDialog.getByRole('button', { name: 'Close export options' });
    await expect(exportDialog.locator('.dialog-chrome-header')).toHaveCount(1);
    await expect(exportClose).toHaveText('');
    await expect(exportClose.locator('svg')).toBeVisible();
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        exportDialog.getByRole('button', { name: /Export retained rows/ }).click(),
    ]);
    const csv = await readFile(await download.path(), 'utf8');
    expect(csv.split('\r\n')[0]).toContain('day');
    expect(csv).toContain('events');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const [queryDownload] = await Promise.all([
        page.waitForEvent('download'),
        page
            .getByRole('dialog', { name: 'Export' })
            .getByRole('button', { name: /Export query/ })
            .click(),
    ]);
    expect(queryDownload.suggestedFilename()).toMatch(/\.sql$/);
    expect(await readFile(await queryDownload.path(), 'utf8')).toContain('SELECT');
});

test('Static production preview searches native Playground docs with bound query parameters', async ({
    page,
}) => {
    const requests: Array<{ url: string; sql: string }> = [];
    await page.route('https://sql-clickhouse.clickhouse.com:8443/**', async route => {
        const request = route.request();
        const sql = request.postData() ?? '';
        if (!sql.includes('system.documentation')) return route.continue();
        requests.push({ url: request.url(), sql });
        const details = sql.includes('version() AS serverVersion');
        const columns = details
            ? ['name', 'type', 'description', 'source', 'serverVersion']
            : ['name', 'type', 'source'];
        const values = details
            ? [
                  'MergeTree',
                  'Table Engine',
                  'MergeTree docs. Use `ORDER BY` for the sorting key.',
                  'src/Storages/MergeTree',
                  '24.6-test',
              ]
            : ['MergeTree', 'Table Engine', 'src/Storages/MergeTree'];
        const body = [
            JSON.stringify(columns),
            JSON.stringify(columns.map(() => 'String')),
            JSON.stringify(values),
            '',
        ].join('\n');
        await route.fulfill({
            status: 200,
            headers: {
                'content-type': 'text/plain; charset=utf-8',
                'access-control-allow-origin': '*',
            },
            body,
        });
    });

    await page.goto('/experimental');
    await page.getByRole('button', { name: 'More workspace panels' }).click();
    await page.getByRole('menuitem', { name: 'Reference' }).click();
    await page.getByTestId('reference-search').fill('MergeTree');
    const mergeTree = page.getByRole('option', { name: /MergeTree Table Engine/ }).first();
    await expect(mergeTree).toBeVisible();
    await mergeTree.click();
    const article = page.getByRole('article', { name: 'Table Engine: MergeTree' });
    await expect(article).toContainText('MergeTree docs.');
    await expect(article.locator('.reference-markdown code')).toContainText('ORDER BY');
    expect(
        requests.some(
            request =>
                request.sql.includes('{search:String}') &&
                new URL(request.url).searchParams.get('param_search') === 'MergeTree',
        ),
    ).toBe(true);
    expect(
        requests.some(
            request =>
                request.sql.includes('name = {name:String}') &&
                new URL(request.url).searchParams.get('param_name') === 'MergeTree',
        ),
    ).toBe(true);
});

test('Static production preview retries missing source metadata and uses native entries from offline search', async ({
    page,
}) => {
    const requests: string[] = [];
    await page.route('https://sql-clickhouse.clickhouse.com:8443/**', async route => {
        const sql = route.request().postData() ?? '';
        if (!sql.includes('system.documentation')) return route.continue();
        requests.push(sql);
        if (sql.includes(', source')) {
            await route.fulfill({
                status: 500,
                headers: {
                    'content-type': 'text/plain; charset=utf-8',
                    'access-control-allow-origin': '*',
                },
                body: 'Code: 47. DB::Exception: Unknown expression identifier `source` in scope SELECT name, source FROM system.documentation. (UNKNOWN_IDENTIFIER) (version 26.1.0.0)',
            });
            return;
        }
        const details = sql.includes('version() AS serverVersion');
        const columns = details
            ? ['name', 'type', 'description', 'serverVersion']
            : ['name', 'type'];
        const rows = details
            ? [['MergeTree', 'Table Engine', 'Live MergeTree documentation.', '26.1-test']]
            : [];
        const body = [
            JSON.stringify(columns),
            JSON.stringify(columns.map(() => 'String')),
            ...rows.map(row => JSON.stringify(row)),
            '',
        ].join('\n');
        await route.fulfill({
            status: 200,
            headers: {
                'content-type': 'text/plain; charset=utf-8',
                'access-control-allow-origin': '*',
            },
            body,
        });
    });

    await page.goto('/experimental');
    await page.getByRole('button', { name: 'More workspace panels' }).click();
    await page.getByRole('menuitem', { name: 'Reference' }).click();
    await page.getByTestId('reference-search').fill('MergeTree');
    const mergeTree = page.getByRole('option', { name: /MergeTree Table Engine/ }).first();
    await expect(mergeTree).toBeVisible();
    await expect(page.getByTestId('reference-source')).toContainText(
        'Offline ClickHouse reference',
    );
    await mergeTree.click();

    const article = page.getByRole('article', { name: 'Table Engine: MergeTree' });
    await expect(article).toContainText('Live MergeTree documentation.');
    await expect(article.locator('.reference-entry-heading small')).toHaveText(
        'ClickHouse 26.1-test',
    );
    expect(requests.filter(sql => sql.includes(', source')).length).toBeGreaterThanOrEqual(2);
    expect(
        requests.some(sql => sql.includes('name = {name:String}') && !sql.includes(', source')),
    ).toBe(true);
});

test('Playground examples preview real SQL and open a draft without executing it', async ({
    page,
}) => {
    const exampleSqlRequests: string[] = [];
    page.on('request', request => {
        const requestText = `${request.url()}\n${request.postData() ?? ''}`;
        if (
            new URL(request.url()).hostname === 'sql-clickhouse.clickhouse.com' &&
            requestText.includes('toDate(created_at) AS day')
        )
            exampleSqlRequests.push(requestText);
    });
    await page.goto('/experimental');
    const dialog = await openSqlExamples(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('ClickHouse Playground', { exact: true })).toBeVisible();
    await dialog.getByTestId('sql-example-category-openSource').click();
    const dailyActivity = dialog.getByTestId('sql-example-github-daily-activity');
    await expect(dailyActivity).toBeVisible();
    await dailyActivity.click();
    await expect(dialog.locator('.sql-example-preview code')).toContainText('FROM github.events');
    await dialog.getByTestId('open-sql-example').click();

    await expect(
        page.getByRole('tab', { name: 'Daily activity.sql', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.cm-content')).toContainText('FROM github.events');
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'ready');
    await expect(page.locator('.execution-bar')).not.toHaveAttribute('data-query-id');
    expect(exampleSqlRequests).toEqual([]);
});

test('Restoring a draft with an unavailable run keeps its SQL without an error toast', async ({
    page,
}) => {
    await page.addInitScript(
        ({ workspaceKey, runId }) => {
            if (sessionStorage.getItem('clickstudio:seeded-missing-run')) return;
            const draftId = 'restored-stale-result';
            localStorage.setItem(
                workspaceKey,
                JSON.stringify({
                    version: 1,
                    activeId: draftId,
                    tabs: [
                        {
                            id: draftId,
                            name: 'Recovered query.sql',
                            sql: 'SELECT 42 AS preserved_query',
                            parameters: {},
                            chart: { kind: 'table', x: 0, ys: [], title: 'Query result' },
                            runIds: [runId],
                            activeRunId: runId,
                            checkpoints: [],
                            from: 0,
                            to: 0,
                            kind: 'query',
                            dependencies: [],
                        },
                    ],
                }),
            );
            sessionStorage.setItem('clickstudio:seeded-missing-run', 'true');
        },
        { workspaceKey: 'clickstudio:workspace:playground:v1', runId: 'missing-retained-run' },
    );

    await page.goto('/experimental?connection=playground');
    await expect(page.locator('.cm-content')).toContainText('SELECT 42 AS preserved_query');
    await expect
        .poll(() =>
            page.evaluate(() => {
                const workspace = JSON.parse(
                    localStorage.getItem('clickstudio:workspace:playground:v1') ?? 'null',
                );
                return workspace?.tabs.find((tab: { id: string }) => tab.id === workspace.activeId)
                    ?.activeRunId;
            }),
        )
        .toBeUndefined();
    await expect(
        page
            .getByRole('alert')
            .filter({ hasText: 'This retained run is no longer available in this browser.' }),
    ).toHaveCount(0);

    await page.reload();
    await expect(page.locator('.cm-content')).toContainText('SELECT 42 AS preserved_query');
    await expect(
        page
            .getByRole('alert')
            .filter({ hasText: 'This retained run is no longer available in this browser.' }),
    ).toHaveCount(0);
});

for (const connectionId of ['demo', 'clickhouse-cloud']) {
    test(`Browser ${connectionId} drafts remain runnable after their saved document disappears`, async ({
        page,
    }) => {
        const workspaceKey = `clickstudio:workspace:${connectionId}:v1`;
        const sql = 'SELECT 42 AS preserved_query';
        await page.addInitScript(
            ({ workspaceKey, sql }) => {
                if (sessionStorage.getItem('clickstudio:seeded-browser-recovery')) return;
                localStorage.setItem(
                    workspaceKey,
                    JSON.stringify({
                        version: 1,
                        activeId: 'recovered-browser-query',
                        tabs: [
                            {
                                id: 'recovered-browser-query',
                                name: 'Recovered browser query.sql',
                                sql,
                                serverId: 'missing-browser-document',
                                baseRevision: 3,
                                parameters: {},
                                chart: { kind: 'table', x: 0, ys: [], title: 'Query result' },
                                runIds: [],
                                checkpoints: [],
                                from: 0,
                                to: 0,
                                kind: 'query',
                                dependencies: [],
                            },
                        ],
                    }),
                );
                sessionStorage.setItem('clickstudio:seeded-browser-recovery', 'true');
            },
            { workspaceKey, sql },
        );
        if (connectionId === 'clickhouse-cloud') {
            await mockCloudEndpoint(page);
            await page.route('**/api/cloud', route => {
                const body = jsonRecord(route.request().postDataJSON());
                return body.action === 'run'
                    ? route.fulfill({
                          json: {
                              queryId: body.queryId,
                              columns: [{ name: 'preserved_query', type: 'UInt8' }],
                              rows: [[42]],
                              elapsedMs: 1,
                              bytes: 1,
                              truncated: false,
                          },
                      })
                    : route.fallback();
            });
        }
        await page.goto('/experimental?connection=demo');
        if (connectionId === 'clickhouse-cloud') await connectPreviewCloud(page);
        await expect(page.locator('.cm-content')).toHaveText(sql);
        await page.getByTestId('run-button').click();
        await expect(page.locator('.execution-bar')).toHaveAttribute(
            'data-run-status',
            'succeeded',
        );
        await expect(page.getByRole('alert')).toHaveCount(0);
        const restored = await page.evaluate(workspaceKey => {
            const workspace = JSON.parse(localStorage.getItem(workspaceKey) ?? 'null');
            return workspace.tabs.find((tab: { id: string }) => tab.id === workspace.activeId);
        }, workspaceKey);
        expect(restored).toMatchObject({
            sql,
            serverId: 'missing-browser-document',
            baseRevision: 3,
        });
    });
}

test('Charts filter opens a chart example in a new SQL tab without executing it', async ({
    page,
}) => {
    const exampleSqlRequests: string[] = [];
    page.on('request', request => {
        const requestText = `${request.url()}\n${request.postData() ?? ''}`;
        if (
            new URL(request.url()).hostname === 'sql-clickhouse.clickhouse.com' &&
            requestText.includes('toStartOfMonth(datetime) AS month')
        )
            exampleSqlRequests.push(requestText);
    });

    await page.goto('/experimental');
    const dialog = await openSqlExamples(page);
    await dialog.getByTestId('sql-example-category-charts').click();

    const forexExample = dialog.getByTestId('sql-example-forex-eur-usd-monthly');
    await expect(forexExample).toBeVisible();
    await forexExample.click();
    await expect(dialog.locator('.sql-example-preview')).toContainText('Forex');
    await expect(dialog.locator('.sql-example-preview code')).toContainText('FROM forex.forex');
    await expect(dialog.locator('.sql-example-readonly')).toHaveText('Line chart');
    await dialog.getByTestId('open-sql-example').click();

    await expect(
        page.getByRole('tab', { name: 'EUR/USD monthly midpoint.sql', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.cm-content')).toContainText('FROM forex.forex');
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'ready');
    expect(exampleSqlRequests).toEqual([]);
});

test('Static preview includes materialized views and storage activity in sample mode', async ({
    page,
}) => {
    await page.goto('/experimental?connection=demo');
    await page
        .getByRole('navigation', { name: 'Workspace browser' })
        .getByRole('button', { name: 'Objects' })
        .click();
    await page.getByRole('button', { name: 'View dependencies', exact: true }).click();
    const graph = page.getByRole('dialog', { name: 'Materialized view dependencies', exact: true });
    await expect(graph).toContainText('SAMPLE DATA');
    await expect(graph.locator('.native-lineage-node')).toHaveCount(5);
    await expect(graph.locator('.native-lineage-node rect').first()).toHaveCSS('rx', '4px');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'events MergeTree', exact: true }).click();
    await page.getByRole('button', { name: 'Visualize parts', exact: true }).click();
    const storage = page.getByRole('dialog', { name: 'MergeTree parts', exact: true });
    await storage.getByRole('button', { name: 'Merges', exact: true }).click();
    await expect(storage).toContainText('67%');
    await expect(storage).toContainText('SAMPLE DATA');
});

test('Geo SQL example runs native Point values and renders twenty cities', async ({ page }) => {
    const pointQueries: string[] = [];
    await page.route('https://sql-clickhouse.clickhouse.com:8443/**', async route => {
        const sql = route.request().postData() ?? '';
        if (sql.includes('::Point')) {
            pointQueries.push(sql);
            const rows = GEO_HELP_CITIES.map(({ city, longitude, latitude, events }) => [
                city,
                `(${longitude},${latitude})`,
                String(events),
            ]);
            const body = [['city', 'location', 'events'], ['String', 'Point', 'UInt64'], ...rows]
                .map(row => JSON.stringify(row))
                .join('\n');
            await route.fulfill({ body: `${body}\n`, contentType: 'text/plain' });
        } else if (sql.includes('SELECT version() AS version')) {
            await route.fulfill({
                body: '["version"]\n["String"]\n["26.6.1.2326"]\n',
                contentType: 'text/plain',
            });
        } else {
            await route.fulfill({ body: '[]\n[]\n', contentType: 'text/plain' });
        }
    });
    await page.goto('/experimental');
    await page.getByRole('button', { name: 'Help', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Explore ClickHouse Playground', exact: true });
    await dialog.getByTestId('help-section-examples').click();
    await dialog.getByTestId('sql-example-category-all').click();
    await dialog.getByRole('option', { name: /^Native Point cities / }).click();
    await expect(dialog.locator('.sql-example-preview code')).toContainText(
        '(13.405, 52.52)::Point',
    );
    await dialog.getByTestId('chart-sql-example').click();

    await expect(
        page.getByRole('tab', { name: 'Native Point cities.sql', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'succeeded', {
        timeout: 30_000,
    });
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await expect(results.getByRole('combobox', { name: 'Type', exact: true })).toContainText(
        'Geography',
    );
    await expect(page.locator('.geo-map')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.geo-feature.geo-point')).toHaveCount(20);
    await expect(page.locator('.geo-map-caption')).toContainText('20 valid features');
    expect(pointQueries).toHaveLength(1);
    expect(pointQueries[0]).toContain('::Point AS location');
    await expect(
        page.getByText(
            'No returned rows contain valid longitude/latitude geometry for this selection.',
            { exact: true },
        ),
    ).toHaveCount(0);
});

test('ClickHouse Cloud import maps and inserts into an existing table without typed confirmation', async ({
    page,
}) => {
    const imports = await mockCloudEndpoint(page);
    await connectPreviewCloud(page);
    await page.getByRole('button', { name: 'Import', exact: true }).last().click();

    const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await dialog.getByLabel('Choose a CSV, JSON, or NDJSON file').setInputFiles({
        name: 'events.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('day,events\n2026-09-27,10\n2026-09-28,20\n'),
    });
    await dialog.getByRole('button', { name: 'Read file and continue' }).click();
    await expect(dialog).toContainText('2 rows · 2 columns · CSV');
    const mappingStep = dialog.getByRole('region', { name: 'Map source columns' });
    await expect(mappingStep).toHaveCSS('row-gap', '15px');
    await chooseExistingCloudTable(dialog);
    await expect(dialog.getByRole('radio', { name: /Add to a table/ })).toBeChecked();
    await expect(
        dialog.getByRole('combobox', { name: 'Map day to destination', exact: true }),
    ).toHaveAttribute('data-value', 'day');
    await dialog.getByRole('button', { name: 'Review import' }).click();
    await dialog.getByRole('button', { name: 'Import rows', exact: true }).click();

    await expect(dialog).toContainText('2 source rows processed successfully');
    expect(imports).toHaveLength(1);
    expect(imports[0]).toContain('name="file"; filename="events.csv"');
    expect(imports[0]).not.toContain('name="confirmation"');
    expect(imports[0]).toContain('name="fields"\r\n\r\n{"day":"day","events":"events"}');
});

test('ClickHouse Cloud import requires an exact table before review', async ({ page }) => {
    const imports = await mockCloudEndpoint(page);
    await connectPreviewCloud(page);
    await page.getByRole('button', { name: 'Import', exact: true }).last().click();

    const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await dialog.getByLabel('Choose a CSV, JSON, or NDJSON file').setInputFiles({
        name: 'events.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('day,events\n2026-09-28,20\n'),
    });
    await dialog.getByRole('button', { name: 'Read file and continue' }).click();

    const existing = dialog.getByRole('radio', { name: /Add to a table/ });
    const create = dialog.getByRole('radio', { name: /Create a table/ });
    await expect(existing).toBeChecked();
    await expect(create).not.toBeChecked();
    await expect(
        dialog.getByRole('combobox', { name: 'Import target table', exact: true }),
    ).toHaveAttribute('data-value', '');
    await expect(dialog.locator('.import-mapping-empty-state')).toContainText('Choose a table');
    await expect(
        dialog.getByRole('button', { name: 'Choose a table', exact: true }),
    ).toBeDisabled();

    await existing.check();
    await expect(
        dialog.getByRole('combobox', { name: 'Import target table', exact: true }),
    ).toHaveAttribute('data-value', '');
    await chooseImportOption(
        dialog.getByRole('combobox', { name: 'Import target table', exact: true }),
        'default.events',
    );
    await expect(
        dialog.getByRole('combobox', { name: 'Map day to destination', exact: true }),
    ).toHaveAttribute('data-value', 'day');
    await expect(dialog.getByRole('button', { name: 'Review import', exact: true })).toBeEnabled();
    expect(imports).toHaveLength(0);
});

test('ClickHouse Cloud import explains when no source columns are mapped', async ({ page }) => {
    await mockCloudEndpoint(page);
    await connectPreviewCloud(page);
    await page.getByRole('button', { name: 'Import', exact: true }).last().click();

    const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await dialog.getByLabel('Choose a CSV, JSON, or NDJSON file').setInputFiles({
        name: 'clickstudio-json-export.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('event_id,message,active,id\n1,hello,true,42\n'),
    });
    await dialog.getByRole('button', { name: 'Read file and continue' }).click();
    await chooseExistingCloudTable(dialog);

    const mappingStep = dialog.getByRole('region', { name: 'Map source columns' });
    const mappingCounts = mappingStep.locator('.import-mapping-counts');
    const emptyState = mappingStep.getByRole('status');
    await expect(mappingCounts).toContainText('0 mapped');
    await expect(mappingCounts).toContainText('4 skipped');
    await expect(emptyState).toContainText('No columns mapped yet');
    await expect(emptyState).toContainText('Skipped columns will not be imported.');
    await expect(emptyState).toContainText('Create a table');
    for (const source of ['event_id', 'message', 'active', 'id']) {
        await expect(
            dialog.getByRole('combobox', { name: `Map ${source} to destination`, exact: true }),
        ).toHaveAttribute('data-value', '');
    }
    await expect(
        dialog.getByRole('button', { name: 'Map a column first', exact: true }),
    ).toBeDisabled();

    await chooseImportOption(
        dialog.getByRole('combobox', { name: 'Map message to destination', exact: true }),
        'day',
    );
    await expect(mappingCounts).toContainText('1 mapped');
    await expect(mappingCounts).toContainText('3 skipped');
    await expect(emptyState).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Review import', exact: true })).toBeEnabled();
});

test('ClickHouse Cloud import creates a table with editable inferred columns', async ({ page }) => {
    const imports = await mockCloudEndpoint(page, 'success', {
        ...previewCloudSchema,
        databases: ['default', 'analytics'],
    });
    await connectPreviewCloud(page);
    await page.getByRole('button', { name: 'Import', exact: true }).last().click();

    const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await dialog.getByLabel('Choose a CSV, JSON, or NDJSON file').setInputFiles({
        name: 'interview events.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('day,events\n2026-09-27,10\n2026-09-28,20\n'),
    });
    await dialog.getByRole('button', { name: 'Read file and continue' }).click();
    await dialog.getByRole('radio', { name: /Create a table/ }).check();
    await expect(dialog.getByLabel('New table name')).toHaveValue('interview_events');
    await expect(
        dialog.getByRole('combobox', { name: 'Type for day', exact: true }),
    ).toHaveAttribute('data-value', 'Date');
    await expect(
        dialog.getByRole('combobox', { name: 'Type for events', exact: true }),
    ).toHaveAttribute('data-value', 'UInt64');
    const database = dialog.getByRole('combobox', { name: 'New table database', exact: true });
    await chooseImportOption(database, 'analytics');
    await chooseImportOption(database, 'default');
    await chooseImportOption(
        dialog.getByRole('combobox', { name: 'Type for events', exact: true }),
        'String',
    );
    await expect(dialog.getByRole('checkbox', { name: /Add a generated id/ })).toBeChecked();
    await dialog.getByLabel('New table name').fill('interview_events');
    const mappingCounts = dialog.locator('.import-mapping-counts');
    await expect(mappingCounts).toContainText('2 mapped');
    await expect(mappingCounts).toContainText('0 skipped');
    await dialog.getByLabel('New column name for day').fill('event_day');
    await dialog.getByRole('button', { name: 'Review import' }).click();
    await expect(
        dialog.getByRole('heading', { name: 'Ready to import into default.interview_events' }),
    ).toBeVisible();
    await expect(dialog.locator('.import-review-metrics')).toContainText('2 rows');
    const generatedIdRow = dialog.getByRole('row', { name: /Generated id/ });
    await expect(generatedIdRow).toContainText('ClickHouse');
    await expect(generatedIdRow).toContainText('UInt64');
    await dialog.getByRole('button', { name: 'Create table and import' }).click();

    await expect(dialog).toContainText('2 source rows processed successfully');
    const createTable = imports[0]?.match(/name="createTable"\r\n\r\n([^\r\n]+)/)?.[1];
    expect(createTable).toBeTruthy();
    expect(JSON.parse(createTable!)).toMatchObject({
        name: 'interview_events',
        generateId: true,
        columns: [
            { source: 'day', name: 'event_day', type: 'Date' },
            { source: 'events', name: 'events', type: 'String' },
        ],
    });
});

test('ClickHouse Cloud import refreshes and reveals the created table', async ({ page }) => {
    let schemaRefreshesAfterImport = 0;
    await mockCloudEndpoint(
        page,
        'success',
        { ...previewCloudSchema, tables: [], columns: [] },
        () => {
            schemaRefreshesAfterImport++;
        },
    );
    await connectPreviewCloud(page);
    await page.getByRole('button', { name: 'Import', exact: true }).last().click();

    const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await dialog.getByLabel('Choose a CSV, JSON, or NDJSON file').setInputFiles({
        name: 'interview events.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('day,events\n2026-09-27,10\n'),
    });
    await dialog.getByRole('button', { name: 'Read file and continue' }).click();
    await dialog.getByRole('radio', { name: /Create a table/ }).check();
    await dialog.getByRole('button', { name: 'Review import' }).click();
    await dialog.getByRole('button', { name: 'Create table and import' }).click();
    await expect(dialog).toContainText('1 source row processed successfully');
    await expect.poll(() => schemaRefreshesAfterImport).toBeGreaterThan(0);

    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('region', { name: 'Selected object' })).toContainText(
        'default.interview_events',
    );
    await page.locator('.object-back-button').click();
    await expect(
        page.getByRole('button', { name: 'interview_events MergeTree', exact: true }),
    ).toBeVisible();
});

test('ClickHouse Cloud insert row leaves defaulted columns out and needs no typed confirmation', async ({
    page,
}) => {
    const cloudSchema = {
        ...previewCloudSchema,
        columns: [
            ...previewCloudSchema.columns,
            {
                database: 'default',
                table: 'events',
                name: 'created_at',
                type: 'DateTime',
                defaultKind: 'DEFAULT',
                comment: '',
            },
        ],
    };
    const imports = await mockCloudEndpoint(page, 'success', cloudSchema);
    await connectPreviewCloud(page);
    await page
        .getByRole('navigation', { name: 'Workspace browser' })
        .getByRole('button', { name: 'Objects' })
        .click();
    await page.getByRole('button', { name: 'events MergeTree', exact: true }).click();
    const details = page.getByRole('region', { name: 'Selected object', exact: true });
    await details.getByRole('button', { name: 'Insert row', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Insert row', exact: true });
    await dialog.getByLabel('day').fill('2026-09-28');
    await dialog.getByLabel('events').fill('12');
    await dialog.getByRole('button', { name: 'Review row' }).click();
    await expect(dialog.locator('pre')).toContainText('"day": "2026-09-28"');
    await expect(dialog.locator('pre')).not.toContainText('created_at');
    await dialog.getByRole('button', { name: 'Insert row', exact: true }).click();

    await expect(dialog).toContainText(
        'ClickHouse acknowledged an insert request containing one row for default.events',
    );
    expect(imports).toHaveLength(1);
    expect(imports[0]).not.toContain('name="confirmation"');
    expect(imports[0]).toContain('name="fields"\r\n\r\n{"day":"day","events":"events"}');
    const row = imports[0]!.match(
        /name="file"; filename="insert-row\.json"\r\nContent-Type: [^\r\n]+\r\n\r\n([\s\S]*?)\r\n--/,
    )?.[1];
    expect(JSON.parse(row!)).toEqual([{ day: '2026-09-28', events: '12' }]);
});

test('Insert row validates each field before Review and allows empty String values', async ({
    page,
}) => {
    const columns = (
        [
            ['event_id', 'UInt64'],
            ['event_time', 'DateTime'],
            ['event_name', 'LowCardinality(String)'],
            ['event_count', 'UInt64'],
        ] as const
    ).map(([name, type]) => ({
        database: 'default',
        table: 'events',
        name,
        type,
        defaultKind: '',
        comment: '',
    }));
    const imports = await mockCloudEndpoint(page, 'success', {
        ...previewCloudSchema,
        columns,
    });
    await connectPreviewCloud(page);
    await page
        .getByRole('navigation', { name: 'Workspace browser' })
        .getByRole('button', { name: 'Objects' })
        .click();
    await page.getByRole('button', { name: 'events MergeTree', exact: true }).click();
    await page
        .getByRole('region', { name: 'Selected object', exact: true })
        .getByRole('button', { name: 'Insert row', exact: true })
        .click();
    const dialog = page.getByRole('dialog', { name: 'Insert row', exact: true });
    const eventId = dialog.getByLabel('event_id', { exact: true });
    const eventTime = dialog.getByLabel('event_time', { exact: true });
    const eventName = dialog.getByLabel('event_name', { exact: true });
    const eventCount = dialog.getByLabel('event_count', { exact: true });
    await expect(dialog).not.toContainText('Required columns are included.');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(eventCount).toBeVisible();
    const readLayout = () =>
        dialog.evaluate(element =>
            Array.from(
                element.querySelectorAll('.insert-row-column, .table-action-dialog-footer'),
            ).map(child => {
                const { y, height } = child.getBoundingClientRect();
                return { y, height };
            }),
        );
    const initialLayout = await readLayout();
    expect(initialLayout).toHaveLength(5);
    await eventId.focus();
    await eventId.press('Tab');
    await expect(eventId).toHaveAccessibleDescription('Enter a value.');
    await expect.poll(readLayout).toEqual(initialLayout);

    await dialog.getByRole('button', { name: 'Review row' }).click();
    await expect(eventId).toBeFocused();
    await expect(dialog.getByRole('alert')).toHaveCount(3);
    await expect.poll(readLayout).toEqual(initialLayout);
    await expect(eventName).toHaveAttribute('aria-invalid', 'false');
    await expect(dialog.locator('pre')).toHaveCount(0);
    expect(imports).toHaveLength(0);

    await eventId.fill('-1');
    await expect(eventId).toHaveAccessibleDescription('Enter zero or a positive whole number.');
    await eventId.fill('18446744073709551616');
    await expect(eventId).toHaveAccessibleDescription('Value is outside the UInt64 range.');
    await eventId.fill('18446744073709551615');
    await expect(eventId).toHaveAttribute('aria-invalid', 'false');
    await eventTime.fill('2026-02-30 12:00:00');
    await expect(eventTime).toHaveAccessibleDescription(
        'Enter a valid date and time in YYYY-MM-DD HH:mm:ss format.',
    );
    await expect.poll(readLayout).toEqual(initialLayout);
    const errorBounds = await eventTime.evaluate(input => {
        const row = input.closest('.insert-row-column');
        const error = row?.querySelector('.insert-row-column-error');
        if (!row || !error) throw new Error('Expected a field row with a validation error.');
        return {
            inputBottom: input.getBoundingClientRect().bottom,
            errorTop: error.getBoundingClientRect().top,
            errorBottom: error.getBoundingClientRect().bottom,
            rowBottom: row.getBoundingClientRect().bottom,
        };
    });
    expect(errorBounds.errorTop).toBeGreaterThanOrEqual(errorBounds.inputBottom);
    expect(errorBounds.errorBottom).toBeLessThanOrEqual(errorBounds.rowBottom - 1);
    await eventTime.fill('2024-02-29 12:00:00');
    await eventCount.fill('12.5');
    await expect(eventCount).toHaveAccessibleDescription('Enter a number.');
    await eventCount.fill('0');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect.poll(readLayout).toEqual(initialLayout);
    await dialog.getByRole('button', { name: 'Review row' }).click();
    await expect(dialog.locator('pre')).toContainText('"event_id": "18446744073709551615"');
    await expect(dialog.locator('pre')).toContainText('"event_name": ""');
    await dialog.getByRole('button', { name: 'Insert row', exact: true }).click();
    await expect(dialog).toContainText(
        'ClickHouse acknowledged an insert request containing one row for default.events',
    );
    expect(imports).toHaveLength(1);
    expect(imports[0]).toContain('"event_name":""');
});

test('ClickHouse Cloud can create a table from a file when no tables exist', async ({ page }) => {
    const imports = await mockCloudEndpoint(page, 'success', {
        ...previewCloudSchema,
        tables: [],
        columns: [],
    });
    await connectPreviewCloud(page);
    await page.getByRole('button', { name: 'Import', exact: true }).last().click();

    const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await dialog.getByLabel('Choose a CSV, JSON, or NDJSON file').setInputFiles({
        name: 'events.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('event,count\npurchase,2\n'),
    });
    await expect(dialog.getByRole('button', { name: 'Read file and continue' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Read file and continue' }).click();

    await expect(dialog.getByRole('radio', { name: /Add to a table/ })).toBeDisabled();
    const create = dialog.getByRole('radio', { name: /Create a table/ });
    await expect(create).not.toBeChecked();
    await create.check();
    await expect(create).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: /Add a generated id/ })).toBeChecked();
    await dialog.getByRole('button', { name: 'Review import' }).click();
    await dialog.getByRole('button', { name: 'Create table and import' }).click();

    await expect(dialog).toContainText('1 source row processed successfully');
    expect(imports).toHaveLength(1);
    const createTable = imports[0]?.match(/name="createTable"\r\n\r\n([^\r\n]+)/)?.[1];
    expect(JSON.parse(createTable!)).toMatchObject({ name: 'events', generateId: true });
});

test('ClickHouse Cloud import flags invalid mappings before review and inspects unknown imports', async ({
    page,
}) => {
    const schemaWithId = {
        ...previewCloudSchema,
        columns: [
            ...previewCloudSchema.columns.map(column =>
                column.name === 'day' ? { ...column, type: 'Nullable(Date)' } : column,
            ),
            {
                database: 'default',
                table: 'events',
                name: 'id',
                type: 'UInt64',
                defaultKind: 'DEFAULT',
                comment: '',
            },
        ],
    };
    const imports = await mockCloudEndpoint(page, 'unknown', schemaWithId);
    await connectPreviewCloud(page);
    await page.getByRole('button', { name: 'Import', exact: true }).last().click();

    const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await dialog.getByLabel('Choose a CSV, JSON, or NDJSON file').setInputFiles({
        name: 'events.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('day,events\n2026-01-01,20\n'),
    });
    await dialog.getByRole('button', { name: 'Read file and continue' }).click();
    await chooseExistingCloudTable(dialog);
    const dayMapping = dialog.getByRole('combobox', {
        name: 'Map day to destination',
        exact: true,
    });
    await dayMapping.focus();
    await chooseImportOption(dayMapping, 'id');

    const mappingError = dialog.locator('#import-mapping-error-0');
    await expect(mappingError).toContainText(
        'Input row 1: "day" value "2026-01-01" cannot be inserted into "id" (UInt64).',
    );
    await expect(dayMapping).toHaveAttribute('aria-invalid', 'true');
    await expect(dayMapping).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Fix column mapping' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Import rows', exact: true })).toHaveCount(0);
    expect(imports).toHaveLength(0);

    await chooseImportOption(dayMapping, 'day');
    await expect(mappingError).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Review import' }).click();
    await dialog.getByRole('button', { name: 'Import rows', exact: true }).click();

    await expect(dialog).toContainText('ClickHouse couldn’t confirm the rows in default.events.');
    await expect(dialog).toContainText(
        'ClickHouse could not confirm the insert. The rows may already be there.',
    );
    await expect(dialog.getByRole('button', { name: 'Open table to inspect' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Check status' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /Rows missing/ })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Forget import and continue' })).toHaveCount(0);
    expect(imports).toHaveLength(1);

    await dialog.getByRole('button', { name: 'Open table to inspect' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('region', { name: 'Selected object' })).toContainText(
        'default.events',
    );
    await expect(
        page.getByText(
            'Import not confirmed. Check the rows in “default.events” before importing again.',
        ),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Import', exact: true }).last().click();
    await expect(dialog).toContainText(
        'ClickHouse could not confirm the insert. The rows may already be there.',
    );
    await expect(
        dialog.getByRole('button', { name: 'I checked; the rows are there' }),
    ).toBeVisible();
    await expect(dialog.getByRole('button', { name: /retry|rows missing/i })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Check status' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'I checked; the rows are there' }).click();
    await expect(dialog.locator('.import-status-card.is-success')).toContainText(
        'You confirmed the imported rows in default.events',
    );
    await expect(dialog.getByRole('button', { name: 'Import another file' })).toBeVisible();
    expect(imports).toHaveLength(1);
});

test('ClickHouse Cloud import can be confirmed after the user checks the selected table', async ({
    page,
}) => {
    const imports = await mockCloudEndpoint(page, 'unknown');
    await connectPreviewCloud(page);
    await page.getByRole('button', { name: 'Import', exact: true }).last().click();

    const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await dialog.getByLabel('Choose a CSV, JSON, or NDJSON file').setInputFiles({
        name: 'events.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('day,events\n2026-09-28,20\n'),
    });
    await dialog.getByRole('button', { name: 'Read file and continue' }).click();
    await chooseExistingCloudTable(dialog);
    await dialog.getByRole('button', { name: 'Review import' }).click();
    await dialog.getByRole('button', { name: 'Import rows', exact: true }).click();
    await dialog.getByRole('button', { name: 'Open table to inspect' }).click();
    await expect(dialog).not.toBeVisible();

    await page.getByRole('button', { name: 'Import', exact: true }).last().click();
    await dialog.getByRole('button', { name: 'I checked; the rows are there' }).click();
    await expect(dialog.locator('.import-status-card.is-success')).toContainText(
        'You confirmed the imported rows in default.events',
    );
    expect(imports).toHaveLength(1);
});

test('ClickHouse Cloud import can be closed and forgotten so another file can be imported', async ({
    page,
}) => {
    const imports = await mockCloudEndpoint(page, 'running');
    await connectPreviewCloud(page);
    await page.getByRole('button', { name: 'Import', exact: true }).last().click();

    let dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await dialog.getByLabel('Choose a CSV, JSON, or NDJSON file').setInputFiles({
        name: 'stuck.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('day,events\n2026-09-27,10\n2026-09-28,20\n'),
    });
    await dialog.getByRole('button', { name: 'Read file and continue' }).click();
    await chooseExistingCloudTable(dialog);
    await dialog.getByRole('button', { name: 'Review import' }).click();
    await dialog.getByRole('button', { name: 'Import rows', exact: true }).click();
    await expect(dialog).toContainText('ClickHouse still reports this import as active.');
    await expect(dialog.getByRole('button', { name: 'Close import wizard' })).toBeEnabled();

    await dialog.getByRole('button', { name: 'Close import wizard' }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole('button', { name: 'Import', exact: true }).last().click();
    dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await expect(dialog).toContainText('ClickHouse still reports this import as active.');
    await dialog.getByRole('button', { name: 'Forget import and continue' }).click();

    await dialog.getByLabel('Choose a CSV, JSON, or NDJSON file').setInputFiles({
        name: 'other.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('day,events\n2026-09-29,30\n'),
    });
    await dialog.getByRole('button', { name: 'Read file and continue' }).click();
    await chooseExistingCloudTable(dialog);
    await dialog.getByRole('button', { name: 'Review import' }).click();
    await dialog.getByRole('button', { name: 'Import rows', exact: true }).click();

    await expect(dialog).toContainText('1 source row processed successfully');
    expect(imports).toHaveLength(2);
    expect(imports[0]).toContain('filename="stuck.csv"');
    expect(imports[1]).toContain('filename="other.csv"');
});

const movieRatings = [
    [1980, 5.58, 781],
    [1990, 5.33, 1136],
    [2004, 6.22, 1138],
];

for (const mode of ['Standard', 'Experimental']) {
    test(`${mode} movie ratings open as a trend and scatter uses readable year axes`, async ({
        page,
    }, info) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        let queryCount = 0;
        await page.route('https://sql-clickhouse.clickhouse.com:8443/**', async route => {
            const sql = route.request().postData() ?? '';
            let body = '[]\n[]\n';
            if (sql.includes('FROM imdb.movies')) {
                queryCount++;
                body =
                    [
                        ['year', 'average_rating', 'rated_movies'],
                        ['UInt32', 'Float64', 'UInt64'],
                        ...movieRatings,
                    ]
                        .map(row => JSON.stringify(row))
                        .join('\n') + '\n';
            }
            await route.fulfill({ body, contentType: 'text/plain' });
        });
        await page.goto(`${workspacePath(mode)}?connection=playground`);
        const dialog = await openSqlExamples(page);
        await dialog.getByTestId('sql-example-category-datasets').click();
        await dialog.getByTestId('sql-example-imdb-ratings-by-year').click();
        await expect(dialog.locator('.sql-example-preview code')).toContainText('rated_movies');
        await dialog.getByTestId('open-sql-example').click();
        expect(queryCount).toBe(0);
        await runButton(page).click();
        const results = page.getByRole('region', { name: 'Query results', exact: true });
        await expect(
            results.getByRole('columnheader', { name: 'rated_movies UInt64' }),
        ).toBeVisible();
        await results.getByRole('tab', { name: 'Chart', exact: true }).click();
        await expect(results.locator('.chart-line')).toHaveCount(1);
        await expect(results.locator('.chart-point')).toHaveCount(movieRatings.length);
        const labels = results.locator('.chart-x-labels text');
        await expect(labels.first().locator('title')).toHaveText('1980');
        await expect(labels.last().locator('title')).toHaveText('2004');
        await chooseChartOption(
            page,
            results.getByRole('combobox', { name: 'Type', exact: true }),
            'scatter',
        );
        await expect(labels).toHaveCount(3);
        await expect(labels.first()).toContainText('1980');
        await expect(labels.last()).toContainText('2004');
        for (const width of [1440, 900]) {
            await page.setViewportSize({ width, height: 900 });
            await expect
                .poll(() =>
                    results.locator('.chart-canvas svg').evaluate(svg => {
                        const points = [...svg.querySelectorAll('circle')];
                        const xs = points.map(point => Number(point.getAttribute('cx')));
                        const ys = points.map(point => Number(point.getAttribute('cy')));
                        const grids = [...svg.querySelectorAll('.chart-gridline')];
                        const grid = grids[0]!;
                        const gridYs = grids.map(line => Number(line.getAttribute('y1')));
                        const plotHeight = Math.max(...gridYs) - Math.min(...gridYs);
                        const plotWidth =
                            Number(grid.getAttribute('x2')) - Number(grid.getAttribute('x1'));
                        return Math.min(
                            (Math.max(...xs) - Math.min(...xs)) / plotWidth,
                            (Math.max(...ys) - Math.min(...ys)) / plotHeight,
                        );
                    }),
                )
                .toBeGreaterThan(0.95);
        }
        await results.screenshot({ path: info.outputPath('movie-ratings-scatter.png') });
        expect(queryCount).toBe(1);
    });
}

test('Compressed SELECT 1 link opens an editable draft without executing', async ({ page }) => {
    let postedExecutions = 0;
    page.on('request', request => {
        if (
            request.method() === 'POST' &&
            ['/api/runs', '/api/scripts'].includes(new URL(request.url()).pathname)
        )
            postedExecutions++;
    });
    await page.goto('/?connection=demo#sqlz=v1.C3b1cXUOUTAEAA');
    await expect(page.getByRole('textbox', { name: 'SQL document name' })).toHaveValue(
        'Shared SQL.sql',
    );
    await expect(page.locator('.cm-content')).toContainText('SELECT 1');
    await expect(page).toHaveURL(/\/\?connection=demo$/);
    expect(postedExecutions).toBe(0);
    await page.reload();
    await expect(page.locator('.cm-content')).toContainText('SELECT 1');
});

test('Share button copies a portable SQL-only link', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/?connection=demo');
    await openBlankSql(page);
    const sql = "SELECT 'Grüße 🐱' AS greeting";
    await replaceSql(page, sql);
    const originalName = await page
        .getByRole('textbox', { name: 'SQL document name' })
        .inputValue();
    const shareButton = page.getByTestId('share-sql');
    await expect(shareButton).toHaveAttribute('aria-label', 'Share SQL');
    await expect(shareButton).toHaveText('');
    await expect(shareButton).toHaveCSS('width', '30px');
    await expect(shareButton.locator('svg')).toBeVisible();
    await shareButton.click();
    await expect(shareButton).toHaveAttribute('aria-label', 'Link copied');
    await expect(shareButton).toHaveAttribute('data-copied', 'true');
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toContain('#sqlz=v1.');
    expect(new URL(link).search).toBe('');
    const recipient = await context.newPage();
    try {
        await recipient.goto(link);
        await expect(recipient.locator('.cm-content')).toContainText(sql);
        await expect(recipient.getByRole('textbox', { name: 'SQL document name' })).toHaveValue(
            originalName,
        );
        await expect(recipient).not.toHaveURL(/#sqlz=/);
    } finally {
        await recipient.close();
    }
});
