import { OverlayPortal } from '../../../ui/components/OverlayPortal';
import { StorageExplorer } from '../storage/StorageExplorer';
import { MaterializedViewExplorer } from './MaterializedViewExplorer';
import { CreateTableDialog } from '../../tables/CreateTableDialog';
import { InsertRowDialog } from '../../tables/InsertRowDialog';
import { DeleteTableDialog } from '../../tables/DeleteTableDialog';
import type { ObjectExplorerView } from './tree/useObjectExplorerState';

export function ObjectExplorerDialogs({
    copy,
    trusted,
    partsTable,
    setPartsTable,
    lineageOpen,
    connection,
    schema,
    setLineageOpen,
    createTableOpen,
    actionDatabase,
    tablePermissions,
    setCreateTableOpen,
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
}: Pick<
    ObjectExplorerView,
    | 'copy'
    | 'trusted'
    | 'partsTable'
    | 'setPartsTable'
    | 'lineageOpen'
    | 'connection'
    | 'schema'
    | 'setLineageOpen'
    | 'createTableOpen'
    | 'actionDatabase'
    | 'tablePermissions'
    | 'setCreateTableOpen'
    | 'setSearch'
    | 'setCreatedTableTarget'
    | 'onRefreshSchema'
    | 'insertRowTarget'
    | 'setInsertRowTarget'
    | 'deleteTableTarget'
    | 'setDeleteTableTarget'
    | 'onTableDeleted'
    | 'setSelectedId'
    | 'setDetailsOpen'
>) {
    return (
        <>
            {trusted && partsTable && (
                <OverlayPortal>
                    <StorageExplorer
                        connection={connection}
                        table={partsTable}
                        copy={copy}
                        onClose={() => setPartsTable(undefined)}
                    />
                </OverlayPortal>
            )}
            {trusted && lineageOpen && (
                <OverlayPortal>
                    <MaterializedViewExplorer
                        connection={connection}
                        database={connection.database}
                        databases={schema?.databases}
                        onClose={() => setLineageOpen(false)}
                    />
                </OverlayPortal>
            )}
            {trusted && tablePermissions.create !== false && createTableOpen && (
                <OverlayPortal>
                    <CreateTableDialog
                        connection={{ ...connection, database: actionDatabase }}
                        databases={schema?.databases ?? []}
                        onClose={() => setCreateTableOpen(false)}
                        onCreated={target => {
                            setSearch('');
                            setCreatedTableTarget(target);
                            onRefreshSchema();
                        }}
                    />
                </OverlayPortal>
            )}
            {trusted && tablePermissions.insert !== false && insertRowTarget && (
                <OverlayPortal>
                    <InsertRowDialog
                        key={`${insertRowTarget.table.database}.${insertRowTarget.table.name}`}
                        connectionId={connection.id}
                        table={insertRowTarget.table}
                        columns={insertRowTarget.columns}
                        onClose={() => setInsertRowTarget(undefined)}
                        onInserted={onRefreshSchema}
                    />
                </OverlayPortal>
            )}
            {trusted && tablePermissions.drop !== false && deleteTableTarget && (
                <OverlayPortal>
                    <DeleteTableDialog
                        connectionId={connection.id}
                        table={deleteTableTarget}
                        onClose={() => setDeleteTableTarget(undefined)}
                        onDeleted={table => {
                            onTableDeleted(table);
                            setSelectedId(undefined);
                            setDetailsOpen(false);
                            onRefreshSchema();
                        }}
                    />
                </OverlayPortal>
            )}
        </>
    );
}
