import { workspacePath, setWorkspaceMode } from './helpers.js';
import { test, expect, type Page, type Route } from '@playwright/test';
import { jsonRecord } from '../helpers/type-guards.js';

const schema = {
    connectionId: 'live',
    fetchedAt: '2026-09-23T00:00:00.000Z',
    tables: [
        {
            database: 'analytics',
            name: 'events',
            engine: 'MergeTree',
            orderBy: '(tenant_id, day)',
            primaryKey: 'tenant_id, day',
            partitionKey: 'toYYYYMM(day)',
            samplingKey: 'tenant_id',
            ttlConfigured: true,
            rowEstimate: '1200000',
            sizeBytes: '1610612736',
            uncompressedBytes: '4294967296',
            parts: '20',
            activeParts: '18',
            projections: [{ name: 'by_day', type: 'Normal', sortingKey: 'day' }],
            skipIndexes: [
                {
                    name: 'tenant_bloom',
                    type: 'bloom_filter',
                    expression: 'tenant_id',
                    granularity: '4',
                },
            ],
        },
    ],
    columns: [
        {
            database: 'analytics',
            table: 'events',
            name: 'day',
            type: 'Date',
            defaultKind: '',
            comment: 'Event date',
        },
    ],
    dictionaries: [
        {
            database: 'analytics',
            name: 'campaign_lookup',
            status: 'LOADED',
            type: 'Hashed',
            keyColumns: 'campaign_id UInt64',
            attributeColumns: 'campaign_name String',
            elementCount: '18240',
            memoryBytes: '5242880',
            lastSuccessfulUpdate: '2026-09-23 08:15:00',
        },
    ],
    warnings: [],
    truncated: false,
};

async function mockLiveWorkspace(
    page: Page,
    respondToSchema: (route: Route) => Promise<void>,
    mode = 'Experimental',
) {
    let trusted = true;
    let schemaRequests = 0;
    await page.route('**/api/session', route =>
        route.fulfill({
            json: {
                principal: { id: 'test-owner', role: 'owner' },
                requiresLogin: false,
                demo: false,
            },
        }),
    );
    await page.route('**/api/connections', route =>
        route.fulfill({
            json: [
                {
                    id: 'live',
                    name: 'Test database',
                    host: 'https://clickhouse.example',
                    database: 'analytics',
                    username: 'reader',
                    readonly: true,
                    trusted,
                    limits: {
                        rows: 5000,
                        bytes: 2000000,
                        seconds: 30,
                        memory: 536870912,
                        threads: 4,
                    },
                    manifest: {
                        version: 1,
                        serverVersion: '26.1',
                        testedAt: '2026-09-23T00:00:00.000Z',
                        schema: { available: true },
                        progress: { available: true },
                        cancellation: { available: true },
                        explain: { available: true },
                        pipeline: { available: true },
                        queryLog: { available: true },
                        documentation: { available: false },
                        import: { available: false },
                        scripts: { available: true },
                        parameters: { available: true },
                    },
                },
            ],
        }),
    );
    await page.route('**/api/connections/live/trust', async route => {
        trusted = Boolean(jsonRecord(route.request().postDataJSON()).trusted);
        await route.fulfill({ json: { trusted } });
    });
    await page.route('**/api/connections/live/schema', async route => {
        schemaRequests++;
        await respondToSchema(route);
    });
    await page.route('**/api/runs**', route => route.fulfill({ json: [] }));
    await page.route('**/api/documents**', route => route.fulfill({ json: [] }));
    await page.goto(workspacePath(mode));
    await expect(page.getByTestId('run-button')).toBeEnabled();
    return {
        get schemaRequests() {
            return schemaRequests;
        },
    };
}

async function revokeAccess(page: Page) {
    await page.locator('.connection-trigger').click();
    await page
        .getByRole('dialog', { name: 'Connection details' })
        .getByRole('button', { name: 'Turn off read-only access', exact: true })
        .click();
    await expect(page.locator('.connection-quick-status')).toHaveText('Review needed');
    await expect(page.getByText('Schema is private', { exact: true })).toBeVisible();
}

async function replaceSql(page: Page, sql: string) {
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(sql);
    await expect(editor).toContainText(sql);
}

