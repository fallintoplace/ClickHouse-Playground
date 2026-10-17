import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { Json } from '../../../../shared/common/values';
import type { Schema } from '../../../../shared/database/schema/types';
import { api, apiResponses, message } from '../../../api/client';
import {
    checkClickHouseCloudImport,
    CLICKHOUSE_CLOUD_CONNECTION_ID,
    getClickHouseCloudConnection,
    loadClickHouseCloudSchema,
} from '../../connections/cloud-connection';
import {
    cloudImportTargets,
    preferredCloudImportDatabase,
    type CloudImportColumn,
} from '../state/cloud-import';
import {
    importStateKey,
    isPendingImport,
    loadImportSetup,
    type ImportFormat,
    type ImportJob,
    type ImportPreview,
    type PendingImport,
} from '../state/import-wizard-model';
import type { ImportActionSetters } from '../state/import-wizard-controller-types';

export async function loadConnectionImportSetup(
    connectionId: string,
    cloudImport: boolean,
    signal?: AbortSignal,
): Promise<[string[], Schema]> {
    if (cloudImport) {
        const nextSchema = await loadClickHouseCloudSchema();
        return [cloudImportTargets(nextSchema), nextSchema];
    }
    return await loadImportSetup(connectionId, signal);
}

export function pendingImportForJob(job: ImportJob, previous?: PendingImport): PendingImport {
    const sameJob = previous?.id === job.id ? previous : undefined;
    const queryId = job.queryId || sameJob?.queryId;
    const deduplicationToken = job.deduplicationToken || sameJob?.deduplicationToken;

    return {
        id: job.id,
        table: job.table,
        rows: job.rows,
        name: sameJob?.name ?? 'Previous import',
        ...(queryId ? { queryId } : {}),
        ...(deduplicationToken ? { deduplicationToken } : {}),
        ...(sameJob?.inspectionOpened ? { inspectionOpened: true } : {}),
    };
}

export function advanceRecoveredQueue(context: {
    resolvedJob: ImportJob;
    recoverableJobs: ImportJob[];
    setJob: Dispatch<SetStateAction<ImportJob | undefined>>;
    setRecoverableJobs: Dispatch<SetStateAction<ImportJob[]>>;
    savePendingImport: (value: PendingImport) => void;
    clearPendingImport: () => void;
}): boolean {
    const {
        resolvedJob,
        recoverableJobs,
        setJob,
        setRecoverableJobs,
        savePendingImport,
        clearPendingImport,
    } = context;
    const remaining = recoverableJobs.filter(item => item.id !== resolvedJob.id);
    setRecoverableJobs(remaining);
    clearPendingImport();
    const following = remaining[0];
    if (!following) return false;
    setJob(following);
    savePendingImport(pendingImportForJob(following));
    return true;
}

type ImportWizardRecoveryContext = ImportActionSetters & {
    open: boolean;
    connectionId: string;
    importConnectionId: string;
    trusted: boolean;
    demoMode: boolean;
    browserDemoImport: boolean;
    browserCloudImport: boolean;
    setFile: Dispatch<SetStateAction<File | undefined>>;
    setFormat: Dispatch<SetStateAction<ImportFormat | undefined>>;
    setPreview: Dispatch<SetStateAction<ImportPreview | undefined>>;
    setCloudRows: Dispatch<SetStateAction<Record<string, Json>[]>>;
    setCreateTableName: Dispatch<SetStateAction<string>>;
    setCreateTableDatabase: Dispatch<SetStateAction<string>>;
    setCreateColumns: Dispatch<SetStateAction<CloudImportColumn[]>>;
    setGenerateId: Dispatch<SetStateAction<boolean>>;
    reportedJobRef: { current: string | undefined };
    reportedInspectionRef: { current: string | undefined };
    onImportedRef: { current: (job: ImportJob) => void };
    onTableNeedsInspectionRef: { current: (job: ImportJob) => void };
};

