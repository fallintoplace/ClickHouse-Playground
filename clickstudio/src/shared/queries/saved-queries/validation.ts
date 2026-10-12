import { CHART_KINDS } from '../results/chart-types.js';
import { isRecord, isStringArray } from '../../common/values.js';
import type { MetricContract, QueryDocument } from './types.js';

function isMetricContract(value: unknown): value is MetricContract {
    return (
        isRecord(value) &&
        typeof value.definition === 'string' &&
        typeof value.grain === 'string' &&
        isStringArray(value.dimensions) &&
        typeof value.timezone === 'string' &&
        typeof value.filters === 'string' &&
        typeof value.nullTreatment === 'string' &&
        isStringArray(value.sourceColumns)
    );
}

function isChartConfig(value: unknown): boolean {
    if (
        !isRecord(value) ||
        !CHART_KINDS.some(kind => kind === value.kind) ||
        typeof value.x !== 'number' ||
        !Array.isArray(value.ys) ||
        !value.ys.every(index => typeof index === 'number') ||
        typeof value.title !== 'string' ||
        (value.groupBy !== undefined && typeof value.groupBy !== 'number')
    )
        return false;
    if (value.candlestick === undefined) return true;
    if (!isRecord(value.candlestick)) return false;
    return Object.values(value.candlestick).every(item => typeof item === 'number');
}

export function isQueryDocument(value: unknown): value is QueryDocument {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        typeof value.owner === 'string' &&
        typeof value.name === 'string' &&
        typeof value.connectionId === 'string' &&
        typeof value.sql === 'string' &&
        Number.isSafeInteger(value.revision) &&
        typeof value.createdAt === 'string' &&
        typeof value.updatedAt === 'string' &&
        (value.deletedAt === undefined || typeof value.deletedAt === 'string') &&
        isRecord(value.parameters) &&
        Object.values(value.parameters).every(parameter => typeof parameter === 'string') &&
        isChartConfig(value.chart) &&
        (value.runId === undefined || typeof value.runId === 'string') &&
        (value.parentDocumentId === undefined || typeof value.parentDocumentId === 'string') &&
        isStringArray(value.dependencies) &&
        (value.kind === 'query' || value.kind === 'snippet' || value.kind === 'metric') &&
        (value.metric === undefined || isMetricContract(value.metric)) &&
        (value.verifiedRevision === undefined || Number.isSafeInteger(value.verifiedRevision)) &&
        (value.publishedRevision === undefined || Number.isSafeInteger(value.publishedRevision))
    );
}
