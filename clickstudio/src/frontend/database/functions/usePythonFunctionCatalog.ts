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

export function usePythonFunctionCatalog(
    connection: Connected,
    trusted: boolean,
    visible: boolean,
) {
    const key = metadataConnectionKey(connection);
    const enabled =
        trusted &&
        connection.dataSource !== 'fixture' &&
        connection.id !== PLAYGROUND_CONNECTION_ID;
    const active = useRef({ key, enabled });
    active.current = { key, enabled };
    const [requestedKey, setRequestedKey] = useState<string>();
    const [revision, setRevision] = useState(0);
    const [loaded, setLoaded] = useState<{
        key: string;
        revision: number;
        functions: ExecutableFunction[];
        available?: boolean;
        error?: string;
        refreshFailed?: boolean;
    }>();
    const requested = enabled && (visible || requestedKey === key);
    useEffect(() => {
        if (!enabled) {
            setRequestedKey(undefined);
            setLoaded(undefined);
        } else if (visible) setRequestedKey(key);
    }, [enabled, key, visible]);
    useEffect(() => {
        if (!requested) return;
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
    }, [requested, connection.id, key, revision]);
    const current = enabled && loaded?.key === key ? loaded : undefined;
    const error = current?.revision === revision ? current.error : undefined;
    return {
        enabled,
        functions: current?.functions ?? [],
        available: current?.available === true,
        loading: requested && (!current || current.revision !== revision),
        error,
        refreshError: current?.refreshFailed ? error : undefined,
        refresh: () => {
            if (active.current.key !== key || !active.current.enabled) return;
            setRequestedKey(key);
            setRevision(value => value + 1);
        },
    };
}

export type PythonFunctionCatalogState = ReturnType<typeof usePythonFunctionCatalog>;
