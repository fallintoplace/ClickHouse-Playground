import {
    RUN_KINDS,
    RUN_STATUSES,
    RUN_RESULT_STATES,
    SCRIPT_STATUSES,
    RESULT_COMPLETENESS,
    RUN_EVENT_TYPES,
    type RunEventType,
} from './status.js';
import type { ApiError } from '../../common/errors.js';
import { isJson, isRecord, type Column } from '../../common/values.js';
import type { Limits } from './settings.js';
import type { Progress, Run, RunEvent, Script } from './types.js';
import type { Result } from '../results/types.js';
import type { RunStatus } from './status.js';

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isSafeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value);
}

function isOptionalString(value: unknown): value is string | undefined {
    return value === undefined || typeof value === 'string';
}

function isStringRecord(value: unknown): value is Record<string, string> {
    return isRecord(value) && Object.values(value).every(item => typeof item === 'string');
}

function isColumn(value: unknown): value is Column {
    return isRecord(value) && typeof value.name === 'string' && typeof value.type === 'string';
}

function isLimits(value: unknown): value is Limits {
    return (
        isRecord(value) &&
        isSafeInteger(value.rows) &&
        isSafeInteger(value.bytes) &&
        isSafeInteger(value.seconds) &&
        isSafeInteger(value.memory) &&
        isSafeInteger(value.threads)
    );
}

function isProgress(value: unknown): value is Progress {
    return (
        isRecord(value) &&
        typeof value.readRows === 'string' &&
        typeof value.readBytes === 'string' &&
        isFiniteNumber(value.elapsedMs) &&
        isOptionalString(value.memory)
    );
}

function isApiError(value: unknown): value is ApiError {
    return (
        isRecord(value) &&
        typeof value.code === 'string' &&
        typeof value.message === 'string' &&
        isOptionalString(value.remediation) &&
        (value.position === undefined || isFiniteNumber(value.position))
    );
}

function isRunStatus(value: unknown): value is RunStatus {
    return typeof value === 'string' && RUN_STATUSES.some(status => status === value);
}

export function isRun(value: unknown): value is Run {
    if (!isRecord(value)) return false;
    return (
        (value.dataSource === 'clickhouse' || value.dataSource === 'fixture') &&
        typeof value.id === 'string' &&
        typeof value.queryId === 'string' &&
        typeof value.owner === 'string' &&
        typeof value.connectionId === 'string' &&
        isOptionalString(value.documentId) &&
        typeof value.sql === 'string' &&
        (value.sourceFrom === undefined || isSafeInteger(value.sourceFrom)) &&
        (value.sourceTo === undefined || isSafeInteger(value.sourceTo)) &&
        isRunKind(value.kind) &&
        isStringRecord(value.parameters) &&
        isLimits(value.limits) &&
        isStringRecord(value.tags) &&
        isOptionalString(value.parentRunId) &&
        isRunStatus(value.status) &&
        typeof value.createdAt === 'string' &&
        isOptionalString(value.startedAt) &&
        isOptionalString(value.finishedAt) &&
        isFiniteNumber(value.elapsedMs) &&
        isFiniteNumber(value.rowCount) &&
        (value.writtenRows === undefined ||
            (isSafeInteger(value.writtenRows) && value.writtenRows >= 0)) &&
        isFiniteNumber(value.bytes) &&
        Array.isArray(value.columns) &&
        value.columns.every(isColumn) &&
        (value.progress === undefined || isProgress(value.progress)) &&
        Array.isArray(value.warnings) &&
        value.warnings.every(warning => typeof warning === 'string') &&
        (value.error === undefined || isApiError(value.error)) &&
        isSafeInteger(value.sequence) &&
        RUN_RESULT_STATES.some(state => state === value.resultState) &&
        typeof value.requestedBy === 'string' &&
        typeof value.executedAs === 'string' &&
        isRecord(value.permissionSnapshot) &&
        typeof value.permissionSnapshot.readonly === 'boolean' &&
        typeof value.permissionSnapshot.role === 'string' &&
        value.retryPolicy === 'never' &&
        isOptionalString(value.traceId) &&
        isOptionalString(value.serverVersion)
    );
}

function isRunKind(value: unknown): value is Run['kind'] {
    return RUN_KINDS.some(kind => kind === value);
}

export function isResult(value: unknown): value is Result {
    return (
        isRecord(value) &&
        typeof value.runId === 'string' &&
        typeof value.queryId === 'string' &&
        Array.isArray(value.columns) &&
        value.columns.every(isColumn) &&
        Array.isArray(value.rows) &&
        value.rows.every(row => Array.isArray(row) && row.every(isJson)) &&
        RESULT_COMPLETENESS.some(completeness => completeness === value.completeness) &&
        typeof value.createdAt === 'string'
    );
}

export function isScript(value: unknown): value is Script {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        typeof value.owner === 'string' &&
        typeof value.connectionId === 'string' &&
        typeof value.sql === 'string' &&
        typeof value.createdAt === 'string' &&
        SCRIPT_STATUSES.some(status => status === value.status) &&
        typeof value.stopOnError === 'boolean' &&
        typeof value.cancelled === 'boolean' &&
        Array.isArray(value.statements) &&
        value.statements.every(
            statement =>
                isRecord(statement) &&
                typeof statement.sql === 'string' &&
                isSafeInteger(statement.from) &&
                isSafeInteger(statement.to) &&
                isOptionalString(statement.runId) &&
                (statement.status === 'pending' ||
                    statement.status === 'skipped' ||
                    isRunStatus(statement.status)) &&
                (statement.error === undefined || isApiError(statement.error)),
        )
    );
}

function isRunEventType(value: unknown): value is RunEventType {
    return RUN_EVENT_TYPES.some(type => type === value);
}

export function parseRunEvent(value: unknown): RunEvent {
    if (
        !isRecord(value) ||
        !isSafeInteger(value.sequence) ||
        !isRunEventType(value.type) ||
        !isRun(value.run)
    )
        throw new Error('Invalid run event');
    return { sequence: value.sequence, type: value.type, run: value.run };
}
