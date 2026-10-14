import type { ExecutableFunction } from '../../../shared/database/functions/python-functions';
import { Icon } from '../../ui/components/icons';
import { Spinner } from '../../ui/components/primitives';
import { ExplorerGroupRow, ObjectLeafRow } from '../explorer/objects/tree/ObjectTreeRows';
import type { usePythonFunctions } from './usePythonFunctions';

export function PythonFunctionsTree({
    state,
    search,
    onSelect,
    level = 1,
    expanded,
    onToggle,
}: {
    state: ReturnType<typeof usePythonFunctions>;
    search: string;
    onSelect: (fn: ExecutableFunction) => void;
    level?: number;
    expanded: boolean;
    onToggle: () => void;
}) {
    const functions = state.functions.filter(fn =>
        fn.name.toLowerCase().includes(search.trim().toLowerCase()),
    );
    return (
        <div className="object-tree-branch python-functions-tree">
            <ExplorerGroupRow
                level={level}
                label="Python UDFs"
                kind="function"
                count={functions.length}
                expanded={expanded || Boolean(search.trim())}
                onToggle={onToggle}
                action={
                    state.loading ? (
                        <Spinner size={12} label="Loading Python UDFs" />
                    ) : (
                        state.canCreate && (
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
                        )
                    )
                }
            />
            {(expanded || search.trim()) && (
                <div role="group" className="object-tree-children">
                    {functions.map(fn => (
                        <ObjectLeafRow
                            key={fn.name}
                            level={level + 1}
                            selected={false}
                            glyph="function"
                            label={fn.name}
                            meta="Executable UDF"
                            onSelect={() => onSelect(fn)}
                        />
                    ))}
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
