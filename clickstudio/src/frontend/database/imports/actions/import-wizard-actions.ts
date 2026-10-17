import type { Dispatch, SetStateAction } from 'react';
import type { Json } from '../../../../shared/common/values';
import type { Schema, SchemaColumn } from '../../../../shared/database/schema/types';
import { mapImportRows } from '../../../../shared/database/imports/mapping';
import { api, apiResponses, message, post } from '../../../api/client';
import { getClickHouseCloudConnection } from '../../connections/cloud-connection';
import {
    CREATE_CLOUD_TABLE_TARGET,
    inferCloudImportColumns,
    suggestCloudTableName,
    type CloudImportColumn,
} from '../state/cloud-import';
import {
    importStateKey,
    initialFields,
    writableColumns,
    type BusyAction,
    type ImportFormat,
    type ImportJob,
    type ImportMapping,
    type ImportPreview,
    type PendingImport,
    type Step,
} from '../state/import-wizard-model';
import type { ImportActionSetters } from '../state/import-wizard-controller-types';
import { importFailureMessage } from '../state/import-failure-message';
import { pendingImportForJob, advanceRecoveredQueue } from '../recovery/useImportWizardRecovery';
import { runCommitImport, forgetCloudImport } from './commit-import';

type ConfirmUnknownImportContext = Pick<ImportActionSetters, 'setBusy' | 'setError'> & {
    job?: ImportJob;
    recoverableJobs: ImportJob[];
    busy: BusyAction;
    browserCloudImport: boolean;
    rememberJob: (job: ImportJob) => void;
    setJob: ImportActionSetters['setJob'];
    setRecoverableJobs: ImportActionSetters['setRecoverableJobs'];
    savePendingImport: (value: PendingImport) => void;
    clearPendingImport: () => void;
};

async function runConfirmUnknownImport(context: ConfirmUnknownImportContext) {
    const { job, busy, browserCloudImport, rememberJob, setBusy, setError } = context;
    if (!job || job.status !== 'unknown' || busy) return;
    setBusy('review');
    setError('');
    try {
        let checked = job;
        if (!browserCloudImport) {
            checked = job.reviewedAt
                ? await post(
                      `/imports/${encodeURIComponent(job.id)}/reconcile`,
                      {},
                      apiResponses.isImportJob,
                  )
                : await post(
                      `/imports/${encodeURIComponent(job.id)}/review`,
                      { inspected: true, noActiveInsert: true },
                      apiResponses.isImportJob,
                  );
            if (checked.status !== 'unknown') {
                rememberJob(checked);
                if (checked.status === 'succeeded')
                    advanceRecoveredQueue({ resolvedJob: checked, ...context });
                return;
            }
            if (!checked.reviewedAt) {
                rememberJob(checked);
                return;
            }
        }
        const succeeded = {
            ...checked,
            status: 'succeeded' as const,
            error: undefined,
            reviewedAt: checked.reviewedAt ?? new Date().toISOString(),
        };
        rememberJob(succeeded);
        advanceRecoveredQueue({ resolvedJob: succeeded, ...context });
    } catch (caught) {
        setError(`Could not confirm the imported rows: ${message(caught)}`);
    } finally {
        setBusy('');
    }
}

function updateRecoverableJobs(current: ImportJob[], next: ImportJob): ImportJob[] {
    if (next.status === 'succeeded' || next.reviewedAt)
        return current.filter(item => item.id !== next.id);
    if (current.some(item => item.id === next.id))
        return current.map(item => (item.id === next.id ? next : item));
    return [next, ...current];
}

type ImportWizardActionsContext = {
    actionSetters: ImportActionSetters;
    importConnectionId: string;
    browserCloudImport: boolean;
    browserDemoImport: boolean;
    preview?: ImportPreview;
    job?: ImportJob;
    pendingImport?: PendingImport;
    busy: BusyAction;
    recoveryState: 'checking' | 'ready' | 'failed';
    onClose: () => void;
    reportedJobRef: { current: string | undefined };
    reportedInspectionRef: { current: string | undefined };
    onImportedRef: { current: (job: ImportJob) => void };
    onTableNeedsInspectionRef: { current: (job: ImportJob) => void };
    chooseFile: (file?: File) => void;
    file?: File;
    format?: ImportFormat;
    creatingTable: boolean;
    schema?: Schema;
    createTableDatabase: string;
    createTableName: string;
    createColumns: CloudImportColumn[];
    target: string;
    generateId: boolean;
    mapping?: ImportMapping;
    destinationNames: string[];
    duplicateDestinations: boolean;
    createTableAlreadyExists: boolean;
    cloudRows: Record<string, Json>[];
    selectedFields: Record<string, string>;
    destinationColumns: ReturnType<typeof writableColumns>;
    recoverableJobs: ImportJob[];
};

