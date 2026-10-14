import { MAX_SQL_CHARS } from '../../../shared/queries/execution/limits.js';
import { randomUUID } from 'node:crypto';
import type { Proposal } from '../../../shared/assistant/types.js';
import {
    ASSISTANT_REQUEST_TIMEOUT_MS,
    ASSISTANT_TIMEOUT_MESSAGE,
    buildContext,
    PROMPT_VERSION,
    validateAssistantConversation,
    validateAssistantImages,
    validateAssistantTextFiles,
    validateProposal,
    type PreparedContext,
} from './assistant.js';
import {
    assistantInputText as field,
    assistantRequestFrom,
    assistantResultFrom as resultFrom,
    assistantSchemaFrom as schemaFrom,
} from '../context/input-validation.js';
import { AppError } from '../../system/requests/errors.js';
import { fail, json } from '../../system/requests/responses.js';
import { OpenAIDriver } from '../openai-client.js';
import { openaiServiceTier } from '../../system/config.js';
import { isRecord } from '../../../shared/common/values.js';
import {
    MAX_ASSISTANT_IMAGE_COUNT,
    MAX_VERCEL_ASSISTANT_TOTAL_IMAGE_BYTES,
} from '../../../shared/assistant/images.js';

const MAX_BODY_BYTES = 4_000_000;
const MAX_BODY_BYTES_WITHOUT_ATTACHMENTS = 300_000;
const MAX_IMAGE_DATA_URL_CHARS = 2_900_000;
const MAX_REQUESTS_PER_DAY = 20;
const MODEL = process.env.OPENAI_MODEL?.trim() || 'gpt-6-luna';
const requestsByIp = new Map<string, { day: string; count: number }>();

function allowRequest(ip: string): boolean {
    const day = new Date().toISOString().slice(0, 10);
    if (!requestsByIp.has(ip) && requestsByIp.size >= 2_000) {
        for (const [key, value] of requestsByIp) if (value.day !== day) requestsByIp.delete(key);
        if (requestsByIp.size >= 2_000) return false;
    }
    const current = requestsByIp.get(ip);
    if (current?.day === day && current.count >= MAX_REQUESTS_PER_DAY) return false;
    requestsByIp.set(ip, { day, count: current?.day === day ? current.count + 1 : 1 });
    return true;
}

function assistantImages(body: Record<string, unknown>): string[] {
    const images = body.images === undefined ? [] : body.images;
    if (!Array.isArray(images)) throw new AppError(400, 'IMAGE_TYPE', 'Images must be a list.');
    if (images.length + (body.image === undefined ? 0 : 1) > MAX_ASSISTANT_IMAGE_COUNT)
        throw new AppError(
            400,
            'IMAGE_COUNT',
            `Attach at most ${MAX_ASSISTANT_IMAGE_COUNT} images.`,
        );
    const dataUrls = [
        ...(body.image === undefined ? [] : [field(body.image, 'image', MAX_IMAGE_DATA_URL_CHARS)]),
        ...images.map((image, index) =>
            field(image, `image ${index + 1}`, MAX_IMAGE_DATA_URL_CHARS),
        ),
    ];
    const validated = validateAssistantImages(dataUrls);
    const totalBytes = validated.reduce((total, image) => {
        const payload = image.slice(image.indexOf(',') + 1);
        return total + Buffer.from(payload, 'base64').length;
    }, 0);
    if (totalBytes > MAX_VERCEL_ASSISTANT_TOTAL_IMAGE_BYTES)
        throw new AppError(
            413,
            'IMAGE_SIZE',
            `Attached images must total at most ${MAX_VERCEL_ASSISTANT_TOTAL_IMAGE_BYTES / 1_000_000} MB on this deployment.`,
        );
    return validated;
}

function prepareAssistantContext(body: Record<string, unknown>) {
    const connectionId = field(body.connectionId, 'Connection ID', 128);
    const question = field(body.question, 'Question', 4_000);
    const conversation = validateAssistantConversation(body.conversation);
    const sql = field(body.sql, 'SQL', MAX_SQL_CHARS, true);
    const database =
        body.database === undefined ? undefined : field(body.database, 'Database', 128);
    const schema = schemaFrom(body.schema, connectionId);
    const { action, repair } = assistantRequestFrom(body.action, body.repair);
    const includeRun = body.includeRun === true && !repair;
    if (includeRun) field(body.runId, 'Run ID', 200);
    const result = includeRun && body.result !== undefined ? resultFrom(body.result) : undefined;
    const evidenceSql =
        includeRun && body.evidenceSql !== undefined
            ? field(body.evidenceSql, 'Selected run SQL', MAX_SQL_CHARS, true)
            : undefined;
    const error =
        includeRun && body.error !== undefined
            ? field(body.error, 'Selected run error', 3_000, true)
            : undefined;
    const serverVersion =
        typeof body.serverVersion === 'string' ? body.serverVersion.slice(0, 128) : undefined;
    const images = assistantImages(body);
    const files = validateAssistantTextFiles(body.files);
    const built = buildContext({
        connectionId,
        database,
        action,
        question,
        conversation,
        sql,
        schema,
        result,
        evidenceSql: repair?.sql ?? evidenceSql,
        error: repair?.error ?? error,
        serverVersion,
        sensitiveColumns: (process.env.AI_SENSITIVE_COLUMNS ?? 'password,token,secret,api_key')
            .split(',')
            .map(name => name.trim()),
        images,
        files,
    });
    return { connectionId, action, sql, schema, built };
}

