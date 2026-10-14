import { CLOUD_ACTIONS } from '../../../shared/database/connections/cloud-requests.js';
import type express from 'express';
import { type Express, type Request, type Response } from 'express';
import { Readable } from 'node:stream';
import type cloudApi from './cloud-api.js';
import type { Principal } from '../../../shared/common/identity.js';
import type { RunService } from '../../queries/execution/runs.js';
import type { CloudConnectionSessions } from './cloud-sessions.js';
import { CLOUD_SESSION_COOKIE, type CloudCredentials } from './cloud-sessions.js';
import { requireThat } from '../../system/requests/errors.js';
import { canWrite } from '../../system/login/permissions.js';
import { type Config } from '../../system/config.js';
import { cloudSessionCookieOptions } from './cookies.js';
import { body, principal, id, boolean } from '../../system/requests/request-accessors.js';
import type { Driver } from '../../app/types.js';
import { isRecord } from '../../../shared/common/values.js';

function requestBody(request: Request): ReadableStream<Uint8Array> {
    const reader = Readable.toWeb(request).getReader();
    return new globalThis.ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                const { done, value } = await reader.read();
                if (done) {
                    controller.close();
                } else if (value instanceof Uint8Array) {
                    controller.enqueue(value);
                } else if (typeof value === 'string') {
                    controller.enqueue(new TextEncoder().encode(value));
                } else {
                    controller.error(new TypeError('Request stream contains an invalid chunk.'));
                }
            } catch (error) {
                controller.error(error);
            }
        },
        cancel(reason) {
            return reader.cancel(reason);
        },
    });
}

