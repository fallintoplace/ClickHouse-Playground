import { useRef, useState } from 'react';
import type { SchemaTable } from '../../../shared/database/schema/types';
import { isValidTableDatabase } from '../../../shared/database/tables/create-table';
import { createMaterializedViewSql } from '../../../shared/database/views/create-materialized-view';
import { quoteIdentifier } from '../../../shared/sql/sql';
import { CreationDialog } from '../../ui/components/CreationDialog';
import { SelectControl } from '../../ui/components/SelectControl';

const tableKey = (table: Pick<SchemaTable, 'database' | 'name'>) =>
    `${quoteIdentifier(table.database)}.${quoteIdentifier(table.name)}`;

export function CreateMaterializedViewDialog({
    database,
    tables,
    selectSql,
    onClose,
    onOpenSql,
}: {
    database: string;
    tables: readonly SchemaTable[];
    selectSql: string;
    onClose: () => void;
    onOpenSql: (name: string, sql: string) => boolean;
}) {
    const nameInput = useRef<HTMLInputElement>(null);
    const [name, setName] = useState('');
    const [targetKey, setTargetKey] = useState(() => {
        const first = tables.find(table => table.database === database) ?? tables[0];
        return first ? tableKey(first) : '';
    });
    const target = tables.find(table => tableKey(table) === targetKey);
    const validName = isValidTableDatabase(name.trim());

    return (
        <CreationDialog
            title="Create materialized view"
            description={`Incremental · ${database}`}
            closeLabel="Close Create materialized view"
            className="materialized-view-dialog"
            busy={false}
            initialFocus={nameInput}
            onClose={onClose}
            onSubmit={event => {
                event.preventDefault();
                if (!validName || !target) return;
                if (
                    onOpenSql(
                        `${name.trim()}.sql`,
                        createMaterializedViewSql(database, name, target, selectSql),
                    )
                )
                    onClose();
            }}
            footer={
                <>
                    <button type="button" className="creation-dialog-button" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        type="submit"
                        className="creation-dialog-button is-primary"
                        disabled={!validName || !target}
                    >
                        Open SQL
                    </button>
                </>
            }
        >
            <div className="materialized-view-fields">
                <label className="creation-dialog-field">
                    <span>View name</span>
                    <input
                        ref={nameInput}
                        className="creation-dialog-control"
                        value={name}
                        required
                        maxLength={128}
                        placeholder="e.g. orders_daily_mv"
                        aria-invalid={Boolean(name) && !validName ? true : undefined}
                        onChange={event => setName(event.target.value)}
                    />
                </label>
                <div className="creation-dialog-field">
                    <span>Target table</span>
                    <SelectControl
                        className="select-control-field"
                        label="Target table"
                        value={targetKey}
                        options={tables.map(table => ({
                            value: tableKey(table),
                            label: `${table.database}.${table.name}`,
                        }))}
                        onChange={setTargetKey}
                        searchable
                    />
                </div>
            </div>
            <p className="creation-dialog-help">Processes new inserts only.</p>
            {!tables.length && <p className="creation-dialog-help">Create a target table first.</p>}
        </CreationDialog>
    );
}
