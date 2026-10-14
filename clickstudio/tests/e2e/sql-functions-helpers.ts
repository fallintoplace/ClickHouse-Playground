import { expect, type Page, type Route } from '@playwright/test';
import { createClient, ClickHouseLogLevel } from '@clickhouse/client';
import {
    loadSqlFunctions,
    createSqlFunction,
    dropSqlFunction,
} from '../../src/backend/database/functions/sql-functions.js';
import {
    SQL_FUNCTION_TEMPLATES,
    createSqlFunctionQuery,
    type SqlFunction,
} from '../../src/shared/database/functions/sql-functions.js';
import { cloudConnectionTest, cloudSchema } from '../helpers/cloud-fixtures.js';
import { jsonRecord, stringValue } from '../helpers/type-guards.js';
import { connectPreviewCloud } from './cloud-import-helpers.js';
import type { ExecutableFunction } from '../../src/shared/database/functions/python-functions.js';
import type { TablePermissions } from '../../src/shared/database/tables/permissions.js';

type FunctionTestState = {
    executableFunctions: ExecutableFunction[];
    executableError: boolean;
    canCreate: boolean;
    canDrop: boolean;
    failDrop: boolean;
    dropDelay: number;
    functions: SqlFunction[];
    failCreate: boolean;
    failRun: boolean;
    metadataError: boolean;
    metadataDelay: number;
    invalidCatalog: boolean;
    runDelay: number;
    mapJson: string;
};

async function fulfillFunctionRun(
    route: Route,
    body: Record<string, unknown>,
    state: FunctionTestState,
    liveClient?: ReturnType<typeof createClient>,
) {
    if (state.runDelay) await new Promise(resolve => setTimeout(resolve, state.runDelay));
    if (state.failRun)
        return route.fulfill({
            status: 502,
            json: {
                error: {
                    code: 'CLICKHOUSE_ERROR',
                    message: 'Function input type is invalid.',
                },
            },
        });
    if (String(body.sql).includes('python_double'))
        return route.fulfill({
            json: {
                queryId: body.queryId,
                columns: [
                    { name: 'result', type: 'Int64' },
                    { name: 'result_json', type: 'String' },
                ],
                rows: [['42', '42']],
                elapsedMs: 3,
                bytes: 16,
                truncated: false,
            },
        });
    if (liveClient) {
        const response = await liveClient.query({
            query: stringValue(body.sql, 'Test SQL'),
            format: 'JSON',
        });
        const json = await response.json<Record<string, unknown>>();
        const columns = json.meta ?? [];
        return route.fulfill({
            json: {
                queryId: body.queryId,
                columns,
                rows: json.data.map(row => columns.map(column => row[column.name])),
                elapsedMs: 3,
                bytes: 32,
                truncated: false,
            },
        });
    }
    if (String(body.sql).includes('udf_increment')) {
        return route.fulfill({
            json: {
                queryId: body.queryId,
                columns: [
                    { name: 'result', type: 'Int64' },
                    { name: 'result_json', type: 'String' },
                ],
                rows: [[101, '101']],
                elapsedMs: 3,
                bytes: 16,
                truncated: false,
            },
        });
    }
    const map = String(body.sql).includes('udf_map_remove');
    return route.fulfill({
        json: {
            queryId: body.queryId,
            columns: [
                { name: 'result', type: map ? 'Map(String, UInt8)' : 'Array(UInt8)' },
                { name: 'result_json', type: 'String' },
            ],
            rows: map
                ? [[JSON.parse(state.mapJson), state.mapJson]]
                : [[[10, 30, 40], '[10,30,40]']],
            elapsedMs: 3,
            bytes: 32,
            truncated: false,
        },
    });
}

async function fulfillFunctionCreate(
    route: Route,
    body: Record<string, unknown>,
    state: FunctionTestState,
    liveClient?: ReturnType<typeof createClient>,
) {
    if (state.failCreate)
        return route.fulfill({
            status: 403,
            json: {
                error: {
                    code: 'FUNCTION_PERMISSION',
                    message: 'CREATE FUNCTION privilege was revoked.',
                },
            },
        });
    const fn = liveClient
        ? await createSqlFunction(liveClient, body)
        : {
              name: stringValue(body.name, 'Function name'),
              parameters: Array.isArray(body.parameters) ? body.parameters : [],
              createQuery: createSqlFunctionQuery({
                  name: stringValue(body.name, 'Function name'),
                  parameters: Array.isArray(body.parameters)
                      ? body.parameters.map(parameter => stringValue(parameter, 'Parameter'))
                      : [],
                  expression: stringValue(body.expression, 'Expression'),
              }),
          };
    state.functions.push(fn);
    return route.fulfill({ json: fn });
}

async function fulfillFunctionDrop(
    route: Route,
    body: Record<string, unknown>,
    state: FunctionTestState,
    liveClient?: ReturnType<typeof createClient>,
) {
    if (state.dropDelay) await new Promise(resolve => setTimeout(resolve, state.dropDelay));
    if (state.failDrop || !state.canDrop)
        return route.fulfill({
            status: 403,
            json: {
                error: {
                    code: 'FUNCTION_PERMISSION',
                    message: 'DROP FUNCTION privilege was revoked.',
                },
            },
        });
    if (body.name !== body.confirmation)
        return route.fulfill({
            status: 400,
            json: {
                error: {
                    code: 'FUNCTION_DROP_CONFIRMATION',
                    message: 'Exact name required.',
                },
            },
        });
    const result = liveClient ? await dropSqlFunction(liveClient, body) : { name: body.name };
    state.functions = state.functions.filter(fn => fn.name !== body.name);
    return route.fulfill({ json: result });
}

