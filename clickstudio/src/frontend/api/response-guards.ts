import {
    isFiniteNumber,
    isJson,
    isJsonRecord,
    isRecord,
    isSafeInteger,
    isStringArray,
    isStringRecord,
} from '../../shared/common/values.js';
import type { Principal } from '../../shared/common/identity.js';
import type { Capability, Connection, Manifest } from '../../shared/database/connections/types.js';
import type {
    WorkloadFamily,
    WorkloadPoint,
    WorkloadSnapshot,
} from '../../shared/database/explorer/activity/workload.js';
import {
    isQueryLogSource,
    WORKLOAD_WINDOWS,
    type WorkloadWindow,
} from '../../shared/database/explorer/activity/workload.js';
import type {
    ReplicationCapabilities,
    ReplicationQueueGroup,
    ReplicationSnapshot,
    ReplicationTable,
} from '../../shared/database/explorer/activity/replication.js';
import type { MetadataSnapshot } from '../../shared/database/explorer/metadata.js';
import type {
    LineageSnapshot,
    LineageNode,
    LineageEdge,
    ViewRefresh,
} from '../../shared/database/explorer/objects/view-lineage.js';
import type {
    MergeActivity,
    MergeSnapshot,
    MutationActivity,
    MutationSnapshot,
} from '../../shared/database/explorer/storage/activity.js';
import type { NativeExplorerSnapshot } from '../../shared/database/explorer/explorers.js';
import type {
    MergeTreePart,
    MergeTreePartsSnapshot,
} from '../../shared/database/explorer/storage/parts.js';
import type { Schema } from '../../shared/database/schema/types.js';
import { isSchema } from '../../shared/database/schema/schema.js';
import type {
    ClickHouseDocumentationEntry,
    ClickHouseDocumentationSummary,
} from '../../shared/database/reference/types.js';
import { IMPORT_JOB_STATUSES, type ImportJobStatus } from '../../shared/database/imports/status.js';
import { IMPORT_FORMATS, type ImportFormat } from '../../shared/database/imports/limits.js';
import { isResult, isRun, isScript } from '../../shared/queries/execution/validation.js';
import type { Result, ResultPage } from '../../shared/queries/results/types.js';
import type { Run, Script } from '../../shared/queries/execution/types.js';
import type { QueryDocument } from '../../shared/queries/saved-queries/types.js';
import { isQueryDocument } from '../../shared/queries/saved-queries/validation.js';
import type { ProfilePipeline, QueryProfile } from '../../shared/queries/inspection/types.js';
import type {
    FlamegraphSnapshot,
    FlamegraphTraceType,
} from '../../shared/queries/inspection/flamegraph.js';
import {
    FLAMEGRAPH_TRACE_TYPES,
    isFlamegraphSource,
} from '../../shared/queries/inspection/flamegraph.js';
import type { Limits } from '../../shared/queries/execution/settings.js';
import type { TablePermissions } from '../../shared/database/tables/permissions.js';
import type {
    ImportJob,
    ImportMapping,
    ImportPreview,
} from '../database/imports/state/import-wizard-model.js';
import type { Connected, Session } from '../workspace/workspace-types.js';

export { isStringArray };

export type ResponseGuard<T> = (value: unknown) => value is T;

export const isUnknown: ResponseGuard<unknown> = (_value): _value is unknown => true;

export function isArrayOf<T>(value: unknown, guard: ResponseGuard<T>): value is T[] {
    return Array.isArray(value) && value.every(guard);
}

export function arrayOf<T>(guard: ResponseGuard<T>): ResponseGuard<T[]> {
    return (value): value is T[] => isArrayOf(value, guard);
}

export function isRecordResponse(value: unknown): value is Record<string, unknown> {
    return isRecord(value);
}

export function isRecordArrayResponse(value: unknown): value is Record<string, unknown>[] {
    return Array.isArray(value) && value.every(isRecord);
}

function isImportFormat(value: unknown): value is ImportFormat {
    return IMPORT_FORMATS.some(format => format === value);
}

