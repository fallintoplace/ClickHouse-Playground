import {
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
    type FormEvent,
    type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
    CREATE_TABLE_COLUMN_TYPES,
    type CreateTableColumn,
} from '../../../shared/database/tables/create-table';
import type { Connected } from '../../workspace/workspace-types';
import { apiResponses, message, post } from '../../api/client';
import {
    CLICKHOUSE_CLOUD_CONNECTION_ID,
    createClickHouseCloudTable,
} from '../connections/cloud-connection';
import { Icon } from '../../ui/components/icons';

type Props = {
    connection: Connected;
    databases: readonly string[];
    onClose: () => void;
    onCreated: (target: { database: string; table: string }) => void;
};

const firstColumn: CreateTableColumn = { name: 'id', type: 'UInt64', generatedId: true };
const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const identifierPatternAttribute = '[A-Za-z_][A-Za-z0-9_]{0,127}';

export function CreateTableDialog({ connection, databases, onClose, onCreated }: Props) {
    const dialog = useRef<HTMLDialogElement>(null);
    const databaseInput = useRef<HTMLInputElement>(null);
    const tableInput = useRef<HTMLInputElement>(null);
    const databaseOptionsId = `create-table-databases-${useId()}`;
    const databaseInputId = `${databaseOptionsId}-input`;
    const [database, setDatabase] = useState(connection.database);
    const [table, setTable] = useState('');
    const [columns, setColumns] = useState<CreateTableColumn[]>([firstColumn]);
    const [orderBy, setOrderBy] = useState(firstColumn.name);
    const [busy, setBusy] = useState(false);
    const [created, setCreated] = useState(false);
    const [error, setError] = useState('');
    const [databaseTouched, setDatabaseTouched] = useState(false);
    const [tableTouched, setTableTouched] = useState(false);
    const [databaseOptionsOpen, setDatabaseOptionsOpen] = useState(false);
    const [activeDatabaseOption, setActiveDatabaseOption] = useState(-1);
    const [databaseOptionsQuery, setDatabaseOptionsQuery] = useState('');
    const targetTable = useMemo(() => `${database.trim()}.${table.trim()}`, [database, table]);
    const databaseIsValid = identifierPattern.test(database);
    const tableIsValid = identifierPattern.test(table);
    const columnsAreValid = columns.every(column => identifierPattern.test(column.name));
    const columnNamesAreUnique =
        new Set(columns.map(column => column.name)).size === columns.length;
    const canCreate =
        databaseIsValid &&
        tableIsValid &&
        columnsAreValid &&
        columnNamesAreUnique &&
        Boolean(orderBy);
    const databaseOptions = useMemo(() => {
        const query = databaseOptionsQuery.trim().toLowerCase();
        return [...new Set([connection.database, ...databases])].filter(
            name =>
                Boolean(name) && identifierPattern.test(name) && name.toLowerCase().includes(query),
        );
    }, [connection.database, databases, databaseOptionsQuery]);
    const highlightedDatabaseOption =
        activeDatabaseOption >= 0 && activeDatabaseOption < databaseOptions.length
            ? activeDatabaseOption
            : -1;

    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        element.showModal();
        tableInput.current?.focus({ preventScroll: true });
        return () => {
            if (element.open) element.close();
        };
    }, []);

    useEffect(() => {
        if (!columns.some(column => column.name === orderBy)) setOrderBy(columns[0]?.name ?? '');
    }, [columns, orderBy]);

    useEffect(() => {
        if (!databaseOptionsOpen || highlightedDatabaseOption < 0) return;
        document
            .getElementById(`${databaseOptionsId}-option-${highlightedDatabaseOption}`)
            ?.scrollIntoView({ block: 'nearest' });
    }, [databaseOptionsId, databaseOptionsOpen, highlightedDatabaseOption]);

    function updateColumn(index: number, field: keyof CreateTableColumn, value: string) {
        setColumns(current =>
            current.map((column, item) => {
                if (item !== index) return column;
                const next = { ...column, [field]: value } as CreateTableColumn;
                if (next.name !== 'id' || next.type !== 'UInt64') delete next.generatedId;
                return next;
            }),
        );
    }

    function selectDatabase(value: string) {
        setDatabase(value);
        setDatabaseOptionsQuery('');
        setDatabaseTouched(false);
        setDatabaseOptionsOpen(false);
        setActiveDatabaseOption(-1);
        databaseInput.current?.focus();
    }

    function handleDatabaseKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setDatabaseOptionsOpen(true);
            setActiveDatabaseOption(current => {
                if (databaseOptions.length === 0) {
                    return -1;
                }

                if (current < 0 || current >= databaseOptions.length - 1) {
                    return 0;
                }

                return current + 1;
            });
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setDatabaseOptionsOpen(true);
            setActiveDatabaseOption(current => {
                if (databaseOptions.length === 0) {
                    return -1;
                }

                if (current <= 0 || current >= databaseOptions.length) {
                    return databaseOptions.length - 1;
                }

                return current - 1;
            });
        } else if (event.key === 'Enter' && databaseOptionsOpen) {
            event.preventDefault();
            const selectedDatabase = databaseOptions[highlightedDatabaseOption];
            if (selectedDatabase) selectDatabase(selectedDatabase);
            else setDatabaseOptionsOpen(false);
        } else if (event.key === 'Escape' && databaseOptionsOpen) {
            event.preventDefault();
            event.stopPropagation();
            setDatabaseOptionsOpen(false);
            setActiveDatabaseOption(-1);
        }
    }

    async function create(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy || !canCreate) return;
        setBusy(true);
        setError('');
        try {
            if (connection.id === CLICKHOUSE_CLOUD_CONNECTION_ID) {
                await createClickHouseCloudTable({
                    database: database.trim(),
                    name: table.trim(),
                    columns,
                    orderBy,
                });
            } else {
                await post(
                    `/connections/${encodeURIComponent(connection.id)}/tables`,
                    {
                        database: database.trim(),
                        table: table.trim(),
                        columns,
                        orderBy,
                    },
                    apiResponses.isUnknown,
                );
            }
            setCreated(true);
            onCreated({ database: database.trim(), table: table.trim() });
        } catch (caught) {
            setError(message(caught));
        } finally {
            setBusy(false);
        }
    }

    const creationHelp = () => {
        let databaseHelp: string;

        if (databaseTouched && !databaseIsValid) {
            if (database) {
                databaseHelp = 'Use letters, numbers, and underscores. Start with a letter or _.';
            } else {
                databaseHelp = 'Choose or type a database name.';
            }
        } else {
            databaseHelp = '';
        }
        let tableHelp: string;

        if (tableTouched && !tableIsValid) {
            if (table) {
                tableHelp = 'Use letters, numbers, and underscores. Start with a letter or _.';
            } else {
                tableHelp = 'A table name is required.';
            }
        } else if (table) {
            tableHelp = 'Names can use letters, numbers, and underscores.';
        } else {
            tableHelp = 'Enter a table name to enable Create table.';
        }
        let createDisabledReason: string;

        if (!databaseIsValid) {
            createDisabledReason = 'Select or type a valid database name.';
        } else if (!tableIsValid) {
            if (table) {
                createDisabledReason = 'Use a valid table name to continue.';
            } else {
                createDisabledReason = '';
            }
        } else if (!columnsAreValid) {
            createDisabledReason = 'Give each column a valid name.';
        } else if (!columnNamesAreUnique) {
            createDisabledReason = 'Column names must be unique.';
        } else if (!orderBy) {
            createDisabledReason = 'Choose a sorting key to continue.';
        } else {
            createDisabledReason = '';
        }

        return { databaseHelp, tableHelp, createDisabledReason };
    };
    const { databaseHelp, tableHelp, createDisabledReason } = creationHelp();
    const contentModel: CreateTableContentModel = {
        databaseInputId,
        databaseInput,
        databaseTouched,
        databaseIsValid,
        databaseOptionsOpen,
        databaseOptionsId,
        highlightedDatabaseOption,
        database,
        setDatabaseOptionsOpen,
        setDatabaseOptionsQuery,
        setActiveDatabaseOption,
        setDatabaseTouched,
        setDatabase,
        handleDatabaseKeyDown,
        databaseOptions,
        selectDatabase,
        databaseHelp,
        tableInput,
        table,
        setTable,
        setTableTouched,
        tableTouched,
        tableIsValid,
        tableHelp,
        setColumns,
        columns,
        updateColumn,
        orderBy,
        setOrderBy,
        created,
        targetTable,
        error,
    };

    return (
        <dialog
            ref={dialog}
            aria-labelledby="create-table-title"
            onCancel={event => {
                event.preventDefault();
                if (!busy) onClose();
            }}
            onClick={event => {
                if (event.target === dialog.current && !busy) onClose();
            }}
            className="table-action-dialog create-table-dialog m-auto max-w-none overflow-hidden border border-[var(--line-bright)] bg-[var(--panel)] p-0 text-[var(--text)] shadow-[var(--shadow-dialog)]"
        >
            <form
                onSubmit={event => void create(event)}
                className="table-action-dialog-layout create-table-form"
            >
                <header className="table-action-dialog-header create-table-header">
                    <div className="min-w-0">
                        <h2 id="create-table-title" className="table-action-dialog-title">
                            New table
                        </h2>
                        <p className="table-action-dialog-description">
                            Create an empty MergeTree table in{' '}
                            <code>{database || 'a database'}</code>.
                        </p>
                    </div>
                    <button
                        type="button"
                        aria-label="Close new table"
                        disabled={busy}
                        onClick={onClose}
                        className="table-action-dialog-close"
                    >
                        <Icon name="close" />
                    </button>
                </header>

                <CreateTableContent model={contentModel} />

                <footer className="table-action-dialog-footer create-table-footer">
                    {!created && !canCreate && !busy && createDisabledReason && (
                        <p className="create-table-submit-help">{createDisabledReason}</p>
                    )}
                    {created ? (
                        <button
                            type="button"
                            onClick={onClose}
                            className="table-action-dialog-button table-action-dialog-primary create-table-button bg-[var(--accent-action)] text-[var(--accent-ink)]"
                        >
                            Done
                        </button>
                    ) : (
                        <button
                            type="submit"
                            disabled={busy || !canCreate}
                            className="table-action-dialog-button table-action-dialog-primary create-table-button bg-[var(--accent-action)] text-[var(--accent-ink)] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {busy ? 'Creating…' : 'Create table'}
                        </button>
                    )}
                </footer>
            </form>
        </dialog>
    );
}

