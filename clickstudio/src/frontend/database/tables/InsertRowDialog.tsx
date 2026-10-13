import type { ImportJobStatus } from '../../../shared/database/imports/status';
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type Dispatch,
    type FormEvent,
    type SetStateAction,
} from 'react';
import type { SchemaColumn, SchemaTable } from '../../../shared/database/schema/types';
import { api, apiResponses, message, post, RequestError } from '../../api/client';
import { Icon } from '../../ui/components/icons';
import {
    checkClickHouseCloudImport,
    CLICKHOUSE_CLOUD_CONNECTION_ID,
    CloudRequestError,
    getClickHouseCloudConnection,
    insertClickHouseCloudRow,
} from '../connections/cloud-connection';

type Props = {
    connectionId: string;
    table: SchemaTable;
    columns: readonly SchemaColumn[];
    onClose: () => void;
    onInserted: () => void;
};

type Preview = { id: string; rowCount: number };
type Mapping = {
    id: string;
    table: string;
    rowCount: number;
    fields: Record<string, string>;
    deduplicationToken?: string | null;
};
type ImportJob = {
    id: string;
    table: string;
    rows: number;
    status: ImportJobStatus;
    error?: string;
    reconciliationRequired?: boolean;
    reviewedAt?: string;
    queryId?: string;
    deduplicationToken?: string;
    connectionId?: string;
};
type Step = 'edit' | 'review' | 'status';
function optionalColumn(column: SchemaColumn) {
    return Boolean(column.defaultKind) || /^Nullable\(/.test(column.type);
}

async function confirmInsertedRow({
    job,
    busy,
    setBusy,
    setError,
    setJob,
    reportSuccess,
}: {
    job: ImportJob | undefined;
    busy: boolean;
    setBusy: Dispatch<SetStateAction<boolean>>;
    setError: Dispatch<SetStateAction<string>>;
    setJob: Dispatch<SetStateAction<ImportJob | undefined>>;
    reportSuccess: () => void;
}) {
    if (!job || busy) return;
    setBusy(true);
    setError('');
    try {
        const next = job.queryId
            ? job
            : await post(
                  `/imports/${encodeURIComponent(job.id)}/review`,
                  { inspected: true, noActiveInsert: true },
                  apiResponses.isImportJob,
              );
        if (next.status === 'running' || next.status === 'succeeded') {
            setJob(next);
            if (next.status === 'succeeded') reportSuccess();
            return;
        }
        setJob({
            ...next,
            status: 'succeeded',
            error: undefined,
            reviewedAt: next.reviewedAt ?? new Date().toISOString(),
        });
        reportSuccess();
    } catch (caught) {
        setError(`Could not record that the row is present: ${message(caught)}`);
    } finally {
        setBusy(false);
    }
}

export function InsertRowDialog({ connectionId, table, columns, onClose, onInserted }: Props) {
    const dialog = useRef<HTMLDialogElement>(null);
    const reported = useRef(false);
    const name = `${table.database}.${table.name}`;
    const writableColumns = useMemo(
        () => columns.filter(column => !['MATERIALIZED', 'ALIAS'].includes(column.defaultKind)),
        [columns],
    );
    const [included, setIncluded] = useState<Record<string, boolean>>(() =>
        Object.fromEntries(writableColumns.map(column => [column.name, !optionalColumn(column)])),
    );
    const [values, setValues] = useState<Record<string, string>>(() =>
        Object.fromEntries(writableColumns.map(column => [column.name, ''])),
    );
    const [allowed, setAllowed] = useState(false);
    const [loading, setLoading] = useState(true);
    const [step, setStep] = useState<Step>('edit');
    const [preview, setPreview] = useState<Preview>();
    const [mapping, setMapping] = useState<Mapping>();
    const [job, setJob] = useState<ImportJob>();
    const [busy, setBusy] = useState(false);
    const [retryAttempted, setRetryAttempted] = useState(false);
    const [error, setError] = useState('');
    const [setupError, setSetupError] = useState('');
    const cloudConnection = connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID;
    const row = useMemo(
        () =>
            Object.fromEntries(
                writableColumns
                    .filter(column => included[column.name])
                    .map(column => [column.name, values[column.name] ?? '']),
            ),
        [writableColumns, included, values],
    );
    const reportSuccess = useCallback(() => {
        if (reported.current) return;
        reported.current = true;
        onInserted();
    }, [onInserted]);

    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        element.showModal();
        let active = true;
        if (cloudConnection) {
            if (getClickHouseCloudConnection()) setAllowed(true);
            else setSetupError('Reconnect to ClickHouse Cloud before inserting a row.');
            setLoading(false);
            return () => {
                if (element.open) element.close();
            };
        }
        void api(
            `/connections/${encodeURIComponent(connectionId)}/import-targets`,
            apiResponses.isStringArray,
        )
            .then(targets => {
                if (!Array.isArray(targets) || targets.some(target => typeof target !== 'string'))
                    throw new Error('The connection returned an invalid list of insert targets.');
                if (active) setAllowed(targets.includes(name));
            })
            .catch(caught => {
                if (active) setSetupError(message(caught));
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
            if (element.open) element.close();
        };
    }, [connectionId, cloudConnection, name]);

    useEffect(() => {
        if (step !== 'status' || job?.status !== 'running' || busy) return;
        let active = true;
        const timer = window.setTimeout(() => {
            const status = job.queryId
                ? checkClickHouseCloudImport(
                      job.queryId,
                      job.table,
                      job.rows,
                      job.deduplicationToken,
                  )
                : api(`/imports/${encodeURIComponent(job.id)}`, apiResponses.isImportJob);
            void status
                .then(next => {
                    if (!active) return;
                    setJob(next);
                    if (next.status === 'succeeded') reportSuccess();
                })
                .catch(caught => {
                    if (!active) return;
                    if (job.queryId)
                        setJob(current =>
                            current
                                ? {
                                      ...current,
                                      status: 'unknown',
                                      error: `Could not confirm the insert status. Inspect ${name} before trying again.`,
                                  }
                                : current,
                        );
                    setError(message(caught));
                });
        }, 1200);
        return () => {
            active = false;
            window.clearTimeout(timer);
        };
    }, [step, job, busy, name, reportSuccess]);

    const reviewRow = (event: FormEvent<HTMLFormElement>) =>
        reviewInsertRow(event, {
            allowed,
            loading,
            busy,
            row,
            cloudConnection,
            name,
            tableName: table.name,
            connectionId,
            setBusy,
            setError,
            setStep,
            setMapping,
            setPreview,
        });

    async function insertRow() {
        if (!mapping || busy) return;
        setBusy(true);
        setError('');
        const deduplicationToken = mapping.deduplicationToken ?? crypto.randomUUID();
        const queryId = cloudConnection ? `clickstudio-import-${crypto.randomUUID()}` : undefined;
        setMapping({ ...mapping, deduplicationToken });
        setJob({
            id: mapping.id,
            table: name,
            rows: 1,
            deduplicationToken,
            status: 'running',
            ...(queryId ? { queryId, connectionId } : {}),
        });
        setStep('status');
        try {
            const next =
                cloudConnection && queryId
                    ? await insertClickHouseCloudRow({
                          table: name,
                          columns,
                          row,
                          queryId,
                          deduplicationToken,
                      })
                    : await post(
                          `/imports/${encodeURIComponent(mapping.id)}/commit`,
                          {},
                          apiResponses.isImportJob,
                      );
            setJob(next);
            if (next.status === 'succeeded') reportSuccess();
        } catch (caught) {
            if (cloudConnection && caught instanceof CloudRequestError && caught.status < 500) {
                setStep('review');
                setJob(undefined);
                setError(message(caught));
            } else if (cloudConnection && queryId) {
                try {
                    const recovered = await checkClickHouseCloudImport(
                        queryId,
                        name,
                        1,
                        deduplicationToken,
                    );
                    setJob(recovered);
                    if (recovered.status === 'succeeded') reportSuccess();
                } catch {
                    setJob({
                        id: mapping.id,
                        table: name,
                        rows: 1,
                        queryId,
                        deduplicationToken,
                        connectionId,
                        status: 'unknown',
                        error: `Could not confirm whether the row reached ${name}. Inspect the table before trying again.`,
                    });
                }
            } else {
                try {
                    const recovered = await api<ImportJob>(
                        `/imports/${encodeURIComponent(mapping.id)}`,
                        apiResponses.isImportJob,
                    );
                    setJob(recovered);
                    if (recovered.status === 'succeeded') reportSuccess();
                } catch {
                    setStep('review');
                    setJob(undefined);
                    setError(message(caught));
                }
            }
        } finally {
            setBusy(false);
        }
    }

    async function reconcile() {
        if (!job || busy) return;
        setBusy(true);
        setError('');
        try {
            const next = job.queryId
                ? await checkClickHouseCloudImport(
                      job.queryId,
                      job.table,
                      job.rows,
                      job.deduplicationToken,
                  )
                : await post(
                      `/imports/${encodeURIComponent(job.id)}/reconcile`,
                      {},
                      apiResponses.isImportJob,
                  );
            setJob(next);
            if (next.status === 'succeeded') reportSuccess();
        } catch (caught) {
            setError(message(caught));
        } finally {
            setBusy(false);
        }
    }

    const confirmInserted = () =>
        confirmInsertedRow({ job, busy, setBusy, setError, setJob, reportSuccess });

    async function retryUnknown() {
        return await retryUnknownInsert({
            job,
            mapping,
            busy,
            retryAttempted,
            setBusy,
            setError,
            setJob,
            reportSuccess,
            preview,
            connectionId,
            name,
            setMapping,
            cloudConnection,
            setRetryAttempted,
            columns,
            row,
        });
    }

    const close = () => closeInsertRowDialog({ busy, job, preview, onClose });

    const canClose = !busy && job?.status !== 'running';
    return renderInsertRowDialog({
        dialog,
        canClose,
        close,
        name,
        loading,
        setupError,
        allowed,
        step,
        reviewRow,
        writableColumns,
        included,
        setIncluded,
        values,
        setValues,
        row,
        job,
        retryAttempted,
        busy,
        reconcile,
        confirmInserted,
        retryUnknown,
        error,
        setStep,
        insertRow,
    });
}

