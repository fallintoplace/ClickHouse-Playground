import { isRecord } from '../../../shared/common/values.js';
import type { ChartConfig } from '../../../shared/queries/results/chart-settings.js';
import type { QueryDocument } from '../../../shared/queries/saved-queries/types.js';
import { isQueryDocument } from '../../../shared/queries/saved-queries/validation.js';

export const LEGACY_CHART_KINDS = ['area', 'stacked', 'pie'] as const;

export type StoredQueryDocument = Omit<QueryDocument, 'chart'> & {
    chart: Omit<ChartConfig, 'kind'> & {
        kind: ChartConfig['kind'] | (typeof LEGACY_CHART_KINDS)[number];
    };
};

export function isStoredQueryDocument(value: unknown): value is StoredQueryDocument {
    if (isQueryDocument(value)) return true;
    if (!isRecord(value) || !isRecord(value.chart)) return false;
    const chart = value.chart;
    return (
        LEGACY_CHART_KINDS.some(kind => kind === chart.kind) &&
        isQueryDocument({ ...value, chart: { ...chart, kind: 'table' } })
    );
}