type CreateTableContentModel = {
    databaseInputId: string;
    databaseInput: import('react').RefObject<HTMLInputElement | null>;
    databaseTouched: boolean;
    databaseIsValid: boolean;
    databaseOptionsOpen: boolean;
    databaseOptionsId: string;
    highlightedDatabaseOption: number;
    database: string;
    setDatabaseOptionsOpen: import('react').Dispatch<import('react').SetStateAction<boolean>>;
    setDatabaseOptionsQuery: import('react').Dispatch<import('react').SetStateAction<string>>;
    setActiveDatabaseOption: import('react').Dispatch<import('react').SetStateAction<number>>;
    setDatabaseTouched: import('react').Dispatch<import('react').SetStateAction<boolean>>;
    setDatabase: import('react').Dispatch<import('react').SetStateAction<string>>;
    handleDatabaseKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
    databaseOptions: string[];
    selectDatabase: (value: string) => void;
    databaseHelp: string;
    tableInput: import('react').RefObject<HTMLInputElement | null>;
    table: string;
    setTable: import('react').Dispatch<import('react').SetStateAction<string>>;
    setTableTouched: import('react').Dispatch<import('react').SetStateAction<boolean>>;
    tableTouched: boolean;
    tableIsValid: boolean;
    tableHelp: string;
    setColumns: import('react').Dispatch<import('react').SetStateAction<CreateTableColumn[]>>;
    columns: CreateTableColumn[];
    updateColumn: (index: number, field: keyof CreateTableColumn, value: string) => void;
    orderBy: string;
    setOrderBy: import('react').Dispatch<import('react').SetStateAction<string>>;
    created: boolean;
    targetTable: string;
    error: string;
};

