import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { createApp } from '../../src/backend/app/app.js';
import { loadConfig } from '../../src/backend/system/config.js';
import { DemoDriver } from '../../src/backend/database/clickhouse/sample-client.js';
import { MemoryStore } from '../../src/backend/system/store.js';
import {
    PYTHON_FUNCTION_TEMPLATES,
    pythonStatusSchema,
} from '../../src/shared/database/functions/python-functions.js';
import { cloudConnectionTest } from '../helpers/cloud-fixtures.js';

const token = 'workspace-owner-token-'.repeat(3);
const host = 'service.clickhouse.cloud:8443';
const draft = PYTHON_FUNCTION_TEMPLATES[1]!;
const cookie = (response: Response) => response.headers.get('set-cookie')!.split(';')[0]!;
async function start() {
    const config = loadConfig({
        CLICKSTUDIO_TOKEN: token,
        CLICKSTUDIO_UDF_ORG_ID: 'org',
        CLICKSTUDIO_UDF_SERVICE_ID: 'service',
        CLICKSTUDIO_UDF_API_KEY_ID: 'key-id',
        CLICKSTUDIO_UDF_API_KEY_SECRET: 'management-secret',
    });
    config.profiles = config.profiles.filter(profile => !profile.publicPlayground);
    const state = {
        versions: [] as unknown[],
        attachment: undefined as unknown,
        writes: 0,
        timeout: false,
    };
    const service = createApp(config, {
        store: new MemoryStore(),
        driver: new DemoDriver(),
        cloudApi: { fetch: async () => Response.json(cloudConnectionTest({ host })) },
        udfFetch: async (url, options) => {
            const path = String(url),
                method = options?.method ?? 'GET';
            if (path.includes('/services/'))
                return Response.json({
                    result: {
                        id: 'service',
                        name: 'Selected service',
                        endpoints: [{ host: 'service.clickhouse.cloud', protocol: 'https' }],
                    },
                });
            if (method === 'GET' && path.includes('/versions'))
                return Response.json({ result: state.versions, nextCursor: null });
            if (method === 'GET' && path.includes('/attachments/'))
                return state.attachment
                    ? Response.json({ result: state.attachment })
                    : new Response('', { status: 404 });
            state.writes++;
            if (path.includes('/udfUploads/url'))
                return Response.json({
                    result: {
                        uploadId: 'upload-id',
                        uploadUrl: 'https://uploads.example/file.zip',
                    },
                });
            if (path.startsWith('https://uploads.example')) return new Response('');
            if (state.timeout) throw new Error('request timed out');
            const version = {
                functionName: draft.name,
                version: state.versions.length + 1,
                status: 'ready',
                error: null,
                arguments: draft.arguments,
                returnType: draft.returnType,
            };
            if (path.includes('/attachments/')) {
                state.attachment = { version: 1, status: 'provisioning' };
                return Response.json({ result: state.attachment });
            }
            state.versions.push(version);
            return Response.json({ result: version });
        },
    });
    const server = service.app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    config.origin = `http://127.0.0.1:${address.port}`;
    const call = (path: string, body?: unknown, cookies = '', expectedHost = host) =>
        fetch(`${config.origin}/api${path}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: {
                cookie: cookies,
                'X-ClickStudio-Intent': '1',
                'X-ClickStudio-Connection-Host': expectedHost,
                'Content-Type': 'application/json',
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    const login = async () => {
        const owner = cookie(await call('/session', { token }));
        const sql = cookie(
            await call(
                '/cloud/session',
                {
                    credentials: {
                        host,
                        database: 'default',
                        username: 'reader',
                        password: 'sql-password',
                    },
                },
                owner,
            ),
        );
        return `${owner}; ${sql}`;
    };
    return {
        state,
        call,
        login,
        stop: async () => {
            await service.close();
            server.closeAllConnections();
            await new Promise<void>(resolve => server.close(() => resolve()));
        },
    };
}

test('Management HTTP endpoints require owner login, a matching SQL session and a short management session', async t => {
    const app = await start();
    t.after(() => app.stop());
    assert.equal((await app.call('/python-functions/session', {})).status, 401);
    const owner = cookie(await app.call('/session', { token }));
    assert.equal((await app.call('/python-functions/session', {}, owner)).status, 409);
    const cookies = await app.login();
    assert.equal(
        (await app.call('/python-functions/session', {}, cookies, 'other.clickhouse.cloud')).status,
        409,
    );
    assert.equal(
        (await app.call(`/python-functions/${draft.name}/status`, undefined, cookies)).status,
        401,
    );
    const enabled = await app.call('/python-functions/session', {}, cookies);
    assert.equal(enabled.status, 200);
    assert.match(enabled.headers.get('set-cookie')!, /HttpOnly/);
    assert.match(enabled.headers.get('set-cookie')!, /Max-Age=900/);
    const response = JSON.stringify(await enabled.json());
    assert.match(response, /Selected service/);
    assert.doesNotMatch(response, /management-secret|sql-password|key-id/);
    assert.equal(app.state.writes, 0);
});

test('Publishing and attachment require an explicit immutable-version choice and restart confirmation', async t => {
    const app = await start();
    t.after(() => app.stop());
    const cookies = await app.login();
    const active = `${cookies}; ${cookie(await app.call('/python-functions/session', {}, cookies))}`;
    const invalid = await app.call(
        '/python-functions/publish',
        { draft: { ...draft, source: 'not python' }, newVersion: false },
        active,
    );
    assert.equal(invalid.status, 400);
    assert.equal(app.state.writes, 0);
    assert.equal(
        (await app.call('/python-functions/publish', { draft, newVersion: false }, active)).status,
        200,
    );
    assert.equal(
        (await app.call('/python-functions/publish', { draft, newVersion: false }, active)).status,
        409,
    );
    assert.equal(
        (
            await app.call(
                `/python-functions/${draft.name}/attach`,
                { version: 1, serviceId: 'service' },
                active,
            )
        ).status,
        400,
    );
    assert.equal(
        (
            await app.call(
                `/python-functions/${draft.name}/attach`,
                { version: 1, serviceId: 'wrong-service', confirmRestart: true },
                active,
            )
        ).status,
        400,
    );
    assert.equal(
        (
            await app.call(
                `/python-functions/${draft.name}/attach`,
                { version: 1, serviceId: 'service', confirmRestart: true },
                active,
            )
        ).status,
        200,
    );
    const status = pythonStatusSchema.parse(
        await (await app.call(`/python-functions/${draft.name}/status`, undefined, active)).json(),
    );
    assert.equal(status.attachment?.status, 'provisioning');
    assert.equal(status.operation?.phase, 'attached');
    assert.equal(
        (await app.call('/python-functions/publish', { draft, newVersion: true }, active)).status,
        200,
    );
    const state = pythonStatusSchema.parse(
        await (await app.call(`/python-functions/${draft.name}/status`, undefined, active)).json(),
    );
    assert.deepEqual(
        state.versions.map(version => version.version),
        [2, 1],
    );
});

test('A timed-out create returns unknown, blocks retries, and needs a status refresh', async t => {
    const app = await start();
    t.after(() => app.stop());
    const cookies = await app.login();
    const active = `${cookies}; ${cookie(await app.call('/python-functions/session', {}, cookies))}`;
    app.state.timeout = true;
    const first = await app.call('/python-functions/publish', { draft, newVersion: false }, active);
    assert.equal(first.status, 502);
    assert.equal(
        z
            .object({ error: z.object({ code: z.literal('UDF_UNKNOWN') }) })
            .safeParse(await first.json()).success,
        true,
    );
    const count = app.state.writes;
    const retry = await app.call('/python-functions/publish', { draft, newVersion: false }, active);
    assert.equal(retry.status, 409);
    assert.equal(app.state.writes, count);
    const status = pythonStatusSchema.parse(
        await (await app.call(`/python-functions/${draft.name}/status`, undefined, active)).json(),
    );
    assert.equal(status.operation?.phase, 'checked');
    assert.equal(status.operation?.uploadId, 'upload-id');
    app.state.timeout = false;
    assert.equal(
        (await app.call('/python-functions/publish', { draft, newVersion: false }, active)).status,
        200,
    );
});
