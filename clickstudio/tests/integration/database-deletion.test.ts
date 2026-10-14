import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../../src/backend/app/app.js';
import { loadConfig } from '../../src/backend/system/config.js';
import { MemoryStore } from '../../src/backend/system/store.js';
import cloudApi from '../../api/cloud.js';
import * as cloud from '../../src/frontend/database/connections/cloud-connection.js';
import { cloudConnectionTest } from '../helpers/cloud-fixtures.js';
import { jsonRecord, jsonValue, responseErrorCode, serverPort } from '../helpers/type-guards.js';

test('Local database deletion checks trust and confirmation, uses the writer, and switches the active database', async t => {
    const requests: { query: string; database: string | null; authorization?: string }[] = [];
    let deny = false;
    const clickhouse = createServer((req, res) => {
        void (async () => {
            let query = '';
            for await (const chunk of req) query += String(chunk);
            const url = new URL(req.url!, 'http://localhost');
            requests.push({
                query,
                database: url.searchParams.get('database'),
                authorization: req.headers.authorization,
            });
            if (query.startsWith('DROP DATABASE')) {
                res.statusCode = deny ? 403 : 200;
                res.end(deny ? 'DROP DATABASE privilege is required' : '');
            } else {
                res.setHeader('content-type', 'application/json');
                res.end(
                    JSON.stringify(
                        query.startsWith('SELECT') ? { readonly: 0, allow_ddl: 1 } : { result: 1 },
                    ) + '\n',
                );
            }
        })().catch(error => res.destroy(error instanceof Error ? error : new Error(String(error))));
    });
    await new Promise<void>(resolve => clickhouse.listen(0, '127.0.0.1', resolve));
    const config = loadConfig({
        CLICKHOUSE_URL: `http://127.0.0.1:${serverPort(clickhouse)}`,
        CLICKHOUSE_DATABASE: 'analytics',
        CLICKHOUSE_USER: 'reader',
        CLICKHOUSE_PASSWORD: 'reader-fixture',
        CLICKHOUSE_WRITER_USER: 'writer',
        CLICKHOUSE_WRITER_PASSWORD: 'writer-fixture',
    });
    const service = createApp(config, { store: new MemoryStore() });
    const server = service.app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    config.origin = `http://127.0.0.1:${serverPort(server)}`;
    t.after(async () => {
        await service.close();
        server.closeAllConnections();
        clickhouse.closeAllConnections();
        await Promise.all([
            new Promise<void>(resolve => server.close(() => resolve())),
            new Promise<void>(resolve => clickhouse.close(() => resolve())),
        ]);
    });
    const connectionId = config.profiles.find(profile => !profile.publicPlayground)!.id;
    const call = (suffix: string, method: string, body?: unknown) =>
        fetch(`${config.origin}/api/connections/${connectionId}${suffix}`, {
            method,
            headers: { 'content-type': 'application/json', 'x-clickstudio-intent': '1' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
    const drop = (database: string, confirmation = database) =>
        call('/databases', 'DELETE', { database, confirmation });
    const untrusted = await drop('analytics');
    assert.equal(await responseErrorCode(untrusted), 'WORKSPACE_UNTRUSTED');
    await call('/trust', 'POST', { confirmation: connectionId, trusted: true });
    for (const database of ['default', 'system', 'INFORMATION_SCHEMA']) {
        assert.equal(await responseErrorCode(await drop(database)), 'DATABASE_DROP_TARGET');
    }
    assert.equal(
        await responseErrorCode(await drop('analytics', 'Analytics')),
        'DATABASE_DROP_CONFIRMATION',
    );
    assert.equal(requests.length, 0);
    deny = true;
    const denied = await drop('analytics');
    assert.equal(denied.ok, false);
    assert.equal(service.driver.database(connectionId), 'analytics');
    deny = false;
    const deleted = await drop('analytics');
    assert.equal(deleted.status, 200);
    const result = jsonRecord(await deleted.json());
    assert.equal(result.database, 'analytics');
    assert.equal(service.driver.database(connectionId), 'default');
    assert.equal(requests.at(-1)?.query, 'DROP DATABASE IF EXISTS `analytics`');
    assert.equal(
        requests.at(-1)?.authorization,
        'Basic ' + Buffer.from('writer:writer-fixture').toString('base64'),
    );
    const permissions = await call('/table-permissions', 'POST', { database: 'other' });
    assert.equal(permissions.status, 200);
    assert.notEqual(requests.at(-1)?.database, 'analytics');
});

const credentials = {
    host: 'service.clickhouse.cloud:8443',
    database: 'analytics',
    username: 'reader',
    password: 'fixture-password',
};

test('Cloud database deletion validates protected names and exact confirmation before contacting ClickHouse', async () => {
    for (const [database, confirmation, code] of [
        ['default', 'default', 'DATABASE_DROP_TARGET'],
        ['system', 'system', 'DATABASE_DROP_TARGET'],
        ['INFORMATION_SCHEMA', 'INFORMATION_SCHEMA', 'DATABASE_DROP_TARGET'],
        ['analytics', 'Analytics', 'DATABASE_DROP_CONFIRMATION'],
        ['analytics', 'analytics ', 'DATABASE_DROP_CONFIRMATION'],
        ['analytics', '', 'DATABASE_DROP_CONFIRMATION'],
    ]) {
        const response = await cloudApi.fetch(
            new Request('https://clickstudio.example/api/cloud', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    action: 'drop-database',
                    credentials,
                    database,
                    confirmation,
                }),
            }),
        );
        assert.equal(await responseErrorCode(response), code);
    }
});

