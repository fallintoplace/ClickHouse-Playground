import {
    explorerProjectionId,
    explorerProjectionsId,
    explorerSkipIndexId,
    explorerSkipIndexesId,
    type ExplorerRelation,
    type ObjectExplorerModel,
} from '../object-explorer-model';
import { cx } from '../../../../ui/components/primitives';
import { Icon } from '../../../../ui/components/icons';
import type { ObjectExplorerProps } from './object-explorer-types';
import { ExplorerGroupRow } from './ObjectTreeRows';
import { ObjectLeafRow } from './ObjectTreeRows';
import { objectTypeFooterHelp, objectTypeLabel } from './object-type-labels';

export function createRelationRenderer({
    expanded,
    model,
    relationChildrenMatch,
    selectedId,
    highlightedTableId,
    copy,
    toggle,
    selectObject,
    expert,
}: {
    expanded: (id: string, forced?: boolean) => boolean;
    model: ObjectExplorerModel;
    relationChildrenMatch: (relation: ExplorerRelation) => boolean;
    selectedId: string | undefined;
    highlightedTableId: string | undefined;
    copy: ObjectExplorerProps['copy'];
    toggle: (id: string) => void;
    selectObject: (id: string) => void;
    expert: boolean;
}) {
    return (relation: ExplorerRelation, level: number) => {
        const relationExpanded = expanded(
            relation.id,
            Boolean(model.query && relationChildrenMatch(relation)),
        );
        const projectionGroupId = explorerProjectionsId(
            relation.table.database,
            relation.table.name,
        );
        const indexGroupId = explorerSkipIndexesId(relation.table.database, relation.table.name);
        const projectionsExpanded = expanded(
            projectionGroupId,
            Boolean(model.query && relation.matchedProjections.length),
        );
        const indexesExpanded = expanded(
            indexGroupId,
            Boolean(model.query && relation.matchedSkipIndexes.length),
        );
        const projections =
            model.query && relation.matchedProjections.length
                ? relation.matchedProjections
                : (relation.table.projections ?? []);
        const indexes =
            model.query && relation.matchedSkipIndexes.length
                ? relation.matchedSkipIndexes
                : (relation.table.skipIndexes ?? []);
        const hasChildren =
            (relation.table.projections?.length ?? 0) > 0 ||
            (relation.table.skipIndexes?.length ?? 0) > 0;

        return (
            <div className="object-tree-branch" key={relation.id}>
                <div
                    role="treeitem"
                    aria-level={level}
                    aria-expanded={hasChildren ? relationExpanded : undefined}
                    aria-selected={selectedId === relation.id}
                    data-database={relation.table.database}
                    data-table-name={relation.table.name}
                    className={cx(
                        'object-tree-row',
                        'is-object',
                        `is-${relation.kind}`,
                        selectedId === relation.id && 'is-selected',
                        highlightedTableId === relation.id && 'is-import-highlight',
                    )}
                    style={{ '--tree-indent': `${Math.max(0, level - 1) * 12}px` }}
                >
                    <button
                        type="button"
                        className="object-tree-toggle"
                        aria-label={relationExpanded ? copy.collapse : copy.expand}
                        disabled={!hasChildren}
                        onClick={() => hasChildren && toggle(relation.id)}
                    >
                        <span className={cx(relationExpanded && 'is-open')}>
                            {hasChildren && <Icon name="chevron" />}
                        </span>
                    </button>
                    <button
                        type="button"
                        className="object-tree-main"
                        title={`${relation.table.database}.${relation.table.name}`}
                        data-footer-help={
                            expert
                                ? objectTypeFooterHelp(relation.table.engine, copy.objectTypes)
                                : undefined
                        }
                        onClick={() => selectObject(relation.id)}
                    >
                        <span
                            className={cx(
                                'object-kind-glyph',
                                relation.kind === 'view' && 'is-view',
                            )}
                        >
                            <Icon name={relation.kind === 'view' ? 'view' : 'table'} />
                        </span>
                        <span className="object-tree-label">
                            <strong>{relation.table.name}</strong>
                            <small>
                                {objectTypeLabel(relation.table.engine, copy.objectTypes)}
                            </small>
                        </span>
                    </button>
                </div>
                {relationExpanded && hasChildren && (
                    <div role="group" className="object-tree-children">
                        {(relation.table.projections?.length ?? 0) > 0 && (
                            <>
                                <ExplorerGroupRow
                                    level={level + 1}
                                    label={copy.projections}
                                    count={relation.table.projections!.length}
                                    expanded={projectionsExpanded}
                                    onToggle={() => toggle(projectionGroupId)}
                                    kind="projection"
                                />
                                {projectionsExpanded && (
                                    <div role="group">
                                        {projections.map(projection => {
                                            const id = explorerProjectionId(
                                                relation.table.database,
                                                relation.table.name,
                                                projection.name,
                                            );
                                            return (
                                                <ObjectLeafRow
                                                    key={id}
                                                    level={level + 2}
                                                    selected={selectedId === id}
                                                    glyph="projection"
                                                    label={projection.name}
                                                    meta={projection.type}
                                                    onSelect={() => selectObject(id)}
                                                />
                                            );
                                        })}
                                    </div>
                                )}
                            </>
                        )}
                        {(relation.table.skipIndexes?.length ?? 0) > 0 && (
                            <>
                                <ExplorerGroupRow
                                    level={level + 1}
                                    label={copy.skipIndexes}
                                    count={relation.table.skipIndexes!.length}
                                    expanded={indexesExpanded}
                                    onToggle={() => toggle(indexGroupId)}
                                    kind="index"
                                />
                                {indexesExpanded && (
                                    <div role="group">
                                        {indexes.map(index => {
                                            const id = explorerSkipIndexId(
                                                relation.table.database,
                                                relation.table.name,
                                                index.name,
                                            );
                                            return (
                                                <ObjectLeafRow
                                                    key={id}
                                                    level={level + 2}
                                                    selected={selectedId === id}
                                                    glyph="index"
                                                    label={index.name}
                                                    meta={index.type}
                                                    onSelect={() => selectObject(id)}
                                                />
                                            );
                                        })}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>
        );
    };
}
