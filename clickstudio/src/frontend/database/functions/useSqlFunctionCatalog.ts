import { CLICKHOUSE_CLOUD_CONNECTION_ID } from '../../../shared/database/connections/cloud-policy';
import type { Connected } from '../../workspace/workspace-types';
import { loadClickHouseCloudFunctions } from '../connections/cloud-connection';
import { useFunctionCatalog } from './useFunctionCatalog';

export function useSqlFunctionCatalog(connection: Connected, trusted: boolean, visible: boolean) {
    return useFunctionCatalog(
        connection,
        trusted && connection.id === CLICKHOUSE_CLOUD_CONNECTION_ID,
        visible,
        loadClickHouseCloudFunctions,
    );
}

export type SqlFunctionCatalogState = ReturnType<typeof useSqlFunctionCatalog>;
