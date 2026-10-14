import type { ReactNode } from 'react';
import { CLICKHOUSE_CLOUD_CONNECTION_ID } from '../../../../shared/database/connections/cloud-policy';
import { useSqlFunctions } from '../../functions/useSqlFunctions';
import { FunctionsTree } from '../../functions/FunctionsTree';
import { SqlFunctionDetails } from '../../functions/SqlFunctionDetails';
import { CreateSqlFunctionDialog } from '../../functions/CreateSqlFunctionDialog';
import { DeleteSqlFunctionDialog } from '../../functions/DeleteSqlFunctionDialog';
import { Button, cx, Spinner } from '../../../ui/components/primitives';
import { Icon } from '../../../ui/components/icons';
import { ObjectDetails } from './ObjectExplorerDetails';
import type { ObjectExplorerProps } from './tree/object-explorer-types';
import { useObjectExplorerState } from './tree/useObjectExplorerState';
import { ObjectExplorerSearch } from './ObjectExplorerSearch';
import { ObjectTree } from './tree/ObjectTree';
import { ObjectExplorerDialogs } from './ObjectExplorerDialogs';
import { usePythonFunctions } from '../../functions/usePythonFunctions';
import { PythonFunctionsTree } from '../../functions/PythonFunctionsTree';
import { CreatePythonFunctionDialog } from '../../functions/CreatePythonFunctionDialog';
import { PythonFunctionDetails } from '../../functions/PythonFunctionDetails';

function ObjectExplorerEmptySearch({
    query,
    copy,
}: {
    query: string;
    copy: ObjectExplorerProps['copy'];
}) {
    return (
        <div className="object-empty-search">
            <strong>{query ? copy.noObjectsMatch : copy.noObjectsAvailable}</strong>
            <span>{query ? copy.noObjectsMatchHint : copy.noObjectsAvailableHint}</span>
        </div>
    );
}