export async function functionsWorkspace(
    page: Page,
    options: {
        canCreate?: boolean;
        canDrop?: boolean;
        executableError?: boolean;
        live?: boolean;
        existing?: boolean;
        path?: string;
        invalidCatalog?: boolean;
        metadataDelay?: number;
        waitForFunctions?: boolean;
        openObjects?: boolean;
        executableFunctions?: ExecutableFunction[];
        tablePermissions?: TablePermissions;
    } = {},
) {
    const state: FunctionTestState = {
        executableFunctions: options.executableFunctions ?? [],
        executableError: options.executableError ?? false,
        canCreate: options.canCreate ?? true,
        canDrop: options.canDrop ?? true,
        failDrop: false,
        dropDelay: 0,
        functions: options.existing
            ? SQL_FUNCTION_TEMPLATES.map(template => ({
                  name: template.name,
                  parameters: template.parameters,
                  createQuery: createSqlFunctionQuery(template),
              }))
            : ([] as SqlFunction[]),
        failCreate: false,
        failRun: false,
        metadataError: false,
        metadataDelay: options.metadataDelay ?? 0,
        invalidCatalog: options.invalidCatalog ?? false,
        runDelay: 0,
        mapJson: '{"a":10,"c":30}',
    };
    const requests: Record<string, unknown>[] = [];
    const liveClient = options.live
        ? createClient({
              url: process.env.CLICKSTUDIO_UDF_TEST_URL,
              log: { level: ClickHouseLogLevel.OFF },
          })
        : undefined;
    if (liveClient && options.existing) {
        for (const template of SQL_FUNCTION_TEMPLATES)
            await createSqlFunction(liveClient, template);
    }
    await page.route('**/api/session', route =>
        route.fulfill({
            json: {
                principal: { id: 'test-owner', role: 'owner' },
                requiresLogin: false,
                demo: false,
            },
        }),
    );
    await page.route('**/api/cloud', async route => {
        const body = jsonRecord(route.request().postDataJSON(), 'Cloud request');
        requests.push(body);
        const action = body.action;
        if (action === 'test')
            return route.fulfill({ json: cloudConnectionTest({ serverVersion: '26.6.8.7' }) });
        if (action === 'schema') return route.fulfill({ json: cloudSchema });
        if (action === 'executable-functions' && state.executableError)
            return route.fulfill({
                status: 403,
                json: {
                    error: { code: 'FUNCTION_PERMISSION', message: 'Function access denied.' },
                },
            });
        if (action === 'executable-functions')
            return route.fulfill({ json: { functions: state.executableFunctions } });
        if (action === 'functions') {
            if (state.metadataDelay)
                await new Promise(resolve => setTimeout(resolve, state.metadataDelay));
            if (state.metadataError)
                return route.fulfill({
                    status: 502,
                    json: {
                        error: {
                            code: 'CLICKHOUSE_ERROR',
                            message: 'Function metadata unavailable',
                        },
                    },
                });
            return route.fulfill({
                json: liveClient
                    ? await loadSqlFunctions(liveClient)
                    : {
                          functions: state.functions,
                          canCreate: state.canCreate,
                          createReason: state.canCreate
                              ? ''
                              : 'CREATE FUNCTION privilege is required.',
                          canDrop: state.invalidCatalog ? undefined : state.canDrop,
                          dropReason: state.canDrop ? '' : 'DROP FUNCTION privilege is required.',
                      },
            });
        }
        if (action === 'create-function')
            return fulfillFunctionCreate(route, body, state, liveClient);
        if (action === 'drop-function') return fulfillFunctionDrop(route, body, state, liveClient);
        if (action === 'run') return fulfillFunctionRun(route, body, state, liveClient);
        if (action === 'table-permissions')
            return route.fulfill({
                json: options.tablePermissions ?? { create: false, insert: false, drop: false },
            });
        return route.fulfill({
            status: 409,
            json: { error: { code: 'UNEXPECTED_ACTION', message: `Unexpected ${String(action)}` } },
        });
    });
    const catalogResponse =
        options.waitForFunctions === false || options.openObjects === false
            ? undefined
            : page.waitForResponse(
                  response =>
                      response.url().endsWith('/api/cloud') &&
                      jsonRecord(response.request().postDataJSON(), 'Cloud request').action ===
                          'functions',
              );
    await connectPreviewCloud(page, options.path);
    if (options.openObjects !== false)
        await page
            .locator('.icon-rail')
            .getByRole('button', { name: 'Objects', exact: true })
            .click();
    if (catalogResponse) {
        await catalogResponse;
        if (options.invalidCatalog || (options.canCreate === false && !options.existing))
            await expect(page.locator('.sql-functions-tree')).toHaveCount(0);
        else
            await expect(
                page.getByRole('button', { name: 'Create SQL UDF', exact: true }),
            ).toBeVisible();
        await expect(
            page.getByRole('status', { name: 'Loading functions', exact: true }),
        ).toHaveCount(0);
    }
    return {
        state,
        requests,
        close: async () => {
            if (!liveClient) return;
            for (const fn of state.functions)
                await liveClient.command({ query: `DROP FUNCTION IF EXISTS \`${fn.name}\`` });
            await liveClient.close();
        },
    };
}
