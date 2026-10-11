import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ClickHouseDriver } from '../../src/backend/database/clickhouse/client.js';
import { loadConfig } from '../../src/backend/system/config.js';

test('Local permission probes use the writer identity and preserve ClickHouse grant SQL', async t => {
    const requests: { query: string; authorization?: string; format: string | null }[] = [];
    const server = createServer(async (req, res) => {
        let query = '';
        for await (const chunk of req) query += String(chunk);
        const url = new URL(req.url!, 'http://localhost');
        requests.push({
            query,
            authorization: req.headers.authorization,
            format: url.searchParams.get('default_format'),
        });
        let row: Record<string, unknown>;
        if (query.startsWith('SELECT')) row = { readonly: 0, allow_ddl: 1 };
        else if (query === 'SHOW GRANTS FINAL')
            row = { grants: 'GRANT INSERT ON analytics.events TO writer' };
        else row = { result: query.startsWith('CHECK GRANT INSERT') ? 1 : 0 };
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(row) + '\n');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const config = loadConfig({
        CLICKHOUSE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        CLICKHOUSE_USER: 'fixture-reader',
        CLICKHOUSE_PASSWORD: 'reader-secret',
        CLICKHOUSE_WRITER_USER: 'fixture-writer',
        CLICKHOUSE_WRITER_PASSWORD: 'writer-secret',
    });
    const driver = new ClickHouseDriver(config);
    t.after(async () => {
        await driver.close();
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
    });
    const connection = driver
        .connections({ id: 'owner', role: 'owner' })
        .find(c => c.id !== 'playground')!;
    assert.equal(connection.readonly, true);
    assert.deepEqual(await driver.tablePermissions(connection.id, 'analytics', 'events'), {
        create: false,
        insert: true,
        drop: false,
    });
    assert.equal(requests.length, 5);
    for (const request of requests) {
        assert.equal(
            request.authorization,
            'Basic ' + Buffer.from('fixture-writer:writer-secret').toString('base64'),
        );
        assert.equal(request.format, 'JSONEachRow');
        assert.doesNotMatch(request.query, /\bFORMAT\b/);
    }
    assert.deepEqual(await driver.tablePermissions('playground', 'github', 'events'), {
        create: false,
        insert: false,
        drop: false,
    });
    assert.equal(requests.length, 5);
});
