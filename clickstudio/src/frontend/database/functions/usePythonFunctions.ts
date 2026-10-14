import { useEffect, useRef, useState } from 'react';
import {
    executableCatalogSchema,
    type ExecutableFunction,
} from '../../../shared/database/functions/python-functions';
import { CLICKHOUSE_CLOUD_CONNECTION_ID } from '../../../shared/database/connections/cloud-policy';
import { PLAYGROUND_CONNECTION_ID } from '../../../shared/database/connections/playground';
import type { Connected } from '../../workspace/workspace-types';
import { api, message } from '../../api/client';
import { loadClickHouseCloudExecutableFunctions } from '../connections/cloud-connection';
import { metadataAccessDenied, metadataConnectionKey } from '../schema/metadata-state';

export function usePythonFunctions(
    connection: Connected,
    canCreate: boolean,
    creationPending = false,
) {
    const key = metadataConnectionKey(connection);
    const [revision, setRevision] = useState(0);
    const [creating, setCreating] = useState<string>();
    const [selection, setSelection] = useState<{ key: string; fn: ExecutableFunction }>();
    const [loaded, setLoaded] = useState<{
        key: string;
        revision: number;
        functions: ExecutableFunction[];
        available?: boolean;
        error?: string;
        refreshFailed?: boolean;
    }>();
    const active = useRef(key);
    active.current = key;
    const discover =
        connection.trusted &&
        connection.dataSource !== 'fixture' &&
        connection.id !== PLAYGROUND_CONNECTION_ID;
    const visible =
        discover &&
        loaded?.key === key &&
        loaded.available === true &&
        (canCreate || loaded.functions.length > 0);
    const loading = discover && (loaded?.key !== key || loaded.revision !== revision);
    const error =
        discover && loaded?.key === key && loaded.revision === revision ? loaded.error : undefined;
    useEffect(() => {
        if (!discover) setLoaded(undefined);
    }, [discover]);
    useEffect(() => {
        if (!visible) setSelection(undefined);
        if (!visible || !canCreate || error) setCreating(undefined);
    }, [visible, canCreate, error]);
    useEffect(() => {
        if (loading || error || loaded?.key !== key) return;
        setSelection(current => {
            if (current?.key !== key) return current;
            const fn = loaded.functions.find(value => value.name === current.fn.name);
            return fn ? { key, fn } : undefined;
        });
    }, [loading, error, loaded, key]);
    useEffect(() => {
        if (!discover) return;
        const controller = new AbortController();
        void Promise.resolve().then(async () => {
            if (controller.signal.aborted) return;
            try {
                const catalog =
                    connection.id === CLICKHOUSE_CLOUD_CONNECTION_ID
                        ? await loadClickHouseCloudExecutableFunctions(controller.signal)
                        : await api(
                              `/connections/${encodeURIComponent(connection.id)}/executable-functions`,
                              (value): value is { functions: ExecutableFunction[] } =>
                                  executableCatalogSchema.safeParse(value).success,
                              { signal: controller.signal },
                          );
                if (!controller.signal.aborted)
                    setLoaded({ key, revision, functions: catalog.functions, available: true });
            } catch (error) {
                if (!controller.signal.aborted)
                    setLoaded(current => {
                        const retain = !metadataAccessDenied(error) && current?.key === key;
                        return {
                            key,
                            revision,
                            functions: retain ? current.functions : [],
                            available: retain && current.available,
                            error: message(error),
                            refreshFailed:
                                current?.key === key &&
                                (current.available === true || current.refreshFailed === true),
                        };
                    });
            }
        });
        return () => controller.abort();
    }, [discover, connection.id, key, revision]);
    return {
        key,
        visible,
        canCreate: visible && canCreate && !error,
        creationPending: loading || creationPending,
        functions: discover && loaded?.key === key ? loaded.functions : [],
        available: discover && loaded?.key === key && loaded.available === true,
        loading,
        error,
        refreshError: loaded?.refreshFailed ? error : undefined,
        selected: visible && selection?.key === key ? selection.fn : undefined,
        createOpen: visible && canCreate && !error && creating === key,
        create: () => {
            if (visible && canCreate && !error && !loading && !creationPending) setCreating(key);
        },
        closeCreate: () => setCreating(undefined),
        select: (fn: ExecutableFunction) => setSelection({ key, fn }),
        close: () => setSelection(undefined),
        refresh: () => {
            if (active.current === key && discover) setRevision(value => value + 1);
        },
    };
}