function tableObject(page: Page, name = 'events') {
    return page
        .getByRole('tree', { name: 'Objects', exact: true })
        .getByRole('button', { name: `${name} MergeTree`, exact: true });
}

for (const mode of ['beginner', 'expert']) {
    test(`${mode} keeps denied table writes outside its available object actions`, async ({
        page,
    }) => {
        let permissionRequests = 0;
        await page.route('**/api/connections/live/table-permissions', async route => {
            permissionRequests++;
            await route.fulfill({ json: { create: false, insert: false, drop: false } });
        });
        await mockLiveWorkspace(page, route => route.fulfill({ json: schema }), mode);
        if (mode === 'beginner') {
            await expect(page.locator('.object-explorer-section')).toHaveCount(0);
            await page
                .locator('.icon-rail')
                .getByRole('button', { name: 'Objects', exact: true })
                .click();
            await expect(page.locator('.object-explorer-section')).toBeVisible();
        }
        await page.locator('.object-tree-row.is-database').hover();
        await expect.poll(() => permissionRequests).toBeGreaterThan(0);
        await expect(
            page.getByRole('button', { name: 'New table in analytics', exact: true }),
        ).toHaveCount(0);
        await tableObject(page).click();
        await expect.poll(() => permissionRequests).toBeGreaterThan(1);
        await expect(
            page.getByRole('button', { name: 'Actions for analytics.events', exact: true }),
        ).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Insert row', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Delete table', exact: true })).toHaveCount(
            0,
        );
        await expect(page.getByRole('button', { name: 'Preview rows', exact: true })).toBeVisible();
        await expect(page.locator('.object-details-hero > code')).toHaveText('analytics.events');
    });
}

test('Insert-only permissions hide create and drop while preserving the insert dialog', async ({
    page,
}) => {
    await page.route('**/api/connections/live/table-permissions', route =>
        route.fulfill({ json: { create: false, insert: true, drop: false } }),
    );
    await mockLiveWorkspace(page, route => route.fulfill({ json: schema }));
    await page.locator('.object-tree-row.is-database').hover();
    await expect(
        page.getByRole('button', { name: 'New table in analytics', exact: true }),
    ).toHaveCount(0);
    await tableObject(page).click();
    await expect(page.getByRole('button', { name: 'Delete table', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Insert row', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Insert row', exact: true })).toBeVisible();
});

test('Unavailable permission checks hide create while retaining selected-table actions', async ({
    page,
}) => {
    let permissionRequests = 0;
    await page.route('**/api/connections/live/table-permissions', async route => {
        permissionRequests++;
        await route.fulfill({
            status: 502,
            json: { error: { code: 'UNAVAILABLE', message: 'Unavailable' } },
        });
    });
    await mockLiveWorkspace(page, route => route.fulfill({ json: schema }));
    await page.locator('.object-tree-row.is-database').hover();
    await expect.poll(() => permissionRequests).toBeGreaterThan(0);
    await expect(
        page.getByRole('button', { name: 'New table in analytics', exact: true }),
    ).toHaveCount(0);
    await tableObject(page).click();
    await expect.poll(() => permissionRequests).toBeGreaterThan(1);
    for (const name of ['Insert row', 'Delete table'])
        await expect(page.getByRole('button', { name, exact: true })).toBeEnabled();
});