export function ObjectExplorer(props: ObjectExplorerProps) {
    const state = useObjectExplorerState(props);
    const {
        compact,
        showCompactDetails,
        selectedTable,
        tablePermissions,
        connection,
        trusted,
        copy,
        createTableDatabase,
        setCreateTableDatabase,
        insertableTable,
        setInsertRowTarget,
        deletableTable,
        setDeleteTableTarget,
        browseObjects,
        selected,
        expert,
        copiedId,
        onInsert,
        copyText,
        onOpenSqlDraft,
        onOpenReference,
        setPartsTable,
        search,
        onRefreshSchema,
        schema,
        selectObject,
        partsTable,
        lineageOpen,
        setLineageOpen,
        setSearch,
        setCreatedTableTarget,
        insertRowTarget,
        deleteTableTarget,
        onTableDeleted,
        setSelectedId,
        setDetailsOpen,
    } = state;
    const functionsEnabled = trusted && connection.id === CLICKHOUSE_CLOUD_CONNECTION_ID;
    const functions = useSqlFunctions(connection, functionsEnabled, props.functionCatalog);
    const python = usePythonFunctions(connection, expert);
    const functionDetails = functions.selected || python.selected;
    const deployPython =
        trusted && !connection.readonly && connection.id === CLICKHOUSE_CLOUD_CONNECTION_ID;
    const canDeleteFunction =
        !connection.readonly && !functions.loading && functions.catalog?.canDrop === true;
    const sqlFunctionsSlot =
        functionsEnabled && !functions.error ? (
            <FunctionsTree
                label={expert ? 'SQL Functions' : 'Functions'}
                catalog={functions.catalog}
                loading={functions.loading}
                search={search}
                canCreate={!connection.readonly && functions.catalog?.canCreate === true}
                createReason={
                    connection.readonly
                        ? 'This connection is read only.'
                        : functions.catalog?.createReason || 'Checking CREATE FUNCTION privileges…'
                }
                onCreate={functions.openCreate}
                onSelect={functions.select}
            />
        ) : undefined;
    const functionsSlot =
        sqlFunctionsSlot || expert ? (
            <>
                {sqlFunctionsSlot}
                {expert && (
                    <PythonFunctionsTree
                        state={python}
                        search={search}
                        onSelect={fn => {
                            functions.close();
                            python.select(fn);
                        }}
                    />
                )}
            </>
        ) : undefined;
    const canInsertSelectedTable =
        connection.dataSource !== 'fixture' &&
        Boolean(insertableTable) &&
        tablePermissions.insert !== false;
    const canDeleteSelectedTable =
        connection.dataSource !== 'fixture' &&
        Boolean(deletableTable) &&
        tablePermissions.drop !== false;
    const tableActionDisabledReason = trusted ? undefined : copy.runActionTrustRequired;
    const compactTableActions =
        showCompactDetails &&
        selectedTable &&
        (canInsertSelectedTable || canDeleteSelectedTable) ? (
            <div className="object-utility-actions object-table-write-actions">
                {canInsertSelectedTable && (
                    <Button
                        variant="ghost"
                        className="toolbar-small"
                        disabled={!trusted}
                        title={tableActionDisabledReason}
                        onClick={() => {
                            if (insertableTable)
                                setInsertRowTarget({
                                    table: insertableTable.table,
                                    columns: insertableTable.columns,
                                });
                        }}
                    >
                        <Icon name="plus" />
                        {copy.insertRow}
                    </Button>
                )}
                {canDeleteSelectedTable && (
                    <Button
                        variant="danger"
                        className="toolbar-small"
                        disabled={!trusted}
                        title={tableActionDisabledReason}
                        onClick={() => {
                            if (deletableTable) setDeleteTableTarget(deletableTable);
                        }}
                    >
                        <Icon name="trash" />
                        {copy.deleteTable}
                    </Button>
                )}
            </div>
        ) : undefined;
    return (
        <section
            className={cx(
                'inspector-section object-explorer-section',
                compact && 'is-compact',
                (showCompactDetails || functionDetails) && 'is-detail-mode',
            )}
        >
            {python.selected ? (
                <div className="object-compact-details">
                    <button type="button" className="object-back-button" onClick={python.close}>
                        <Icon name="chevron" className="object-back-icon" />
                        {copy.objects}
                    </button>
                    <PythonFunctionDetails
                        key={`${python.key}:${python.selected.name}`}
                        fn={python.selected}
                        trusted={trusted}
                        deployAllowed={deployPython}
                        evidence={props.functionTest}
                        onRun={onOpenSqlDraft}
                        onCopy={(value, id) => void copyText(value, id)}
                        onRefresh={python.refresh}
                    />
                </div>
            ) : null}
            {!python.selected && functions.selected ? (
                <div className="object-compact-details">
                    <button type="button" className="object-back-button" onClick={functions.close}>
                        <Icon name="chevron" className="object-back-icon" />
                        {copy.objects}
                    </button>
                    <SqlFunctionDetails
                        key={functions.selected.name}
                        fn={functions.selected}
                        evidence={props.functionTest}
                        trusted={trusted}
                        canDelete={canDeleteFunction}
                        deleteReason={
                            connection.readonly
                                ? 'This connection is read only.'
                                : functions.catalog?.dropReason ||
                                  'Checking DROP FUNCTION privileges…'
                        }
                        onDelete={() => {
                            if (functions.selected) functions.openDelete(functions.selected);
                        }}
                        onRun={onOpenSqlDraft}
                        copiedId={copiedId}
                        onCopy={(sql, id) => void copyText(sql, id)}
                    />
                </div>
            ) : null}
            {!functionDetails && showCompactDetails && selected ? (
                <div className="object-compact-details">
                    <button type="button" className="object-back-button" onClick={browseObjects}>
                        <Icon name="chevron" className="object-back-icon" />
                        {copy.objects}
                    </button>
                    <ObjectDetails
                        copy={copy}
                        selection={selected}
                        tableActions={compactTableActions}
                        trusted={trusted}
                        expert={expert}
                        copiedId={copiedId}
                        onInsert={onInsert}
                        onCopy={copyText}
                        onOpenSqlDraft={onOpenSqlDraft}
                        onOpenReference={onOpenReference}
                        onOpenParts={setPartsTable}
                        onSelect={selectObject}
                        search={search}
                    />
                </div>
            ) : null}
            {!functionDetails && !showCompactDetails && (
                <ObjectExplorerBrowser
                    state={state}
                    functionsSlot={functionsSlot}
                    functionsEnabled={functionsEnabled || expert}
                    onRefreshFunctions={() => {
                        functions.refresh();
                        python.refresh();
                    }}
                />
            )}
            {functions.createOpen && (
                <CreateSqlFunctionDialog
                    onClose={functions.closeCreate}
                    onCreated={functions.created}
                    copiedId={copiedId}
                    onCopy={(sql, id) => void copyText(sql, id)}
                />
            )}
            {python.createOpen && (
                <CreatePythonFunctionDialog
                    key={python.key}
                    onClose={python.closeCreate}
                    onPublished={python.refresh}
                    deployAllowed={deployPython}
                />
            )}
            {functions.deleteTarget && canDeleteFunction && (
                <DeleteSqlFunctionDialog
                    key={functions.deleteTarget.name}
                    name={functions.deleteTarget.name}
                    onClose={functions.closeDelete}
                    onDeleted={functions.deleted}
                />
            )}
            <ObjectExplorerDialogs
                {...{
                    copy,
                    trusted,
                    partsTable,
                    setPartsTable,
                    lineageOpen,
                    connection,
                    schema,
                    setLineageOpen,
                    createTableDatabase,
                    tablePermissions,
                    setCreateTableDatabase,
                    setSearch,
                    setCreatedTableTarget,
                    onRefreshSchema,
                    insertRowTarget,
                    setInsertRowTarget,
                    deleteTableTarget,
                    setDeleteTableTarget,
                    onTableDeleted,
                    setSelectedId,
                    setDetailsOpen,
                }}
            />
        </section>
    );
}

