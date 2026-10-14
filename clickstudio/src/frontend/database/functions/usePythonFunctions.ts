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

export function usePythonFunctions(connection: Connected, enabled: boolean, canCreate: boolean) {
    const key = `${connection.id}:${connection.host}:${connection.database}:${connection.username}:${connection.manifest?.testedAt}`;
    const [revision, setRevision] = useState(0);
    const [creating, setCreating] = useState<string>();
    const [selection, setSelection] = useState<{ key: string; fn: ExecutableFunction }>();
    const [loaded, setLoaded] = useState<{
        key: string;
        revision: number;
        functions: ExecutableFunction[];
        error?: string;
    }>();
    const active = useRef(key);
    active.current = key;
    const discover =
        enabled &&
        connection.trusted &&
        connection.dataSource !== 'fixture' &&
        connection.id !== PLAYGROUND_CONNECTION_ID;
    const visible =
        discover &&
        loaded?.key === key &&
        !loaded.error &&
        (canCreate || loaded.functions.length > 0);
    useEffect(() => {
        if (!discover) setLoaded(undefined);
    }, [discover]);
    useEffect(() => {
        if (!visible) setSelection(undefined);
        if (!visible || !canCreate) setCreating(undefined);
    }, [visible, canCreate]);
    useEffect(() => {
        if (!discover) return;
        const controller = new AbortController();
        void (async () => {
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
                    setLoaded({ key, revision, functions: catalog.functions });
            } catch (error) {
                if (!controller.signal.aborted)
                    setLoaded({ key, revision, functions: [], error: message(error) });
            }
        })();
        return () => controller.abort();
    }, [discover, connection.id, key, revision]);
    return {
        key,
        visible,
        canCreate: visible && canCreate,
        functions: discover && loaded?.key === key ? loaded.functions : [],
        loading: discover && (loaded?.key !== key || loaded.revision !== revision),
        error: discover && loaded?.key === key ? loaded.error : undefined,
        selected: visible && selection?.key === key ? selection.fn : undefined,
        createOpen: visible && canCreate && creating === key,
        create: () => setCreating(key),
        closeCreate: () => setCreating(undefined),
        select: (fn: ExecutableFunction) => setSelection({ key, fn }),
        close: () => setSelection(undefined),
        refresh: () => {
            if (active.current === key) setRevision(value => value + 1);
        },
    };
}
