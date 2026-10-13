import { expect, type Page, type Route } from '@playwright/test';
import { createClient, ClickHouseLogLevel } from '@clickhouse/client';
import {
    loadSqlFunctions,
    createSqlFunction,
} from '../../src/backend/database/functions/sql-functions.js';
import {
    SQL_FUNCTION_TEMPLATES,
    createSqlFunctionQuery,
    type SqlFunction,
} from '../../src/shared/database/functions/sql-functions.js';
import { cloudConnectionTest, cloudSchema } from '../helpers/cloud-fixtures.js';
import { jsonRecord, stringValue } from '../helpers/type-guards.js';
import { connectPreviewCloud } from './cloud-import-helpers.js';

type FunctionTestState = {
    canCreate: boolean;
    functions: SqlFunction[];
    failCreate: boolean;
    failRun: boolean;
    metadataError: boolean;
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
    if (String(body.sql).includes('add_tax_demo')) {
        return route.fulfill({
            json: {
                queryId: body.queryId,
                columns: [
                    { name: 'result', type: 'Float64' },
                    { name: 'result_json', type: 'String' },
                ],
                rows: [[119, '119']],
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

export async function functionsWorkspace(
    page: Page,
    options: { canCreate?: boolean; live?: boolean; existing?: boolean } = {},
) {
    const state: FunctionTestState = {
        canCreate: options.canCreate ?? true,
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
        if (action === 'functions') {
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
                      },
            });
        }
        if (action === 'create-function') {
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
                              ? body.parameters.map(parameter =>
                                    stringValue(parameter, 'Parameter'),
                                )
                              : [],
                          expression: stringValue(body.expression, 'Expression'),
                      }),
                  };
            state.functions.push(fn);
            return route.fulfill({ json: fn });
        }
        if (action === 'run') return fulfillFunctionRun(route, body, state, liveClient);
        if (action === 'table-permissions')
            return route.fulfill({ json: { create: false, insert: false, drop: false } });
        return route.fulfill({
            status: 409,
            json: { error: { code: 'UNEXPECTED_ACTION', message: `Unexpected ${String(action)}` } },
        });
    });
    await connectPreviewCloud(page);
    await page
        .getByRole('navigation', { name: 'Workspace browser' })
        .getByRole('button', { name: 'Objects', exact: true })
        .click();
    await expect(page.getByRole('button', { name: 'Create SQL UDF', exact: true })).toBeVisible();
    await expect(page.getByText('Loading functions…', { exact: true })).toHaveCount(0);
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
