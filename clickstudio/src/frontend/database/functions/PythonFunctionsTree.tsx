import { useState } from 'react';
import type { ExecutableFunction } from '../../../shared/database/functions/python-functions';
import { Icon } from '../../ui/components/icons';
import { ExplorerGroupRow, ObjectLeafRow } from '../explorer/objects/tree/ObjectTreeRows';
import type { usePythonFunctions } from './usePythonFunctions';

export function PythonFunctionsTree({
    state,
    search,
    onSelect,
}: {
    state: ReturnType<typeof usePythonFunctions>;
    search: string;
    onSelect: (fn: ExecutableFunction) => void;
}) {
    const [expanded, setExpanded] = useState(true);
    const functions = state.functions.filter(fn =>
        fn.name.toLowerCase().includes(search.trim().toLowerCase()),
    );
    return (
        <div className="object-tree-branch python-functions-tree">
            <ExplorerGroupRow
                level={1}
                label="Python UDFs"
                kind="function"
                count={functions.length}
                expanded={expanded || Boolean(search)}
                onToggle={() => setExpanded(value => !value)}
                action={
                    state.canCreate ? (
                        <button
                            type="button"
                            className="object-tree-inline-action"
                            aria-label="Create Python UDF"
                            title="Create Python UDF"
                            disabled={state.creationPending}
                            onClick={state.create}
                        >
                            <Icon name="plus" />
                        </button>
                    ) : undefined
                }
            />
            {(expanded || search) && (
                <div role="group" className="object-tree-children">
                    {functions.map(fn => (
                        <ObjectLeafRow
                            key={fn.name}
                            level={2}
                            selected={false}
                            glyph="function"
                            label={fn.name}
                            meta="Executable UDF"
                            onSelect={() => onSelect(fn)}
                        />
                    ))}
                    {state.loading && !state.available && (
                        <p className="sql-functions-status">Loading executable functions...</p>
                    )}
                    {state.available && !functions.length && (
                        <p className="sql-functions-status">
                            {search
                                ? 'No matching functions.'
                                : 'No executable UDFs on this server.'}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
