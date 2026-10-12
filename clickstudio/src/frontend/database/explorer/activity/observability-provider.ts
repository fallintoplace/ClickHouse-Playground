import type { WorkloadWindow } from '../../../../shared/database/explorer/activity/workload';
import { api, apiResponses } from '../../../api/client';
import {
    CLICKHOUSE_CLOUD_CONNECTION_ID,
    loadClickHouseCloudReplication,
    loadClickHouseCloudWorkload,
} from '../../connections/cloud-connection';

export function loadWorkload(connectionId: string, minutes: WorkloadWindow, signal: AbortSignal) {
    if (connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID)
        return loadClickHouseCloudWorkload(minutes, signal);
    return api(
        `/connections/${encodeURIComponent(connectionId)}/workload?minutes=${minutes}`,
        apiResponses.isWorkloadSnapshot,
        { signal },
    );
}

export function loadReplication(connectionId: string, signal: AbortSignal) {
    if (connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID)
        return loadClickHouseCloudReplication(signal);
    return api(
        `/connections/${encodeURIComponent(connectionId)}/replication`,
        apiResponses.isReplicationSnapshot,
        { signal },
    );
}
