import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/backend/app/app.js';
import { loadConfig } from '../../src/backend/system/config.js';
import { CLOUD_SESSION_COOKIE } from '../../src/backend/database/connections/cloud-sessions.js';
import { MemoryStore } from '../../src/backend/system/store.js';
import { DemoDriver } from '../../src/backend/database/clickhouse/sample-client.js';
import cloudApi from '../../src/backend/database/connections/cloud-api.js';
import { isRecord, jsonRecord, responseErrorCode, serverPort } from '../helpers/type-guards.js';

const credentials = {
    host: 'service.region.provider.clickhouse.cloud:8443',
    database: 'default',
    username: 'default',
    password: 'local-cloud-secret',
};
const tested = {
    host: credentials.host,
    database: credentials.database,
    username: credentials.username,
    serverVersion: '25.1.1',
    queryLog: { available: true },
};
type CloudCall = { action: string; credentials?: typeof credentials };

function isCloudCredentials(value: unknown): value is typeof credentials {
    return (
        isRecord(value) &&
        typeof value.host === 'string' &&
        typeof value.database === 'string' &&
        typeof value.username === 'string' &&
        typeof value.password === 'string'
    );
}

async function start(cloudApiOverride?: CloudApiStub) {
    const cloudCalls: CloudCall[] = [];
    const defaultCloudApi = {
        fetch: async (request: Request) => {
            const contentType = request.headers.get('content-type') ?? '';
            if (contentType.startsWith('multipart/form-data')) {
                const form = await request.formData();
                const value = form.get('credentials');
                const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : undefined;
                const saved = isCloudCredentials(parsed) ? parsed : undefined;
                cloudCalls.push({ action: String(form.get('action') ?? ''), credentials: saved });
                return Response.json({ accepted: true });
            }
            const body = jsonRecord(await request.json(), 'Cloud request body');
            const action = typeof body.action === 'string' ? body.action : '';
            const requestCredentials = isCloudCredentials(body.credentials)
                ? body.credentials
                : undefined;
            cloudCalls.push({ action, credentials: requestCredentials });
            if (action === 'test') {
                if (requestCredentials?.password === 'bad-password')
                    return Response.json(
                        {
                            error: {
                                code: 'CLICKHOUSE_PERMISSION',
                                message: 'Credentials were rejected.',
                            },
                        },
                        { status: 403 },
                    );
                return Response.json({
                    ...tested,
                    host: requestCredentials?.host ?? tested.host,
                    database: requestCredentials?.database ?? tested.database,
                });
            }
            if (!requestCredentials)
                return Response.json(
                    { error: { code: 'CLOUD_CREDENTIALS', message: 'Missing credentials.' } },
                    { status: 400 },
                );
            if (action === 'drop-database')
                return body.confirmation === body.database
                    ? Response.json({ database: body.database, queryId: 'drop-id' })
                    : Response.json(
                          {
                              error: {
                                  code: 'DATABASE_DROP_CONFIRMATION',
                                  message: 'Type the exact database name.',
                              },
                          },
                          { status: 400 },
                      );
            return Response.json({ action, credentials: requestCredentials });
        },
    };
    const cloudApi = cloudApiOverride ?? defaultCloudApi;
    const config = loadConfig({ DEMO_MODE: 'true' });
    const service = createApp(config, {
        store: new MemoryStore(),
        driver: new DemoDriver(),
        cloudApi,
    });
    const server = service.app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    config.origin = `http://127.0.0.1:${serverPort(server)}`;
    const call = (
        path: string,
        body?: unknown,
        headers: Record<string, string> = {},
        method = body === undefined ? 'GET' : 'POST',
    ) =>
        fetch(`${config.origin}/api${path}`, {
            method,
            headers: {
                'content-type': 'application/json',
                'x-clickstudio-intent': '1',
                ...headers,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    return {
        call,
        cloudCalls,
        origin: config.origin,
        stop: async () => {
            await service.close();
            server.closeAllConnections();
            await new Promise<void>(resolve => server.close(() => resolve()));
        },
    };
}

function cookieFrom(response: Response) {
    return response.headers.get('set-cookie')?.split(';', 1)[0];
}

test('Local Cloud database deletion updates the saved session only after a successful drop', async t => {
    const app = await start();
    t.after(() => app.stop());
    const connected = await app.call('/cloud/session', {
        credentials: { ...credentials, database: 'analytics' },
    });
    const cookie = cookieFrom(connected)!;
    const drop = (confirmation: string) =>
        app.call(
            '/cloud',
            { action: 'drop-database', database: 'analytics', confirmation },
            { cookie },
        );
    assert.equal((await drop('Analytics')).status, 400);
    await app.call('/cloud', { action: 'schema' }, { cookie });
    assert.equal(app.cloudCalls.at(-1)?.credentials?.database, 'analytics');
    assert.equal((await drop('analytics')).status, 200);
    await app.call('/cloud', { action: 'schema' }, { cookie });
    assert.equal(app.cloudCalls.at(-1)?.credentials?.database, 'default');
    const restored = jsonRecord(
        await (await app.call('/cloud/session', undefined, { cookie })).json(),
    );
    const session = jsonRecord(restored.session);
    assert.equal(jsonRecord(session.profile).database, 'default');
    assert.equal(jsonRecord(session.tested).database, 'default');
});

test('Local Cloud full-result downloads stream CSV from a same-origin form', async t => {
    let releaseCsv: () => void = () => {};
    let receivedSql: unknown;
    let receivedParameters: unknown;
    let receivedAction: unknown;
    const csvGate = new Promise<void>(resolve => {
        releaseCsv = resolve;
    });
    const cloudApi = {
        fetch: async (request: Request) => {
            const payload = jsonRecord(await request.json(), 'Cloud request body');
            receivedAction = payload.action;
            if (payload.action === 'test') return Response.json(tested);
            if (payload.action === 'full-export') {
                receivedSql = payload.sql;
                receivedParameters = payload.parameters;
                let sentHeader = false;
                const stream = new ReadableStream<Uint8Array>({
                    async pull(controller) {
                        if (!sentHeader) {
                            sentHeader = true;
                            controller.enqueue(new TextEncoder().encode('day,events\n'));
                            await csvGate;
                            controller.enqueue(new TextEncoder().encode('2026-01-01,10\n'));
                            controller.close();
                        }
                    },
                });
                return new Response(stream, {
                    headers: {
                        'Content-Type': 'text/csv; charset=utf-8',
                        'Content-Disposition': 'attachment; filename="full.csv"',
                    },
                });
            }
            return Response.json({ error: { code: 'UNEXPECTED_ACTION', message: 'Unexpected.' } });
        },
    };
    const app = await start(cloudApi);
    t.after(() => app.stop());
    const connected = await app.call('/cloud/session', { credentials });
    const cookie = cookieFrom(connected)!;
    const downloadPromise = fetch(`${app.origin}/api/cloud`, {
        method: 'POST',
        headers: {
            cookie,
            origin: app.origin,
            'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            action: 'full-export',
            sql: 'SELECT {value:UInt64}',
            parameters: JSON.stringify({ value: '42' }),
        }),
    });
    const earlyResponse = await Promise.race([
        downloadPromise.then(response => response),
        new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 1000)),
    ]);
    releaseCsv();
    assert.ok(earlyResponse, 'the download response should start before the CSV is complete');
    assert.equal(earlyResponse.status, 200, await earlyResponse.clone().text());
    assert.equal(receivedAction, 'full-export', await earlyResponse.clone().text());
    assert.equal(
        earlyResponse.headers.get('content-disposition'),
        'attachment; filename="full.csv"',
    );
    assert.equal(receivedSql, 'SELECT {value:UInt64}');
    assert.deepEqual(receivedParameters, { value: '42' });
    const csv = await earlyResponse.text();
    assert.equal(csv, 'day,events\n2026-01-01,10\n');
});

