import type { CloudConnectionTest } from '../../src/frontend/database/connections/cloud-connection.js';

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
