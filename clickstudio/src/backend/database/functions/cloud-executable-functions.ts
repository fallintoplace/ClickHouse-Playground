import { z } from 'zod';
import { AppError, requireThat } from '../../system/requests/errors.js';
import { hash, type Store } from '../../system/store.js';
import {
    pythonCloudDefinition,
    pythonDeploymentSchema,
    managedVersionSchema,
    type PythonDeployment,
    type PythonFunctionDraft,
} from '../../../shared/database/functions/python-functions.js';
import {
    pythonUdfArtifact,
    TOKENIZER_ASSET,
} from '../../../shared/database/functions/python-udf-package.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export type CloudUdfConfig = {
    organizationId: string;
    serviceId: string;
    keyId: string;
    keySecret: string;
};
const cloudVersionSchema = managedVersionSchema
    .omit({ name: true })
    .extend({ functionName: z.string() });
const attachmentSchema = z.object({ version: z.number().int().positive(), status: z.string() });
const serviceSchema = z.object({
    id: z.string(),
    name: z.string(),
    endpoints: z.array(z.object({ host: z.string(), protocol: z.string() })),
});

export class CloudUdfClient {
    constructor(
        readonly config: CloudUdfConfig,
        private readonly request: typeof fetch = fetch,
    ) {}

    private async call(
        path: string,
        method = 'GET',
        body?: unknown,
        onCursor?: (cursor?: string) => void,
    ): Promise<unknown> {
        let response: Response;
        try {
            response = await this.request(
                `https://api.clickhouse.cloud/v1/organizations/${encodeURIComponent(this.config.organizationId)}${path}`,
                {
                    method,
                    redirect: 'error',
                    signal: AbortSignal.timeout(15000),
                    headers: {
                        Authorization: `Basic ${Buffer.from(`${this.config.keyId}:${this.config.keySecret}`).toString('base64')}`,
                        'Content-Type': 'application/json',
                    },
                    body: body === undefined ? undefined : JSON.stringify(body),
                },
            );
        } catch {
            throw new AppError(
                502,
                'UDF_UNKNOWN',
                'Cloud request did not complete. Check actual deployment status before retrying.',
            );
        }
        if (response.status === 404 && method === 'GET') return undefined;
        requireThat(
            response.ok,
            response.status === 403 || response.status === 401 ? 403 : 502,
            'UDF_CLOUD',
            `Cloud management request returned HTTP ${response.status}. Check API permissions and service status.`,
        );
        const envelope = z
            .object({ result: z.unknown(), nextCursor: z.string().nullable().optional() })
            .parse(await response.json());
        onCursor?.(envelope.nextCursor || undefined);
        return envelope.result;
    }

    async service(host: string) {
        const service = serviceSchema.parse(
            await this.call(`/services/${encodeURIComponent(this.config.serviceId)}`),
        );
        const hostname = new URL(
            host.includes('://') ? host : `https://${host}`,
        ).hostname.toLowerCase();
        requireThat(
            service.id === this.config.serviceId &&
                service.endpoints.some(
                    endpoint =>
                        endpoint.protocol === 'https' && endpoint.host.toLowerCase() === hostname,
                ),
            409,
            'UDF_SERVICE_MISMATCH',
            'The configured Cloud service does not match the SQL connection.',
        );
        return service;
    }