function isImportJobStatus(value: unknown): value is ImportJobStatus {
    return IMPORT_JOB_STATUSES.some(status => status === value);
}

export function isImportPreview(value: unknown): value is ImportPreview {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        typeof value.name === 'string' &&
        isImportFormat(value.format) &&
        isStringArray(value.columns) &&
        isArrayOf(value.rows, isJsonRecord) &&
        isSafeInteger(value.rowCount)
    );
}

export function isImportMapping(value: unknown): value is ImportMapping {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        (value.deduplicationToken === undefined ||
            value.deduplicationToken === null ||
            typeof value.deduplicationToken === 'string') &&
        typeof value.inputId === 'string' &&
        typeof value.connectionId === 'string' &&
        typeof value.table === 'string' &&
        isStringRecord(value.fields) &&
        isArrayOf(value.rows, isJsonRecord) &&
        isSafeInteger(value.rowCount) &&
        (value.missingFields === undefined ||
            (isRecord(value.missingFields) &&
                Object.values(value.missingFields).every(isSafeInteger)))
    );
}

export function isImportJob(value: unknown): value is ImportJob {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        (value.connectionId === undefined || typeof value.connectionId === 'string') &&
        typeof value.table === 'string' &&
        (value.queryId === undefined || typeof value.queryId === 'string') &&
        (value.deduplicationToken === undefined || typeof value.deduplicationToken === 'string') &&
        isSafeInteger(value.rows) &&
        (value.createdAt === undefined || typeof value.createdAt === 'string') &&
        isImportJobStatus(value.status) &&
        (value.error === undefined || typeof value.error === 'string') &&
        (value.reconciliationRequired === undefined ||
            typeof value.reconciliationRequired === 'boolean') &&
        (value.tableCreated === undefined || typeof value.tableCreated === 'boolean') &&
        (value.tableExists === undefined || typeof value.tableExists === 'boolean') &&
        (value.reviewedAt === undefined || typeof value.reviewedAt === 'string') &&
        (value.demoRows === undefined || isArrayOf(value.demoRows, isJsonRecord)) &&
        (value.demoPersisted === undefined || typeof value.demoPersisted === 'boolean')
    );
}

export function isResultPage(value: unknown): value is ResultPage {
    return (
        isRecord(value) &&
        isSafeInteger(value.offset) &&
        isSafeInteger(value.totalRows) &&
        (value.nextOffset === null || isSafeInteger(value.nextOffset)) &&
        isResult(value)
    );
}

function isPipelineNode(value: unknown): value is Record<string, unknown> {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        typeof value.label === 'string' &&
        [
            'read',
            'filter',
            'aggregate',
            'sort',
            'resize',
            'join',
            'transform',
            'output',
            'stage',
        ].some(kind => kind === value.kind) &&
        (value.detail === undefined || typeof value.detail === 'string') &&
        ['measured', 'estimated', 'planned'].some(status => status === value.status) &&
        ['durationMs', 'parallelism', 'timePercent'].every(
            key => value[key] === undefined || isFiniteNumber(value[key]),
        ) &&
        ['rows', 'bytes', 'inputRows', 'outputRows', 'inputBytes', 'outputBytes'].every(
            key => value[key] === undefined || typeof value[key] === 'string',
        )
    );
}

function isPipelineEdge(value: unknown): value is Record<string, unknown> {
    return (
        isRecord(value) &&
        typeof value.source === 'string' &&
        typeof value.target === 'string' &&
        (value.label === undefined || typeof value.label === 'string') &&
        (value.flow === undefined || isFiniteNumber(value.flow))
    );
}

export function isProfilePipeline(value: unknown): value is ProfilePipeline {
    return (
        isRecord(value) &&
        typeof value.available === 'boolean' &&
        ['explain_pipeline', 'explain_plan', 'query_shape', 'explain_analyze'].some(
            source => source === value.source,
        ) &&
        isArrayOf(value.nodes, isPipelineNode) &&
        isArrayOf(value.edges, isPipelineEdge) &&
        (value.raw === undefined || isStringArray(value.raw)) &&
        (value.truncated === undefined || typeof value.truncated === 'boolean') &&
        typeof value.notice === 'string'
    );
}

