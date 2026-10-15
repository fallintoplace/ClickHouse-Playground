import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Run } from '../../../shared/queries/execution/types';
import type { Schema } from '../../../shared/database/schema/types';
import { isSystemDatabaseName, isViewEngine } from '../../../shared/database/tables/delete-table';
import { materializedViewSelect } from '../../../shared/database/views/create-materialized-view';
import { CreateMaterializedViewDialog } from '../../database/views/CreateMaterializedViewDialog';
import { Icon } from '../../ui/components/icons';

export type OpenResultSql = (
    name: string,
    sql: string,
    parameters: Record<string, string>,
) => boolean;

export function ResultActions({
    run,
    database,
    schema,
    onOpenSql,
}: {
    run: Run;
    database: string;
    schema?: Schema;
    onOpenSql: OpenResultSql;
}) {
    const id = useId();
    const root = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const menuItem = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const selectSql = useMemo(() => materializedViewSelect(run.sql), [run.sql]);
    const tables = useMemo(
        () =>
            (schema?.tables ?? []).filter(
                table => !isSystemDatabaseName(table.database) && !isViewEngine(table.engine),
            ),
        [schema?.tables],
    );

    useEffect(() => {
        if (!open) return;
        const closeOutside = (event: PointerEvent) => {
            if (!root.current || !event.composedPath().includes(root.current)) setOpen(false);
        };
        const frame = requestAnimationFrame(() => menuItem.current?.focus());
        document.addEventListener('pointerdown', closeOutside);
        return () => {
            cancelAnimationFrame(frame);
            document.removeEventListener('pointerdown', closeOutside);
        };
    }, [open]);

    if (
        !selectSql ||
        run.kind !== 'query' ||
        run.columns.length === 0 ||
        !['succeeded', 'truncated'].includes(run.status)
    )
        return null;

    return (
        <div
            ref={root}
            className="result-actions-dropdown"
            onKeyDown={event => {
                if (event.key === 'Escape' && open) {
                    event.preventDefault();
                    setOpen(false);
                    trigger.current?.focus();
                } else if (event.key === 'Tab' && open) {
                    setOpen(false);
                    trigger.current?.focus();
                } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                    if (creating) return;
                    event.preventDefault();
                    setOpen(true);
                    menuItem.current?.focus();
                }
            }}
        >
            <button
                ref={trigger}
                type="button"
                className="button-base button-ghost result-actions-trigger"
                aria-label="Result actions"
                aria-haspopup="menu"
                aria-controls={id}
                aria-expanded={open}
                title="Result actions"
                onClick={() => setOpen(value => !value)}
            >
                <Icon name="more" />
            </button>
            {open && (
                <div
                    id={id}
                    className="result-actions-menu"
                    role="menu"
                    aria-label="Result actions"
                >
                    <button
                        ref={menuItem}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                            setOpen(false);
                            trigger.current?.focus();
                            setCreating(true);
                        }}
                    >
                        <Icon name="plus" />
                        Create materialized view
                    </button>
                </div>
            )}
            {creating && (
                <CreateMaterializedViewDialog
                    database={database}
                    tables={tables}
                    selectSql={selectSql}
                    onClose={() => setCreating(false)}
                    onOpenSql={(name, sql) => onOpenSql(name, sql, run.parameters)}
                />
            )}
        </div>
    );
}