type InsertRowDialogRenderProps = {
    dialog: import('react').RefObject<HTMLDialogElement | null>;
    canClose: boolean;
    close: () => void;
    name: string;
    loading: boolean;
    setupError: string;
    allowed: boolean;
    step: Step;
    reviewRow: (event: FormEvent<HTMLFormElement>) => Promise<void>;
    writableColumns: SchemaColumn[];
    included: Record<string, boolean>;
    setIncluded: import('react').Dispatch<import('react').SetStateAction<Record<string, boolean>>>;
    values: Record<string, string>;
    setValues: import('react').Dispatch<import('react').SetStateAction<Record<string, string>>>;
    row: { [k: string]: string };
    job: ImportJob | undefined;
    retryAttempted: boolean;
    busy: boolean;
    reconcile: () => Promise<void>;
    confirmInserted: () => Promise<void>;
    retryUnknown: () => Promise<void>;
    error: string;
    setStep: import('react').Dispatch<import('react').SetStateAction<Step>>;
    insertRow: () => Promise<void>;
};

type ReviewInsertRowContext = {
    allowed: boolean;
    loading: boolean;
    busy: boolean;
    row: Record<string, string>;
    cloudConnection: boolean;
    name: string;
    tableName: string;
    connectionId: string;
    setBusy: import('react').Dispatch<import('react').SetStateAction<boolean>>;
    setError: import('react').Dispatch<import('react').SetStateAction<string>>;
    setStep: import('react').Dispatch<import('react').SetStateAction<Step>>;
    setMapping: import('react').Dispatch<import('react').SetStateAction<Mapping | undefined>>;
    setPreview: import('react').Dispatch<import('react').SetStateAction<Preview | undefined>>;
};