async function post(request: Request): Promise<Response> {
    if (request.method !== 'POST')
        return fail('METHOD_NOT_ALLOWED', 'Use POST to ask the ClickHouse assistant.', 405);
    if (
        request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
        'application/json'
    )
        return fail('CONTENT_TYPE', 'Send the assistant request as JSON.', 415);
    const origin = request.headers.get('origin');
    if (
        !origin ||
        origin !== new URL(request.url).origin ||
        request.headers.get('x-clickstudio-intent') !== '1'
    )
        return fail(
            'ORIGIN',
            'This endpoint accepts requests from the ClickStudio site only.',
            403,
        );
    const length = Number(request.headers.get('content-length'));
    if (Number.isFinite(length) && length > MAX_BODY_BYTES)
        return fail('REQUEST_SIZE', 'The assistant request is too large.', 413);
    if (!process.env.OPENAI_API_KEY?.trim())
        return fail(
            'AI_UNAVAILABLE',
            'Add OPENAI_API_KEY to the Vercel project environment to enable the assistant.',
            503,
        );

    let raw: string;
    try {
        raw = await request.text();
    } catch {
        return fail('REQUEST_BODY', 'Could not read the request body.');
    }
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES)
        return fail('REQUEST_SIZE', 'The assistant request is too large.', 413);

    let body: unknown;
    try {
        body = JSON.parse(raw) as unknown;
    } catch {
        return fail('REQUEST_BODY', 'The request body is not valid JSON.');
    }
    if (!isRecord(body)) return fail('REQUEST_BODY', 'The request body must be a JSON object.');
    const hasImages =
        body.image !== undefined || (Array.isArray(body.images) && body.images.length > 0);
    const hasFiles = Array.isArray(body.files) && body.files.length > 0;
    if (!hasImages && !hasFiles && Buffer.byteLength(raw) > MAX_BODY_BYTES_WITHOUT_ATTACHMENTS)
        return fail('REQUEST_SIZE', 'The assistant request is too large.', 413);

    let timeoutSignal: AbortSignal | undefined;
    try {
        const { connectionId, action, sql, schema, built } = prepareAssistantContext(body);
        const serviceTier = openaiServiceTier();
        const ip =
            request.headers.get('x-real-ip')?.trim() ||
            request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
            'unknown';
        if (!allowRequest(ip))
            return fail(
                'AI_RATE_LIMIT',
                'This network has reached the temporary assistant request limit. Try again later.',
                429,
            );
        const context: PreparedContext = {
            id: randomUUID(),
            owner: 'vercel-session',
            connectionId,
            action,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + ASSISTANT_REQUEST_TIMEOUT_MS + 60_000).toISOString(),
            baseSql: sql,
            ...built,
            evaluationSchema: { tables: schema.tables, truncated: schema.truncated },
            state: 'running',
        };
        const driver = new OpenAIDriver(process.env.OPENAI_API_KEY, MODEL, serviceTier);
        timeoutSignal = AbortSignal.timeout(ASSISTANT_REQUEST_TIMEOUT_MS);
        const signal = AbortSignal.any([request.signal, timeoutSignal]);
        const response = await driver.propose(context, signal);
        signal.throwIfAborted();
        const content = validateProposal(response.content);
        const proposal: Proposal = {
            ...content,
            id: randomUUID(),
            owner: 'vercel-session',
            connectionId,
            action,
            createdAt: new Date().toISOString(),
            baseSql: sql,
            responseId: response.responseId,
            model: driver.model,
            promptVersion: PROMPT_VERSION,
            contextSummary: built.summary,
            decision: 'pending',
        };
        return json(proposal, 201);
    } catch (error) {
        if (request.signal.aborted) return new Response(null, { status: 499 });
        if (timeoutSignal?.aborted) return fail('AI_TIMEOUT', ASSISTANT_TIMEOUT_MESSAGE, 504);
        if (error instanceof AppError) return fail(error.code, error.message, error.status);
        return fail(
            'AI_PROVIDER_ERROR',
            'The assistant request failed. No SQL was applied or run.',
            502,
        );
    }
}

export default {
    async fetch(request: Request): Promise<Response> {
        return await post(request);
    },
};
