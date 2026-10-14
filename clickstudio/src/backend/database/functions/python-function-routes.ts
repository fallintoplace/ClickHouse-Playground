import { randomBytes, createHash } from 'node:crypto';
import type { Express, Request } from 'express';
import { z } from 'zod';
import type { Principal } from '../../../shared/common/identity.js';
import {
    pythonDraftSchema,
    pythonSourceIssue,
} from '../../../shared/database/functions/python-functions.js';
import type { Driver } from '../../app/types.js';
import type { Config } from '../../system/config.js';
import type { Store } from '../../system/store.js';
import { body, id, principal } from '../../system/requests/request-accessors.js';
import { requireThat } from '../../system/requests/errors.js';
import { canWrite } from '../../system/login/permissions.js';
import type { CloudConnectionSessions } from '../connections/cloud-sessions.js';
import { CloudUdfClient, PythonDeploymentService } from './cloud-executable-functions.js';

const functionName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,127}$/);
const sessionCookie = 'clickstudio_udf_management';

export function registerPythonFunctionRoutes({
    app,
    config,
    store,
    driver,
    authorized,
    cloudSessions,
    request,
}: {
    app: Express;
    config: Config;
    store: Store;
    driver: Driver;
    authorized: (p: Principal, c: string) => boolean;
    cloudSessions: CloudConnectionSessions;
    request?: typeof fetch;
}) {
    const deployment = config.udfManagement
        ? new PythonDeploymentService(new CloudUdfClient(config.udfManagement, request), store)
        : undefined;
    const managementSessions = new Map<string, number>();
    const digest = (token: string) => createHash('sha256').update(token).digest('hex');
    const active = (req: Request) =>
        (req.get('cookie') ?? '').split(';').some(part => {
            const token = part.trim().startsWith(`${sessionCookie}=`)
                ? part.trim().slice(sessionCookie.length + 1)
                : '';
            return Boolean(token && (managementSessions.get(digest(token)) ?? 0) > Date.now());
        });
    const access = async (req: Request, requireSession: boolean) => {
        requireThat(
            deployment && !config.demo && config.token,
            409,
            'UDF_UNAVAILABLE',
            'Cloud deployment requires a trusted backend with separate management credentials.',
        );
        requireThat(
            !requireSession || active(req),
            401,
            'UDF_SESSION',
            'Enable a new 15-minute management session.',
        );
        const credentials = cloudSessions.credentials(req.get('cookie'));
        requireThat(
            credentials,
            409,
            'UDF_CONNECTION',
            'Reconnect the SQL connection through this backend before deployment.',
        );
        requireThat(
            req.get('x-clickstudio-connection-host') === credentials.host,
            409,
            'UDF_CONNECTION_CHANGED',
            'The SQL connection changed. Reconnect and enable a new management session.',
        );
        const service = await deployment.client.service(credentials.host);
        return { deployment, service };
    };
    app.get('/api/connections/:id/executable-functions', async (req, res) => {
        const connectionId = id(req);
        requireThat(
            authorized(principal(res), connectionId),
            403,
            'WORKSPACE_UNTRUSTED',
            'Trust this connection before inspecting functions.',
        );
        res.json(await driver.executableFunctions(connectionId));
    });
    app.get('/api/python-functions/capabilities', async (_req, res) => {
        res.json({
            available: Boolean(deployment),
            reason: deployment
                ? ''
                : 'Export is available. Direct deployment requires an authenticated backend with Cloud management credentials.',
        });
    });
    app.post('/api/python-functions/session', async (req, res) => {
        canWrite(principal(res));
        const { service } = await access(req, false);
        for (const [key, expires] of managementSessions)
            if (expires <= Date.now()) managementSessions.delete(key);
        requireThat(
            managementSessions.size < 30,
            429,
            'UDF_SESSION_LIMIT',
            'Too many management sessions. Retry after an existing session expires.',
        );
        const token = randomBytes(32).toString('base64url');
        managementSessions.set(digest(token), Date.now() + 15 * 60_000);
        res.cookie(sessionCookie, token, {
            httpOnly: true,
            sameSite: 'strict',
            secure: config.origin.startsWith('https:'),
            path: '/api/python-functions',
            maxAge: 15 * 60_000,
        });
        res.json({ available: true, reason: '', serviceId: service.id, serviceName: service.name });
    });
    app.get('/api/python-functions/:name/status', async (req, res) => {
        const { deployment } = await access(req, true);
        res.json(await deployment.status(functionName.parse(req.params.name)));
    });
    app.post('/api/python-functions/publish', async (req, res) => {
        canWrite(principal(res));
        const { deployment, service } = await access(req, true);
        const input = z
            .object({ draft: pythonDraftSchema, newVersion: z.boolean() })
            .safeParse(body(req));
        requireThat(
            input.success,
            400,
            'UDF_INPUT',
            'Check the Python function signature and source.',
        );
        const { draft, newVersion } = input.data;
        const sourceIssue = pythonSourceIssue(draft);
        requireThat(!sourceIssue, 400, 'UDF_SOURCE', sourceIssue);
        const versions = await deployment.client.versions(draft.name);
        requireThat(
            newVersion ? versions.length > 0 : versions.length === 0,
            409,
            'UDF_DUPLICATE',
            newVersion
                ? 'The function does not exist. Create it first.'
                : 'This name already exists. Publish a new version explicitly.',
        );
        res.json(
            await deployment.mutate(draft.name, service.name, async recordUpload => ({
                phase: 'published',
                version: await deployment.client.publish(draft, newVersion, recordUpload),
            })),
        );
    });
    app.post('/api/python-functions/:name/attach', async (req, res) => {
        canWrite(principal(res));
        const { deployment, service } = await access(req, true);
        const name = functionName.parse(req.params.name);
        const input = z
            .object({
                version: z.number().int().positive(),
                serviceId: z.string(),
                confirmRestart: z.literal(true),
            })
            .safeParse(body(req));
        requireThat(
            input.success && input.data.serviceId === service.id,
            400,
            'UDF_CONFIRM',
            'Confirm the selected service and possible rolling restart before attaching.',
        );
        const version = (await deployment.client.versions(name)).find(
            version => version.version === input.data.version,
        );
        requireThat(
            version?.status === 'ready',
            409,
            'UDF_BUILD',
            'Only a successfully built version can be attached.',
        );
        res.json(
            await deployment.mutate(name, service.name, async () => ({
                phase: 'attached',
                version: (await deployment.client.attach(name, input.data.version)).version,
            })),
        );
    });
}