test('Cloud full-result form rejects non-read queries before connecting', async () => {
    const origin = 'https://clickstudio.example';
    const response = await cloudApi.fetch(
        new Request(`${origin}/api/cloud`, {
            method: 'POST',
            headers: {
                origin,
                'content-type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                action: 'full-export',
                sql: 'DROP TABLE events',
                parameters: '{}',
                credentials: JSON.stringify(credentials),
            }),
        }),
    );
    assert.equal(response.status, 403);
    assert.equal(await responseErrorCode(response), 'READ_ONLY_SQL');
});

test('Local Cloud connection restores after refresh without returning its password', async t => {
    const app = await start();
    t.after(() => app.stop());
    const connected = await app.call('/cloud/session', { credentials });
    assert.equal(connected.status, 200);
    const setCookie = connected.headers.get('set-cookie') ?? '';
    const cookie = cookieFrom(connected);
    assert.ok(cookie?.startsWith(`${CLOUD_SESSION_COOKIE}=`));
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.match(setCookie, /Path=\/api;/i);
    assert.equal(/Max-Age=/i.test(setCookie), false);

    const refreshed = await app.call('/cloud/session', undefined, { cookie: cookie! });
    const snapshot = jsonRecord(await refreshed.json(), 'Cloud session response');
    const session = jsonRecord(snapshot.session, 'Cloud session');
    const profile = jsonRecord(session.profile, 'Cloud profile');
    assert.equal(refreshed.status, 200);
    assert.equal(profile.host, tested.host);
    assert.equal(JSON.stringify(snapshot).includes(credentials.password), false);

    const schema = await app.call('/cloud', { action: 'schema' }, { cookie: cookie! });
    assert.equal(schema.status, 200);
    assert.equal(app.cloudCalls.at(-1)?.credentials?.password, credentials.password);
});