export function registerCloudApi(
    app: Express,
    config: Config,
    cloudSessions: CloudConnectionSessions,
    cloudApiClient: Pick<typeof cloudApi, 'fetch'>,
) {
    const cloudUrl = (req: Request) =>
        new URL('/api/cloud', `${req.protocol}://${req.get('host') ?? '127.0.0.1'}`);
    const cloudHeaders = (req: Request) => {
        const headers = new Headers();
        const origin = req.get('origin');
        if (origin) headers.set('origin', origin);
        return headers;
    };
    const forward = async (response: globalThis.Response, res: Response) => {
        response.headers.forEach((value, name) => res.setHeader(name, value));
        res.status(response.status).send(Buffer.from(await response.arrayBuffer()));
    };
    const sameOrigin = (req: Request) => {
        const origin = req.get('origin');
        return !origin || origin === `${req.protocol}://${req.get('host') ?? ''}`;
    };
    app.get('/api/cloud/session', (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const snapshot = cloudSessions.snapshot(req.get('cookie'));
        if (!snapshot) res.clearCookie(CLOUD_SESSION_COOKIE, cloudSessionCookieOptions(config));
        res.json({ session: snapshot ?? null });
    });
    app.post('/api/cloud/session', async (req, res, next) => {
        try {
            if (!sameOrigin(req)) {
                res.status(403).json({
                    error: {
                        code: 'ORIGIN',
                        message: 'This endpoint accepts requests from the ClickStudio site only.',
                    },
                });
                return;
            }
            const credentialsValue = body(req).credentials;
            if (!isRecord(credentialsValue)) {
                res.status(400).json({
                    error: {
                        code: 'CLOUD_CREDENTIALS',
                        message: 'Enter your ClickHouse Cloud connection details.',
                    },
                });
                return;
            }
            if (
                typeof credentialsValue.host !== 'string' ||
                typeof credentialsValue.database !== 'string' ||
                typeof credentialsValue.username !== 'string' ||
                typeof credentialsValue.password !== 'string'
            ) {
                res.status(400).json({
                    error: {
                        code: 'CLOUD_CREDENTIALS',
                        message: 'Check the host, database, username, and password.',
                    },
                });
                return;
            }
            const credentials: CloudCredentials = {
                host: credentialsValue.host,
                database: credentialsValue.database,
                username: credentialsValue.username,
                password: credentialsValue.password,
            };
            const headers = cloudHeaders(req);
            headers.set('content-type', 'application/json');
            const request = new globalThis.Request(cloudUrl(req), {
                method: 'POST',
                headers,
                body: JSON.stringify({ action: CLOUD_ACTIONS.test, credentials }),
            });
            const response = await cloudApiClient.fetch(request);
            if (!response.ok) {
                await forward(response, res);
                return;
            }
            const tested: unknown = await response.json();
            if (!isRecord(tested)) {
                res.status(502).json({
                    error: {
                        code: 'CLOUD_RESPONSE',
                        message: 'ClickHouse Cloud returned an invalid connection response.',
                    },
                });
                return;
            }
            const test = tested;
            const savedCredentials: CloudCredentials = {
                host: typeof test.host === 'string' ? test.host : credentials.host,
                database: typeof test.database === 'string' ? test.database : credentials.database,
                username: typeof test.username === 'string' ? test.username : credentials.username,
                password: credentials.password,
            };
            const token = cloudSessions.create(savedCredentials, test, req.get('cookie'));
            res.cookie(CLOUD_SESSION_COOKIE, token, cloudSessionCookieOptions(config));
            res.setHeader('Cache-Control', 'no-store');
            res.json(test);
        } catch (error) {
            next(error);
        }
    });
    app.delete('/api/cloud/session', (req, res) => {
        if (!sameOrigin(req)) {
            res.status(403).json({
                error: {
                    code: 'ORIGIN',
                    message: 'This endpoint accepts requests from the ClickStudio site only.',
                },
            });
            return;
        }
        cloudSessions.revoke(req.get('cookie'));
        res.clearCookie(CLOUD_SESSION_COOKIE, cloudSessionCookieOptions(config));
        res.status(204).end();
    });
    app.post('/api/cloud', async (req, res, next) => {
        try {
            const url = cloudUrl(req);
            const headers = cloudHeaders(req);
            const contentType = req.get('content-type') ?? '';
            const credentials = cloudSessions.credentials(req.get('cookie'));
            let request: globalThis.Request;
            if (contentType.toLowerCase().startsWith('multipart/form-data') && credentials) {
                const incomingHeaders = cloudHeaders(req);
                incomingHeaders.set('content-type', contentType);
                const incomingInit: RequestInit & { duplex?: 'half' } = {
                    method: req.method,
                    headers: incomingHeaders,
                    body: requestBody(req),
                    duplex: 'half',
                };
                const incoming = new globalThis.Request(url, incomingInit);
                const form = await incoming.formData();
                form.set('credentials', JSON.stringify(credentials));
                request = new globalThis.Request(url, { method: req.method, headers, body: form });
            } else if (contentType.toLowerCase().startsWith('multipart/form-data')) {
                headers.set('content-type', contentType);
                const incomingInit: RequestInit & { duplex?: 'half' } = {
                    method: req.method,
                    headers,
                    body: requestBody(req),
                    duplex: 'half',
                };
                request = new globalThis.Request(url, incomingInit);
            } else if (contentType.toLowerCase().startsWith('application/json')) {
                const incoming = body(req);
                const payload = credentials ? { ...incoming, credentials } : incoming;
                headers.set('content-type', 'application/json');
                request = new globalThis.Request(url, {
                    method: req.method,
                    headers,
                    body: JSON.stringify(payload),
                });
            } else {
                if (contentType) headers.set('content-type', contentType);
                request = new globalThis.Request(url, {
                    method: req.method,
                    headers,
                    body:
                        req.method === 'GET' || req.method === 'HEAD'
                            ? undefined
                            : requestBody(req),
                    ...(req.method === 'GET' || req.method === 'HEAD'
                        ? {}
                        : { duplex: 'half' as const }),
                });
            }
            const response = await cloudApiClient.fetch(request);
            if (
                response.ok &&
                contentType.toLowerCase().startsWith('application/json') &&
                body(req).action === CLOUD_ACTIONS.dropDatabase &&
                typeof body(req).database === 'string'
            ) {
                cloudSessions.databaseDeleted(String(body(req).database), req.get('cookie'));
            }
            await forward(response, res);
        } catch (error) {
            next(error);
        }
    });
}

export function registerConnectionRoutes({
    app,
    driver,
    runs,
    authorized,
}: {
    app: ReturnType<typeof express>;
    driver: Driver;
    runs: RunService;
    authorized: (p: Principal, c: string) => boolean;
}) {
    app.get('/api/connections', (_req, res) => {
        const p = principal(res);
        res.json(driver.connections(p).map(c => ({ ...c, trusted: runs.isTrusted(p, c.id) })));
    });
    app.post('/api/connections/:id/test', async (req, res) => {
        canWrite(principal(res));
        res.json(await driver.test(id(req)));
    });
    app.post('/api/connections/:id/trust', (req, res) => {
        const p = principal(res),
            v = body(req),
            connectionId = id(req);
        requireThat(
            v.confirmation === connectionId,
            400,
            'TRUST_CONFIRMATION',
            'Confirm the selected connection ID',
        );
        runs.trust(p, connectionId, boolean(v.trusted, 'trusted'));
        res.json({ trusted: runs.isTrusted(p, connectionId) });
    });
    app.get('/api/connections/:id/schema', async (req, res) => {
        const p = principal(res),
            c = id(req);
        requireThat(
            authorized(p, c),
            403,
            'WORKSPACE_UNTRUSTED',
            'Trust this connection before inspecting its schema',
        );
        res.json(await driver.schema(c));
    });
}
