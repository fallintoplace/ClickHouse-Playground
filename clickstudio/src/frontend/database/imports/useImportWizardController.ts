import { useEffect, useMemo, useRef, useState } from 'react';
import type { Json } from '../../../shared/common/values';
import type { Schema } from '../../../shared/database/schema/types';
import { useImportJobPolling } from './recovery/useImportJobPolling';
import { isFrontendDemoPreview } from '../../api/client';
import {
    CLICKHOUSE_CLOUD_CONNECTION_ID,
    getClickHouseCloudConnection,
} from '../connections/cloud-connection';
import { CREATE_TABLE_COLUMN_TYPES } from '../../../shared/database/tables/create-table';
import { CREATE_CLOUD_TABLE_TARGET, type CloudImportColumn } from './state/cloud-import';
import {
    writableColumns,
    type BusyAction,
    type ImportFormat,
    type ImportJob,
    type ImportMapping,
    type ImportPreview,
    type PendingImport,
    type Step,
} from './state/import-wizard-model';
import type { ImportActionSetters } from './state/import-wizard-controller-types';
import { useImportWizardRecovery, advanceRecoveredQueue } from './recovery/useImportWizardRecovery';
import { createImportWizardFileActions } from './actions/import-wizard-file-actions';
import { createImportWizardActions } from './actions/import-wizard-actions';

export type ImportWizardControllerOptions = {
    open: boolean;
    connectionId: string;
    trusted: boolean;
    demoMode: boolean;
    onClose: () => void;
    onImported: (job: ImportJob) => void;
    onTableNeedsInspection: (job: ImportJob) => void;
};

