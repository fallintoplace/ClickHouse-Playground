import type { ClickHouseClient } from '@clickhouse/client';
import { z } from 'zod';
import { executableCatalogSchema } from '../../../shared/database/functions/python-functions.js';

const metadataSchema = z
    .object({
        name: z.string(),
        argumentNames: z.array(z.string()),
        argumentTypes: z.array(z.string().min(1)),
        returnType: z.string(),
    })
    .refine(
        value =>
            !value.argumentNames.length ||
            value.argumentNames.length === value.argumentTypes.length,
        'Argument names and types must have the same length.',
    );

export async function loadExecutableFunctions(client: Pick<ClickHouseClient, 'query'>) {
    let metadata;
    try {
        metadata = await client.query({
            query: "SELECT name, argument_names AS argumentNames, argument_types AS argumentTypes, return_type AS returnType FROM system.user_defined_functions WHERE load_status = 'Success' ORDER BY name LIMIT 1000",
            format: 'JSONEachRow',
            abort_signal: AbortSignal.timeout(8000),
        });
    } catch (error) {
        const code =
            error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        if (!['47', '60', '497'].includes(code)) throw error;
    }
    if (metadata) {
        const functions = metadataSchema.array().parse(await metadata.json());
        return executableCatalogSchema.parse({
            functions: functions.map(fn => ({
                name: fn.name,
                createQuery: '',
                arguments: fn.argumentTypes.map((type, index) => ({
                    name: fn.argumentNames[index] || `arg${index + 1}`,
                    type,
                })),
                returnType: fn.returnType,
            })),
        });
    }
    const result = await client.query({
        query: "SELECT name, create_query AS createQuery FROM system.functions WHERE origin = 'ExecutableUserDefined' ORDER BY name LIMIT 1000",
        format: 'JSONEachRow',
        abort_signal: AbortSignal.timeout(8000),
    });
    return executableCatalogSchema.parse({ functions: await result.json() });
}