test('A late denial closes an open write dialog and cannot reopen it', async ({ page }) => {
    let deny: (() => void) | undefined;
    await page.route('**/api/connections/live/table-permissions', async route => {
        await new Promise<void>(resolve => {
            deny = resolve;
        });
        await route.fulfill({ json: { create: false, insert: false, drop: false } });
    });
    await mockLiveWorkspace(page, route => route.fulfill({ json: schema }));
    await tableObject(page).click();
    await page.getByRole('button', { name: 'Insert row', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Insert row', exact: true });
    await expect(dialog).toBeVisible();
    await expect.poll(() => Boolean(deny)).toBe(true);
    deny!();
    await expect(dialog).toHaveCount(0);
    for (const name of ['Insert row', 'Delete table'])
        await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    await expect(
        page.getByRole('button', { name: 'Actions for analytics.events', exact: true }),
    ).toHaveCount(0);
});

test('A late denial for a previous table does not hide the current table actions', async ({
    page,
}) => {
    let denyPrevious: (() => void) | undefined;
    let previousResolved = false;
    let currentResolved = false;
    await page.route('**/api/connections/live/table-permissions', async route => {
        const { table } = jsonRecord(route.request().postDataJSON(), 'Table permissions request');
        if (table === 'events') {
            await new Promise<void>(resolve => {
                denyPrevious = resolve;
            });
            await route.fulfill({ json: { create: false, insert: false, drop: false } });
            previousResolved = true;
        } else {
            await route.fulfill({ json: { create: true, insert: true, drop: true } });
            if (table === 'new_events') currentResolved = true;
        }
    });
    await mockLiveWorkspace(page, route =>
        route.fulfill({
            json: {
                ...schema,
                tables: [...schema.tables, { ...schema.tables[0], name: 'new_events' }],
            },
        }),
    );
    await tableObject(page).click();
    await expect.poll(() => Boolean(denyPrevious)).toBe(true);
    await page.getByRole('button', { name: '‹ Objects', exact: true }).click();
    await tableObject(page, 'new_events').click();
    denyPrevious!();
    await expect.poll(() => previousResolved && currentResolved).toBe(true);
    await expect(page.locator('.object-details-hero > code')).toHaveText('analytics.new_events');
    for (const name of ['Insert row', 'Delete table'])
        await expect(page.getByRole('button', { name, exact: true })).toBeEnabled();
});

async function hoverToken(page: Page, token: string) {
    const point = await page.locator('.cm-content').evaluate((root, value) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
            const text = node.textContent ?? '',
                start = text.indexOf(value);
            if (start < 0) continue;
            const range = document.createRange();
            range.setStart(node, start);
            range.setEnd(node, start + value.length);
            const bounds = range.getBoundingClientRect();
            return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
        }
        return undefined;
    }, token);
    if (!point) throw new Error(`Could not find SQL token ${token}`);
    await page.mouse.move(point.x, point.y);
}

