export const IMPORT_JOB_STATUSES = ['running', 'succeeded', 'unknown'] as const;
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

export type CloudImportJob<ConnectionId extends string = string> = {
    id: string;
    connectionId: ConnectionId;
    table: string;
    queryId: string;
    deduplicationToken?: string;
    rows: number;
    createdAt: string;
    status: ImportJobStatus;
    error?: string;
    reviewedAt?: string;
    reconciliationRequired?: boolean;
    tableCreated?: boolean;
    tableExists?: boolean;
};
