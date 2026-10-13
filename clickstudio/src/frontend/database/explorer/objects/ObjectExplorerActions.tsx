import { Button } from '../../../ui/components/primitives';
import { Icon } from '../../../ui/components/icons';
import type { ObjectExplorerProps } from './tree/object-explorer-types';
import type { ObjectExplorerView } from './tree/useObjectExplorerState';

export function ObjectExplorerActions({
    selectedTable,
    tablePermissions,
    connection,
    trusted,
    copy,
    setCreateTableOpen,
}: {
    selectedTable: ObjectExplorerView['selectedTable'];
    tablePermissions: ObjectExplorerView['tablePermissions'];
    connection: ObjectExplorerProps['connection'];
    trusted: ObjectExplorerProps['trusted'];
    copy: ObjectExplorerProps['copy'];
    setCreateTableOpen: ObjectExplorerView['setCreateTableOpen'];
}) {
    if (connection.dataSource === 'fixture' || tablePermissions.create === false) return null;
    return (
        <div
            className="object-explorer-action-bar"
            role="group"
            aria-label="Table actions"
        >
            {connection.dataSource !== 'fixture' && tablePermissions.create !== false && (
                <Button
                    variant="secondary"
                    className="toolbar-small object-create-table-action"
                    disabled={!trusted}
                    title={!trusted ? copy.runActionTrustRequired : undefined}
                    onClick={() => setCreateTableOpen(true)}
                >
                    <Icon name="table" />
                    {copy.newTable}
                </Button>
            )}
        </div>
    );
}

export function ObjectExplorerSearch({
    search,
    changeSearch,
    copy,
}: {
    search: ObjectExplorerProps['search'];
    changeSearch: (value: string) => void;
    copy: ObjectExplorerProps['copy'];
}) {
    return (
        <div className="inspector-search object-search">
            <Icon name="search" />
            <input
                data-testid="schema-search"
                value={search}
                onChange={event => changeSearch(event.target.value)}
                placeholder={copy.objectSearch}
                aria-label={copy.objectSearch}
            />
            {search && (
                <button
                    type="button"
                    className="object-search-clear"
                    aria-label="Clear object search"
                    onClick={() => changeSearch('')}
                >
                    ×
                </button>
            )}
        </div>
    );
}