test('Revoking trust removes loaded schema from editor completion and hover', async ({ page }) => {
    await mockLiveWorkspace(page, route => route.fulfill({ json: schema }));
    await expect(tableObject(page)).toBeVisible();
    await replaceSql(page, 'SELECT day FROM events');
    await hoverToken(page, 'day');
    await expect(page.locator('.sql-hover')).toContainText('Date');

    await revokeAccess(page);
    await replaceSql(page, 'SELECT * FROM ev');
    await page.keyboard.press('Control+Space');
    await expect(page.getByRole('option').filter({ hasText: 'events' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.mouse.move(0, 0);
    await replaceSql(page, 'SELECT day FROM events');
    await hoverToken(page, 'day');
    await expect(page.locator('.sql-hover')).toHaveCount(0);
});

test('Object explorer shows ClickHouse metadata, searchable children, and generated SQL', async ({
    page,
}) => {
    await mockLiveWorkspace(page, route => route.fulfill({ json: schema }));

    await expect(page.getByRole('tree', { name: 'Objects' })).toBeVisible();
    const eventsObject = tableObject(page);
    await expect(eventsObject).toBeVisible();
    await eventsObject.click();
    await expect(page.getByLabel('Selected object')).toContainText('MergeTree');
    await expect(page.getByLabel('Selected object')).toContainText('ORDER BY');
    await expect(page.getByLabel('Selected object')).toContainText('(tenant_id, day)');
    await expect(page.getByLabel('Selected object')).toContainText('PRIMARY KEY');
    await expect(page.getByLabel('Selected object')).toContainText('PARTITION BY');
    await expect(page.getByLabel('Selected object')).toContainText('SAMPLE BY');
    await expect(page.getByLabel('Selected object')).toContainText('Configured');
    await expect(page.getByLabel('Selected object')).toContainText('1.2M rows');
    await expect(page.getByLabel('Selected object')).toContainText('1.5 GiB');
    await expect(page.getByLabel('Selected object')).toContainText('18 active');

    const sqlTabs = page.getByRole('tablist', { name: 'SQL documents', exact: true });
    const originalTabName = await sqlTabs.getByRole('tab').first().getAttribute('aria-label');
    await page.locator('button[aria-controls="sql-editor-content"]').click();
    await expect(page.locator('#sql-editor-content')).toBeHidden();
    await page.getByRole('button', { name: 'Generate SELECT', exact: true }).click();
    await expect(page.locator('#sql-editor-content')).toBeVisible();
    await expect(page.locator('.cm-content')).toContainText('SELECT');
    await expect(page.locator('.cm-content')).toContainText('`day`');
    await expect(page.locator('.cm-content')).toContainText('FROM `analytics`.`events`');
    await sqlTabs.getByRole('tab', { name: originalTabName!, exact: true }).click();
    await expect(page.locator('#sql-editor-content')).toBeHidden();

    await page.getByRole('button', { name: '‹ Objects', exact: true }).click();
    const search = page.getByTestId('schema-search');
    await search.fill('tenant_bloom');
    await expect(page.getByText('tenant_bloom', { exact: true })).toBeVisible();

    await search.fill('campaign_lookup');
    await expect(page.getByText('campaign_lookup', { exact: true })).toBeVisible();
    await page.getByText('campaign_lookup', { exact: true }).click();
    await expect(page.getByLabel('Selected object')).toContainText('18.2K');
});

test('Object explorer keeps selection while browsing and restores expansion after reload', async ({
    page,
}) => {
    await mockLiveWorkspace(page, route => route.fulfill({ json: schema }));
    const table = page.locator(
        '[role="treeitem"][data-database="analytics"][data-table-name="events"]',
    );
    await expect(table).toBeVisible();
    await table.locator('.object-tree-toggle').click();
    await expect(table).toHaveAttribute('aria-expanded', 'true');
    await table.locator('.object-tree-main').click();
    await expect(page.getByLabel('Selected object')).toContainText('MergeTree');
    await page.getByRole('button', { name: '‹ Objects', exact: true }).click();
    await expect(table).toHaveAttribute('aria-selected', 'true');
    const search = page.getByTestId('schema-search');
    await search.fill('events');
    await expect(table).toHaveAttribute('aria-selected', 'true');
    await search.fill('');
    await page.reload();
    await expect(table).toBeVisible();
    await expect(table).toHaveAttribute('aria-expanded', 'true');
    await expect(
        page.getByRole('button', { name: 'Expand projections', exact: true }),
    ).toBeVisible();
});

test('Column details show the type once and keep comments readable', async ({ page }) => {
    await mockLiveWorkspace(page, route => route.fulfill({ json: schema }));

    const table = page.locator(
        '[role="treeitem"][data-database="analytics"][data-table-name="events"]',
    );
    await table.locator('.object-tree-main').click();
    await page
        .getByRole('region', { name: 'Selected object', exact: true })
        .getByRole('button', { name: 'day', exact: true })
        .click();

    const details = page.getByRole('region', { name: 'Selected object', exact: true });
    await expect(details.locator('.object-details-hero > small')).toHaveText('Type · Date');
    await expect(details.locator('.object-fact > span')).toHaveText(['COMMENT']);
    await expect(details.locator('.object-fact > code')).toHaveText(['Event date']);
});

test('Object explorer explains when the loaded schema has no visible objects', async ({ page }) => {
    await mockLiveWorkspace(page, route =>
        route.fulfill({ json: { ...schema, tables: [], columns: [], dictionaries: [] } }),
    );

    await expect(page.getByText('No objects found.', { exact: true })).toBeVisible();
    await expect(
        page.getByText('No tables, views, or dictionaries are visible for this connection.', {
            exact: true,
        }),
    ).toBeVisible();
    await expect(page.getByText('ClickHouse metadata unavailable', { exact: true })).toHaveCount(0);

    const search = page.getByTestId('schema-search');
    await search.fill('events');
    await expect(page.getByText('No objects match this search.', { exact: true })).toBeVisible();
    await expect(
        page.getByText('Try a different name, type, engine, index, or column.', { exact: true }),
    ).toBeVisible();

    await search.fill('   ');
    await expect(page.getByText('No objects found.', { exact: true })).toBeVisible();
});

test('Object explorer keeps metadata failures separate from an empty schema', async ({ page }) => {
    await mockLiveWorkspace(page, route =>
        route.fulfill({
            status: 403,
            json: {
                error: {
                    code: 'CLICKHOUSE_PERMISSION',
                    message: 'Not enough privileges to read system.tables',
                },
            },
        }),
    );

    await expect(page.locator('.callout-error')).toContainText(
        'Not enough privileges to read system.tables',
    );
    await expect(page.getByText('No objects found.', { exact: true })).toHaveCount(0);
    await expect(page.getByText('ClickHouse metadata unavailable', { exact: true })).toHaveCount(0);
});

test('Object explorer keeps the partial-schema notice beside an empty loaded page', async ({
    page,
}) => {
    await mockLiveWorkspace(page, route =>
        route.fulfill({
            json: {
                ...schema,
                tables: [],
                columns: [],
                dictionaries: [],
                truncated: true,
                pagination: { tables: 0 },
            },
        }),
    );

    await expect(page.getByText('No objects found.', { exact: true })).toBeVisible();
    await expect(page.getByText(/Showing part of this schema/)).toBeVisible();
    await expect(
        page.getByRole('button', { name: 'Load more metadata', exact: true }),
    ).toBeVisible();
});

test('Standard loads schema and opens Objects only on demand', async ({ page }) => {
    const loaded = page.waitForResponse(
        response => new URL(response.url()).pathname === '/api/connections/live/schema',
    );
    await mockLiveWorkspace(page, route => route.fulfill({ json: schema }), 'beginner');
    expect((await loaded).ok()).toBe(true);
    const inspector = page.locator('.inspector-pane.is-docked-inspector');
    await expect(inspector).toHaveCount(0);
    const openObjects = page
        .locator('.icon-rail')
        .getByRole('button', { name: 'Objects', exact: true });
    await expect(openObjects).toBeVisible();
    await openObjects.click();
    await expect(inspector).toBeVisible();
    await expect(page.getByTestId('schema-search')).toBeVisible();
    await setWorkspaceMode(page, 'Experimental');
    await expect(inspector.getByRole('heading', { name: 'Objects', exact: true })).toBeVisible();
    await tableObject(page).click();
    await expect(page.getByLabel('Selected object')).toContainText('analytics.events');
    await expect(page.getByRole('button', { name: 'Preview rows', exact: true })).toBeVisible();
});

test('Preview Rows reuses the same draft and keeps the saved query panel preference', async ({
    page,
}) => {
    await mockLiveWorkspace(page, route => route.fulfill({ json: schema }));
    await page.route('**/api/runs**', async route => {
        if (route.request().method() === 'POST') {
            await route.fulfill({
                status: 503,
                json: {
                    error: { code: 'MOCK_RUN_FAILURE', message: 'The preview request is mocked.' },
                },
            });
            return;
        }
        await route.fallback();
    });

    const sqlTabs = page.getByRole('tablist', { name: 'SQL documents', exact: true });
    const originalTabName = await sqlTabs.getByRole('tab').first().getAttribute('aria-label');
    await page.locator('button[aria-controls="sql-editor-content"]').click();
    await expect(page.locator('#sql-editor-content')).toBeHidden();
    await tableObject(page).click();
    await page.getByRole('button', { name: 'Preview rows', exact: true }).click();
    await expect(sqlTabs.getByRole('tab').last()).toHaveAttribute(
        'aria-label',
        'Preview events.sql',
    );
    await expect(page.locator('#sql-editor-content')).toBeHidden();

    await sqlTabs.getByRole('tab', { name: originalTabName!, exact: true }).click();
    await expect(page.locator('#sql-editor-content')).toBeHidden();

    const repeatedRun = page.waitForResponse(
        response =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === '/api/runs',
    );
    await page.getByRole('button', { name: 'Preview rows', exact: true }).click();
    await repeatedRun;
    await expect(sqlTabs.getByRole('tab')).toHaveCount(2);
    await expect(sqlTabs.getByRole('tab', { name: 'Preview events.sql', exact: true })).toHaveCount(
        1,
    );
});

test('Preview Rows keeps an edited preview draft and opens a fresh one', async ({ page }) => {
    await mockLiveWorkspace(page, route => route.fulfill({ json: schema }));
    await page.route('**/api/runs**', async route => {
        if (route.request().method() === 'POST') {
            await route.fulfill({
                status: 503,
                json: {
                    error: { code: 'MOCK_RUN_FAILURE', message: 'The preview request is mocked.' },
                },
            });
            return;
        }
        await route.fallback();
    });

    const sqlTabs = page.getByRole('tablist', { name: 'SQL documents', exact: true });
    await tableObject(page).click();
    const firstRun = page.waitForResponse(
        response =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === '/api/runs',
    );
    await page.getByRole('button', { name: 'Preview rows', exact: true }).click();
    await firstRun;
    const previewTabs = sqlTabs.getByRole('tab', { name: 'Preview events.sql', exact: true });
    await previewTabs.click();
    const queryEditor = page.locator('#sql-editor-content');
    const queryToggle = page.locator('button[aria-controls="sql-editor-content"]');
    if (await queryEditor.isHidden()) await queryToggle.click();
    await replaceSql(page, 'SELECT 42');

    const secondRun = page.waitForResponse(
        response =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === '/api/runs',
    );
    await page.getByRole('button', { name: 'Preview rows', exact: true }).click();
    await secondRun;
    await expect(previewTabs).toHaveCount(2);
    await previewTabs.nth(0).click();
    if (await queryEditor.isHidden()) await queryToggle.click();
    await expect(page.locator('.cm-content')).toContainText('SELECT 42');
    await previewTabs.nth(1).click();
    if (await queryEditor.isHidden()) await queryToggle.click();
    await expect(page.locator('.cm-content')).toContainText('FROM `analytics`.`events`');
});

test('Deleting a table preserves its cached preview rows without a status pill', async ({
    page,
}) => {
    let tableExists = true;
    await mockLiveWorkspace(page, route =>
        route.fulfill({
            json: {
                ...schema,
                tables: tableExists ? schema.tables : [],
                columns: tableExists ? schema.columns : [],
            },
        }),
    );

    const previewSql = 'SELECT *\nFROM `analytics`.`events`\nLIMIT 100;';
    const run = {
        dataSource: 'clickhouse',
        id: 'deleted-source-run',
        queryId: 'deleted-source-query',
        owner: 'test-owner',
        connectionId: 'live',
        sql: previewSql,
        kind: 'query',
        parameters: {},
        limits: { rows: 5000, bytes: 2000000, seconds: 30, memory: 536870912, threads: 4 },
        tags: {},
        status: 'succeeded',
        createdAt: '2026-09-29T08:00:00.000Z',
        startedAt: '2026-09-29T08:00:00.000Z',
        finishedAt: '2026-09-29T08:00:00.000Z',
        elapsedMs: 1,
        rowCount: 1,
        bytes: 8,
        columns: [{ name: 'day', type: 'Date' }],
        warnings: [],
        sequence: 1,
        resultState: 'reopenable',
        requestedBy: 'test-owner',
        executedAs: 'test-reader',
        permissionSnapshot: { readonly: true, role: 'owner' },
        retryPolicy: 'never',
    };
    await page.route('**/api/runs**', async route => {
        const url = new URL(route.request().url());
        if (route.request().method() === 'POST' && url.pathname === '/api/runs') {
            await route.fulfill({ json: run });
            return;
        }
        if (url.pathname === '/api/runs') {
            await route.fulfill({ json: [run] });
            return;
        }
        if (url.pathname === `/api/runs/${run.id}/result`) {
            await route.fulfill({
                json: {
                    runId: run.id,
                    queryId: run.queryId,
                    columns: run.columns,
                    rows: [['2026-09-29']],
                    completeness: 'complete',
                    createdAt: run.createdAt,
                    offset: 0,
                    totalRows: 1,
                    nextOffset: null,
                },
            });
            return;
        }
        if (url.pathname === `/api/runs/${run.id}`) {
            await route.fulfill({ json: run });
            return;
        }
        await route.fallback();
    });
    await page.route('**/api/connections/live/tables', async route => {
        if (route.request().method() === 'DELETE') {
            tableExists = false;
            await route.fulfill({ json: { ok: true } });
            return;
        }
        await route.fallback();
    });

    await tableObject(page).click();
    await page.getByRole('button', { name: 'Preview rows', exact: true }).click();
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await expect(results.getByRole('table', { name: 'Retained query rows' })).toBeVisible();

    await page.getByRole('button', { name: 'Delete table', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete table', exact: true });
    await expect(dialog.getByRole('button', { name: 'Delete table', exact: true })).toBeDisabled();
    await dialog
        .getByRole('textbox', { name: 'Type analytics.events to confirm' })
        .fill('analytics.events');
    const deleteRequest = page.waitForRequest(
        request =>
            request.method() === 'DELETE' &&
            new URL(request.url()).pathname === '/api/connections/live/tables',
    );
    await dialog.getByRole('button', { name: 'Delete table', exact: true }).click();
    await deleteRequest;

    await expect(results.locator('.result-provenance-header')).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();
    const restoredResults = page.getByRole('region', { name: 'Query results', exact: true });
    await expect(restoredResults.locator('.result-provenance-header')).toHaveCount(0);
});

test('MergeTree storage opens a selectable, metric-switchable D3 parts explorer', async ({
    page,
}) => {
    await mockLiveWorkspace(page, route => route.fulfill({ json: schema }));
    await page.route('**/api/connections/live/table-parts', route =>
        route.fulfill({
            json: {
                database: 'analytics',
                table: 'events',
                parts: [
                    {
                        active: true,
                        partition: '2026-09',
                        name: '202609_1_1_0',
                        rows: '120000',
                        marks: '15',
                        compressedBytes: '4096',
                        uncompressedBytes: '8192',
                        level: 0,
                        minBlockNumber: '1',
                        maxBlockNumber: '1',
                        modifiedAt: '2026-09-24 08:00:00',
                        diskName: 'default',
                    },
                    {
                        active: true,
                        partition: '2026-09',
                        name: '202609_2_2_0',
                        rows: '80000',
                        marks: '10',
                        compressedBytes: '2048',
                        uncompressedBytes: '4096',
                        level: 0,
                        minBlockNumber: '2',
                        maxBlockNumber: '2',
                        modifiedAt: '2026-09-24 08:10:00',
                        diskName: 'default',
                    },
                    {
                        active: false,
                        partition: '2026-09',
                        name: '202609_3_3_0',
                        rows: '35000',
                        marks: '5',
                        compressedBytes: '512',
                        uncompressedBytes: '1024',
                        level: 0,
                        minBlockNumber: '3',
                        maxBlockNumber: '3',
                        modifiedAt: '2026-09-24 08:12:00',
                        diskName: 'cold',
                    },
                ],
                totalParts: '3',
                activeParts: '2',
                inactiveParts: '1',
                truncated: false,
                measuredAt: '2026-09-24T08:10:00.000Z',
                totals: {
                    rows: '235000',
                    marks: '30',
                    compressedBytes: '6656',
                    uncompressedBytes: '13312',
                },
            },
        }),
    );

    await tableObject(page).click();
    await page.getByRole('button', { name: 'Visualize parts', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'MergeTree parts', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.parts-map-row')).toHaveCount(3);
    await expect(dialog.locator('.parts-map-row.is-inactive')).toHaveCount(1);
    await expect(dialog.locator('.parts-graph-meta')).toContainText('6.5 KiB');

    const stateFilter = dialog.getByRole('group', { name: 'Part state' });
    await stateFilter.getByRole('button', { name: 'Inactive 1', exact: true }).click();
    await expect(dialog.locator('.parts-map-row')).toHaveCount(1);
    await dialog.locator('.parts-map-row.is-inactive').click();
    await expect(dialog.locator('.parts-inspector')).toContainText('Min block');
    await expect(dialog.locator('.parts-inspector')).toContainText('Disk');
    await expect(dialog.locator('.parts-inspector')).toContainText('cold');
    await stateFilter.getByRole('button', { name: 'All', exact: true }).click();
    await expect(dialog.locator('.parts-map-row')).toHaveCount(3);

    const metricControl = dialog.getByRole('group', { name: 'MergeTree parts' });
    await metricControl.getByRole('button', { name: 'Rows', exact: true }).click();
    await expect(metricControl.getByRole('button', { name: 'Rows', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
    );
    await dialog.getByRole('button', { name: 'Zoom into partition 2026-09', exact: true }).click();
    await expect(dialog.locator('.parts-breadcrumb')).toContainText('2026-09');
    await dialog
        .getByRole('group', { name: 'Part map' })
        .getByRole('button', { name: 'Galaxy', exact: true })
        .click();
    await expect(dialog.locator('.parts-graph-viewport')).toHaveClass(/is-galaxy/);

    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(dialog).toHaveCount(0);
});

test('A schema response arriving after trust is revoked cannot restore editor metadata', async ({
    page,
}) => {
    let releaseSchema!: () => void;
    let notifyStarted!: () => void;
    const gate = new Promise<void>(resolve => {
        releaseSchema = resolve;
    });
    const started = new Promise<void>(resolve => {
        notifyStarted = resolve;
    });
    const state = await mockLiveWorkspace(page, async route => {
        notifyStarted();
        await gate;
        await route.fulfill({ json: schema });
    });
    await started;
    expect(state.schemaRequests).toBeGreaterThan(0);
    await revokeAccess(page);
    releaseSchema();
    await expect(page.getByText('Schema is private', { exact: true })).toBeVisible();
    await replaceSql(page, 'SELECT * FROM ev');
    await page.keyboard.press('Control+Space');
    await expect(page.getByRole('option').filter({ hasText: 'events' })).toHaveCount(0);
});

for (const mode of ['beginner', 'expert']) {
    for (const canInsert of [true, false]) {
        test(`${mode} shows ${canInsert ? 'both write actions' : 'delete only'} below table name actions`, async ({
            page,
        }) => {
            await page.route('**/api/connections/live/table-permissions', route =>
                route.fulfill({ json: { create: false, insert: canInsert, drop: true } }),
            );
            await mockLiveWorkspace(page, route => route.fulfill({ json: schema }), mode);
            if (mode === 'beginner') {
                await page
                    .locator('.icon-rail')
                    .getByRole('button', { name: 'Objects', exact: true })
                    .click();
            }
            await tableObject(page).click();
            const details = page.getByRole('region', { name: 'Selected object', exact: true });
            await expect(
                details.getByRole('button', { name: 'Actions for analytics.events', exact: true }),
            ).toHaveCount(0);
            await expect(
                details.getByRole('button', { name: 'Preview rows', exact: true }),
            ).toBeVisible();
            await expect(
                details.getByRole('button', { name: 'Generate SELECT', exact: true }),
            ).toBeVisible();
            const rows = details.locator('.object-utility-actions');
            await expect(rows).toHaveCount(2);
            await expect(rows.nth(0).getByRole('button')).toHaveText(['Insert name', 'Copy name']);
            const writes = details.locator('.object-table-write-actions');
            await expect(writes.getByRole('button')).toHaveText(
                canInsert ? ['Insert row', 'Delete table'] : ['Delete table'],
            );
            const remove = writes.getByRole('button', { name: 'Delete table', exact: true });
            await expect(remove).toBeEnabled();
            await expect(remove).toHaveClass(/button-danger/);
            if (canInsert)
                await expect(
                    writes.getByRole('button', { name: 'Insert row', exact: true }),
                ).toBeEnabled();
            const nameBounds = await details
                .getByRole('button', { name: 'Copy name', exact: true })
                .boundingBox();
            const deleteBounds = await remove.boundingBox();
            expect(nameBounds).not.toBeNull();
            expect(deleteBounds).not.toBeNull();
            expect(deleteBounds!.y).toBeGreaterThanOrEqual(nameBounds!.y + nameBounds!.height);
            expect(Math.abs(deleteBounds!.x - nameBounds!.x)).toBeLessThan(1);
            expect(Math.abs(deleteBounds!.width - nameBounds!.width)).toBeLessThan(1);
        });
    }
}
