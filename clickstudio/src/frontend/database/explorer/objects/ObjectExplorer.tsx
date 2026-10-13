import { Button, cx, Spinner } from '../../../ui/components/primitives';
import { Icon } from '../../../ui/components/icons';
import { ObjectDetails } from './ObjectExplorerDetails';
import type { ObjectExplorerProps } from './tree/object-explorer-types';
import { useObjectExplorerState } from './tree/useObjectExplorerState';
import { ObjectExplorerSearch } from './ObjectExplorerSearch';
import { ObjectTree } from './tree/ObjectTree';
import { ObjectExplorerDialogs } from './ObjectExplorerDialogs';
import { ObjectActionsMenu } from './ObjectActionsMenu';
import { useTablePermissions } from '../../tables/useTablePermissions';

export function ObjectExplorer(props: ObjectExplorerProps) {
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
        partsTable,
        lineageOpen,
        setSearch,
        setCreatedTableTarget,
        insertRowTarget,
        deleteTableTarget,
        onTableDeleted,
        setSelectedId,
        setDetailsOpen,
    } = useObjectExplorerState(props);
    const selectedDatabase =
        selected?.kind === 'database' ? selected.database : undefined;
    const databasePermissions = useTablePermissions(
        connection,
        trusted,
        selectedDatabase?.name ?? connection.database,
        undefined,
        Boolean(selectedDatabase),
    );
    const databaseActions =
        selectedDatabase &&
        connection.dataSource !== 'fixture' &&
        databasePermissions.create === true ? (
            <ObjectActionsMenu
                kind="database"
                database={selectedDatabase.name}
                trusted={trusted}
                copy={copy}
                onCreateTable={() => setCreateTableDatabase(selectedDatabase.name)}
            />
        ) : undefined;
    const canInsertSelectedTable =
        connection.dataSource !== 'fixture' &&
        Boolean(insertableTable) &&
        tablePermissions.insert !== false;
    const canDeleteSelectedTable =
        connection.dataSource !== 'fixture' &&
        Boolean(deletableTable) &&
        tablePermissions.drop !== false;
    const selectedTableActions =
        selectedTable && (canInsertSelectedTable || canDeleteSelectedTable) ? (
            <ObjectActionsMenu
                kind="table"
                table={selectedTable.table}
                canInsertRow={canInsertSelectedTable}
                canDeleteTable={canDeleteSelectedTable}
                trusted={trusted}
                copy={copy}
                onInsertRow={() => {
                    if (insertableTable)
                        setInsertRowTarget({
                            table: insertableTable.table,
                            columns: insertableTable.columns,
                        });
                }}
                onDeleteTable={() => {
                    if (deletableTable) setDeleteTableTarget(deletableTable);
                }}
            />
        ) : undefined;
    const compactDetailsActions = databaseActions ?? selectedTableActions;
    return (
        <section
            className={cx(
                'inspector-section object-explorer-section',
                compact && 'is-compact',
                showCompactDetails && 'is-detail-mode',
            )}
        >
            {showCompactDetails && selected ? (
                <div className="object-compact-details">
                    <button type="button" className="object-back-button" onClick={browseObjects}>
                        <span>‹</span>
                        {copy.objects}
                    </button>
                    <ObjectDetails
                        copy={copy}
                        selection={selected}
                        actions={compactDetailsActions}
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
            ) : (
                <>
                    <div className="object-search-row">
                        <ObjectExplorerSearch {...{ search, changeSearch, copy }} />
                        <div
                            className={cx(
                                'schema-heading object-heading',
                                !expert && 'is-standard-object-heading',
                            )}
                        >
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
                            <span>
                                {copy.objectCount.replace(
                                    '{count}',
                                    (model.query
                                        ? model.visibleObjects
                                        : model.totalObjects
                                    ).toLocaleString(),
                                )}
                            </span>
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
                                onClick={onRefreshSchema}
                                disabled={schemaLoading || !trusted}
                            >
                                <Icon name="refresh" />
                            </Button>
                        </div>
                    </div>
                    {schemaError && <div className="callout callout-error">{schemaError}</div>}
                    {schema?.metadataWarnings?.length ? (
                        <div className="schema-metadata-warning" role="note">
                            <span className="schema-metadata-warning-icon" aria-hidden="true">
                                i
                            </span>
                            <div className="schema-metadata-warning-content">
                                {schema.metadataWarnings.map(warning => (
                                    <p key={warning}>{warning}</p>
                                ))}
                            </div>
                        </div>
                    ) : null}
                    {!trusted && (
                        <div className="inspector-empty">
                            <Icon name="lock" />
                            <strong>{copy.schemaPrivate}</strong>
                            <p>{copy.trustToInspect}</p>
                        </div>
                    )}
                    {schemaLoading && (
                        <div className="inspector-empty">
                            <Spinner />
                            <p>{copy.readingSchema}</p>
                        </div>
                    )}
                    {trusted && schema && !schemaLoading && (
                        <>
                            {model.databases.length ? (
                                <ObjectTree
                                    {...{
                                        treeScroll,
                                        copy,
                                        model,
                                        expanded,
                                        toggle,
                                        renderRelation,
                                        selectedId,
                                        selectObject,
                                    }}
                                />
                            ) : (
                                <div className="object-empty-search">
                                    <strong>
                                        {model.query
                                            ? copy.noObjectsMatch
                                            : copy.noObjectsAvailable}
                                    </strong>
                                    <span>
                                        {model.query
                                            ? copy.noObjectsMatchHint
                                            : copy.noObjectsAvailableHint}
                                    </span>
                                </div>
                            )}
                            {schema.truncated && schema.pagination && (
                                <div className="schema-partial-state" role="status">
                                    <span>
                                        Showing part of this schema. Load the next page to see more
                                        tables and columns.
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
                                    actions={
                                        selected.kind === 'database'
                                            ? databaseActions
                                            : selectedTableActions
                                    }
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
