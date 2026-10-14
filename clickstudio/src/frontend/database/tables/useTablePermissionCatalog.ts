import { useCallback, useEffect, useRef, useState } from 'react';
import {
    NO_TABLE_PERMISSIONS,
    type TablePermissions,
} from '../../../shared/database/tables/permissions';
import { PLAYGROUND_CONNECTION_ID } from '../../../shared/database/connections/playground';
import { apiResponses, post } from '../../api/client';
import type { Connected } from '../../workspace/workspace-types';
import { metadataConnectionKey } from '../schema/metadata-state';

type Entry = { connectionKey: string; permissions: TablePermissions; loading: boolean };
const targetKey = (key: string, database: string, table?: string) =>
    JSON.stringify([key, database, table]);

export function useTablePermissionCatalog(connection: Connected, trusted: boolean) {
    const key = metadataConnectionKey(connection);
    const enabled =
        trusted &&
        connection.id !== PLAYGROUND_CONNECTION_ID &&
        connection.dataSource !== 'fixture';
    const active = useRef({ key, enabled });
    active.current = { key, enabled };
    const cache = useRef(new Map<string, Entry>());
    const requests = useRef(
        new Map<string, { connectionKey: string; controller: AbortController }>(),
    );
    const [loaded, setLoaded] = useState(cache.current);
    const [revision, setRevision] = useState(0);
    const update = useCallback((target: string, entry: Entry) => {
        cache.current = new Map(cache.current).set(target, entry);
        setLoaded(cache.current);
    }, []);
    const clear = useCallback((connectionKey: string) => {
        for (const [target, request] of requests.current) {
            if (request.connectionKey !== connectionKey) continue;
            request.controller.abort();
            requests.current.delete(target);
        }
        cache.current = new Map(
            [...cache.current].filter(([, entry]) => entry.connectionKey !== connectionKey),
        );
        setLoaded(cache.current);
    }, []);
    useEffect(() => {
        if (!enabled) return;
        return () => clear(key);
    }, [key, enabled, clear]);
    const request = useCallback(
        (database: string, table?: string) => {
            const target = targetKey(key, database, table);
            if (
                !enabled ||
                active.current.key !== key ||
                !active.current.enabled ||
                cache.current.has(target)
            )
                return;
            const controller = new AbortController();
            requests.current.set(target, { connectionKey: key, controller });
            update(target, { connectionKey: key, permissions: {}, loading: true });
            void Promise.resolve().then(async () => {
                if (controller.signal.aborted) return;
                try {
                    const permissions = await post(
                        `/connections/${encodeURIComponent(connection.id)}/table-permissions`,
                        { database, ...(table === undefined ? {} : { table }) },
                        apiResponses.isTablePermissions,
                        { signal: controller.signal },
                    );
                    if (!controller.signal.aborted)
                        update(target, { connectionKey: key, permissions, loading: false });
                } catch {
                    if (!controller.signal.aborted)
                        update(target, {
                            connectionKey: key,
                            permissions: NO_TABLE_PERMISSIONS,
                            loading: false,
                        });
                } finally {
                    if (requests.current.get(target)?.controller === controller)
                        requests.current.delete(target);
                }
            });
        },
        [key, enabled, connection.id, update],
    );
    return {
        revision,
        request,
        get: (database: string, table?: string) => {
            if (!enabled) return { ...NO_TABLE_PERMISSIONS, loading: false };
            const entry = loaded.get(targetKey(key, database, table));
            return { ...entry?.permissions, loading: entry?.loading ?? true };
        },
        refresh: () => {
            if (active.current.key !== key || !active.current.enabled) return;
            clear(key);
            setRevision(value => value + 1);
        },
    };
}

export type TablePermissionCatalogState = ReturnType<typeof useTablePermissionCatalog>;