    async versions(name: string) {
        const versions = [];
        let cursor: string | undefined;
        let pages = 0;
        do {
            requireThat(
                ++pages <= 10,
                502,
                'UDF_VERSION_LIMIT',
                'Cloud version pagination exceeded the inspection limit.',
            );
            const result = await this.call(
                `/udfs/${encodeURIComponent(name)}/versions?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
                'GET',
                undefined,
                value => {
                    cursor = value;
                },
            );
            if (result === undefined) break;
            versions.push(
                ...z
                    .array(cloudVersionSchema)
                    .parse(result)
                    .map(({ functionName, ...version }) => ({ ...version, name: functionName })),
            );
            requireThat(
                versions.length <= 1000,
                502,
                'UDF_VERSION_LIMIT',
                'Too many UDF versions to inspect safely.',
            );
        } while (cursor);
        return versions.sort((a, b) => b.version - a.version);
    }

    async attachment(name: string) {
        const value = await this.call(
            `/udfs/${encodeURIComponent(name)}/attachments/${encodeURIComponent(this.config.serviceId)}`,
        );
        return value === undefined ? undefined : attachmentSchema.parse(value);
    }

    async publish(
        draft: PythonFunctionDraft,
        newVersion: boolean,
        onUpload?: (id: string) => void,
    ) {
        const upload = z
            .object({ uploadId: z.string(), uploadUrl: z.url() })
            .parse(await this.call('/udfUploads/url', 'POST'));
        onUpload?.(upload.uploadId);
        const url = new URL(upload.uploadUrl);
        requireThat(
            url.protocol === 'https:' && !url.username && !url.password,
            502,
            'UDF_UPLOAD',
            'Cloud returned an invalid upload URL.',
        );
        const zip = await pythonUdfArtifact(draft, async () => {
            try {
                return new Uint8Array(
                    await readFile(resolve('public/udf-assets', TOKENIZER_ASSET)),
                );
            } catch {
                return new Uint8Array(
                    await readFile(resolve('dist/frontend/udf-assets', TOKENIZER_ASSET)),
                );
            }
        });
        let response: Response;
        try {
            response = await this.request(url, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/zip' },
                body: new Blob([zip]),
                redirect: 'error',
                signal: AbortSignal.timeout(30000),
            });
        } catch {
            throw new AppError(
                502,
                'UDF_UNKNOWN',
                'Artifact upload did not complete. Check status before retrying with a fresh upload.',
            );
        }
        requireThat(
            response.ok,
            502,
            'UDF_UPLOAD',
            'Artifact upload failed. A new attempt needs a fresh upload URL.',
        );
        const { functionName, ...definition } = pythonCloudDefinition(draft);
        const value = await this.call(
            newVersion ? `/udfs/${encodeURIComponent(functionName)}/versions` : '/udfs',
            'POST',
            { ...definition, uploadId: upload.uploadId, ...(newVersion ? {} : { functionName }) },
        );
        return cloudVersionSchema.parse(value).version;
    }

    async attach(name: string, version: number) {
        return attachmentSchema.parse(
            await this.call(
                `/udfs/${encodeURIComponent(name)}/attachments/${encodeURIComponent(this.config.serviceId)}`,
                'PUT',
                { version },
            ),
        );
    }
}

export class PythonDeploymentService {
    private readonly busy = new Set<string>();
    constructor(
        readonly client: CloudUdfClient,
        private readonly store: Store,
    ) {}
    private key(name: string) {
        return hash([this.client.config.organizationId, this.client.config.serviceId, name]);
    }
    private operation(name: string) {
        return this.store.get(
            'python-deployments',
            this.key(name),
            (value): value is PythonDeployment => pythonDeploymentSchema.safeParse(value).success,
        );
    }
    private save(operation: PythonDeployment) {
        this.store.put('python-deployments', this.key(operation.name), operation);
        return operation;
    }
    async status(name: string) {
        const observed = this.busy.has(name) ? undefined : this.operation(name);
        const [versions, attachment] = await Promise.all([
            this.client.versions(name),
            this.client.attachment(name),
        ]);
        let operation = this.operation(name);
        if (
            observed?.phase === 'unknown' &&
            operation?.phase === 'unknown' &&
            observed.attemptId === operation.attemptId &&
            !this.busy.has(name)
        )
            operation = this.save({
                ...operation,
                phase: 'checked',
                message:
                    'Cloud state refreshed. Inspect versions and attachment before making another change.',
            });
        return { versions, attachment, operation };
    }
    async mutate(
        name: string,
        serviceName: string,
        action: (
            recordUpload: (id: string) => void,
        ) => Promise<{ version: number; phase: 'published' | 'attached' }>,
    ) {
        requireThat(
            !this.busy.has(name) && this.operation(name)?.phase !== 'unknown',
            409,
            'UDF_RECONCILE',
            'Refresh actual Cloud status before retrying this function.',
        );
        this.busy.add(name);
        const operation: PythonDeployment = {
            attemptId: randomUUID(),
            name,
            serviceName,
            serviceId: this.client.config.serviceId,
            phase: 'unknown',
            message: 'Deployment outcome is unknown until Cloud status has been checked.',
        };
        try {
            this.save(operation);
            const result = await action(id => {
                operation.uploadId = id;
                this.save(operation);
            });
            return this.save({
                ...operation,
                ...result,
                message:
                    result.phase === 'published'
                        ? 'Version published. Wait for the build before attaching.'
                        : 'Attachment requested. Check service status, reload the pool, then run a SQL test.',
            });
        } catch (error) {
            if (
                error instanceof AppError &&
                error.code !== 'UDF_UNKNOWN' &&
                error.code !== 'UDF_CLOUD'
            )
                this.save({ ...operation, phase: 'failed', message: error.message });
            throw error;
        } finally {
            this.busy.delete(name);
        }
    }
}
