import { useState } from 'react';
import type {
    FunctionCatalog,
    SqlFunction,
} from '../../../shared/database/functions/sql-functions';
import { Icon } from '../../ui/components/icons';
import { Spinner } from '../../ui/components/primitives';
import { ExplorerGroupRow, ObjectLeafRow } from '../explorer/objects/tree/ObjectTreeRows';

export function FunctionsTree({
    catalog,
    loading,
    search,
    canCreate,
    createReason,
    onCreate,
    onSelect,
    label = 'Functions',
}: {
    catalog?: FunctionCatalog;
    loading: boolean;
    search: string;
    canCreate: boolean;
    createReason: string;
    onCreate: () => void;
    onSelect: (fn: SqlFunction) => void;
    label?: string;
}) {
    const [expanded, setExpanded] = useState(true);
    const query = search.trim().toLowerCase();
    const functions = catalog?.functions.filter(fn => fn.name.toLowerCase().includes(query)) ?? [];
    return (
        <div className="object-tree-branch sql-functions-tree">
            <ExplorerGroupRow
                level={1}
                label={label}
                kind="function"
                count={functions.length}
                expanded={expanded || Boolean(query)}
                onToggle={() => setExpanded(value => !value)}
                action={
                    <button
                        type="button"
                        className="object-tree-inline-action"
                        aria-label="Create SQL UDF"
                        title={canCreate ? 'Create SQL UDF' : createReason}
                        disabled={!canCreate || loading}
                        onClick={onCreate}
                    >
                        <Icon name="plus" />
                    </button>
                }
            />
            {(expanded || query || !functions.length) && (
                <div role="group" className="object-tree-children">
                    {loading && !catalog && (
                        <div className="sql-functions-status">
                            <Spinner size={12} label="Loading functions" />
                        </div>
                    )}
                    {catalog &&
                        functions.length > 0 &&
                        functions.map(fn => (
                            <ObjectLeafRow
                                key={fn.name}
                                level={2}
                                selected={false}
                                glyph="function"
                                label={fn.name}
                                meta="SQL UDF"
                                onSelect={() => onSelect(fn)}
                            />
                        ))}
                    {catalog && functions.length === 0 && (
                        <p className="sql-functions-status">
                            {query ? 'No matching functions.' : 'No SQL UDFs on this server yet.'}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
