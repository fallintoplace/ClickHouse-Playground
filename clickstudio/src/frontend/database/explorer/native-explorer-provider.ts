import {
    loadNativeExplorer,
    type NativeExplorerRequest,
    type NativeExplorerSnapshot,
} from '../../../shared/database/explorer/explorers';
import { api, apiResponses, isFrontendDemoPreview } from '../../api/client';
import {
    CLICKHOUSE_CLOUD_CONNECTION_ID,
    loadClickHouseCloudNativeExplorer,
} from '../connections/cloud-connection';
import {
    PLAYGROUND_CONNECTION_ID,
    queryPlaygroundWithParams,
} from '../connections/playground-client';

export function requestNativeExplorer(
    connectionId: string,
    request: NativeExplorerRequest,
    signal: AbortSignal,
): Promise<NativeExplorerSnapshot> {
    if (connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID)
        return loadClickHouseCloudNativeExplorer(request, signal);
    if (isFrontendDemoPreview && connectionId === PLAYGROUND_CONNECTION_ID)
        return loadNativeExplorer(
            request,
            async (sql, parameters) => {
                const response = await queryPlaygroundWithParams(sql, parameters, signal);
                if (response.truncated)
                    throw new Error(
                        'The metadata response exceeded the Playground limit. Select a smaller database or table.',
                    );
                return response.rows.map(row =>
                    Object.fromEntries(
                        response.columns.map((column, index) => [column.name, row[index]]),
                    ),
                );
            },
            signal,
        );
    return api(
        `/connections/${encodeURIComponent(connectionId)}/native-explorer`,
        apiResponses.isNativeExplorerSnapshot,
        { method: 'POST', body: request, signal },
    );
}