function CreateTableContent({ model }: { model: CreateTableContentModel }) {
    const {
        database,
        tableInput,
        table,
        setTable,
        setTableTouched,
        tableTouched,
        tableIsValid,
        tableHelp,
        columns,
        orderBy,
        setOrderBy,
        created,
        targetTable,
        error,
    } = model;
    return (
        <main className="create-table-content table-action-dialog-content min-h-0 flex-1 overflow-y-auto">
            {!created && (
                <>
                    <div className="create-table-identity-grid">
                        {renderDatabasePicker(model)}

                        <label className="create-table-field">
                            <span>Table name</span>
                            <input
                                ref={tableInput}
                                aria-label="Table name"
                                aria-describedby="create-table-name-help create-table-target"
                                aria-invalid={tableTouched && !tableIsValid}
                                value={table}
                                onChange={event => setTable(event.target.value)}
                                onBlur={() => setTableTouched(true)}
                                required
                                maxLength={128}
                                pattern={identifierPatternAttribute}
                                placeholder="e.g. events"
                                className="create-table-control font-mono"
                            />
                            <span
                                id="create-table-name-help"
                                className={`create-table-help${tableTouched && !tableIsValid ? ' is-error' : ''}`}
                            >
                                {tableHelp}
                            </span>
                            <span id="create-table-target" className="create-table-target">
                                <span>Destination</span>
                                <code>{`${database.trim() || '<database>'}.${table.trim() || '<table_name>'}`}</code>
                            </span>
                        </label>
                    </div>

                    {renderTableColumns(model)}

                    <label className="create-table-field">
                        <span>Sorting key</span>
                        <span className="create-table-select-wrap">
                            <select
                                aria-label="Sorting key"
                                value={orderBy}
                                onChange={event => setOrderBy(event.target.value)}
                                className="create-table-control create-table-select"
                            >
                                {columns.map((column, index) => (
                                    <option key={`${column.name}-${index}`} value={column.name}>
                                        {column.name || `Column ${index + 1}`}
                                    </option>
                                ))}
                            </select>
                            <Icon name="chevron" />
                        </span>
                    </label>
                </>
            )}
            {created && (
                <p
                    role="status"
                    className="create-table-notice border border-[var(--green)]/30 bg-[var(--green)]/5 p-4 text-sm"
                >
                    Created <code>{targetTable}</code>.
                </p>
            )}
            {error && (
                <p
                    role="alert"
                    className="create-table-notice border border-[var(--red)]/30 bg-[var(--red)]/5 px-3 py-2.5 text-xs text-[var(--red)]"
                >
                    {error}
                </p>
            )}
        </main>
    );
}

