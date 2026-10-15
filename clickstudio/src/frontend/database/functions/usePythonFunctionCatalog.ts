import { useCallback } from 'react';
import {
    executableCatalogSchema,
    type ExecutableFunction,
} from '../../../shared/database/functions/python-functions';
import { CLICKHOUSE_CLOUD_CONNECTION_ID } from '../../../shared/database/connections/cloud-policy';
import { PLAYGROUND_CONNECTION_ID } from '../../../shared/database/connections/playground';
import type { Connected } from '../../workspace/workspace-types';
import { api } from '../../api/client';
import { loadClickHouseCloudExecutableFunctions } from '../connections/cloud-connection';
import { useFunctionCatalog } from './useFunctionCatalog';

export function usePythonFunctionCatalog(
    connection: Connected,
    trusted: boolean,
    visible: boolean,
) {
    const enabled =
        trusted &&
        connection.dataSource !== 'fixture' &&
        connection.id !== PLAYGROUND_CONNECTION_ID;
    const load = useCallback(
        (signal: AbortSignal) =>
            connection.id === CLICKHOUSE_CLOUD_CONNECTION_ID
                ? loadClickHouseCloudExecutableFunctions(signal)
                : api(
                      `/connections/${encodeURIComponent(connection.id)}/executable-functions`,
                      (value): value is { functions: ExecutableFunction[] } =>
                          executableCatalogSchema.safeParse(value).success,
                      { signal },
                  ),
        [connection.id],
    );
    const { catalog, ...state } = useFunctionCatalog(connection, enabled, visible, load);
    return {
        ...state,
        enabled,
        functions: catalog?.functions ?? [],
        available: catalog !== undefined,
    };
}

export type PythonFunctionCatalogState = ReturnType<typeof usePythonFunctionCatalog>;
