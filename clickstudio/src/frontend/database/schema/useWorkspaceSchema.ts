import { useCallback, useEffect, useRef, useState } from 'react';
import { CLICKHOUSE_CLOUD_CONNECTION_ID } from '../../../shared/database/connections/cloud-policy';
import type { Schema } from '../../../shared/database/schema/types';
import { api, apiResponses, message } from '../../api/client';
import type { Connected } from '../../workspace/workspace-types';
import { metadataAccessDenied, metadataConnectionKey } from './metadata-state';
import { hasSchemaPage, mergeSchemaPages, reloadSchemaPages, schemaPagePath } from './schema-pages';

type Snapshot = { key: string; schema: Schema; pages: number };
type Request = { key: string; controller: AbortController; more: boolean };

export function useWorkspaceSchema(connection: Connected, trusted: boolean) {
    const key = metadataConnectionKey(connection);
    const active = useRef({ key, trusted });
    active.current = { key, trusted };
    const [snapshot, setSnapshot] = useState<Snapshot>();
    const snapshotRef = useRef(snapshot);
    snapshotRef.current = snapshot;
    const [request, setRequest] = useState<Request>();
    const requestRef = useRef<Request | undefined>(undefined);
    const [failure, setFailure] = useState<{ key: string; message: string }>();

    useEffect(() => {
        return () => {
            requestRef.current?.controller.abort();
            requestRef.current = undefined;
            snapshotRef.current = undefined;
            setSnapshot(undefined);
            setRequest(undefined);
            setFailure(undefined);
        };
    }, [key, trusted]);

    const load = useCallback(
        async (refresh: boolean, more: boolean) => {
            if (!active.current.trusted || active.current.key !== key) return undefined;
            if (requestRef.current) {
                if (!refresh || more) return undefined;
                requestRef.current.controller.abort();
                requestRef.current = undefined;
            }
            const current = snapshotRef.current?.key === key ? snapshotRef.current : undefined;
            if (more && (!current || !hasSchemaPage(current.schema))) return undefined;
            const pending = { key, more, controller: new AbortController() };
            requestRef.current = pending;
            setRequest(pending);
            setFailure(undefined);
            const valid = () =>
                !pending.controller.signal.aborted &&
                active.current.trusted &&
                active.current.key === key &&
                requestRef.current === pending;
            try {
                await Promise.resolve();
                pending.controller.signal.throwIfAborted();
                const loadPage = (pagination?: Schema['pagination']) =>
                    api<Schema>(
                        schemaPagePath(connection.id, pagination, refresh),
                        apiResponses.isSchemaResponse,
                        { signal: pending.controller.signal },
                    );
                let next;
                if (more && current) {
                    const page = await loadPage(current.schema.pagination);
                    next = {
                        schema: mergeSchemaPages(current.schema, page),
                        pages: current.pages + 1,
                    };
                } else {
                    const pages = refresh && current ? current.pages : 1;
                    next = await reloadSchemaPages(pages, loadPage, pending.controller.signal);
                }
                if (valid()) {
                    const updated = { key, ...next };
                    snapshotRef.current = updated;
                    setSnapshot(updated);
                    return next.schema;
                }
            } catch (error) {
                if (valid()) {
                    const denied = metadataAccessDenied(error);
                    if (denied) {
                        snapshotRef.current = undefined;
                        setSnapshot(undefined);
                    }
                    const hint =
                        current && !denied ? 'Refresh failed. Showing previous schema. ' : '';
                    setFailure({ key, message: `${hint}${message(error)}` });
                }
            } finally {
                if (requestRef.current === pending) {
                    requestRef.current = undefined;
                    setRequest(undefined);
                }
            }
            return undefined;
        },
        [key, connection.id],
    );

    const loadSchema = useCallback((refresh = false) => load(refresh, false), [load]);
    const loadMoreSchema = useCallback(() => {
        if (connection.id !== CLICKHOUSE_CLOUD_CONNECTION_ID) return Promise.resolve(undefined);
        return load(false, true);
    }, [connection.id, load]);

    return {
        schema: trusted && snapshot?.key === key ? snapshot.schema : undefined,
        schemaLoading: trusted && request?.key === key && !request.more,
        schemaLoadingMore: trusted && request?.key === key && request.more,
        schemaError: trusted && failure?.key === key ? failure.message : '',
        loadSchema,
        loadMoreSchema,
    };
}
