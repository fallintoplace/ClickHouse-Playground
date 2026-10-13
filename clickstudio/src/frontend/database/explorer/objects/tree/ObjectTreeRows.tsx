import type { ReactNode } from 'react';
import type { SchemaTable } from '../../../../../shared/database/schema/types';
import { quoteIdentifier } from '../../../../../shared/sql/sql';
import { cx } from '../../../../ui/components/primitives';
import { Icon } from '../../../../ui/components/icons';

export function ExplorerGroupRow({
    level,
    label,
    count,
    expanded,
    onToggle,
    database = false,
    kind = 'table',
    action,
    onInteract,
}: {
    level: number;
    label: string;
    count: number;
    expanded: boolean;
    onToggle: () => void;
    database?: boolean;
    kind?: 'table' | 'view' | 'dictionary' | 'column' | 'projection' | 'index';
    action?: ReactNode;
    onInteract?: () => void;
}) {
    const hasChildren = count > 0;
    const toggleLabel = expanded ? `Collapse ${label}` : `Expand ${label}`;
    const hasActionSlot = database || Boolean(action);
    const countBadge = <small className="object-tree-count">{count.toLocaleString()}</small>;
    return (
        <div
            role="treeitem"
            aria-level={level}
            aria-expanded={hasChildren ? expanded : undefined}
            tabIndex={hasChildren ? undefined : 0}
            className={cx(
                'object-tree-row',
                'is-group',
                database && 'is-database',
                !database && `is-${kind}`,
            )}
            style={{ '--tree-indent': `${Math.max(0, level - 1) * 12}px` }}
            onPointerEnter={onInteract}
            onFocusCapture={onInteract}
        >
            <button
                type="button"
                className="object-tree-toggle"
                aria-label={hasChildren ? toggleLabel : label}
                disabled={!hasChildren}
                onClick={onToggle}
            >
                <span className={cx(expanded && 'is-open')}>
                    {hasChildren && <Icon name="chevron" />}
                </span>
            </button>
            <button
                type="button"
                className="object-tree-main"
                title={label}
                disabled={!hasChildren}
                onClick={onToggle}
            >
                <span className={cx('object-kind-glyph', database && 'is-database')}>
                    <Icon name={database ? 'database' : kind} />
                </span>
                <span className="object-tree-label">
                    <strong>{label}</strong>
                </span>
                {!hasActionSlot && countBadge}
            </button>
            {hasActionSlot && (
                <span className="object-tree-group-actions">
                    <span className="object-tree-group-action">{action}</span>
                    {countBadge}
                </span>
            )}
        </div>
    );
}

export function ObjectLeafRow({
    level,
    selected,
    glyph,
    label,
    meta,
    onSelect,
    onInsert,
    insertLabel,
}: {
    level: number;
    selected: boolean;
    glyph: 'column' | 'projection' | 'index' | 'dictionary';
    label: string;
    meta?: string;
    onSelect: () => void;
    onInsert?: () => void;
    insertLabel?: string;
}) {
    return (
        <div
            role="treeitem"
            aria-level={level}
            aria-selected={selected}
            className={cx(
                'object-tree-row',
                'is-object',
                'is-leaf',
                `is-${glyph}`,
                selected && 'is-selected',
            )}
            style={{ '--tree-indent': `${Math.max(0, level - 1) * 12}px` }}
        >
            <span className="object-tree-toggle object-tree-spacer" />
            <button
                type="button"
                className="object-tree-main"
                title={meta ? `${label} · ${meta}` : label}
                onClick={onSelect}
            >
                <span className="object-kind-glyph">
                    <Icon name={glyph} />
                </span>
                <span className="object-tree-label">
                    <strong>{label}</strong>
                    {meta && <small>{meta}</small>}
                </span>
            </button>
            {onInsert && (
                <button
                    type="button"
                    className="object-tree-inline-action"
                    title={insertLabel}
                    aria-label={`${insertLabel}: ${label}`}
                    onClick={onInsert}
                >
                    <Icon name="plus" />
                </button>
            )}
        </div>
    );
}

export function qualifiedTableName(table: SchemaTable) {
    return `${quoteIdentifier(table.database)}.${quoteIdentifier(table.name)}`;
}
