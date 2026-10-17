import type { Schema } from '../../../../shared/database/schema/types';
import { api, apiResponses, message, post, RequestError } from '../../../api/client';
import {
    checkClickHouseCloudImport,
    CloudRequestError,
    importClickHouseCloudFile,
} from '../../connections/cloud-connection';
import { CREATE_CLOUD_TABLE_TARGET, type CloudImportColumn } from '../state/cloud-import';
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
} from '../state/import-wizard-model';
import type { ImportActionSetters } from '../state/import-wizard-controller-types';
import { loadConnectionImportSetup } from '../recovery/useImportWizardRecovery';
import { importFailureMessage } from '../state/import-failure-message';

type ForgetCloudImportContext = Pick<
    ImportActionSetters,
    | 'setStep'
    | 'setFields'
    | 'setRecoverableJobs'
    | 'setJob'
    | 'setBusy'
    | 'setError'
    | 'setTargets'
    | 'setSchema'
    | 'setTarget'
    | 'setLastExistingTarget'
    | 'setImportUnavailable'
> & {
    job?: ImportJob;
    busy: BusyAction;
    browserCloudImport: boolean;
    importConnectionId: string;
    clearPendingImport: () => void;
    chooseFile: (file?: File) => void;
};

export async function forgetCloudImport(context: ForgetCloudImportContext) {
    const {
        job,
        busy,
        browserCloudImport,
        importConnectionId,
        clearPendingImport,
        chooseFile,
        setRecoverableJobs,
        setFields,
        setStep,
        setJob,
        setBusy,
        setError,
        setTargets,
        setSchema,
        setTarget,
        setLastExistingTarget,
        setImportUnavailable,
    } = context;
    if (
        !browserCloudImport ||
        !job ||
        busy ||
        (job.status !== 'running' && job.status !== 'unknown')
    )
        return;
    clearPendingImport();
    setJob(undefined);
    setRecoverableJobs(items => items.filter(item => item.id !== job.id));
    chooseFile(undefined);
    setFields({});
    setStep('file');
    setBusy('setup');
    setError('');
    setImportUnavailable('');
    try {
        const [nextTargets, nextSchema] = await loadConnectionImportSetup(importConnectionId, true);
        setTargets(nextTargets);
        setSchema(nextSchema);
        setTarget('');
        setLastExistingTarget('');
    } catch (caught) {
        setError(`Could not load ClickHouse Cloud tables: ${message(caught)}`);
    } finally {
        setBusy('');
    }
}

async function recoverUnresolvedImport(
    {
        importConnectionId,
        setBusy,
        setRecoverableJobs,
        setJob,
        setPendingImport,
        setStep,
        setError,
        setRecoveryState,
    }: Pick<
        ImportActionSetters,
        | 'setBusy'
        | 'setRecoverableJobs'
        | 'setJob'
        | 'setPendingImport'
        | 'setStep'
        | 'setError'
        | 'setRecoveryState'
    > & { importConnectionId: string },
    caught: RequestError,
) {
    setBusy('recover');
    try {
        const jobs = await api(
            `/imports?connectionId=${encodeURIComponent(importConnectionId)}&recoverable=true`,
            apiResponses.arrayOf(apiResponses.isImportJob),
        );
        setRecoverableJobs(jobs);
        const unresolved = jobs[0];
        if (unresolved) {
            const pending = {
                id: unresolved.id,
                table: unresolved.table,
                rows: unresolved.rows,
                name: 'Previous import',
                ...(unresolved.deduplicationToken
                    ? { deduplicationToken: unresolved.deduplicationToken }
                    : {}),
            };
            setJob(unresolved);
            setPendingImport(pending);
            setStep('status');
            try {
                localStorage.setItem(importStateKey(importConnectionId), JSON.stringify(pending));
            } catch {}
        } else {
            setStep('review');
            setError(message(caught));
        }
    } catch (recoveryError) {
        setRecoveryState('failed');
        setError(`Could not check for unresolved imports: ${message(recoveryError)}`);
    }
}

type RunCommitImportContext = ImportActionSetters & {
    mapping?: ImportMapping;
    busy: BusyAction;
    browserDemoImport: boolean;
    browserCloudImport: boolean;
    file?: File;
    format?: ImportFormat;
    creatingTable: boolean;
    schema?: Schema;
    createTableDatabase: string;
    createTableName: string;
    createColumns: CloudImportColumn[];
    generateId: boolean;
    importConnectionId: string;
    preview?: ImportPreview;
    savePendingImport: (value: PendingImport) => void;
    clearPendingImport: () => void;
    rememberJob: (job: ImportJob) => void;
};