test('Cloud deletion switches the active profile and subsequent requests to default only on success', async t => {
    const requests: Record<string, unknown>[] = [];
    let fail = true;
    t.mock.method(globalThis, 'fetch', async (_url: unknown, options?: RequestInit) => {
        const body = jsonRecord(jsonValue(String(options?.body)));
        requests.push(body);
        if (body.action === 'test')
            return Response.json(cloudConnectionTest({ database: 'analytics' }));
        if (body.action === 'drop-database')
            return fail
                ? Response.json(
                      { error: { code: 'DENIED', message: 'Permission revoked' } },
                      { status: 403 },
                  )
                : Response.json({ database: 'analytics', queryId: 'drop-id' });
        return Response.json({ create: true, dropDatabase: true });
    });
    t.after(() => cloud.disconnectClickHouseCloud());
    await cloud.connectClickHouseCloud(credentials);
    await assert.rejects(
        cloud.dropClickHouseCloudDatabase('analytics', 'analytics'),
        /Permission revoked/,
    );
    assert.equal(cloud.getClickHouseCloudConnection()?.database, 'analytics');
    fail = false;
    await cloud.dropClickHouseCloudDatabase('analytics', 'analytics');
    assert.equal(cloud.getClickHouseCloudConnection()?.database, 'default');
    await cloud.loadClickHouseCloudTablePermissions('other');
    assert.equal(jsonRecord(requests.at(-1)?.credentials).database, 'default');
});

test('A late Cloud deletion never changes a replacement connection', async t => {
    let release: (response: Response) => void = () => {};
    const pending = new Promise<Response>(resolve => {
        release = resolve;
    });
    t.mock.method(globalThis, 'fetch', async (_url: unknown, options?: RequestInit) => {
        const body = jsonRecord(jsonValue(String(options?.body)));
        return body.action === 'drop-database' ? pending : Response.json(cloudConnectionTest());
    });
    t.after(() => cloud.disconnectClickHouseCloud());
    await cloud.connectClickHouseCloud(credentials);
    const deleting = cloud.dropClickHouseCloudDatabase('analytics', 'analytics');
    await cloud.connectClickHouseCloud({ ...credentials, host: 'other.clickhouse.cloud:8443' });
    const replacement = cloud.getClickHouseCloudConnection();
    release(Response.json({ database: 'analytics', queryId: 'drop-id' }));
    await deleting;
    assert.equal(cloud.getClickHouseCloudConnection(), replacement);
    assert.equal(replacement?.database, 'analytics');
});
