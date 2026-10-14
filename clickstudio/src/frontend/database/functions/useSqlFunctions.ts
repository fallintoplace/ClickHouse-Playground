import { useEffect, useRef, useState } from 'react';
import type { SqlFunction } from '../../../shared/database/functions/sql-functions';
import type { Connected } from '../../workspace/workspace-types';
import type { SqlFunctionCatalogState } from './useSqlFunctionCatalog';
import { metadataConnectionKey } from '../schema/metadata-state';

export function useSqlFunctions(
    connection: Connected,
    enabled: boolean,
    catalog: SqlFunctionCatalogState,
) {
    const key = metadataConnectionKey(connection);
    const currentConnection = useRef({ key, enabled });
    currentConnection.current = { key, enabled };
    const [selection, setSelection] = useState<{ key: string; fn: SqlFunction }>();
    const [creating, setCreating] = useState<string>();
    const [deleting, setDeleting] = useState<{ key: string; fn: SqlFunction }>();
    const canCreate =
        enabled && !connection.readonly && !catalog.error && catalog.catalog?.canCreate === true;
    const visible =
        enabled &&
        (catalog.loading ||
            (!connection.readonly && catalog.catalog?.canCreate === true) ||
            Boolean(catalog.catalog?.functions.length));
    useEffect(() => {
        if (!visible) {
            setSelection(undefined);
            setDeleting(undefined);
        }
        if (!visible || !canCreate) setCreating(undefined);
    }, [visible, canCreate]);

    useEffect(() => {
        if (catalog.loading || catalog.error || !catalog.catalog) return;
        const refreshed = catalog.catalog;
        setSelection(current => {
            if (current?.key !== key) return current;
            const fn = refreshed.functions.find(value => value.name === current.fn.name);
            return fn ? { key, fn } : undefined;
        });
    }, [catalog.catalog, catalog.loading, catalog.error, key]);

    return {
        ...catalog,
        visible,
        canCreate,
        canDelete:
            enabled &&
            !connection.readonly &&
            !catalog.loading &&
            !catalog.error &&
            catalog.catalog?.canDrop === true,
        selected: visible && selection?.key === key ? selection.fn : undefined,
        createOpen: visible && canCreate && creating === key,
        deleteTarget: visible && deleting?.key === key ? deleting.fn : undefined,
        select: (fn: SqlFunction) => setSelection({ key, fn }),
        close: () => setSelection(undefined),
        openCreate: () => setCreating(key),
        closeCreate: () => setCreating(undefined),
        openDelete: (fn: SqlFunction) => setDeleting({ key, fn }),
        closeDelete: () => setDeleting(undefined),
        deleted: (name: string) => {
            if (currentConnection.current.key !== key || !currentConnection.current.enabled) return;
            setDeleting(current =>
                current?.key === key && current.fn.name === name ? undefined : current,
            );
            setSelection(current =>
                current?.key === key && current.fn.name === name ? undefined : current,
            );
            catalog.refresh();
        },
        created: (fn: SqlFunction) => {
            if (currentConnection.current.key !== key || !currentConnection.current.enabled) return;
            setCreating(undefined);
            setSelection({ key, fn });
            catalog.refresh();
        },
    };
}