export function isQueryProfile(value: unknown): value is QueryProfile {
    if (!isRecord(value)) return false;
    const { summary, capabilities } = value;
    if (!isRecord(summary) || !isRecord(capabilities)) return false;
    return (
        value.version === 1 &&
        typeof value.queryId === 'string' &&
        typeof value.runId === 'string' &&
        isFiniteNumber(summary.durationMs) &&
        isFiniteNumber(summary.resultRows) &&
        ['readRows', 'readBytes', 'resultBytes', 'memory'].every(
            key => summary[key] === undefined || typeof summary[key] === 'string',
        ) &&
        Array.isArray(value.insights) &&
        value.insights.every(
            insight =>
                isRecord(insight) &&
                typeof insight.id === 'string' &&
                ['info', 'warning', 'critical'].some(severity => severity === insight.severity) &&
                typeof insight.title === 'string' &&
                typeof insight.description === 'string',
        ) &&
        isProfilePipeline(value.pipeline) &&
        ['queryLog', 'pipelineGraph', 'indexAnalysis', 'runtimePlan'].every(
            key => typeof capabilities[key] === 'boolean',
        ) &&
        (value.traceUrl === undefined || typeof value.traceUrl === 'string') &&
        typeof value.notice === 'string'
    );
}

function isFlamegraphFrame(value: unknown): value is Record<string, unknown> {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        typeof value.name === 'string' &&
        (value.location === undefined || typeof value.location === 'string') &&
        isSafeInteger(value.samples) &&
        isSafeInteger(value.selfSamples) &&
        isArrayOf(value.children, isFlamegraphFrame)
    );
}

function isFlamegraphTraceType(value: unknown): value is FlamegraphTraceType {
    return FLAMEGRAPH_TRACE_TYPES.some(type => type === value);
}

export function isFlamegraphSnapshot(value: unknown): value is FlamegraphSnapshot {
    if (!isRecord(value)) return false;
    const { series, samples } = value;
    if (!isRecord(series) || !isRecord(samples)) return false;
    return (
        typeof value.queryId === 'string' &&
        Object.entries(series).every(
            ([type, series]) =>
                isFlamegraphTraceType(type) &&
                isRecord(series) &&
                series.type === type &&
                isFlamegraphFrame(series.root) &&
                isSafeInteger(series.samples),
        ) &&
        ['CPU', 'Real'].every(type => isSafeInteger(samples[type])) &&
        isSafeInteger(value.symbolizedSamples) &&
        typeof value.truncated === 'boolean'
    );
}

function isLimits(value: unknown): value is Limits {
    return (
        isRecord(value) &&
        ['rows', 'bytes', 'seconds', 'memory', 'threads'].every(key => isSafeInteger(value[key]))
    );
}

function isCapability(value: unknown): value is Capability {
    return (
        isRecord(value) &&
        typeof value.available === 'boolean' &&
        (value.reason === undefined || typeof value.reason === 'string')
    );
}

function isManifest(value: unknown): value is Manifest {
    if (!isRecord(value)) return false;
    return (
        value.version === 1 &&
        typeof value.serverVersion === 'string' &&
        typeof value.testedAt === 'string' &&
        [
            'schema',
            'progress',
            'cancellation',
            'explain',
            'pipeline',
            'queryLog',
            'documentation',
            'import',
            'scripts',
            'parameters',
        ].every(key => isCapability(value[key])) &&
        [
            'explainPlan',
            'explainAnalyze',
            'queryTree',
            'explainPipeline',
            'traceLog',
            'replication',
        ].every(key => value[key] === undefined || isCapability(value[key])) &&
        (value.traceLogSource === undefined || isFlamegraphSource(value.traceLogSource)) &&
        (value.queryLogSource === undefined || isQueryLogSource(value.queryLogSource))
    );
}

