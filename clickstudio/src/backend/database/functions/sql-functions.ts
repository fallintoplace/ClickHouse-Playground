import { StringDecoder } from 'node:string_decoder';
import { CLOUD_QUERY_LIMITS } from '../../../shared/database/connections/cloud-policy.js';
import type { ClickHouseClient } from '@clickhouse/client';
import { randomUUID } from 'node:crypto';
import { isRecord } from '../../../shared/common/values.js';
import {
    createSqlFunctionQuery,
    sqlFunctionParameters,
    type FunctionCatalog,
    type SqlFunctionInput,
} from '../../../shared/database/functions/sql-functions.js';
import { requireThat } from '../../system/requests/errors.js';

type FunctionClient = Pick<ClickHouseClient, 'exec' | 'command'>;

async function rows(client: FunctionClient, query: string): Promise<Record<string, unknown>[]> {
    const result = await client.exec({
        query: query.startsWith('SELECT') ? `${query} FORMAT JSONEachRow` : query,
        abort_signal: AbortSignal.timeout(8000),
        clickhouse_settings: query.startsWith('SELECT') ? {} : { default_format: 'JSONEachRow' },
    });
    const decoder = new StringDecoder('utf8');
    let text = '',
        size = 0;
    for await (const chunk of result.stream) {
        const value: unknown = chunk;
        requireThat(
            typeof value === 'string' || value instanceof Uint8Array,
            502,
            'FUNCTION_RESPONSE',
            'Invalid function metadata stream.',
        );
        const bytes = Buffer.from(value);
        size += bytes.length;
        requireThat(
            size <= CLOUD_QUERY_LIMITS.bytes,
            502,
            'FUNCTION_RESPONSE_SIZE',
            'Function metadata exceeds the 2 MB limit.',
        );
        text += decoder.write(bytes);
    }
    text += decoder.end();
    return text
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
            const value: unknown = JSON.parse(line);
            requireThat(isRecord(value), 502, 'FUNCTION_RESPONSE', 'Invalid function metadata.');
            return value;
        });
}

export async function functionCreationPermission(client: FunctionClient) {
    try {
        const settings = (
            await rows(
                client,
                "SELECT getSetting('readonly') AS readonly, getSetting('allow_ddl') AS allow_ddl",
            )
        )[0];
        if (
            !settings ||
            (settings.readonly !== 0 && settings.readonly !== '0') ||
            Number(settings.allow_ddl) !== 1
        )
            return { canCreate: false, createReason: 'This connection does not allow DDL.' };
        const grant = (await rows(client, 'CHECK GRANT CREATE FUNCTION ON *.*'))[0];
        const canCreate = Number(grant?.result) === 1;
        return {
            canCreate,
            createReason: canCreate ? '' : 'CREATE FUNCTION privilege is required.',
        };
    } catch {
        return {
            canCreate: false,
            createReason: 'Could not verify CREATE FUNCTION privileges. Refresh to try again.',
        };
    }
}

export async function loadSqlFunctions(client: FunctionClient): Promise<FunctionCatalog> {
    const [metadata, permission] = await Promise.all([
        rows(
            client,
            "SELECT name, create_query FROM system.functions WHERE origin = 'SQLUserDefined' ORDER BY name LIMIT 1000",
        ),
        functionCreationPermission(client),
    ]);
    return {
        ...permission,
        functions: metadata.map(row => {
            requireThat(
                typeof row.name === 'string' && typeof row.create_query === 'string',
                502,
                'FUNCTION_RESPONSE',
                'Invalid SQL function metadata.',
            );
            return {
                name: row.name,
                createQuery: row.create_query,
                parameters: sqlFunctionParameters(row.create_query),
            };
        }),
    };
}

export async function createSqlFunction(client: FunctionClient, body: Record<string, unknown>) {
    requireThat(
        typeof body.name === 'string' &&
            typeof body.expression === 'string' &&
            Array.isArray(body.parameters) &&
            body.parameters.every(value => typeof value === 'string'),
        400,
        'FUNCTION_INPUT',
        'Check the function name, parameters and expression.',
    );
    const input: SqlFunctionInput = {
        name: body.name,
        expression: body.expression,
        parameters: body.parameters,
    };
    let query;
    try {
        query = createSqlFunctionQuery(input);
    } catch (error) {
        requireThat(
            false,
            400,
            'FUNCTION_INPUT',
            error instanceof Error ? error.message : 'Invalid SQL function.',
        );
    }
    const permission = await functionCreationPermission(client);
    requireThat(permission.canCreate, 403, 'FUNCTION_PERMISSION', permission.createReason);
    await client.command({
        query,
        query_id: `clickstudio-create-function-${randomUUID()}`,
        abort_signal: AbortSignal.timeout(15000),
    });
    return { name: input.name, parameters: input.parameters, createQuery: query };
}
