import type { CloudConnectionTest } from '../../src/frontend/database/connections/cloud-connection.js';
import type { Schema } from '../../src/shared/database/schema/types.js';

export const cloudSchema: Schema = {
    connectionId: 'clickhouse-cloud',
    fetchedAt: '2026-09-28T00:00:00.000Z',
    databases: ['default'],
    tables: [{ database: 'default', name: 'events', engine: 'MergeTree' }],
    columns: [
        {
            database: 'default',
            table: 'events',
            name: 'day',
            type: 'Date',
            defaultKind: '',
            comment: '',
        },
        {
            database: 'default',
            table: 'events',
            name: 'events',
            type: 'UInt64',
            defaultKind: '',
            comment: '',
        },
    ],
    warnings: [],
    truncated: false,
};

export function cloudConnectionTest(
    overrides: Partial<CloudConnectionTest> = {},
): CloudConnectionTest {
    return {
        host: 'service.clickhouse.cloud:8443',
        database: 'default',
        username: 'reader',
        serverVersion: '25.1',
        queryLog: { available: true },
        queryLogSource: 'query_log',
        replication: { available: true },
        progress: { available: false, reason: 'Progress polling is not mocked in these tests.' },
        cancellation: { available: true },
        explain: { available: true },
        explainPlan: { available: true },
        explainAnalyze: { available: true },
        queryTree: { available: true },
        explainPipeline: { available: true },
        pipeline: { available: true },
        traceLog: { available: true },
        traceLogSource: 'symbolized',
        documentation: { available: true },
        parameters: { available: true },
        ...overrides,
    };
}
