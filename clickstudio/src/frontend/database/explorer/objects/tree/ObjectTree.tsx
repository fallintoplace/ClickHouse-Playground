import type { ReactNode } from 'react';
import type { SchemaDictionary } from '../../../../../shared/database/schema/types';
import { useTablePermissions } from '../../../tables/useTablePermissions';
import { Icon } from '../../../../ui/components/icons';
import { Spinner } from '../../../../ui/components/primitives';
import {
    explorerCategoryId,
    explorerDictionaryId,
    type ExplorerRelation,
    type ObjectExplorerModel,
} from '../object-explorer-model';
import type { ObjectExplorerProps } from './object-explorer-types';
import { ExplorerGroupRow, ObjectLeafRow } from './ObjectTreeRows';
import { canDropDatabase } from '../../../../../shared/database/databases/delete-database';

export function ObjectTree({
    treeScroll,
    copy,
    model,
    expanded,
    toggle,
    renderRelation,
    selectedId,
    selectObject,
    tablePermissionCatalog,
    onCreateTable,
    onDeleteDatabase,
    functionsSlot,
}: {
    functionsSlot?: ReactNode;
    treeScroll: import('react').RefObject<HTMLDivElement | null>;
    copy: ObjectExplorerProps['copy'];
    model: ObjectExplorerModel;
    expanded: (id: string, forced?: boolean) => boolean;
    toggle: (id: string) => void;
    renderRelation: (relation: ExplorerRelation, level: number) => import('react').ReactElement;
    selectedId: string | undefined;
    selectObject: (id: string) => void;
    tablePermissionCatalog: ObjectExplorerProps['tablePermissionCatalog'];
    onCreateTable: (database: string) => void;
    onDeleteDatabase: (database: string) => void;
}) {
    return (
        <div className="object-tree-scroll" ref={treeScroll}>
            <div className="object-tree" role="tree" aria-label={copy.objects}>
                {model.databases.map(database => {
                    const databaseExpanded = expanded(database.id, Boolean(model.query));
                    return (
                        <div className="object-tree-branch" key={database.id}>
                            <DatabaseRow
                                database={database.name}
                                count={database.visibleObjectCount}
                                expanded={databaseExpanded}
                                onToggle={() => toggle(database.id)}
                                tablePermissionCatalog={tablePermissionCatalog}
                                copy={copy}
                                onCreateTable={onCreateTable}
                                onDeleteDatabase={onDeleteDatabase}
                            />
                            {databaseExpanded && (
                                <div role="group" className="object-tree-children">
                                    {database.tables.length > 0 && (
                                        <ObjectCategory
                                            label={copy.tables}
                                            kind="table"
                                            database={database.name}
                                            relations={database.tables}
                                            level={2}
                                            query={model.query}
                                            expanded={expanded}
                                            toggle={toggle}
                                            renderRelation={renderRelation}
                                        />
                                    )}
                                    {database.views.length > 0 && (
                                        <ObjectCategory
                                            label={copy.views}
                                            kind="view"
                                            database={database.name}
                                            relations={database.views}
                                            level={2}
                                            query={model.query}
                                            expanded={expanded}
                                            toggle={toggle}
                                            renderRelation={renderRelation}
                                        />
                                    )}
                                    {database.dictionaries.length > 0 && (
                                        <DictionaryCategory
                                            label={copy.dictionaries}
                                            database={database.name}
                                            dictionaries={database.dictionaries}
                                            level={2}
                                            query={model.query}
                                            expanded={expanded}
                                            toggle={toggle}
                                            selectedId={selectedId}
                                            onSelect={selectObject}
                                        />
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
                {functionsSlot}
            </div>
        </div>
    );
}

function DatabaseRow({
    database,
    count,
    expanded,
    onToggle,
    tablePermissionCatalog,
    copy,
    onCreateTable,
    onDeleteDatabase,
}: {
    database: string;
    count: number;
    expanded: boolean;
    onToggle: () => void;
    tablePermissionCatalog: ObjectExplorerProps['tablePermissionCatalog'];
    copy: ObjectExplorerProps['copy'];
    onCreateTable: (database: string) => void;
    onDeleteDatabase: (database: string) => void;
}) {
    const permissions = useTablePermissions(tablePermissionCatalog, database);
    const action = (
        <>
            {permissions.loading && (
                <Spinner size={12} label={`Checking database actions for ${database}`} />
            )}
            {permissions.dropDatabase === true && canDropDatabase(database) && (
                <button
                    type="button"
                    className="object-tree-inline-action object-delete-database-inline-action"
                    title={`Delete database ${database}`}
                    aria-label={`Delete database ${database}`}
                    onClick={() => onDeleteDatabase(database)}
                >
                    <Icon name="trash" />
                </button>
            )}
            {permissions.create === true && (
                <button
                    type="button"
                    className="object-tree-inline-action object-create-table-inline-action"
                    title={`${copy.newTable} in ${database}`}
                    aria-label={`${copy.newTable} in ${database}`}
                    onClick={() => onCreateTable(database)}
                >
                    <Icon name="plus" />
                </button>
            )}
        </>
    );

    return (
        <ExplorerGroupRow
            level={1}
            label={database}
            count={count}
            expanded={expanded}
            onToggle={onToggle}
            database
            action={action}
        />
    );
}

function ObjectCategory({
    label,
    kind,
    database,
    relations,
    level,
    query,
    expanded,
    toggle,
    renderRelation,
}: {
    label: string;
    kind: 'table' | 'view';
    database: string;
    relations: readonly ExplorerRelation[];
    level: number;
    query: string;
    expanded: (id: string, forced?: boolean) => boolean;
    toggle: (id: string) => void;
    renderRelation: (relation: ExplorerRelation, level: number) => ReactNode;
}) {
    const id = explorerCategoryId(database, kind);
    const open = expanded(id, Boolean(query));
    return (
        <div className="object-tree-branch">
            <ExplorerGroupRow
                level={level}
                label={label}
                count={relations.length}
                expanded={open}
                onToggle={() => toggle(id)}
                kind={kind}
            />
            {open && (
                <div role="group">
                    {relations.map(relation => renderRelation(relation, level + 1))}
                </div>
            )}
        </div>
    );
}

function DictionaryCategory({
    label,
    database,
    dictionaries,
    level,
    query,
    expanded,
    toggle,
    selectedId,
    onSelect,
}: {
    label: string;
    database: string;
    dictionaries: readonly SchemaDictionary[];
    level: number;
    query: string;
    expanded: (id: string, forced?: boolean) => boolean;
    toggle: (id: string) => void;
    selectedId?: string;
    onSelect: (id: string) => void;
}) {
    const id = explorerCategoryId(database, 'dictionary');
    const open = expanded(id, Boolean(query));
    return (
        <div className="object-tree-branch">
            <ExplorerGroupRow
                level={level}
                label={label}
                count={dictionaries.length}
                expanded={open}
                onToggle={() => toggle(id)}
                kind="dictionary"
            />
            {open && (
                <div role="group">
                    {dictionaries.map(dictionary => {
                        const dictionaryId = explorerDictionaryId(
                            dictionary.database,
                            dictionary.name,
                        );
                        return (
                            <ObjectLeafRow
                                key={dictionaryId}
                                level={level + 1}
                                selected={selectedId === dictionaryId}
                                glyph="dictionary"
                                label={dictionary.name}
                                meta={dictionary.type || dictionary.status}
                                onSelect={() => onSelect(dictionaryId)}
                            />
                        );
                    })}
                </div>
            )}
        </div>
    );
}