function isConnection(value: unknown): value is Connection & Record<string, unknown> {
    if (!isRecord(value)) return false;
    return (
        typeof value.id === 'string' &&
        typeof value.name === 'string' &&
        typeof value.host === 'string' &&
        typeof value.database === 'string' &&
        typeof value.username === 'string' &&
        typeof value.readonly === 'boolean' &&
        isLimits(value.limits) &&
        (value.dataSource === undefined ||
            value.dataSource === 'clickhouse' ||
            value.dataSource === 'fixture') &&
        (value.manifest === undefined || isManifest(value.manifest))
    );
}

export function isConnected(value: unknown): value is Connected {
    return isConnection(value) && typeof value.trusted === 'boolean';
}

function isPrincipal(value: unknown): value is Principal {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        (value.role === 'owner' || value.role === 'viewer')
    );
}

export function isSession(value: unknown): value is Session {
    return (
        isRecord(value) &&
        (value.principal === null || isPrincipal(value.principal)) &&
        typeof value.requiresLogin === 'boolean' &&
        typeof value.demo === 'boolean' &&
        (value.cloudConnectionPersistence === undefined ||
            value.cloudConnectionPersistence === 'local-server')
    );
}

export function isClickHouseDocumentationSummary(
    value: unknown,
): value is ClickHouseDocumentationSummary {
    return (
        isRecord(value) &&
        typeof value.name === 'string' &&
        typeof value.type === 'string' &&
        (value.source === undefined || typeof value.source === 'string')
    );
}

export function isClickHouseDocumentationEntry(
    value: unknown,
): value is ClickHouseDocumentationEntry {
    return (
        isRecord(value) &&
        isClickHouseDocumentationSummary(value) &&
        typeof value.description === 'string' &&
        typeof value.serverVersion === 'string' &&
        (value.origin === 'native' || value.origin === 'bundled')
    );
}

export function isTablePermissions(value: unknown): value is TablePermissions {
    return (
        isRecord(value) &&
        ['create', 'insert', 'drop'].every(
            key => value[key] === undefined || typeof value[key] === 'boolean',
        )
    );
}

function isWorkloadFamily(value: unknown): value is WorkloadFamily {
    if (!isRecord(value)) return false;
    return (
        typeof value.hash === 'string' &&
        typeof value.query === 'string' &&
        isFiniteNumber(value.executions) &&
        isFiniteNumber(value.p50Ms) &&
        isFiniteNumber(value.p95Ms) &&
        isFiniteNumber(value.p99Ms) &&
        isFiniteNumber(value.totalMs) &&
        typeof value.readRows === 'string' &&
        typeof value.readBytes === 'string' &&
        typeof value.peakMemory === 'string' &&
        isFiniteNumber(value.errors) &&
        typeof value.lastSeen === 'string'
    );
}

function isWorkloadPoint(value: unknown): value is WorkloadPoint {
    return (
        isRecord(value) &&
        typeof value.hash === 'string' &&
        typeof value.queryId === 'string' &&
        typeof value.at === 'string' &&
        isFiniteNumber(value.durationMs) &&
        typeof value.memory === 'string' &&
        typeof value.readRows === 'string' &&
        typeof value.readBytes === 'string' &&
        typeof value.failed === 'boolean'
    );
}

function isWorkloadWindow(value: unknown): value is WorkloadWindow {
    return WORKLOAD_WINDOWS.some(minutes => minutes === value);
}

export function isWorkloadSnapshot(value: unknown): value is WorkloadSnapshot {
    return (
        isRecord(value) &&
        typeof value.connectionId === 'string' &&
        isWorkloadWindow(value.minutes) &&
        value.scope === 'local-user' &&
        isQueryLogSource(value.queryLogSource) &&
        isArrayOf(value.families, isWorkloadFamily) &&
        isArrayOf(value.points, isWorkloadPoint) &&
        typeof value.truncated === 'boolean'
    );
}

