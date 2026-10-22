import { z } from 'zod';
import {
    pythonCapabilitySchema,
    pythonDeploymentSchema,
    pythonStatusSchema,
    type PythonFunctionDraft,
} from '../../../shared/database/functions/python-functions';
import { isFrontendDemoPreview, message } from '../../api/client';
import { getClickHouseCloudConnection } from '../connections/cloud-connection';

export class PythonManagementError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
    }
}

export async function pythonManagement<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    signal?: AbortSignal,
): Promise<T> {
    if (isFrontendDemoPreview)
        throw new Error('Cloud management requires an authenticated self-hosted backend.');
    const response = await fetch(`/api/python-functions${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'same-origin',
        signal,
        headers: {
            'X-ClickHouse Playground-Intent': '1',
            'X-ClickHouse Playground-Connection-Host': getClickHouseCloudConnection()?.host ?? '',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
        const error = z.object({ error: z.object({ message: z.string() }) }).safeParse(value);
        throw new PythonManagementError(
            error.success
                ? error.data.error.message
                : 'Cloud management is unavailable on this server.',
            response.status,
        );
    }
    return schema.parse(value);
}
export const pythonCapabilities = (signal?: AbortSignal) =>
    pythonManagement('/capabilities', pythonCapabilitySchema, undefined, signal).catch(error => ({
        available: false,
        reason: message(error),
    }));
export const pythonManagementSession = () =>
    pythonManagement('/session', pythonCapabilitySchema, {});
export const pythonDeploymentStatus = (name: string, signal?: AbortSignal) =>
    pythonManagement(`/${encodeURIComponent(name)}/status`, pythonStatusSchema, undefined, signal);
export const publishPythonFunction = (draft: PythonFunctionDraft, newVersion: boolean) =>
    pythonManagement('/publish', pythonDeploymentSchema, { draft, newVersion });
export const attachPythonFunction = (name: string, version: number, serviceId: string) =>
    pythonManagement(`/${encodeURIComponent(name)}/attach`, pythonDeploymentSchema, {
        version,
        serviceId,
        confirmRestart: true,
    });
