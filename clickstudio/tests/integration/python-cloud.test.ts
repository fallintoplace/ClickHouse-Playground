import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
    CloudUdfClient,
    PythonDeploymentService,
} from '../../src/backend/database/functions/cloud-executable-functions.js';
import { PYTHON_FUNCTION_TEMPLATES } from '../../src/shared/database/functions/python-functions.js';
import { MemoryStore } from '../../src/backend/system/store.js';
import { AppError } from '../../src/backend/system/requests/errors.js';
import { loadConfig, redactor } from '../../src/backend/system/config.js';
import { unzipSync } from 'fflate';

const config = {
    organizationId: 'org',
    serviceId: 'service',
    keyId: 'private-key-id',
    keySecret: 'private-key-secret',
};
const version = {
    functionName: 'python_double',
    version: 1,
    status: 'ready',
    error: null,
    arguments: [{ name: 'value', type: 'Int64' }],
    returnType: 'Int64',
};
const draft = PYTHON_FUNCTION_TEMPLATES[1]!;
const json = (result: unknown, extra = {}) => Response.json({ result, ...extra });
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => {
        resolve = done;
    });
    return { promise, resolve };
}

test('Cloud adapter sends Basic auth only to management, uploads a real ZIP, and pins versions', async () => {
    const requests: Array<{
        url: string;
        method: string;
        body: unknown;
        authorization: string | null;
    }> = [];
    const request: typeof fetch = async (url, options) => {
        const text = String(url),
            method = options?.method ?? 'GET';
        const authorization = new Headers(options?.headers).get('Authorization');
        requests.push({ url: text, method, body: options?.body, authorization });
        if (text.includes('/services/'))
            return json({
                id: 'service',
                name: 'Production',
                endpoints: [{ host: 'service.clickhouse.cloud', protocol: 'https' }],
            });
        if (text.endsWith('/udfUploads/url'))
            return json({
                uploadId: `upload${requests.length}`,
                uploadUrl: 'https://uploads.example/artifact.zip',
            });
        if (text.startsWith('https://uploads.example')) {
            assert.equal(authorization, null);
            assert.ok(options?.body instanceof Blob);
            assert.ok(unzipSync(new Uint8Array(await options.body.arrayBuffer()))['main.py']);
            return new Response('', { status: 200 });
        }
        if (text.includes('/attachments/')) return json({ version: 1, status: 'provisioning' });
        return json(version);
    };
    const client = new CloudUdfClient(config, request);
    await client.service('https://service.clickhouse.cloud:8443');
    await assert.rejects(client.service('https://other.clickhouse.cloud:8443'), /does not match/);
    const uploads: string[] = [];
    assert.equal(await client.publish(draft, false, id => uploads.push(id)), 1);
    assert.equal(await client.publish(draft, true), 1);
    assert.equal(uploads.length, 1);
    await client.attach(draft.name, 1);
    const writes = requests.filter(
        request => request.method === 'POST' && !request.url.endsWith('/udfUploads/url'),
    );
    const first = z
        .object({
            functionName: z.string(),
            sandboxType: z.string(),
            sendChunkHeader: z.boolean(),
            uploadId: z.string(),
        })
        .parse(JSON.parse(String(writes[0]?.body)));
    assert.equal(first.functionName, draft.name);
    assert.equal(first.sandboxType, 'basic');
    assert.equal(first.sendChunkHeader, true);
    const second: unknown = JSON.parse(String(writes[1]?.body));
    assert.equal(z.object({ functionName: z.unknown() }).safeParse(second).success, false);
    assert.match(writes[1]!.url, /\/versions$/);
    assert.deepEqual(JSON.parse(String(requests.at(-1)?.body)), { version: 1 });
    assert.equal(requests.filter(request => request.url.endsWith('/udfUploads/url')).length, 2);
    for (const call of requests.filter(call => call.url.startsWith('https://api.clickhouse.cloud')))
        assert.equal(
            call.authorization,
            `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`,
        );
});

test('Version listing follows pagination, keeps build errors, and sorts immutable versions', async () => {
    const urls: string[] = [];
    const client = new CloudUdfClient(config, async url => {
        urls.push(String(url));
        return urls.length === 1
            ? json([{ ...version, version: 1 }], { nextCursor: 'next page' })
            : json(
                  [{ ...version, version: 2, status: 'error', error: 'Dependency build failed' }],
                  { nextCursor: null },
              );
    });
    const versions = await client.versions(draft.name);
    assert.deepEqual(
        versions.map(version => version.version),
        [2, 1],
    );
    assert.equal(versions[0]?.error, 'Dependency build failed');
    assert.match(urls[1]!, /cursor=next%20page/);
});