function renderTableColumns({
    setColumns,
    columns,
    updateColumn,
}: Pick<CreateTableContentModel, 'setColumns' | 'columns' | 'updateColumn'>) {
    return (
        <section aria-label="Table columns" className="create-table-columns">
            <div className="create-table-columns-heading flex items-center justify-between">
                <h3 className="text-xs font-semibold">Columns</h3>
                <button
                    type="button"
                    onClick={() =>
                        setColumns(current => [
                            ...current,
                            {
                                name: `column_${current.length + 1}`,
                                type: 'String',
                            },
                        ])
                    }
                    disabled={columns.length >= 50}
                    className="create-table-secondary-button border border-[var(--line)] px-3 py-1.5 text-xs disabled:opacity-40"
                >
                    Add column
                </button>
            </div>
            {columns.map((column, index) => (
                <div
                    key={index}
                    className={`create-table-column-row grid grid-cols-[minmax(0,1fr)_minmax(8rem,.8fr)_auto] gap-2 border border-[var(--line)] bg-[var(--page)] p-2${column.generatedId ? ' has-generated-id' : ''}`}
                >
                    <label className="create-table-column-field">
                        <span className="create-table-column-label">Name</span>
                        <input
                            aria-label={`Column ${index + 1} name`}
                            aria-invalid={!identifierPattern.test(column.name)}
                            value={column.name}
                            onChange={event => updateColumn(index, 'name', event.target.value)}
                            required
                            maxLength={128}
                            pattern={identifierPatternAttribute}
                            className="create-table-control create-table-column-control font-mono"
                        />
                        {column.generatedId && (
                            <span className="create-table-generated-id">
                                Generated by ClickHouse when omitted
                            </span>
                        )}
                    </label>
                    <label className="create-table-column-field">
                        <span className="create-table-column-label">Type</span>
                        <span className="create-table-select-wrap">
                            <select
                                aria-label={`Column ${index + 1} type`}
                                value={column.type}
                                onChange={event => updateColumn(index, 'type', event.target.value)}
                                className="create-table-control create-table-column-control create-table-select"
                            >
                                {CREATE_TABLE_COLUMN_TYPES.map(type => (
                                    <option key={type} value={type}>
                                        {type}
                                    </option>
                                ))}
                            </select>
                            <Icon name="chevron" />
                        </span>
                    </label>
                    <button
                        type="button"
                        aria-label={`Remove ${column.name || `column ${index + 1}`}`}
                        disabled={columns.length === 1}
                        onClick={() =>
                            setColumns(current => current.filter((_, item) => item !== index))
                        }
                        className="create-table-secondary-button create-table-remove border border-[var(--line)] px-2 text-xs disabled:opacity-30"
                    >
                        Remove
                    </button>
                </div>
            ))}
        </section>
    );
}