function closeInsertRowDialog({
    busy,
    job,
    preview,
    onClose,
}: {
    busy: boolean;
    job: ImportJob | undefined;
    preview: Preview | undefined;
    onClose: () => void;
}) {
    if (busy || job?.status === 'running') return;
    if (preview && job?.status !== 'unknown')
        void api(`/imports/${encodeURIComponent(preview.id)}`, apiResponses.isUnknown, {
            method: 'DELETE',
        }).catch(() => undefined);
    onClose();
}

async function reviewInsertRow(event: FormEvent<HTMLFormElement>, context: ReviewInsertRowContext) {
    const {
        allowed,
        loading,
        busy,
        row,
        cloudConnection,
        name,
        tableName,
        connectionId,
        setBusy,
        setError,
        setStep,
        setMapping,
        setPreview,
    } = context;
    event.preventDefault();
    if (!allowed || loading || busy || Object.keys(row).length === 0) return;
    setBusy(true);
    setError('');
    let nextPreview: Preview | undefined;
    try {
        if (cloudConnection) {
            setMapping({
                id: crypto.randomUUID(),
                deduplicationToken: crypto.randomUUID(),
                table: name,
                rowCount: 1,
                fields: Object.fromEntries(Object.keys(row).map(column => [column, column])),
            });
            setStep('review');
            return;
        }
        nextPreview = await post(
            '/imports/preview',
            {
                name: `${tableName}-row.json`,
                source: JSON.stringify([row]),
                format: 'json',
            },
            apiResponses.isImportPreview,
        );
        const nextMapping = await post(
            `/imports/${encodeURIComponent(nextPreview.id)}/mapping`,
            {
                connectionId,
                table: name,
                fields: Object.fromEntries(Object.keys(row).map(column => [column, column])),
            },
            apiResponses.isImportMapping,
        );
        setPreview(nextPreview);
        setMapping(nextMapping);
        setStep('review');
    } catch (caught) {
        if (nextPreview)
            void api(`/imports/${encodeURIComponent(nextPreview.id)}`, apiResponses.isUnknown, {
                method: 'DELETE',
            }).catch(() => undefined);
        setError(message(caught));
    } finally {
        setBusy(false);
    }
}

