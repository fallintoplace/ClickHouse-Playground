import { useEffect, useRef, useState } from 'react';
import type { Connected } from '../../workspace/workspace-types';
import { message } from '../../api/client';
import { metadataAccessDenied, metadataConnectionKey } from '../schema/metadata-state';

/** Keep the loader stable so unrelated renders do not restart catalog requests. */
export function useFunctionCatalog<T extends object>(
    connection: Connected,
    enabled: boolean,
    visible: boolean,
    load: (signal: AbortSignal) => Promise<T>,
) {
    const key = metadataConnectionKey(connection);
    const active = useRef({ key, enabled });
    active.current = { key, enabled };
    const [requestedKey, setRequestedKey] = useState<string>();
    const [revision, setRevision] = useState(0);
    const [loaded, setLoaded] = useState<{
        key: string;
        revision: number;
        catalog?: T;
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
        // StrictMode can clean up its first effect before this microtask starts a request.
        void Promise.resolve().then(async () => {
            if (controller.signal.aborted) return;
            try {
                const catalog = await load(controller.signal);
                if (!controller.signal.aborted) setLoaded({ key, revision, catalog });
            } catch (error) {
                if (!controller.signal.aborted)
                    setLoaded(current => ({
                        key,
                        revision,
                        catalog:
                            !metadataAccessDenied(error) && current?.key === key
                                ? current.catalog
                                : undefined,
                        error: message(error),
                        refreshFailed:
                            current?.key === key &&
                            Boolean(current.catalog || current.refreshFailed),
                    }));
            }
        });
        return () => controller.abort();
    }, [requested, key, revision, load]);

    const current = enabled && loaded?.key === key ? loaded : undefined;
    const error = current?.revision === revision ? current.error : undefined;
    return {
        catalog: current?.catalog,
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
