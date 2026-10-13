import { useState } from 'react';
import type {
    FunctionCatalog,
    SqlFunction,
} from '../../../shared/database/functions/sql-functions';
import { Icon } from '../../ui/components/icons';
import { ExplorerGroupRow, ObjectLeafRow } from '../explorer/objects/tree/ObjectTreeRows';

export function FunctionsTree({
    catalog,
    loading,
    error,
    search,
    canCreate,
    createReason,
    onCreate,
    onSelect,
    onRefresh,
}: {
    catalog?: FunctionCatalog;
    loading: boolean;
    error?: string;
    search: string;
    canCreate: boolean;
    createReason: string;
    onCreate: () => void;
    onSelect: (fn: SqlFunction) => void;
    onRefresh: () => void;
}) {
    const [expanded, setExpanded] = useState(true);
    const query = search.trim().toLowerCase();
    const functions = catalog?.functions.filter(fn => fn.name.toLowerCase().includes(query)) ?? [];
    return (
        <div className="object-tree-branch sql-functions-tree">
            <ExplorerGroupRow
                level={1}
                label="Functions"
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
            {(expanded || query || loading || error || !functions.length) && (
                <div role="group" className="object-tree-children">
                    {loading && (
                        <p className="sql-functions-status" role="status">
                            Loading functions…
                        </p>
                    )}
                    {!loading && error && (
                        <div className="sql-functions-status" role="alert">
                            <span>{error}</span>
                            <button type="button" onClick={onRefresh}>
                                Retry
                            </button>
                        </div>
                    )}
                    {!loading &&
                        !error &&
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
                    {!loading && !error && functions.length === 0 && (
                        <p className="sql-functions-status">
                            {query ? 'No matching functions.' : 'No SQL UDFs on this server yet.'}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