function isReplicationCapabilities(value: unknown): value is ReplicationCapabilities {
    return (
        isRecord(value) && typeof value.replicas === 'boolean' && typeof value.queue === 'boolean'
    );
}

function isReplicationTable(value: unknown): value is ReplicationTable {
    return (
        isRecord(value) &&
        typeof value.database === 'string' &&
        typeof value.table === 'string' &&
        typeof value.replicaName === 'string' &&
        typeof value.leader === 'boolean' &&
        typeof value.readonly === 'boolean' &&
        typeof value.sessionExpired === 'boolean' &&
        isFiniteNumber(value.absoluteDelay) &&
        isFiniteNumber(value.queueSize) &&
        isFiniteNumber(value.insertsInQueue) &&
        isFiniteNumber(value.mergesInQueue) &&
        isFiniteNumber(value.futureParts) &&
        isFiniteNumber(value.totalReplicas) &&
        isFiniteNumber(value.activeReplicas)
    );
}

function isReplicationQueueGroup(value: unknown): value is ReplicationQueueGroup {
    return (
        isRecord(value) &&
        typeof value.database === 'string' &&
        typeof value.table === 'string' &&
        typeof value.type === 'string' &&
        isFiniteNumber(value.entries) &&
        typeof value.oldestAt === 'string' &&
        isFiniteNumber(value.maxTries) &&
        isFiniteNumber(value.errors) &&
        isFiniteNumber(value.postponed) &&
        isFiniteNumber(value.executing)
    );
}

export function isReplicationSnapshot(value: unknown): value is ReplicationSnapshot {
    return (
        isRecord(value) &&
        typeof value.connectionId === 'string' &&
        value.scope === 'local-node' &&
        isReplicationCapabilities(value.capabilities) &&
        isArrayOf(value.replicas, isReplicationTable) &&
        isArrayOf(value.queue, isReplicationQueueGroup) &&
        typeof value.truncated === 'boolean'
    );
}

function isMetadataSnapshot(value: unknown): value is MetadataSnapshot & Record<string, unknown> {
    return (
        isRecord(value) &&
        typeof value.database === 'string' &&
        typeof value.observedAt === 'string' &&
        (value.source === 'clickhouse' || value.source === 'fixture') &&
        isStringArray(value.notes) &&
        typeof value.truncated === 'boolean'
    );
}

function isViewRefresh(value: unknown): value is ViewRefresh {
    return (
        isRecord(value) &&
        typeof value.status === 'string' &&
        [
            'lastSuccessAt',
            'lastSuccessDurationMs',
            'lastAttemptAt',
            'nextRefreshAt',
            'readRows',
            'writtenRows',
            'exception',
        ].every(key => value[key] === undefined || typeof value[key] === 'string') &&
        (value.progress === undefined || isFiniteNumber(value.progress))
    );
}

function isLineageNode(value: unknown): value is LineageNode {
    return (
        isRecord(value) &&
        typeof value.database === 'string' &&
        typeof value.table === 'string' &&
        typeof value.id === 'string' &&
        typeof value.engine === 'string' &&
        ['table', 'materialized-view', 'external'].some(kind => kind === value.kind) &&
        (value.mode === undefined ||
            ['incremental', 'refreshable', 'append-incremental', 'unknown'].some(
                mode => mode === value.mode,
            )) &&
        (value.schedule === undefined || typeof value.schedule === 'string') &&
        (value.definition === undefined || typeof value.definition === 'string') &&
        (value.definitionTruncated === undefined ||
            typeof value.definitionTruncated === 'boolean') &&
        (value.refresh === undefined || isViewRefresh(value.refresh))
    );
}

function isLineageEdge(value: unknown): value is LineageEdge {
    return (
        isRecord(value) &&
        typeof value.source === 'string' &&
        typeof value.target === 'string' &&
        ['insert-trigger', 'writes-to', 'refresh-dependency', 'catalog-dependency'].some(
            kind => kind === value.kind,
        )
    );
}