function renderInsertRowDialog({
    dialog,
    canClose,
    close,
    name,
    loading,
    setupError,
    allowed,
    step,
    reviewRow,
    writableColumns,
    included,
    setIncluded,
    values,
    setValues,
    row,
    job,
    retryAttempted,
    busy,
    reconcile,
    confirmInserted,
    retryUnknown,
    error,
    setStep,
    insertRow,
}: InsertRowDialogRenderProps) {
    const getInsertStatusMessage = (job: ImportJob) => {
        switch (job.status) {
            case 'succeeded':
                if (job.reviewedAt) {
                    return `You confirmed the row is in ${name}.`;
                }

                return `ClickHouse acknowledged an insert request containing one row for ${name}.`;

            case 'running':
                return 'ClickHouse still reports this insert as active. Wait for it to finish before sending another row.';

            default:
                return 'ClickHouse couldn’t confirm the insert. The row may already be there.';
        }
    };
    return (
        <dialog
            ref={dialog}
            aria-labelledby="insert-row-title"
            onCancel={event => {
                event.preventDefault();
                if (canClose) close();
            }}
            onClick={event => {
                if (event.target === dialog.current && canClose) close();
            }}
            className="table-action-dialog insert-row-dialog m-auto max-h-[min(90dvh,800px)] w-[min(760px,calc(100vw-2rem))] max-w-none overflow-hidden rounded-2xl border border-[var(--line-bright)] bg-[var(--panel)] p-0 text-[var(--text)] shadow-[var(--shadow-dialog)]"
        >
            <div className="table-action-dialog-layout">
                <header className="table-action-dialog-header">
                    <div className="min-w-0">
                        <h2 id="insert-row-title" className="table-action-dialog-title">
                            Insert row
                        </h2>
                        <p className="table-action-dialog-description">
                            Add one row to <code>{name}</code>.
                        </p>
                    </div>
                    <button
                        type="button"
                        aria-label="Close insert row"
                        disabled={!canClose}
                        onClick={close}
                        className="table-action-dialog-close"
                    >
                        <Icon name="close" />
                    </button>
                </header>
                <main className="insert-row-content table-action-dialog-content min-h-0 flex-1 overflow-y-auto">
                    {loading && (
                        <p role="status" className="text-sm text-[var(--text-soft)]">
                            Checking insert access…
                        </p>
                    )}
                    {!loading && setupError && (
                        <p
                            role="alert"
                            className="rounded-lg border border-[var(--red)]/30 bg-[var(--red)]/5 p-3 text-xs text-[var(--red)]"
                        >
                            {setupError}
                        </p>
                    )}
                    {!loading && !setupError && !allowed && (
                        <p
                            role="status"
                            className="rounded-xl border border-[var(--line)] bg-[var(--page)] p-4 text-sm text-[var(--text-soft)]"
                        >
                            This table is not available in the connection database.
                        </p>
                    )}
                    {step === 'edit' && allowed && (
                        <form
                            id="insert-row-form"
                            onSubmit={event => void reviewRow(event)}
                            className="insert-row-form"
                        >
                            <p className="insert-row-guidance text-xs text-[var(--muted)]">
                                Required columns are included. Leave defaulted or nullable columns
                                out to use their ClickHouse defaults.
                            </p>
                            {writableColumns.map(column => {
                                const optional = optionalColumn(column);
                                return (
                                    <div
                                        key={column.name}
                                        className="insert-row-column grid gap-2 rounded-lg border border-[var(--line)] bg-[var(--page)] p-2 sm:grid-cols-[minmax(9rem,.8fr)_minmax(0,1.5fr)] sm:items-center"
                                    >
                                        <div className="min-w-0">
                                            <strong className="insert-row-column-name block truncate text-xs">
                                                {column.name}
                                            </strong>
                                            <code className="insert-row-column-meta font-sans text-[11px] text-[var(--muted)]">
                                                {column.type}
                                                {column.defaultKind
                                                    ? ` · ${column.defaultKind}`
                                                    : ''}
                                            </code>
                                        </div>
                                        <div className="flex min-w-0 items-center gap-3">
                                            {optional && (
                                                <label className="insert-row-include flex shrink-0 items-center gap-1.5 text-[10px] text-[var(--text-soft)]">
                                                    <input
                                                        type="checkbox"
                                                        checked={included[column.name] ?? false}
                                                        onChange={event =>
                                                            setIncluded(current => ({
                                                                ...current,
                                                                [column.name]: event.target.checked,
                                                            }))
                                                        }
                                                    />
                                                    Include
                                                </label>
                                            )}
                                            <input
                                                aria-label={column.name}
                                                disabled={optional && !included[column.name]}
                                                value={values[column.name] ?? ''}
                                                onChange={event =>
                                                    setValues(current => ({
                                                        ...current,
                                                        [column.name]: event.target.value,
                                                    }))
                                                }
                                                placeholder={optional ? 'Use default' : 'Value'}
                                                className="insert-row-column-value min-h-8 min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--panel)] px-2.5 font-mono text-xs disabled:opacity-45"
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                            {!writableColumns.length && (
                                <p
                                    role="status"
                                    className="rounded-lg border border-[var(--line)] p-3 text-xs text-[var(--muted)]"
                                >
                                    This table has no writable columns.
                                </p>
                            )}
                        </form>
                    )}
                    {step === 'review' && (
                        <section aria-label="Review row" className="space-y-4">
                            <p className="text-xs text-[var(--text-soft)]">
                                Review the exact values before inserting.
                            </p>
                            <pre className="max-h-64 overflow-auto rounded-lg border border-[var(--line)] bg-[var(--page)] p-4 font-mono text-xs">
                                {JSON.stringify(row, null, 2)}
                            </pre>
                        </section>
                    )}
                    {step === 'status' && job && (
                        <section aria-label="Insert status" className="space-y-3">
                            <p
                                role="status"
                                className="rounded-xl border border-[var(--line)] bg-[var(--page)] p-4 text-sm"
                            >
                                {getInsertStatusMessage(job)}
                            </p>
                            {job.status === 'unknown' && (
                                <>
                                    <p className="text-xs leading-relaxed text-[var(--text-soft)]">
                                        {retryAttempted
                                            ? 'A retry was sent, but its result is also unclear. Check the table before sending another insert.'
                                            : 'Check the table before choosing. If you do not see the row, you can retry once. A late first insert may create a duplicate.'}
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() => void reconcile()}
                                            className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs disabled:opacity-40"
                                        >
                                            {busy ? 'Checking…' : 'Check status'}
                                        </button>
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() => void confirmInserted()}
                                            className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs disabled:opacity-40"
                                        >
                                            I see the row
                                        </button>
                                        {!retryAttempted && (
                                            <button
                                                type="button"
                                                disabled={busy}
                                                onClick={() => void retryUnknown()}
                                                className="rounded-lg border border-[var(--amber)]/40 px-3 py-2 text-xs disabled:opacity-40"
                                            >
                                                {busy ? 'Checking…' : 'Row absent; retry once'}
                                            </button>
                                        )}
                                    </div>
                                </>
                            )}
                        </section>
                    )}
                    {error && (
                        <p
                            role="alert"
                            className="rounded-lg border border-[var(--red)]/30 bg-[var(--red)]/5 px-3 py-2.5 text-xs text-[var(--red)]"
                        >
                            {error}
                        </p>
                    )}
                </main>
                <footer className="table-action-dialog-footer">
                    {step === 'edit' && allowed && (
                        <button
                            type="submit"
                            form="insert-row-form"
                            disabled={
                                loading ||
                                busy ||
                                !writableColumns.length ||
                                !Object.keys(row).length
                            }
                            className="table-action-dialog-button table-action-dialog-primary bg-[var(--accent-action)] text-[var(--accent-ink)] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {busy ? 'Preparing…' : 'Review row'}
                        </button>
                    )}
                    {step === 'review' && (
                        <>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => setStep('edit')}
                                className="table-action-dialog-button table-action-dialog-secondary disabled:opacity-40"
                            >
                                Back
                            </button>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => void insertRow()}
                                className="table-action-dialog-button table-action-dialog-primary bg-[var(--accent-action)] text-[var(--accent-ink)] disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                {busy ? 'Inserting…' : 'Insert row'}
                            </button>
                        </>
                    )}
                    {step === 'status' && job?.status !== 'running' && (
                        <button
                            type="button"
                            onClick={close}
                            disabled={busy}
                            className="table-action-dialog-button table-action-dialog-primary bg-[var(--accent-action)] text-[var(--accent-ink)] disabled:opacity-40"
                        >
                            Done
                        </button>
                    )}
                </footer>
            </div>
        </dialog>
    );
}