test('Local Cloud restore skips a stale duplicate cookie before the active session', async t => {
    const app = await start();
    t.after(() => app.stop());
    const secondCredentials = {
        ...credentials,
        host: 'other.region.provider.clickhouse.cloud:8443',
    };
    const connected = await app.call('/cloud/session', { credentials: secondCredentials });
    const activeCookie = cookieFrom(connected)!;
    const staleCookie = `${CLOUD_SESSION_COOKIE}=${'A'.repeat(43)}`;

    const refreshed = await app.call('/cloud/session', undefined, {
        cookie: `${staleCookie}; ${activeCookie}`,
    });
    const snapshot = jsonRecord(await refreshed.json(), 'Cloud session response');
    const session = jsonRecord(snapshot.session, 'Cloud session');
    const profile = jsonRecord(session.profile, 'Cloud profile');
    assert.equal(refreshed.status, 200);
    assert.equal(profile.host, secondCredentials.host);
});

test('Disconnect revokes every active session in a duplicate cookie', async t => {
    const app = await start();
    t.after(() => app.stop());
    const first = await app.call('/cloud/session', { credentials });
    const second = await app.call('/cloud/session', {
        credentials: { ...credentials, host: 'other.region.provider.clickhouse.cloud:8443' },
    });
    const firstCookie = cookieFrom(first)!;
    const secondCookie = cookieFrom(second)!;

    const disconnected = await app.call(
        '/cloud/session',
        undefined,
        { cookie: `${firstCookie}; ${secondCookie}` },
        'DELETE',
    );
    assert.equal(disconnected.status, 204);
    assert.deepEqual(
        await (await app.call('/cloud/session', undefined, { cookie: firstCookie })).json(),
        { session: null },
    );
    assert.deepEqual(
        await (await app.call('/cloud/session', undefined, { cookie: secondCookie })).json(),
        { session: null },
    );
});

test('Disconnect revokes the local Cloud session and expires its cookie', async t => {
    const app = await start();
    t.after(() => app.stop());
    const connected = await app.call('/cloud/session', { credentials });
    const cookie = cookieFrom(connected)!;
    const disconnected = await app.call('/cloud/session', undefined, { cookie }, 'DELETE');
    assert.equal(disconnected.status, 204);
    assert.match(disconnected.headers.get('set-cookie') ?? '', /Expires=Thu, 01 Jan 1970/i);

    const refreshed = await app.call('/cloud/session', undefined, { cookie });
    assert.deepEqual(await refreshed.json(), { session: null });
    const schema = await app.call('/cloud', { action: 'schema' }, { cookie });
    assert.equal(schema.status, 400);
    assert.equal(app.cloudCalls.at(-1)?.credentials, undefined);
});

test('Workspace logout revokes the local Cloud session', async t => {
    const app = await start();
    t.after(() => app.stop());
    const connected = await app.call('/cloud/session', { credentials });
    const cookie = cookieFrom(connected)!;
    const logout = await app.call('/session', undefined, { cookie }, 'DELETE');
    assert.equal(logout.status, 200);
    assert.match(
        logout.headers.get('set-cookie') ?? '',
        /clickstudio_cloud_session=; Path=\/api;/i,
    );

    const refreshed = await app.call('/cloud/session', undefined, { cookie });
    assert.deepEqual(await refreshed.json(), { session: null });
    const schema = await app.call('/cloud', { action: 'schema' }, { cookie });
    assert.equal(schema.status, 400);
    assert.equal(app.cloudCalls.at(-1)?.credentials, undefined);
});