export async function runCommitImport(context: RunCommitImportContext) {
    const {
        mapping: initialMapping,
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
        savePendingImport,
        clearPendingImport,
        rememberJob,
    } = context;
    if (!initialMapping || busy) return;
    const deduplicationToken = initialMapping.deduplicationToken ?? crypto.randomUUID();
    const mapping: ImportMapping = {
        ...initialMapping,
        ...(initialMapping.deduplicationToken === deduplicationToken ? {} : { deduplicationToken }),
    };
    setMapping(mapping);
    const queryId = browserCloudImport ? `clickstudio-import-${mapping.id}` : undefined;
    const record: PendingImport = {
        id: mapping.id,
        table: mapping.table,
        rows: mapping.rowCount,
        name: preview?.name ?? 'Selected file',
        deduplicationToken,
        ...(queryId ? { queryId } : {}),
    };
    savePendingImport(record);
    setJob({
        id: mapping.id,
        table: mapping.table,
        rows: mapping.rowCount,
        ...(deduplicationToken ? { deduplicationToken } : {}),
        status: 'running',
        ...(queryId ? { queryId } : {}),
    });
    setStep('status');
    setBusy('commit');
    setError('');
    const refreshCloudMapping = async (caught: CloudRequestError) => {
        if (caught.code === 'TABLE_EXISTS' && creatingTable) {
            setMapping(undefined);
            setStep('mapping');
            try {
                const [nextTargets, nextSchema] = await loadConnectionImportSetup(
                    importConnectionId,
                    true,
                );
                setTargets(nextTargets);
                setSchema(nextSchema);
                setError('');
            } catch (refreshError) {
                setError(
                    `Table ${mapping.table} already exists. Change the table name or choose Add to a table. Could not refresh the table list: ${message(refreshError)}`,
                );
            }
        } else if (caught.code === 'SCHEMA_CHANGED') {
            setMapping(undefined);
            setStep('mapping');
            try {
                const [nextTargets, nextSchema] = await loadConnectionImportSetup(
                    importConnectionId,
                    true,
                );
                setTargets(nextTargets);
                setSchema(nextSchema);
                let nextTarget: string;

                if (nextTargets.includes(mapping.table)) {
                    nextTarget = mapping.table;
                } else if (creatingTable) {
                    nextTarget = CREATE_CLOUD_TABLE_TARGET;
                } else {
                    nextTarget = '';
                }
                setTarget(nextTarget);
                setLastExistingTarget(
                    nextTarget && nextTarget !== CREATE_CLOUD_TABLE_TARGET ? nextTarget : '',
                );
                if (nextTarget !== CREATE_CLOUD_TABLE_TARGET)
                    setFields(
                        initialFields(
                            preview?.columns ?? [],
                            writableColumns(nextSchema, nextTarget),
                        ),
                    );
                setError(
                    'The destination schema changed. Review the updated mapping before importing.',
                );
            } catch (refreshError) {
                setError(
                    `The destination schema changed. Refresh failed: ${message(refreshError)}`,
                );
            }
        } else setError(message(caught));
    };
    const recoverCloudImport = async (caught: unknown, queryId: string) => {
        if (caught instanceof CloudRequestError && caught.code === 'CLICKHOUSE_ERROR') {
            setJob(undefined);
            clearPendingImport();
            setMapping(undefined);
            setStep('mapping');
            setError(importFailureMessage(caught));
            return;
        }
        if (caught instanceof CloudRequestError && caught.status < 500) {
            setJob(undefined);
            clearPendingImport();
            setStep('review');
            await refreshCloudMapping(caught);
            return;
        }
        try {
            const status = await checkClickHouseCloudImport(
                queryId,
                mapping.table,
                mapping.rowCount,
                deduplicationToken,
            );
            rememberJob(status);
        } catch {
            rememberJob({
                id: mapping.id,
                connectionId: importConnectionId,
                table: mapping.table,
                rows: mapping.rowCount,
                queryId,
                ...(deduplicationToken ? { deduplicationToken } : {}),
                status: 'unknown',
                error: 'ClickHouse could not confirm the import. The rows may already be there.',
            });
        }
    };
    const refreshServerMapping = () => refreshServerImportMapping(context, mapping, preview);
    const recoverCommit = async (caught: unknown) => {
        if (browserCloudImport && queryId) {
            await recoverCloudImport(caught, queryId);
            return;
        }
        if (browserDemoImport) {
            setJob(undefined);
            clearPendingImport();
            setStep('review');
            setError(message(caught));
            return;
        }
        if (caught instanceof RequestError && caught.detail.code === 'SCHEMA_CHANGED') {
            await refreshServerMapping();
            return;
        }
        if (caught instanceof RequestError && caught.detail.code === 'IMPORT_UNRESOLVED') {
            await recoverUnresolvedImport(
                {
                    importConnectionId,
                    setBusy,
                    setRecoverableJobs,
                    setJob,
                    setPendingImport,
                    setStep,
                    setError,
                    setRecoveryState,
                },
                caught,
            );
            return;
        }
        if (caught instanceof RequestError && caught.status < 500) {
            setJob(undefined);
            clearPendingImport();
            setStep('review');
            setError(message(caught));
            return;
        }
        setError('The response was interrupted. Checking the saved import status…');
        try {
            const next = await api(
                `/imports/${encodeURIComponent(mapping.id)}`,
                apiResponses.isImportJob,
            );
            rememberJob(next);
        } catch {
            rememberJob({
                id: mapping.id,
                table: mapping.table,
                rows: mapping.rowCount,
                status: 'unknown',
                reconciliationRequired: true,
                error: 'The server could not confirm this insert. Check for the saved import job before starting another write.',
            });
        }
    };
    try {
        let next: ImportJob;
        if (browserCloudImport) {
            if (!file || !format || !queryId)
                throw new Error('Choose the file again before starting this import.');
            const expectedColumns = creatingTable
                ? undefined
                : schema?.columns
                      .filter(column => `${column.database}.${column.table}` === mapping.table)
                      .map(({ name, type, defaultKind }) => ({ name, type, defaultKind }));
            next = await importClickHouseCloudFile({
                file,
                format,
                target: mapping.table,
                fields: mapping.fields,
                queryId,
                ...(deduplicationToken ? { deduplicationToken } : {}),
                ...(expectedColumns ? { expectedColumns } : {}),
                ...(creatingTable
                    ? {
                          createTable: {
                              database: createTableDatabase,
                              name: createTableName,
                              columns: createColumns,
                              generateId,
                          },
                      }
                    : {}),
            });
        } else {
            next = await post(
                `/imports/${encodeURIComponent(mapping.id)}/commit`,
                {},
                apiResponses.isImportJob,
            );
        }
        rememberJob(next);
    } catch (caught) {
        await recoverCommit(caught);
    } finally {
        setBusy('');
    }
}

