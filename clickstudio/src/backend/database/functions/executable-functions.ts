import type { ClickHouseClient } from '@clickhouse/client';
import { executableCatalogSchema } from '../../../shared/database/functions/python-functions.js';

export async function loadExecutableFunctions(client: Pick<ClickHouseClient, 'query'>) {
    const result = await client.query({
        query: "SELECT name, create_query AS createQuery FROM system.functions WHERE origin = 'ExecutableUserDefined' ORDER BY name LIMIT 1000",
        format: 'JSONEachRow',
        abort_signal: AbortSignal.timeout(8000),
    });
    return executableCatalogSchema.parse({ functions: await result.json() });
}
