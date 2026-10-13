import { StringDecoder } from 'node:string_decoder';
import { CLOUD_QUERY_LIMITS } from '../../../shared/database/connections/cloud-policy.js';
import type { ClickHouseClient } from '@clickhouse/client';
import { randomUUID } from 'node:crypto';
import { isRecord } from '../../../shared/common/values.js';
import { quoteIdentifier } from '../../../shared/sql/sql.js';
import {
    createSqlFunctionQuery,
    sqlFunctionParameters,
    type FunctionCatalog,
    type SqlFunctionInput,
    type SqlFunctionDrop,
} from '../../../shared/database/functions/sql-functions.js';
import { requireThat } from '../../system/requests/errors.js';

type FunctionClient = Pick<ClickHouseClient, 'exec' | 'command'>;

async function rows(
    client: FunctionClient,
    query: string,
    queryParams?: Record<string, string>,
): Promise<Record<string, unknown>[]> {
    const result = await client.exec({
        query: query.startsWith('SELECT') ? `${query} FORMAT JSONEachRow` : query,
        query_params: queryParams,
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

async function functionPermission(client: FunctionClient, action: 'CREATE' | 'DROP') {
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
            return { allowed: false, reason: 'This connection does not allow DDL.' };
        const grant = (await rows(client, `CHECK GRANT ${action} FUNCTION ON *.*`))[0];
        const allowed = Number(grant?.result) === 1;
        return {
            allowed,
            reason: allowed ? '' : `${action} FUNCTION privilege is required.`,
        };
    } catch {
        return {
            allowed: false,
            reason: `Could not verify ${action} FUNCTION privileges. Refresh to try again.`,
        };
    }
}

export async function functionCreationPermission(client: FunctionClient) {
    const permission = await functionPermission(client, 'CREATE');
    return { canCreate: permission.allowed, createReason: permission.reason };
}

export async function functionDeletionPermission(client: FunctionClient) {
    const permission = await functionPermission(client, 'DROP');
    return { canDrop: permission.allowed, dropReason: permission.reason };
}

export async function loadSqlFunctions(client: FunctionClient): Promise<FunctionCatalog> {
    const [metadata, creation, deletion] = await Promise.all([
        rows(
            client,
            "SELECT name, create_query FROM system.functions WHERE origin = 'SQLUserDefined' ORDER BY name LIMIT 1000",
        ),
        functionCreationPermission(client),
        functionDeletionPermission(client),
    ]);
    return {
        ...creation,
        ...deletion,
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

export async function dropSqlFunction(
    client: FunctionClient,
    body: Record<string, unknown>,
): Promise<SqlFunctionDrop> {
    requireThat(
        typeof body.name === 'string' &&
            body.name.trim().length > 0 &&
            body.name.length <= 8192 &&
            !Array.from(body.name).some(
                character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
            ),
        400,
        'FUNCTION_INPUT',
        'Enter a valid function name of up to 8,192 characters.',
    );
    requireThat(
        body.confirmation === body.name,
        400,
        'FUNCTION_DROP_CONFIRMATION',
        'Type the exact function name to confirm deletion.',
    );
    const permission = await functionDeletionPermission(client);
    requireThat(permission.canDrop, 403, 'FUNCTION_PERMISSION', permission.dropReason);
    const target = (
        await rows(
            client,
            'SELECT origin FROM system.functions WHERE name = {name:String} LIMIT 1',
            {
                name: body.name,
            },
        )
    )[0];
    requireThat(
        !target || target.origin === 'SQLUserDefined',
        400,
        'FUNCTION_DROP_TARGET',
        'Only SQL UDFs can be deleted here.',
    );
    if (target)
        await client.command({
            query: `DROP FUNCTION IF EXISTS ${quoteIdentifier(body.name)}`,
            query_id: `clickstudio-drop-function-${randomUUID()}`,
            abort_signal: AbortSignal.timeout(15000),
        });
    return { name: body.name };
}