export function createImportWizardActions(context: ImportWizardActionsContext) {
    const {
        actionSetters,
        importConnectionId,
        browserCloudImport,
        browserDemoImport,
        preview,
        job,
        pendingImport,
        busy,
        recoveryState,
        onClose,
        reportedJobRef,
        reportedInspectionRef,
        onImportedRef,
        onTableNeedsInspectionRef,
        chooseFile,
        file,
        format,
        creatingTable,
        schema,
        createTableDatabase,
        createTableName,
        createColumns,
        target,
        generateId,
        mapping,
        destinationNames,
        duplicateDestinations,
        createTableAlreadyExists,
        cloudRows,
        selectedFields,
        destinationColumns,
        recoverableJobs,
    } = context;
    const {
        setJob,
        setStep,
        setBusy,
        setError,
        setMapping,
        setTarget,
        setLastExistingTarget,
        setFields,
        setRecoverableJobs,
        setPendingImport,
        setCreateColumns,
        setCreateTableName,
        setGenerateId,
    } = actionSetters;
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

    function rememberJob(next: ImportJob) {
        setJob(next);
        setRecoverableJobs(current => updateRecoverableJobs(current, next));
        if (next.status === 'succeeded') reportImported(next);
        else reportDestinationNeedsInspection(next);
    }

    function savePendingImport(value: PendingImport) {
        setPendingImport(value);
        try {
            localStorage.setItem(importStateKey(importConnectionId), JSON.stringify(value));
        } catch {}
    }

    function clearPendingImport() {
        try {
            localStorage.removeItem(importStateKey(importConnectionId));
        } catch {}
        setPendingImport(undefined);
    }

    function openImportDestination() {
        if (!job || job.status !== 'unknown' || !job.tableExists || !job.table) return;
        savePendingImport({ ...pendingImportForJob(job, pendingImport), inspectionOpened: true });
        void closeWizard();
    }

    async function closeWizard() {
        if (!browserCloudImport && (busy || job?.status === 'running')) return;
        if (preview?.id && !browserCloudImport) {
            void api(`/imports/${encodeURIComponent(preview.id)}`, apiResponses.isUnknown, {
                method: 'DELETE',
            }).catch(() => undefined);
        }
        if (
            recoveryState === 'ready' &&
            (job?.status !== 'unknown' || job.reviewedAt) &&
            (!browserCloudImport || job?.status !== 'running')
        )
            clearPendingImport();
        onClose();
    }

    function changeTarget(next: string) {
        if (next !== CREATE_CLOUD_TABLE_TARGET) setLastExistingTarget(next);
        setTarget(next);
        if (browserCloudImport && next === CREATE_CLOUD_TABLE_TARGET && preview) {
            const columns = inferCloudImportColumns(
                cloudRows.length ? cloudRows : preview.rows,
                preview.columns,
            );
            setCreateColumns(columns);
            setCreateTableName(suggestCloudTableName(preview.name));
            setFields(Object.fromEntries(columns.map(column => [column.source, column.name])));
            setGenerateId(!columns.some(column => column.name.toLowerCase() === 'id'));
        } else {
            setFields(initialFields(preview?.columns ?? [], writableColumns(schema, next)));
        }
        setMapping(undefined);
        setError('');
    }

    function updateCreateColumn(source: string, key: 'name' | 'type', value: string) {
        setCreateColumns(current => {
            const next = current.map(column =>
                column.source === source
                    ? ({ ...column, [key]: value } as CloudImportColumn)
                    : column,
            );
            if (key === 'name') {
                const hadId = current.some(column => column.name.toLowerCase() === 'id');
                const hasId = next.some(column => column.name.toLowerCase() === 'id');
                if (hadId !== hasId) setGenerateId(!hasId);
            }
            return next;
        });
        if (key === 'name') setFields(current => ({ ...current, [source]: value }));
        setMapping(undefined);
        setError('');
    }

    async function previewMapping() {
        return await previewImportMapping({
            preview,
            target,
            destinationNames,
            duplicateDestinations,
            busy,
            creatingTable,
            createTableAlreadyExists,
            setError,
            createTableDatabase,
            createTableName,
            setBusy,
            browserCloudImport,
            schema,
            cloudRows,
            selectedFields,
            destinationColumns,
            importConnectionId,
            setMapping,
            setStep,
        });
    }

    async function commitImport() {
        await runCommitImport({
            mapping,
            busy,
            browserDemoImport,
            browserCloudImport,
            file,
            format,
            creatingTable,
            schema,
            createTableDatabase,
            createTableName,
            createColumns,
            generateId,
            importConnectionId,
            preview,
            ...actionSetters,
            savePendingImport,
            clearPendingImport,
            rememberJob,
        });
    }

    async function confirmUnknownImport() {
        await runConfirmUnknownImport({
            job,
            recoverableJobs,
            busy,
            browserCloudImport,
            rememberJob,
            ...actionSetters,
            savePendingImport,
            clearPendingImport,
        });
    }
    const forgetImport = () =>
        forgetCloudImport({
            job,
            busy,
            browserCloudImport,
            importConnectionId,
            clearPendingImport,
            chooseFile,
            ...actionSetters,
        });
    return {
        reportImported,
        reportDestinationNeedsInspection,
        savePendingImport,
        clearPendingImport,
        publicActions: {
            closeWizard,
            openImportDestination,
            forgetImport,
            changeTarget,
            updateCreateColumn,
            previewMapping,
            commitImport,
            confirmUnknownImport,
        },
    };
}