async function refreshServerImportMapping(
    context: RunCommitImportContext,
    mapping: ImportMapping,
    preview?: ImportPreview,
) {
    const {
        importConnectionId,
        setJob,
        clearPendingImport,
        setMapping,
        setStep,
        setTargets,
        setSchema,
        setTarget,
        setLastExistingTarget,
        setFields,
        setError,
    } = context;
    setJob(undefined);
    clearPendingImport();
    setMapping(undefined);
    setStep('mapping');
    try {
        const [nextTargets, nextSchema] = await Promise.all([
            api(
                `/connections/${encodeURIComponent(importConnectionId)}/import-targets`,
                apiResponses.isStringArray,
            ),
            api(
                `/connections/${encodeURIComponent(importConnectionId)}/schema`,
                apiResponses.isSchemaResponse,
            ),
        ]);
        setTargets(nextTargets);
        setSchema(nextSchema);
        const nextTarget =
            nextTargets.find(
                table =>
                    table === mapping.table &&
                    nextSchema.tables.some(item => `${item.database}.${item.name}` === table),
            ) ?? '';
        setTarget(nextTarget);
        setLastExistingTarget(nextTarget);
        setFields(initialFields(preview?.columns ?? [], writableColumns(nextSchema, nextTarget)));
        setError('The destination schema changed. Review the updated mapping before importing.');
    } catch (refreshError) {
        setError(`The destination schema changed. Refresh failed: ${message(refreshError)}`);
    }
}
