import { booleanValue, countValue, stringValue } from './row-values.js';

export interface ReplicationCapabilities {
    replicas: boolean;
    queue: boolean;
}

export interface ReplicationTable {
    database: string;
    table: string;
    replicaName: string;
    leader: boolean;
    readonly: boolean;
    sessionExpired: boolean;
    absoluteDelay: number;
    queueSize: number;
    insertsInQueue: number;
    mergesInQueue: number;
    futureParts: number;
    totalReplicas: number;
    activeReplicas: number;
}

export interface ReplicationQueueGroup {
    database: string;
    table: string;
    type: string;
    entries: number;
    oldestAt: string;
    maxTries: number;
    errors: number;
    postponed: number;
    executing: number;
}

export interface ReplicationSnapshot {
    connectionId: string;
    scope: 'local-node';
    capabilities: ReplicationCapabilities;
    replicas: ReplicationTable[];
    queue: ReplicationQueueGroup[];
    truncated: boolean;
}

type Row = Record<string, unknown>;

export function replicationReplicasQuery() {
    return `SELECT database, table, replica_name, is_leader, is_readonly, is_session_expired,
        absolute_delay, queue_size, inserts_in_queue, merges_in_queue, future_parts,
        total_replicas, active_replicas
    FROM system.replicas
    ORDER BY database, table
    LIMIT 501`;
}

export function replicationQueueQuery() {
    return `SELECT database, table, type, count() AS entries, toString(min(create_time)) AS oldest_at,
        max(num_tries) AS max_tries, countIf(last_exception != '') AS errors,
        countIf(postpone_reason != '') AS postponed, countIf(is_currently_executing) AS executing
    FROM system.replication_queue
    GROUP BY database, table, type
    ORDER BY entries DESC, database, table
    LIMIT 501`;
}

export function parseReplicationSnapshot(
    connectionId: string,
    capabilities: ReplicationCapabilities,
    replicaRows: readonly Row[],
    queueRows: readonly Row[],
): ReplicationSnapshot {
    const replicas = replicaRows
        .slice(0, 500)
        .map(row => ({
            database: stringValue(row.database),
            table: stringValue(row.table),
            replicaName: stringValue(row.replica_name),
            leader: booleanValue(row.is_leader),
            readonly: booleanValue(row.is_readonly),
            sessionExpired: booleanValue(row.is_session_expired),
            absoluteDelay: countValue(row.absolute_delay),
            queueSize: countValue(row.queue_size),
            insertsInQueue: countValue(row.inserts_in_queue),
            mergesInQueue: countValue(row.merges_in_queue),
            futureParts: countValue(row.future_parts),
            totalReplicas: countValue(row.total_replicas),
            activeReplicas: countValue(row.active_replicas),
        }))
        .filter(replica => replica.database.length > 0 && replica.table.length > 0);
    const queue = queueRows
        .slice(0, 500)
        .map(row => ({
            database: stringValue(row.database),
            table: stringValue(row.table),
            type: stringValue(row.type),
            entries: countValue(row.entries),
            oldestAt: stringValue(row.oldest_at),
            maxTries: countValue(row.max_tries),
            errors: countValue(row.errors),
            postponed: countValue(row.postponed),
            executing: countValue(row.executing),
        }))
        .filter(
            group => group.database.length > 0 && group.table.length > 0 && group.type.length > 0,
        );
    return {
        connectionId,
        scope: 'local-node',
        capabilities,
        replicas,
        queue,
        truncated: replicaRows.length > 500 || queueRows.length > 500,
    };
}