async function previewImportMapping({
    preview,
    target,
    destinationNames,
    duplicateDestinations,
    busy,
    creatingTable,
    createTableAlreadyExists,
    setError,
    createTableDatabase,
    createTableName,
    setBusy,
    browserCloudImport,
    schema,
    cloudRows,
    selectedFields,
    destinationColumns,
    importConnectionId,
    setMapping,
    setStep,
}: {
    preview: ImportPreview | undefined;
    target: string;
    destinationNames: string[];
    duplicateDestinations: boolean;
    busy: BusyAction;
    creatingTable: boolean;
    createTableAlreadyExists: boolean;
    setError: import('react').Dispatch<import('react').SetStateAction<string>>;
    createTableDatabase: string;
    createTableName: string;
    setBusy: import('react').Dispatch<import('react').SetStateAction<BusyAction>>;
    browserCloudImport: boolean;
    schema: Schema | undefined;
    cloudRows: Record<string, Json>[];
    selectedFields: { [k: string]: string };
    destinationColumns: SchemaColumn[];
    importConnectionId: string;
    setMapping: import('react').Dispatch<import('react').SetStateAction<ImportMapping | undefined>>;
    setStep: Dispatch<SetStateAction<Step>>;
}) {
    if (!preview || !target || !destinationNames.length || duplicateDestinations || busy) return;
    if (creatingTable && createTableAlreadyExists) {
        setError(
            `Table ${createTableDatabase}.${createTableName} already exists. Choose a different name or add rows to the existing table.`,
        );
        return;
    }
    const table = creatingTable ? `${createTableDatabase}.${createTableName}` : target;
    setBusy('mapping');
    setError('');
    try {
        let next: ImportMapping;
        if (browserCloudImport) {
            const cloud = getClickHouseCloudConnection();
            if (!cloud)
                throw new Error('Reconnect to ClickHouse Cloud before reviewing the import.');
            if (creatingTable && !schema?.databases?.includes(createTableDatabase))
                throw new Error('Choose a database visible to this ClickHouse user.');
            if (creatingTable && !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(createTableName))
                throw new Error('Use letters, numbers, and underscores for the new table name.');
            const sourceRows = cloudRows.length ? cloudRows : preview.rows;
            const mapped = mapImportRows(
                sourceRows,
                preview.columns,
                selectedFields,
                destinationColumns,
            );
            next = {
                id: crypto.randomUUID(),
                deduplicationToken: crypto.randomUUID(),
                inputId: preview.id,
                connectionId: importConnectionId,
                table,
                fields: selectedFields,
                rows: mapped.rows,
                rowCount: sourceRows.length,
                missingFields: mapped.missingFields,
            };
        } else {
            next = await post(
                `/imports/${encodeURIComponent(preview.id)}/mapping`,
                {
                    connectionId: importConnectionId,
                    table: target,
                    fields: selectedFields,
                },
                apiResponses.isImportMapping,
            );
        }
        setMapping(next);
        setStep('review');
    } catch (caught) {
        setError(importFailureMessage(caught));
    } finally {
        setBusy('');
    }
}