test('Cloud permissions and expired upload failures do not leak authentication or retry requests', async () => {
    let calls = 0;
    const denied = new CloudUdfClient(config, async () => {
        calls++;
        return new Response('', { status: 403 });
    });
    await assert.rejects(denied.publish(draft, false), /HTTP 403/);
    assert.equal(calls, 1);
    const store = new MemoryStore();
    const service = new PythonDeploymentService(
        new CloudUdfClient(config, async () => {
            throw new Error(config.keySecret);
        }),
        store,
    );
    await assert.rejects(
        service.mutate(draft.name, 'Production', () =>
            service.client.publish(draft, false).then(version => ({ version, phase: 'published' })),
        ),
        /did not complete/,
    );
    assert.equal(
        JSON.stringify(
            store.list('python-deployments', (_value): _value is unknown => true),
        ).includes(config.keySecret),
        false,
    );
    assert.equal(store.list('python-deployments', (_value): _value is unknown => true).length, 1);
});

test('Unknown outcomes remain blocked across restart until a fresh status check completes', async () => {
    const store = new MemoryStore();
    const client = new CloudUdfClient(config, async url =>
        String(url).includes('/attachments/')
            ? json({ version: 1, status: 'provisioning' })
            : json([version]),
    );
    const service = new PythonDeploymentService(client, store);
    await assert.rejects(
        service.mutate(draft.name, 'Production', async record => {
            record('single-use-upload');
            throw new AppError(502, 'UDF_UNKNOWN', 'Timeout');
        }),
        /Timeout/,
    );
    const restarted = new PythonDeploymentService(client, store);
    await assert.rejects(
        restarted.mutate(draft.name, 'Production', async () => ({
            version: 2,
            phase: 'published',
        })),
        /Refresh actual/,
    );
    const checked = await restarted.status(draft.name);
    assert.equal(checked.operation?.phase, 'checked');
    assert.equal(checked.operation?.uploadId, 'single-use-upload');
    assert.equal(checked.attachment?.status, 'provisioning');
    assert.equal(
        (
            await restarted.mutate(draft.name, 'Production', async () => ({
                version: 2,
                phase: 'published',
            }))
        ).phase,
        'published',
    );
});

test('A status request started before a timed-out mutation cannot reconcile the new attempt', async () => {
    const reads = deferred<Response>();
    const client = new CloudUdfClient(config, async () => reads.promise);
    const service = new PythonDeploymentService(client, new MemoryStore());
    const stale = service.status(draft.name);
    await assert.rejects(
        service.mutate(draft.name, 'Production', async () => {
            throw new AppError(502, 'UDF_UNKNOWN', 'Timeout');
        }),
    );
    reads.resolve(new Response('', { status: 404 }));
    assert.equal((await stale).operation?.phase, 'unknown');
    await assert.rejects(
        service.mutate(draft.name, 'Production', async () => ({ version: 2, phase: 'published' })),
        /Refresh actual/,
    );
});

test('Concurrent operations are blocked while the first mutation is in flight', async () => {
    const completion = deferred<{ version: number; phase: 'published' }>();
    const client = new CloudUdfClient(config, async () => new Response('', { status: 404 }));
    const service = new PythonDeploymentService(client, new MemoryStore());
    const first = service.mutate(draft.name, 'Production', () => completion.promise);
    const status = await service.status(draft.name);
    assert.equal(status.operation?.phase, 'unknown');
    await assert.rejects(
        service.mutate(draft.name, 'Production', async () => ({ version: 2, phase: 'published' })),
        /Refresh actual/,
    );
    completion.resolve({ version: 1, phase: 'published' });
    assert.equal((await first).phase, 'published');
});

test('Management configuration requires owner authentication and redacts both key parts', () => {
    const env = {
        CLICKSTUDIO_UDF_ORG_ID: config.organizationId,
        CLICKSTUDIO_UDF_SERVICE_ID: config.serviceId,
        CLICKSTUDIO_UDF_API_KEY_ID: config.keyId,
        CLICKSTUDIO_UDF_API_KEY_SECRET: config.keySecret,
    };
    assert.throws(() => loadConfig(env), /workspace access token/);
    assert.throws(
        () => loadConfig({ ...env, CLICKSTUDIO_TOKEN: 'x'.repeat(32), DEMO_MODE: 'true' }),
        /non-demo/,
    );
    assert.throws(() => loadConfig({ CLICKSTUDIO_UDF_ORG_ID: 'org' }), /all four/);
    const loaded = loadConfig({ ...env, CLICKSTUDIO_TOKEN: 'x'.repeat(32) });
    assert.equal(redactor(loaded)(`${config.keyId} ${config.keySecret}`), '[redacted] [redacted]');
});