async function retryUnknownInsert({
    job,
    mapping,
    busy,
    retryAttempted,
    setBusy,
    setError,
    setJob,
    reportSuccess,
    preview,
    connectionId,
    name,
    setMapping,
    cloudConnection,
    setRetryAttempted,
    columns,
    row,
}: {
    job: ImportJob | undefined;
    mapping: Mapping | undefined;
    busy: boolean;
    retryAttempted: boolean;
    setBusy: import('react').Dispatch<import('react').SetStateAction<boolean>>;
    setError: import('react').Dispatch<import('react').SetStateAction<string>>;
    setJob: import('react').Dispatch<import('react').SetStateAction<ImportJob | undefined>>;
    reportSuccess: () => void;
    preview: Preview | undefined;
    connectionId: Props['connectionId'];
    name: string;
    setMapping: import('react').Dispatch<import('react').SetStateAction<Mapping | undefined>>;
    cloudConnection: boolean;
    setRetryAttempted: import('react').Dispatch<import('react').SetStateAction<boolean>>;
    columns: Props['columns'];
    row: { [k: string]: string };
}) {
    if (!job || !mapping || busy || retryAttempted) return;
    setBusy(true);
    setError('');
    let retryMapping = mapping;
    let retryQueryId: string | undefined;
    let retryDeduplicationToken: string | undefined;
    let writeStarted = false;
    const recoverRetry = async (caught: unknown) => {
        if (
            writeStarted &&
            cloudConnection &&
            caught instanceof CloudRequestError &&
            caught.status < 500
        ) {
            setJob(job);
            setRetryAttempted(false);
            setError(message(caught));
        } else if (
            writeStarted &&
            !cloudConnection &&
            caught instanceof RequestError &&
            caught.status < 500
        ) {
            setJob(job);
            setRetryAttempted(false);
            setError(message(caught));
        } else if (writeStarted && retryQueryId) {
            try {
                const recovered = await checkClickHouseCloudImport(
                    retryQueryId,
                    name,
                    1,
                    retryDeduplicationToken,
                );
                setJob(recovered);
                if (recovered.status === 'succeeded') reportSuccess();
            } catch {
                setJob({
                    id: retryMapping.id,
                    table: name,
                    rows: 1,
                    queryId: retryQueryId,
                    deduplicationToken: retryDeduplicationToken,
                    connectionId,
                    status: 'unknown',
                });
            }
        } else if (writeStarted) {
            try {
                const recovered = await api<ImportJob>(
                    `/imports/${encodeURIComponent(retryMapping.id)}`,
                    apiResponses.isImportJob,
                );
                setJob(recovered);
                if (recovered.status === 'succeeded') reportSuccess();
            } catch {
                setJob({ id: retryMapping.id, table: name, rows: 1, status: 'unknown' });
            }
        } else {
            setJob(job);
            setError(message(caught));
        }
    };
    try {
        const checked = job.queryId
            ? await checkClickHouseCloudImport(
                  job.queryId,
                  job.table,
                  job.rows,
                  job.deduplicationToken,
              )
            : await post(
                  `/imports/${encodeURIComponent(job.id)}/reconcile`,
                  {},
                  apiResponses.isImportJob,
              );
        if (checked.status !== 'unknown') {
            setJob(checked);
            if (checked.status === 'succeeded') reportSuccess();
            return;
        }

        if (job.queryId) {
            retryMapping = {
                ...mapping,
                id: crypto.randomUUID(),
                deduplicationToken: job.deduplicationToken ?? mapping.deduplicationToken,
            };
        } else {
            if (!preview)
                throw new Error(
                    'The row preview expired. Close this dialog and prepare the row again.',
                );
            const reviewed = await post(
                `/imports/${encodeURIComponent(job.id)}/review`,
                { inspected: true, noActiveInsert: true },
                apiResponses.isImportJob,
            );
            if (reviewed.status !== 'unknown') {
                setJob(reviewed);
                if (reviewed.status === 'succeeded') reportSuccess();
                return;
            }
            if (!reviewed.reviewedAt) {
                setJob(reviewed);
                return;
            }
            retryMapping = await post(
                `/imports/${encodeURIComponent(preview.id)}/mapping`,
                {
                    connectionId,
                    table: name,
                    fields: mapping.fields,
                    deduplicationToken: job.deduplicationToken ?? null,
                },
                apiResponses.isImportMapping,
            );
        }

        setMapping(retryMapping);
        retryQueryId = cloudConnection ? `clickstudio-import-${crypto.randomUUID()}` : undefined;
        retryDeduplicationToken =
            job.deduplicationToken ?? retryMapping.deduplicationToken ?? undefined;
        retryMapping = { ...retryMapping, deduplicationToken: retryDeduplicationToken };
        const retryJob: ImportJob = {
            id: retryMapping.id,
            table: name,
            rows: 1,
            deduplicationToken: retryDeduplicationToken,
            status: 'running',
            ...(retryQueryId ? { queryId: retryQueryId, connectionId } : {}),
        };
        setJob(retryJob);
        setRetryAttempted(true);
        writeStarted = true;
        const next = retryQueryId
            ? await insertClickHouseCloudRow({
                  table: name,
                  columns,
                  row,
                  queryId: retryQueryId,
                  deduplicationToken: retryDeduplicationToken,
              })
            : await post(
                  `/imports/${encodeURIComponent(retryMapping.id)}/commit`,
                  {},
                  apiResponses.isImportJob,
              );
        setJob(next);
        if (next.status === 'succeeded') reportSuccess();
    } catch (caught) {
        await recoverRetry(caught);
    } finally {
        setBusy(false);
    }
}
