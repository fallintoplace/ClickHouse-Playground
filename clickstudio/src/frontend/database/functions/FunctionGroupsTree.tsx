import type { SqlFunction } from '../../../shared/database/functions/sql-functions';
import type { ExecutableFunction } from '../../../shared/database/functions/python-functions';
import { ExplorerGroupRow } from '../explorer/objects/tree/ObjectTreeRows';
import { FunctionsTree } from './FunctionsTree';
import { PythonFunctionsTree } from './PythonFunctionsTree';
import type { useSqlFunctions } from './useSqlFunctions';
import type { usePythonFunctions } from './usePythonFunctions';

type FunctionGroup = 'functions' | 'sql' | 'python';

export function FunctionGroupsTree({
    sql,
    python,
    search,
    createReason,
    onSelectSql,
    onSelectPython,
    expanded,
    onToggle,
}: {
    sql: ReturnType<typeof useSqlFunctions>;
    python: ReturnType<typeof usePythonFunctions>;
    search: string;
    createReason: string;
    onSelectSql: (fn: SqlFunction) => void;
    onSelectPython: (fn: ExecutableFunction) => void;
    expanded: Record<FunctionGroup, boolean>;
    onToggle: (group: FunctionGroup) => void;
}) {
    const query = search.trim().toLowerCase();
    const names = [
        ...(sql.visible ? (sql.catalog?.functions.map(fn => fn.name) ?? []) : []),
        ...(python.visible ? python.functions.map(fn => fn.name) : []),
    ];
    const count = names.filter(name => name.toLowerCase().includes(query)).length;
    const open = expanded.functions || Boolean(query);

    return (
        <div className="object-tree-branch functions-tree">
            <ExplorerGroupRow
                level={1}
                label="Functions"
                kind="function"
                count={count}
                hasChildren
                expanded={open}
                onToggle={() => onToggle('functions')}
            />
            {open && (
                <div role="group" className="object-tree-children">
                    {sql.visible && (
                        <FunctionsTree
                            label="SQL UDFs"
                            level={2}
                            expanded={expanded.sql}
                            onToggle={() => onToggle('sql')}
                            catalog={sql.catalog}
                            loading={sql.loading}
                            search={search}
                            canCreate={sql.canCreate}
                            createReason={createReason}
                            onCreate={sql.openCreate}
                            onSelect={onSelectSql}
                        />
                    )}
                    {python.visible && (
                        <PythonFunctionsTree
                            level={2}
                            expanded={expanded.python}
                            onToggle={() => onToggle('python')}
                            state={python}
                            search={search}
                            onSelect={onSelectPython}
                        />
                    )}
                </div>
            )}
        </div>
    );
}