export function useImportWizardController({
    open,
    connectionId,
    trusted,
    demoMode,
    onClose,
    onImported,
    onTableNeedsInspection,
}: ImportWizardControllerOptions) {
    const browserDemoImport = demoMode && isFrontendDemoPreview && connectionId === 'demo';
    const browserCloudImport =
        connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID && Boolean(getClickHouseCloudConnection());
    const importConnectionId = browserDemoImport ? 'demo' : connectionId;
    const dialogRef = useRef<HTMLDialogElement>(null);
    const onImportedRef = useRef(onImported);
    const onTableNeedsInspectionRef = useRef(onTableNeedsInspection);
    const reportedJobRef = useRef<string | undefined>(undefined);
    const reportedInspectionRef = useRef<string | undefined>(undefined);
    onImportedRef.current = onImported;
    onTableNeedsInspectionRef.current = onTableNeedsInspection;

    const [step, setStep] = useState<Step>('file');
    const [file, setFile] = useState<File>();
    const [format, setFormat] = useState<ImportFormat>();
    const [preview, setPreview] = useState<ImportPreview>();
    const [cloudRows, setCloudRows] = useState<Record<string, Json>[]>([]);
    const [schema, setSchema] = useState<Schema>();
    const [targets, setTargets] = useState<string[]>([]);
    const [target, setTarget] = useState('');
    const [lastExistingTarget, setLastExistingTarget] = useState('');
    const [createTableDatabase, setCreateTableDatabase] = useState(
        () => getClickHouseCloudConnection()?.database ?? '',
    );
    const [createTableName, setCreateTableName] = useState('');
    const [createColumns, setCreateColumns] = useState<CloudImportColumn[]>([]);
    const [fields, setFields] = useState<Record<string, string>>({});
    const [mapping, setMapping] = useState<ImportMapping>();
    const [job, setJob] = useState<ImportJob>();
    const [recoverableJobs, setRecoverableJobs] = useState<ImportJob[]>([]);
    const [pendingImport, setPendingImport] = useState<PendingImport>();
    const [recoveryState, setRecoveryState] = useState<'checking' | 'ready' | 'failed'>('checking');
    const [busy, setBusy] = useState<BusyAction>('');
    const [error, setError] = useState('');
    const [generateId, setGenerateId] = useState(true);
    const [importUnavailable, setImportUnavailable] = useState('');

    const availableTargets = useMemo(
        () =>
            targets.filter(table =>
                schema?.tables.some(item => `${item.database}.${item.name}` === table),
            ),
        [schema, targets],
    );
    const creatingTable = browserCloudImport && target === CREATE_CLOUD_TABLE_TARGET;
    const createTableAlreadyExists = Boolean(
        creatingTable &&
        schema?.tables.some(
            table => table.database === createTableDatabase && table.name === createTableName,
        ),
    );
    const destinationColumns = useMemo(
        () =>
            creatingTable
                ? createColumns.map(column => ({
                      database: createTableDatabase,
                      table: createTableName,
                      name: column.name,
                      type: `Nullable(${column.type})`,
                      defaultKind: '',
                      comment: '',
                  }))
                : writableColumns(schema, target),
        [creatingTable, createColumns, createTableDatabase, createTableName, schema, target],
    );
    const selectedFields = useMemo(
        () =>
            Object.fromEntries(
                Object.entries(fields).filter(([, destination]) => Boolean(destination)),
            ),
        [fields],
    );
    const destinationNames = Object.values(selectedFields);
    const duplicateDestinations = new Set(destinationNames).size !== destinationNames.length;
    const sampleColumns = preview?.columns.slice(0, 6) ?? [];
    const { chooseFile, previewFile, previewSampleFile } = createImportWizardFileActions({
        browserDemoImport,
        browserCloudImport,
        target,
        file,
        format,
        busy,
        setFile,
        setFormat,
        setPreview,
        setMapping,
        setFields,
        setCloudRows,
        setCreateColumns,
        setCreateTableName,
        setJob,
        setError,
        setGenerateId,
        setStep,
        setBusy,
        setTarget,
        setLastExistingTarget,
    });

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (open && !dialog.open) dialog.showModal();
        if (!open && dialog.open) dialog.close();
    }, [open]);

    useImportWizardRecovery({
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
    });

    const actionSetters: ImportActionSetters = {
        setJob,
        setStep,
        setBusy,
        setError,
        setMapping,
        setTargets,
        setSchema,
        setTarget,
        setLastExistingTarget,
        setFields,
        setRecoveryState,
        setRecoverableJobs,
        setPendingImport,
        setImportUnavailable,
        setCreateColumns,
        setCreateTableName,
        setGenerateId,
    };
    const callbacks = createImportWizardActions({
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
    });

    useImportJobPolling({
        open,
        step,
        job,
        setJob,
        setRecoverableJobs,
        setBusy,
        setError,
        onSucceeded: job => {
            callbacks.reportImported(job);
            advanceRecoveredQueue({
                resolvedJob: job,
                recoverableJobs,
                setJob,
                setRecoverableJobs,
                savePendingImport: callbacks.savePendingImport,
                clearPendingImport: callbacks.clearPendingImport,
            });
        },
        onNeedsInspection: callbacks.reportDestinationNeedsInspection,
        cloudImport: browserCloudImport,
    });

    return {
        dialogRef,
        step,
        setStep,
        file,
        format,
        preview,
        setPreview,
        target,
        schema,
        lastExistingTarget,
        fields,
        setFields,
        mapping,
        setMapping,
        job,
        recoverableJobs,
        pendingImport,
        recoveryState,
        busy,
        error,
        setError,
        generateId,
        setGenerateId,
        importUnavailable,
        browserDemoImport,
        availableTargets,
        destinationColumns,
        selectedFields,
        destinationNames,
        duplicateDestinations,
        sampleColumns,
        browserCloudImport,
        creatingTable,
        createTableAlreadyExists,
        createTableName,
        setCreateTableName,
        createTableDatabase,
        setCreateTableDatabase,
        createColumns,
        createColumnTypes: CREATE_TABLE_COLUMN_TYPES,
        ...callbacks.publicActions,
        chooseFile,
        previewFile,
        previewSampleFile,
    };
}