function renderDatabasePicker({
    databaseInputId,
    databaseInput,
    databaseTouched,
    databaseIsValid,
    databaseOptionsOpen,
    databaseOptionsId,
    highlightedDatabaseOption,
    database,
    setDatabaseOptionsOpen,
    setDatabaseOptionsQuery,
    setActiveDatabaseOption,
    setDatabaseTouched,
    setDatabase,
    handleDatabaseKeyDown,
    databaseOptions,
    selectDatabase,
    databaseHelp,
}: Pick<
    CreateTableContentModel,
    | 'databaseInputId'
    | 'databaseInput'
    | 'databaseTouched'
    | 'databaseIsValid'
    | 'databaseOptionsOpen'
    | 'databaseOptionsId'
    | 'highlightedDatabaseOption'
    | 'database'
    | 'setDatabaseOptionsOpen'
    | 'setDatabaseOptionsQuery'
    | 'setActiveDatabaseOption'
    | 'setDatabaseTouched'
    | 'setDatabase'
    | 'handleDatabaseKeyDown'
    | 'databaseOptions'
    | 'selectDatabase'
    | 'databaseHelp'
>) {
    return (
        <div className="create-table-field">
            <label htmlFor={databaseInputId}>Database</label>
            <div className="create-table-database-picker">
                <input
                    ref={databaseInput}
                    id={databaseInputId}
                    aria-label="Database"
                    aria-describedby={databaseHelp ? 'create-table-database-help' : undefined}
                    aria-invalid={databaseTouched && !databaseIsValid}
                    aria-autocomplete="list"
                    aria-haspopup="listbox"
                    aria-expanded={databaseOptionsOpen}
                    aria-controls={databaseOptionsId}
                    aria-activedescendant={
                        databaseOptionsOpen && highlightedDatabaseOption >= 0
                            ? `${databaseOptionsId}-option-${highlightedDatabaseOption}`
                            : undefined
                    }
                    role="combobox"
                    value={database}
                    onFocus={() => {
                        setDatabaseOptionsOpen(true);
                        setDatabaseOptionsQuery('');
                        setActiveDatabaseOption(-1);
                    }}
                    onBlur={() => {
                        setDatabaseOptionsOpen(false);
                        setActiveDatabaseOption(-1);
                        setDatabaseTouched(true);
                    }}
                    onChange={event => {
                        setDatabase(event.target.value);
                        setDatabaseOptionsQuery(event.target.value);
                        setDatabaseOptionsOpen(true);
                        setActiveDatabaseOption(-1);
                    }}
                    onKeyDown={handleDatabaseKeyDown}
                    required
                    maxLength={128}
                    pattern={identifierPatternAttribute}
                    autoComplete="off"
                    className="create-table-control create-table-database-input font-mono"
                />
                <button
                    type="button"
                    className="create-table-database-trigger"
                    aria-label={
                        databaseOptionsOpen ? 'Hide database options' : 'Show database options'
                    }
                    aria-expanded={databaseOptionsOpen}
                    aria-controls={databaseOptionsId}
                    onPointerDown={event => event.preventDefault()}
                    onClick={() => {
                        if (databaseOptionsOpen) setDatabaseOptionsOpen(false);
                        else {
                            setDatabaseOptionsQuery('');
                            setDatabaseOptionsOpen(true);
                        }
                        setActiveDatabaseOption(-1);
                        databaseInput.current?.focus();
                    }}
                >
                    <Icon name="chevron" className={databaseOptionsOpen ? 'is-open' : ''} />
                </button>
                <div
                    id={databaseOptionsId}
                    role="listbox"
                    aria-label="Databases"
                    hidden={!databaseOptionsOpen}
                    className="create-table-database-options"
                >
                    {databaseOptions.map((name, index) => (
                        <div
                            key={name}
                            id={`${databaseOptionsId}-option-${index}`}
                            role="option"
                            aria-selected={database === name}
                            onPointerDown={event => event.preventDefault()}
                            onClick={() => selectDatabase(name)}
                            className={`create-table-database-option${highlightedDatabaseOption === index ? ' is-active' : ''}${database === name ? ' is-selected' : ''}`}
                        >
                            {name}
                        </div>
                    ))}
                </div>
                {databaseOptionsOpen && databaseOptions.length === 0 && (
                    <p role="status" className="create-table-database-empty">
                        No matches. You can type another name; it must already exist.
                    </p>
                )}
            </div>
            {databaseHelp && (
                <span
                    id="create-table-database-help"
                    className={`create-table-help${databaseTouched && !databaseIsValid ? ' is-error' : ''}`}
                >
                    {databaseHelp}
                </span>
            )}
        </div>
    );
}
