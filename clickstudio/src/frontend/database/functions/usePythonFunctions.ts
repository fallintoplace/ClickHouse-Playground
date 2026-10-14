import { useEffect, useState } from 'react';
import type { ExecutableFunction } from '../../../shared/database/functions/python-functions';
import type { Connected } from '../../workspace/workspace-types';
import type { PythonFunctionCatalogState } from './usePythonFunctionCatalog';
import { metadataConnectionKey } from '../schema/metadata-state';

export function usePythonFunctions(
    connection: Connected,
    canCreate: boolean,
    catalog: PythonFunctionCatalogState,
    creationPending = false,
) {
    const key = metadataConnectionKey(connection);
    const [creating, setCreating] = useState<string>();
    const [selection, setSelection] = useState<{ key: string; fn: ExecutableFunction }>();
    const { loading, error } = catalog;
    const visible =
        catalog.enabled &&
        (loading || (catalog.available && (canCreate || catalog.functions.length > 0)));
    useEffect(() => {
        if (!visible) setSelection(undefined);
        if (!visible || !canCreate || error) setCreating(undefined);
    }, [visible, canCreate, error]);
    useEffect(() => {
        if (loading || error || !catalog.available) return;
        setSelection(current => {
            if (current?.key !== key) return current;
            const fn = catalog.functions.find(value => value.name === current.fn.name);
            return fn ? { key, fn } : undefined;
        });
    }, [loading, error, catalog.available, catalog.functions, key]);

    return {
        key,
        visible,
        canCreate: visible && canCreate && !error,
        creationPending: loading || creationPending,
        functions: catalog.functions,
        available: catalog.available,
        loading,
        error,
        refreshError: catalog.refreshError,
        selected: visible && selection?.key === key ? selection.fn : undefined,
        createOpen: visible && canCreate && !error && creating === key,
        create: () => {
            if (visible && canCreate && !error && !loading && !creationPending) setCreating(key);
        },
        closeCreate: () => setCreating(undefined),
        select: (fn: ExecutableFunction) => setSelection({ key, fn }),
        close: () => setSelection(undefined),
        refresh: catalog.refresh,
    };
}
