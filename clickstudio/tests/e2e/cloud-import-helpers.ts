import { expect, type Locator, type Page, type Route } from '@playwright/test';
import type { CloudConnectionTest } from '../../src/frontend/database/connections/cloud-connection.js';
import { arrayValue, jsonRecord, jsonValue } from '../helpers/type-guards.js';
import { cloudSchema as previewCloudSchema } from '../helpers/cloud-fixtures.js';
import { chooseImportOption } from './import-helpers.js';

export { previewCloudSchema };

const previewCloudConnectionTest: CloudConnectionTest = {
    host: 'service.region.provider.clickhouse.cloud:8443',
    database: 'default',
    username: 'demo',
    serverVersion: '26.1',
    queryLog: { available: true },
    queryLogSource: 'user_query_log',
    replication: { available: false, reason: 'Unavailable in this preview test.' },
    progress: { available: false, reason: 'Unavailable in this preview test.' },
    cancellation: { available: false, reason: 'Unavailable in this preview test.' },
    explain: { available: false, reason: 'Unavailable in this preview test.' },
    explainPlan: { available: false, reason: 'Unavailable in this preview test.' },
    explainAnalyze: { available: false, reason: 'Unavailable in this preview test.' },
    queryTree: { available: false, reason: 'Unavailable in this preview test.' },
    explainPipeline: { available: false, reason: 'Unavailable in this preview test.' },
    pipeline: { available: false, reason: 'Unavailable in this preview test.' },
    traceLog: { available: false, reason: 'Unavailable in this preview test.' },
    documentation: { available: false, reason: 'Unavailable in this preview test.' },
    parameters: { available: false, reason: 'Unavailable in this preview test.' },
};

function importFileRowCount(format: string | undefined, contents: string): number {
    switch (format) {
        case 'json': {
            const rows: unknown = JSON.parse(contents);
            return arrayValue(rows, 'JSON import contents').length;
        }
        case 'ndjson':
            return contents.split(/\r?\n/).filter(Boolean).length;
        default:
            return Math.max(0, contents.trim().split(/\r?\n/).length - 1);
    }
}

async function fulfillCloudFileImport(
    route: Route,
    body: string,
    imports: string[],
    commitOutcome: 'success' | 'unknown' | 'running',
    applyCreatedTable: (createTable: {
        name: string;
        columns: { name: string; type: string }[];
        generateId: boolean;
    }) => void,
    markImportSucceeded: () => void,
) {
    imports.push(body);
    const queryId =
        body.match(/name="queryId"\r\n\r\n([^\r\n]+)/)?.[1] ??
        'clickstudio-import-00000000-0000-4000-8000-000000000000';
    const table = body.match(/name="target"\r\n\r\n([^\r\n]+)/)?.[1] ?? 'default.events';
    const format = body.match(/name="format"\r\n\r\n([^\r\n]+)/)?.[1];
    const fileContents =
        body.match(
            /name="file"; filename="[^\"]+"\r\nContent-Type: [^\r\n]+\r\n\r\n([\s\S]*?)\r\n--/,
        )?.[1] ?? '';
    const rows = importFileRowCount(format, fileContents);
    const id = queryId.replace('clickstudio-import-', '');
    const createValue = body.match(/name="createTable"\r\n\r\n([^\r\n]+)/)?.[1];
    const createTable = createValue ? parseCreateTable(jsonValue(createValue)) : undefined;
    const targetValue = createTable ? `default.${createTable.name}` : table;
    const unresolvedOutcome =
        commitOutcome === 'unknown' || (commitOutcome === 'running' && imports.length === 1);
    if (unresolvedOutcome) {
        const status = commitOutcome === 'unknown' ? 'unknown' : 'running';
        await route.fulfill({
            json: {
                id,
                connectionId: 'clickhouse-cloud',
                table: targetValue,
                queryId,
                rows,
                createdAt: '2026-09-28T00:00:00.000Z',
                status,
                ...(status === 'unknown'
                    ? {
                          tableExists: true,
                          error: 'ClickHouse could not confirm the insert. The rows may already be there.',
                      }
                    : { reconciliationRequired: true }),
            },
        });
        return;
    }
    if (createTable) applyCreatedTable(createTable);
    markImportSucceeded();
    await route.fulfill({
        json: {
            id,
            connectionId: 'clickhouse-cloud',
            table: targetValue,
            queryId,
            rows,
            createdAt: '2026-09-28T00:00:00.000Z',
            status: 'succeeded',
        },
    });
}

