import { useEffect, useRef, useState } from 'react';
import type { FunctionCatalog } from '../../../shared/database/functions/sql-functions';
import { CLICKHOUSE_CLOUD_CONNECTION_ID } from '../../../shared/database/connections/cloud-policy';
import type { Connected } from '../../workspace/workspace-types';
import { message } from '../../api/client';
import { loadClickHouseCloudFunctions } from '../connections/cloud-connection';

export function useSqlFunctionCatalog(connection: Connected, trusted: boolean, visible: boolean) {
    const key = `${connection.id}:${connection.host}:${connection.username}:${connection.manifest?.testedAt}`;
    const enabled = trusted && connection.id === CLICKHOUSE_CLOUD_CONNECTION_ID;
    const currentConnection = useRef({ key, enabled });
    currentConnection.current = { key, enabled };
    const [requestedKey, setRequestedKey] = useState<string>();
    const [revision, setRevision] = useState(0);
    const [loaded, setLoaded] = useState<{
        key: string;
        revision: number;
        catalog?: FunctionCatalog;
        error?: string;
    }>();
    const requested = enabled && (visible || requestedKey === key);

    useEffect(() => {
        if (!enabled) {
            setRequestedKey(undefined);
            setLoaded(undefined);
        } else if (visible) {
            setRequestedKey(key);
        }
    }, [enabled, key, visible]);

    useEffect(() => {
        if (!requested) return;
        const controller = new AbortController();
        void Promise.resolve().then(async () => {
            if (controller.signal.aborted) return;
            try {
                const catalog = await loadClickHouseCloudFunctions(controller.signal);
                if (!controller.signal.aborted) setLoaded({ key, revision, catalog });
            } catch (error) {
                if (!controller.signal.aborted) setLoaded({ key, revision, error: message(error) });
            }
        });
        return () => controller.abort();
    }, [requested, key, revision]);

    return {
        catalog: enabled && loaded?.key === key ? loaded.catalog : undefined,
        loading: requested && (loaded?.key !== key || loaded.revision !== revision),
        error: enabled && loaded?.key === key ? loaded.error : undefined,
        refresh: () => {
            if (currentConnection.current.key !== key || !currentConnection.current.enabled) return;
            setRequestedKey(key);
            setRevision(value => value + 1);
        },
    };
}

export type SqlFunctionCatalogState = ReturnType<typeof useSqlFunctionCatalog>;