function ObjectExplorerBrowser({
    state,
    functionsSlot,
    functionsEnabled,
    onRefreshFunctions,
}: {
    state: ReturnType<typeof useObjectExplorerState>;
    functionsSlot?: ReactNode;
    functionsEnabled: boolean;
    onRefreshFunctions: () => void;
}) {
    const {
        compact,
        connection,
        trusted,
        copy,
        setCreateTableDatabase,
        browseObjects,
        selected,
        expert,
        copiedId,
        onInsert,
        copyText,
        onOpenSqlDraft,
        onOpenReference,
        setPartsTable,
        search,
        changeSearch,
        setLineageOpen,
        model,
        schemaLoading,
        onRefreshSchema,
        schemaError,
        schema,
        treeScroll,
        expanded,
        toggle,
        renderRelation,
        selectedId,
        selectObject,
        schemaLoadingMore,
        onLoadMoreSchema,
        detailsOpen,
    } = state;
    return (
        <>
            <div className="object-search-row">
                <ObjectExplorerSearch
                    includeFunctions={Boolean(functionsSlot)}
                    {...{ search, changeSearch, copy }}
                />
                <div className="schema-heading object-heading">
                    {expert && (
                        <Button
                            variant="ghost"
                            className="toolbar-small"
                            disabled={!trusted}
                            onClick={() => setLineageOpen(true)}
                        >
                            View dependencies
                        </Button>
                    )}
                    <Button
                        variant="ghost"
                        className={cx(
                            'toolbar-small',
                            'object-refresh-action',
                            schemaLoading && 'is-loading',
                        )}
                        aria-label={schemaLoading ? copy.loading : copy.refresh}
                        aria-busy={schemaLoading}
                        title={schemaLoading ? copy.loading : copy.refresh}
                        onClick={() => {
                            onRefreshSchema();
                            if (functionsEnabled) onRefreshFunctions();
                        }}
                        disabled={schemaLoading || !trusted}
                    >
                        <Icon name="refresh" />
                    </Button>
                </div>
            </div>
            {schemaError && <div className="callout callout-error">{schemaError}</div>}
            {!trusted && (
                <div className="inspector-empty">
                    <Icon name="lock" />
                    <strong>{copy.schemaPrivate}</strong>
                    <p>{copy.trustToInspect}</p>
                </div>
            )}
            {!trusted && functionsSlot && (
                <div className="object-tree" role="tree" aria-label="Functions">
                    {functionsSlot}
                </div>
            )}
            {schemaLoading && (
                <div className="inspector-empty">
                    <Spinner />
                    <p>{copy.readingSchema}</p>
                </div>
            )}
            {trusted && ((schema && !schemaLoading) || functionsEnabled) && (
                <>
                    {model.databases.length || functionsEnabled ? (
                        <ObjectTree
                            {...{
                                functionsSlot,
                                treeScroll,
                                copy,
                                model,
                                expanded,
                                toggle,
                                renderRelation,
                                selectedId,
                                selectObject,
                                connection,
                                trusted,
                                onCreateTable: setCreateTableDatabase,
                            }}
                        />
                    ) : (
                        <ObjectExplorerEmptySearch query={model.query} copy={copy} />
                    )}
                    {schema?.truncated && schema.pagination && (
                        <div className="schema-partial-state" role="status">
                            <span>
                                Showing part of this schema. Load the next page to see more tables
                                and columns.
                            </span>
                            <Button
                                variant="secondary"
                                className="toolbar-small"
                                disabled={schemaLoadingMore || !onLoadMoreSchema}
                                onClick={onLoadMoreSchema}
                            >
                                {schemaLoadingMore ? 'Loading…' : 'Load more metadata'}
                            </Button>
                        </div>
                    )}
                    {!compact && detailsOpen && selected && (
                        <ObjectDetails
                            copy={copy}
                            selection={selected}
                            trusted={trusted}
                            expert={expert}
                            copiedId={copiedId}
                            onClose={browseObjects}
                            onInsert={onInsert}
                            onCopy={copyText}
                            onOpenSqlDraft={onOpenSqlDraft}
                            onOpenReference={onOpenReference}
                            onOpenParts={setPartsTable}
                            onSelect={selectObject}
                            search={search}
                        />
                    )}
                </>
            )}
        </>
    );
}
