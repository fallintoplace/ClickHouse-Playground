import { useEffect, useRef, useState } from 'react';
import type {
    FunctionCatalog,
    SqlFunction,
} from '../../../shared/database/functions/sql-functions';
import type { Connected } from '../../workspace/workspace-types';
import { message } from '../../api/client';
import { loadClickHouseCloudFunctions } from '../connections/cloud-connection';

export function useSqlFunctions(connection: Connected, enabled: boolean) {
    const key = `${connection.id}:${connection.host}:${connection.username}:${connection.manifest?.testedAt}`;
    const currentConnection = useRef({ key, enabled });
    currentConnection.current = { key, enabled };
    const [revision, setRevision] = useState(0);
    const [loaded, setLoaded] = useState<{
        key: string;
        revision: number;
        catalog?: FunctionCatalog;
        error?: string;
    }>();
    const [selection, setSelection] = useState<{ key: string; fn: SqlFunction }>();
    const [creating, setCreating] = useState<string>();
    const [deleting, setDeleting] = useState<{ key: string; fn: SqlFunction }>();
    const catalog = loaded?.key === key ? loaded.catalog : undefined;
    const loading = enabled && (loaded?.key !== key || loaded.revision !== revision);
    const error = loaded?.key === key ? loaded.error : undefined;

    useEffect(() => {
        if (!enabled) return;
        const controller = new AbortController();
        void loadClickHouseCloudFunctions(controller.signal).then(
            catalog => {
                if (!controller.signal.aborted) setLoaded({ key, revision, catalog });
            },
            error => {
                if (!controller.signal.aborted) setLoaded({ key, revision, error: message(error) });
            },
        );
        return () => controller.abort();
    }, [enabled, key, revision]);

    return {
        catalog,
        loading,
        error,
        selected: enabled && selection?.key === key ? selection.fn : undefined,
        createOpen: enabled && creating === key,
        deleteTarget: enabled && deleting?.key === key ? deleting.fn : undefined,
        refresh: () => setRevision(value => value + 1),
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
            setRevision(value => value + 1);
        },
        created: (fn: SqlFunction) => {
            if (currentConnection.current.key !== key || !currentConnection.current.enabled) return;
            setCreating(undefined);
            setSelection({ key, fn });
            setRevision(value => value + 1);
        },
    };
}
