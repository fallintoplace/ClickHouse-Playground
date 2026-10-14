import { useEffect, useRef, useState } from 'react';
import {
    executableCatalogSchema,
    type ExecutableFunction,
} from '../../../shared/database/functions/python-functions';
import { CLICKHOUSE_CLOUD_CONNECTION_ID } from '../../../shared/database/connections/cloud-policy';
import type { Connected } from '../../workspace/workspace-types';
import { api, message } from '../../api/client';
import { loadClickHouseCloudExecutableFunctions } from '../connections/cloud-connection';

export function usePythonFunctions(connection: Connected, enabled: boolean) {
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
    const discover = enabled && connection.trusted && connection.dataSource !== 'fixture';
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
        functions: discover && loaded?.key === key ? loaded.functions : [],
        loading: discover && (loaded?.key !== key || loaded.revision !== revision),
        error: discover && loaded?.key === key ? loaded.error : undefined,
        selected: enabled && selection?.key === key ? selection.fn : undefined,
        createOpen: enabled && creating === key,
        create: () => setCreating(key),
        closeCreate: () => setCreating(undefined),
        select: (fn: ExecutableFunction) => setSelection({ key, fn }),
        close: () => setSelection(undefined),
        refresh: () => {
            if (active.current === key) setRevision(value => value + 1);
        },
    };
}