function isLineageSnapshot(value: unknown): value is LineageSnapshot {
    return (
        isMetadataSnapshot(value) &&
        value.kind === 'lineage' &&
        isArrayOf(value.nodes, isLineageNode) &&
        isArrayOf(value.edges, isLineageEdge)
    );
}

function isMergeActivity(value: unknown): value is MergeActivity {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        typeof value.resultPart === 'string' &&
        isStringArray(value.sourceParts) &&
        typeof value.sourcePartsTruncated === 'boolean' &&
        (value.progress === undefined || isFiniteNumber(value.progress)) &&
        (value.elapsedSeconds === undefined || isFiniteNumber(value.elapsedSeconds)) &&
        ['bytesRead', 'bytesWritten', 'memory'].every(
            key => value[key] === undefined || typeof value[key] === 'string',
        ) &&
        typeof value.isMutation === 'boolean'
    );
}

function isMutationActivity(value: unknown): value is MutationActivity {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        typeof value.command === 'string' &&
        ['createdAt', 'partsRemaining', 'latestFailure', 'latestFailureAt', 'failedPart'].every(
            key => value[key] === undefined || typeof value[key] === 'string',
        ) &&
        (value.done === undefined || typeof value.done === 'boolean')
    );
}

function isMergeSnapshot(value: unknown): value is MergeSnapshot {
    return (
        isMetadataSnapshot(value) &&
        value.kind === 'merges' &&
        typeof value.table === 'string' &&
        isArrayOf(value.items, isMergeActivity)
    );
}

function isMutationSnapshot(value: unknown): value is MutationSnapshot {
    return (
        isMetadataSnapshot(value) &&
        value.kind === 'mutations' &&
        typeof value.table === 'string' &&
        isArrayOf(value.items, isMutationActivity)
    );
}

export function isNativeExplorerSnapshot(value: unknown): value is NativeExplorerSnapshot {
    return isLineageSnapshot(value) || isMergeSnapshot(value) || isMutationSnapshot(value);
}

function isMergeTreePart(value: unknown): value is MergeTreePart {
    return (
        isRecord(value) &&
        typeof value.active === 'boolean' &&
        [
            'partition',
            'name',
            'rows',
            'marks',
            'compressedBytes',
            'uncompressedBytes',
            'minBlockNumber',
            'maxBlockNumber',
            'modifiedAt',
            'diskName',
        ].every(key => typeof value[key] === 'string') &&
        isSafeInteger(value.level)
    );
}

function isMergeTreePartTotals(value: unknown): value is MergeTreePartsSnapshot['totals'] {
    return (
        isRecord(value) &&
        ['rows', 'marks', 'compressedBytes', 'uncompressedBytes'].every(
            key => typeof value[key] === 'string',
        )
    );
}

export function isMergeTreePartsSnapshot(value: unknown): value is MergeTreePartsSnapshot {
    return (
        isRecord(value) &&
        typeof value.database === 'string' &&
        typeof value.table === 'string' &&
        isArrayOf(value.parts, isMergeTreePart) &&
        typeof value.totalParts === 'string' &&
        typeof value.activeParts === 'string' &&
        typeof value.inactiveParts === 'string' &&
        typeof value.truncated === 'boolean' &&
        typeof value.measuredAt === 'string' &&
        isMergeTreePartTotals(value.totals)
    );
}

export function isSchemaResponse(value: unknown): value is Schema {
    return isSchema(value);
}

export function isRunResponse(value: unknown): value is Run {
    return isRun(value);
}

export function isResultResponse(value: unknown): value is Result {
    return isResult(value);
}

export function isScriptResponse(value: unknown): value is Script {
    return isScript(value);
}

export function isQueryDocumentResponse(value: unknown): value is QueryDocument {
    return isQueryDocument(value);
}

export function isJsonValue(value: unknown): value is import('../../shared/common/values.js').Json {
    return isJson(value);
}