test('A replacement Cloud connection invalidates the previous browser cookie only after testing succeeds', async t => {
    const app = await start();
    t.after(() => app.stop());
    const first = await app.call('/cloud/session', { credentials });
    const firstCookie = cookieFrom(first)!;
    const rejected = await app.call(
        '/cloud/session',
        { credentials: { ...credentials, password: 'bad-password' } },
        { cookie: firstCookie },
    );
    assert.equal(rejected.status, 403);
    assert.equal(rejected.headers.get('set-cookie'), null);
    assert.ok(
        jsonRecord(
            await (await app.call('/cloud/session', undefined, { cookie: firstCookie })).json(),
            'Cloud session response',
        ).session,
    );

    const secondCredentials = {
        ...credentials,
        host: 'other.region.provider.clickhouse.cloud:8443',
    };
    const second = await app.call(
        '/cloud/session',
        { credentials: secondCredentials },
        { cookie: firstCookie },
    );
    const secondCookie = cookieFrom(second)!;
    assert.notEqual(secondCookie, firstCookie);
    assert.deepEqual(
        await (await app.call('/cloud/session', undefined, { cookie: firstCookie })).json(),
        { session: null },
    );
    const restored = jsonRecord(
        await (await app.call('/cloud/session', undefined, { cookie: secondCookie })).json(),
        'Cloud session response',
    );
    assert.equal(jsonRecord(jsonRecord(restored.session).profile).host, secondCredentials.host);
});

test('Replacing a Cloud connection revokes every session in a duplicate cookie', async t => {
    const app = await start();
    t.after(() => app.stop());
    const first = await app.call('/cloud/session', { credentials });
    const firstCookie = cookieFrom(first)!;
    const secondCredentials = {
        ...credentials,
        host: 'other.region.provider.clickhouse.cloud:8443',
    };
    const second = await app.call('/cloud/session', { credentials: secondCredentials });
    const secondCookie = cookieFrom(second)!;
    const replacementCredentials = {
        ...credentials,
        host: 'third.region.provider.clickhouse.cloud:8443',
    };

    const replacement = await app.call(
        '/cloud/session',
        { credentials: replacementCredentials },
        { cookie: `${firstCookie}; ${secondCookie}` },
    );
    const replacementCookie = cookieFrom(replacement)!;
    assert.deepEqual(
        await (
            await app.call('/cloud/session', undefined, {
                cookie: `${firstCookie}; ${secondCookie}`,
            })
        ).json(),
        { session: null },
    );
    const restored = jsonRecord(
        await (await app.call('/cloud/session', undefined, { cookie: replacementCookie })).json(),
        'Cloud session response',
    );
    assert.equal(
        jsonRecord(jsonRecord(restored.session).profile).host,
        replacementCredentials.host,
    );
});

test('Local Cloud session creation rejects a cross-origin request before testing credentials', async t => {
    const app = await start();
    t.after(() => app.stop());
    const response = await app.call(
        '/cloud/session',
        { credentials },
        { origin: 'https://evil.example' },
    );
    assert.equal(response.status, 403);
    assert.equal(app.cloudCalls.length, 0);
    assert.equal(response.headers.get('set-cookie'), null);
});

test('Cloud file imports use the local server session instead of credentials in the form', async t => {
    const app = await start();
    t.after(() => app.stop());
    const connected = await app.call('/cloud/session', { credentials });
    const cookie = cookieFrom(connected)!;
    const form = new FormData();
    form.set('action', 'import-commit');
    form.set('file', new Blob(['id\n1\n'], { type: 'text/csv' }), 'rows.csv');
    const response = await fetch(`${app.origin}/api/cloud`, {
        method: 'POST',
        headers: { 'x-clickstudio-intent': '1', cookie },
        body: form,
    });
    assert.equal(response.status, 200);
    assert.equal(app.cloudCalls.at(-1)?.action, 'import-commit');
    assert.equal(app.cloudCalls.at(-1)?.credentials?.password, credentials.password);
});
