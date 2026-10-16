import type { ResultCompleteness } from '../execution/status.js';
import type { Column, Row } from '../../common/values.js';

export type ResultTruncationReason = 'rows' | 'bytes';

export interface Result {
    runId: string;
    queryId: string;
    columns: Column[];
    rows: Row[];
    completeness: ResultCompleteness;
    truncationReason?: ResultTruncationReason;
    createdAt: string;
}

export interface ResultPage extends Omit<Result, 'rows'> {
    rows: Row[];
    offset: number;
    totalRows: number;
    nextOffset: number | null;
}