export async function mockCloudEndpoint(
    page: Page,
    commitOutcome: 'success' | 'unknown' | 'running' = 'success',
    cloudSchema = previewCloudSchema,
    onSchemaAfterImport?: () => void,
) {
    const imports: string[] = [];
    let activeSchema = cloudSchema;
    let importSucceeded = false;
    const applyCreatedTable = (createTable: {
        name: string;
        columns: { name: string; type: string }[];
        generateId: boolean;
    }) => {
        activeSchema = {
            ...activeSchema,
            tables: [
                ...activeSchema.tables.filter(item => item.name !== createTable.name),
                { database: 'default', name: createTable.name, engine: 'MergeTree' },
            ],
            columns: [
                ...activeSchema.columns.filter(item => item.table !== createTable.name),
                ...createTable.columns.map(column => ({
                    database: 'default',
                    table: createTable.name,
                    name: column.name,
                    type: column.type,
                    defaultKind: '',
                    comment: '',
                })),
                ...(createTable.generateId
                    ? [
                          {
                              database: 'default',
                              table: createTable.name,
                              name: 'id',
                              type: 'UInt64',
                              defaultKind: 'DEFAULT',
                              comment: '',
                          },
                      ]
                    : []),
            ],
        };
    };
    await page.route('**/api/cloud', async route => {
        const request = route.request();
        const contentType = request.headers()['content-type'] ?? '';
        if (contentType.startsWith('multipart/form-data')) {
            await fulfillCloudFileImport(
                route,
                request.postData() ?? '',
                imports,
                commitOutcome,
                applyCreatedTable,
                () => {
                    importSucceeded = true;
                },
            );
            return;
        }
        const body = jsonRecord(request.postDataJSON(), 'Cloud request body');
        if (body.action === 'test') {
            await route.fulfill({ json: previewCloudConnectionTest });
            return;
        }
        if (body.action === 'functions') {
            await route.fulfill({
                json: {
                    functions: [],
                    canCreate: false,
                    createReason: 'CREATE FUNCTION privilege is required.',
                    canDrop: false,
                    dropReason: 'DROP FUNCTION privilege is required.',
                },
            });
            return;
        }
        if (body.action === 'schema') {
            if (importSucceeded) onSchemaAfterImport?.();
            await route.fulfill({ json: activeSchema });
            return;
        }
        if (body.action === 'import-status') {
            const running = commitOutcome === 'running';
            await route.fulfill({
                json: {
                    id: (typeof body.queryId === 'string' ? body.queryId : '').replace(
                        'clickstudio-import-',
                        '',
                    ),
                    connectionId: 'clickhouse-cloud',
                    table: typeof body.table === 'string' ? body.table : 'default.events',
                    queryId: typeof body.queryId === 'string' ? body.queryId : '',
                    rows: typeof body.rows === 'number' ? body.rows : 0,
                    createdAt: '2026-09-28T00:00:00.000Z',
                    status: running ? 'running' : 'unknown',
                    ...(!running
                        ? {
                              tableExists: true,
                              error: 'ClickHouse could not confirm the insert. The rows may already be there.',
                          }
                        : { reconciliationRequired: true }),
                },
            });
            return;
        }
        await route.fulfill({
            status: 409,
            json: {
                error: {
                    code: 'UNEXPECTED_ACTION',
                    message: 'Unexpected Cloud action in this import test.',
                },
            },
        });
    });
    return imports;
}

function parseCreateTable(value: unknown): {
    name: string;
    columns: { name: string; type: string }[];
    generateId: boolean;
} {
    const record = jsonRecord(value, 'Create table request');
    if (typeof record.name !== 'string' || typeof record.generateId !== 'boolean')
        throw new Error('Create table request has invalid fields');
    const columns = arrayValue(record.columns, 'Create table columns').map(column => {
        const item = jsonRecord(column, 'Create table column');
        if (typeof item.name !== 'string' || typeof item.type !== 'string')
            throw new Error('Create table column has invalid fields');
        return { name: item.name, type: item.type };
    });
    return { name: record.name, columns, generateId: record.generateId };
}

export async function connectPreviewCloud(page: Page, path = '/experimental') {
    await page.goto(path);
    const connectButton = page.getByRole('button', { name: 'Connect Cloud' });
    await expect(connectButton).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Data source options' })).toHaveCount(0);
    await connectButton.click();
    const dialog = page.getByRole('dialog', { name: 'Connect to your service' });
    await dialog.getByLabel('HTTPS host').fill('service.region.provider.clickhouse.cloud:8443');
    await dialog.getByLabel('Database').fill('default');
    await dialog.getByLabel('Username').fill('demo');
    await dialog.getByLabel('Password').fill('demo-password');
    await dialog.getByRole('button', { name: 'Connect service' }).click();
    await expect(page.locator('.connection-trigger .connection-env.is-cloud')).toHaveText('CLOUD');
    await expect(page.getByRole('button', { name: 'Disconnect Cloud' })).toBeVisible();
}

export async function chooseExistingCloudTable(dialog: Locator) {
    await dialog.getByRole('radio', { name: /Add to a table/ }).check();
    await chooseImportOption(
        dialog.getByRole('combobox', { name: 'Import target table', exact: true }),
        'default.events',
    );
}
