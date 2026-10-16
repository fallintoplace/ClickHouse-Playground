import type { ApiError } from '../../../shared/common/errors';
import type { Run } from '../../../shared/queries/execution/types';

export type SqlDraftObserver = {
    submitted: (run: Run) => void;
    failed: (error: ApiError) => void;
};

export type SqlDraftOpenOptions = {
    generatedPreviewSql?: string;
};

export type OpenSqlDraft = (
    name: string,
    sql: string,
    run: boolean,
    reuseExisting?: boolean,
    observer?: SqlDraftObserver,
    options?: SqlDraftOpenOptions,
) => { draftId: string } | undefined;