export function useImportWizardRecovery(context: ImportWizardRecoveryContext) {
    const {
        open,
        connectionId,
        importConnectionId,
        trusted,
        demoMode,
        browserDemoImport,
        browserCloudImport,
        setStep,
        setFile,
        setFormat,
        setPreview,
        setCloudRows,
        setSchema,
        setTargets,
        setTarget,
        setLastExistingTarget,
        setCreateTableName,
        setCreateTableDatabase,
        setCreateColumns,
        setFields,
        setMapping,
        setJob,
        setRecoverableJobs,
        setPendingImport,
        setBusy,
        setError,
        setGenerateId,
        setImportUnavailable,
        setRecoveryState,
        reportedJobRef,
        reportedInspectionRef,
        onImportedRef,
        onTableNeedsInspectionRef,
    } = context;

    useEffect(() => {
        function reportImported(job: ImportJob) {
            if (reportedJobRef.current === job.id) return;
            reportedJobRef.current = job.id;
            onImportedRef.current(job);
        }
        function reportDestinationNeedsInspection(job: ImportJob) {
            if (
                job.status !== 'unknown' ||
                !job.tableExists ||
                !job.table ||
                reportedInspectionRef.current === job.id
            )
                return;
            reportedInspectionRef.current = job.id;
            onTableNeedsInspectionRef.current(job);
        }
        if (!open) return;
        let current = true;
        const controller = new AbortController();
        setStep('file');
        setFile(undefined);
        setFormat(undefined);
        setPreview(undefined);
        setCloudRows([]);
        setSchema(undefined);
        setTargets([]);
        setTarget('');
        setLastExistingTarget('');
        setCreateTableName('');
        setCreateTableDatabase(getClickHouseCloudConnection()?.database ?? '');
        setCreateColumns([]);
        setFields({});
        setMapping(undefined);
        setJob(undefined);
        setRecoverableJobs([]);
        setPendingImport(undefined);
        setBusy('');
        setError('');
        setGenerateId(true);
        setImportUnavailable('');
        setRecoveryState('checking');
        reportedJobRef.current = undefined;

        if (
            (demoMode && !browserDemoImport && !browserCloudImport) ||
            (connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID && !browserCloudImport)
        ) {
            setRecoveryState('ready');
            setImportUnavailable(importUnavailableReason(connectionId));
            return () => {
                current = false;
                controller.abort();
            };
        }
        if (!trusted) {
            setRecoveryState('ready');
            setImportUnavailable('Trust this connection before importing data.');
            return () => {
                current = false;
                controller.abort();
            };
        }

        const key = importStateKey(importConnectionId);
        let stored: PendingImport | undefined;
        try {
            const value = localStorage.getItem(key);
            if (value) {
                const parsed: unknown = JSON.parse(value);
                if (isPendingImport(parsed)) stored = parsed;
            }
        } catch {}

        if (
            stored &&
            !stored.queryId &&
            ('retryDeduplicationToken' in stored || 'retryOriginId' in stored)
        ) {
            try {
                localStorage.removeItem(key);
            } catch {}
            stored = undefined;
        }

        if (browserCloudImport) {
            setBusy('recover');
            void (async () => {
                try {
                    if (stored?.queryId) {
                        const recovered = await checkClickHouseCloudImport(
                            stored.queryId,
                            stored.table,
                            stored.rows,
                            stored.deduplicationToken,
                        );
                        if (!current) return;
                        if (recovered.status === 'succeeded') {
                            try {
                                localStorage.removeItem(key);
                            } catch {}
                            setPendingImport(undefined);
                        } else {
                            const pending = pendingImportForJob(recovered, stored);
                            setPendingImport(pending);
                            try {
                                localStorage.setItem(key, JSON.stringify(pending));
                            } catch {}
                        }
                        setJob(recovered);
                        setRecoverableJobs(recovered.status === 'succeeded' ? [] : [recovered]);
                        setStep('status');
                        if (recovered.status === 'succeeded') reportImported(recovered);
                        else reportDestinationNeedsInspection(recovered);
                        setRecoveryState('ready');
                        return;
                    }
                    if (stored) {
                        try {
                            localStorage.removeItem(key);
                        } catch {}
                    }
                    setPendingImport(undefined);
                    setStep('file');
                    setBusy('setup');
                    const [nextTargets, nextSchema] = await loadConnectionImportSetup(
                        importConnectionId,
                        true,
                        controller.signal,
                    );
                    if (!current) return;
                    setTargets(nextTargets);
                    setSchema(nextSchema);
                    setCreateTableDatabase(
                        preferredCloudImportDatabase(
                            nextSchema,
                            getClickHouseCloudConnection()?.database ?? '',
                        ),
                    );
                    setLastExistingTarget('');
                    setTarget('');
                    setRecoveryState('ready');
                } catch (caught) {
                    if (!current) return;
                    setRecoveryState('failed');
                    setError(`Could not check Cloud import status: ${message(caught)}`);
                } finally {
                    if (current) setBusy('');
                }
            })();
            return () => {
                current = false;
                controller.abort();
            };
        }

        setBusy('recover');
        void api(
            `/imports?connectionId=${encodeURIComponent(importConnectionId)}&recoverable=true`,
            apiResponses.arrayOf(apiResponses.isImportJob),
            { signal: controller.signal },
        )
            .then(async jobs => {
                if (!current) return;
                setRecoverableJobs(jobs);
                const recovered = jobs.find(item => item.id === stored?.id) ?? jobs[0];
                if (recovered) {
                    const pending = pendingImportForJob(recovered, stored);
                    setPendingImport(pending);
                    setJob(recovered);
                    setStep('status');
                    try {
                        localStorage.setItem(key, JSON.stringify(pending));
                    } catch {}
                    setRecoveryState('ready');
                    setBusy('');
                    return;
                }
                if (stored) {
                    try {
                        localStorage.removeItem(key);
                    } catch {}
                }
                setPendingImport(undefined);
                setStep('file');
                setBusy('setup');
                try {
                    const [nextTargets, nextSchema] = await loadConnectionImportSetup(
                        importConnectionId,
                        false,
                        controller.signal,
                    );
                    if (!current) return;
                    setTargets(nextTargets);
                    setSchema(nextSchema);
                    const hasTarget = nextTargets.some(table =>
                        nextSchema.tables.some(item => `${item.database}.${item.name}` === table),
                    );
                    if (!hasTarget)
                        setImportUnavailable(
                            'No import targets are configured for this connection. Ask the workspace owner to allow a destination table.',
                        );
                } catch (caught) {
                    if (current) setError(message(caught));
                }
                if (current) setRecoveryState('ready');
            })
            .catch(caught => {
                if (!current) return;
                setRecoveryState('failed');
                setError(`Could not check for unresolved imports: ${message(caught)}`);
            })
            .finally(() => {
                if (current) setBusy('');
            });

        return () => {
            current = false;
            controller.abort();
        };
    }, [
        open,
        connectionId,
        importConnectionId,
        trusted,
        demoMode,
        browserDemoImport,
        browserCloudImport,
        onImportedRef,
        onTableNeedsInspectionRef,
        reportedInspectionRef,
        reportedJobRef,
        setBusy,
        setCloudRows,
        setCreateColumns,
        setCreateTableDatabase,
        setCreateTableName,
        setError,
        setFields,
        setFile,
        setFormat,
        setGenerateId,
        setImportUnavailable,
        setJob,
        setLastExistingTarget,
        setMapping,
        setPendingImport,
        setPreview,
        setRecoverableJobs,
        setRecoveryState,
        setSchema,
        setStep,
        setTarget,
        setTargets,
    ]);
}

function importUnavailableReason(connectionId: string) {
    if (connectionId === 'playground')
        return 'File imports are disabled on the public read-only ClickHouse Playground connection.';
    if (connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID)
        return 'Reconnect to ClickHouse Cloud before importing rows.';
    return 'File imports are disabled in sample data. This workspace never writes to a database.';
}
