import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type Dispatch,
    type SetStateAction,
} from 'react';
import type { QueryDocument } from '../../shared/queries/saved-queries/types';
import type { Run } from '../../shared/queries/execution/types';
import { sameSavedContent } from '../queries/saved-queries/draft-save-state';
import { api, apiResponses, message } from '../api/client';
import {
    loadPlaygroundServerVersion,
    PLAYGROUND_CONNECTION_ID,
} from '../database/connections/playground-client';
import type { WorkspaceState } from '../queries/editor/drafts/workspace-state';
import { startVisiblePolling } from '../browser/visible-polling';
import { useSqlFunctionCatalog } from '../database/functions/useSqlFunctionCatalog';
import { usePythonFunctionCatalog } from '../database/functions/usePythonFunctionCatalog';
import { useTablePermissionCatalog } from '../database/tables/useTablePermissionCatalog';
import { useWorkspaceSchema } from '../database/schema/useWorkspaceSchema';
import type { Connected } from './workspace-types';

export function useWorkspaceData({
    connection,
    trusted,
    objectsOpen,
    activeServerId,
    setWorkspace,
    workspaceRef,
}: {
    connection: Connected;
    trusted: boolean;
    objectsOpen: boolean;
    activeServerId?: string;
    setWorkspace: Dispatch<SetStateAction<WorkspaceState>>;
    workspaceRef: { current: WorkspaceState };
}) {
    const connectionId = connection.id;
    const functions = useSqlFunctionCatalog(connection, trusted, objectsOpen);
    const pythonFunctions = usePythonFunctionCatalog(connection, trusted, objectsOpen);
    const tablePermissions = useTablePermissionCatalog(connection, trusted);
    const { schema, schemaLoading, schemaLoadingMore, schemaError, loadSchema, loadMoreSchema } =
        useWorkspaceSchema(connection, trusted);
    const [playgroundServerVersion, setPlaygroundServerVersion] = useState<string>();
    const [playgroundServerVersionLoading, setPlaygroundServerVersionLoading] = useState(false);
    const [documents, setDocuments] = useState<QueryDocument[]>([]);
    const [documentsLoaded, setDocumentsLoaded] = useState(false);
    const [documentsReadError, setDocumentsReadError] = useState(false);
    const [documentsError, setDocumentsError] = useState('');
    const [historyError, setHistoryError] = useState('');
    const [documentRevisions, setDocumentRevisions] = useState<QueryDocument[]>([]);
    const [revisionsDocumentId, setRevisionsDocumentId] = useState<string>();
    const [revisionLoading, setRevisionLoading] = useState(false);
    const [revisionError, setRevisionError] = useState('');
    const [history, setHistory] = useState<Run[]>([]);
    const historyRequestRef = useRef(0);
    const documentsRequestRef = useRef(0);
    const revisionsRequestRef = useRef(0);

    useEffect(() => {
        let cancelled = false;
        setPlaygroundServerVersion(undefined);
        if (!trusted || connectionId !== PLAYGROUND_CONNECTION_ID) {
            setPlaygroundServerVersionLoading(false);
            return;
        }
        setPlaygroundServerVersionLoading(true);
        void loadPlaygroundServerVersion()
            .then(version => {
                if (!cancelled) setPlaygroundServerVersion(version);
            })
            .finally(() => {
                if (!cancelled) setPlaygroundServerVersionLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [connectionId, trusted]);

    const invalidateRequests = useCallback(() => {
        historyRequestRef.current++;
        documentsRequestRef.current++;
        revisionsRequestRef.current++;
    }, []);

    const loadHistory = useCallback(
        async (signal?: AbortSignal) => {
            const requestId = ++historyRequestRef.current;
            try {
                const next = await api<Run[]>(
                    `/runs?connectionId=${encodeURIComponent(connectionId)}`,
                    apiResponses.arrayOf(apiResponses.isRunResponse),
                    { signal },
                );
                if (!signal?.aborted && historyRequestRef.current === requestId) {
                    setHistory(next);
                    setHistoryError('');
                }
            } catch (caught) {
                if (!signal?.aborted && historyRequestRef.current === requestId) {
                    setHistoryError(message(caught));
                    throw caught;
                }
            }
        },
        [connectionId],
    );

    const loadDocuments = useCallback(async () => {
        const requestId = ++documentsRequestRef.current;
        try {
            const next = await api<QueryDocument[]>(
                `/documents?trash=true&connectionId=${encodeURIComponent(connectionId)}`,
                apiResponses.arrayOf(apiResponses.isQueryDocumentResponse),
            );
            if (documentsRequestRef.current === requestId) {
                setDocuments(next);
                setWorkspace(current => ({
                    ...current,
                    tabs: current.tabs.map(draft => {
                        const saved = next.find(document => document.id === draft.serverId);
                        return saved &&
                            draft.baseRevision !== saved.revision &&
                            sameSavedContent(draft, saved)
                            ? { ...draft, baseRevision: saved.revision }
                            : draft;
                    }),
                }));
                setDocumentsReadError(false);
                setDocumentsError('');
            }
        } catch (caught) {
            if (documentsRequestRef.current === requestId) {
                setDocumentsReadError(true);
                setDocumentsError(message(caught));
                throw caught;
            }
        } finally {
            if (documentsRequestRef.current === requestId) setDocumentsLoaded(true);
        }
    }, [connectionId, setWorkspace]);

    const loadDocumentRevisions = useCallback(
        async (documentId = activeServerId) => {
            if (!documentId) {
                revisionsRequestRef.current++;
                setRevisionsDocumentId(undefined);
                setDocumentRevisions([]);
                setRevisionError('Save this query before opening version history.');
                setRevisionLoading(false);
                return;
            }
            const requestId = ++revisionsRequestRef.current;
            setRevisionsDocumentId(documentId);
            setDocumentRevisions([]);
            setRevisionError('');
            setRevisionLoading(true);
            try {
                const next = await api<QueryDocument[]>(
                    `/documents/${encodeURIComponent(documentId)}/revisions`,
                    apiResponses.arrayOf(apiResponses.isQueryDocumentResponse),
                );
                const currentDraft = workspaceRef.current.tabs.find(
                    draft => draft.id === workspaceRef.current.activeId,
                );
                if (
                    revisionsRequestRef.current === requestId &&
                    currentDraft?.serverId === documentId
                )
                    setDocumentRevisions(
                        [...next].sort((left, right) => right.revision - left.revision),
                    );
            } catch (caught) {
                if (revisionsRequestRef.current === requestId) setRevisionError(message(caught));
            } finally {
                if (revisionsRequestRef.current === requestId) setRevisionLoading(false);
            }
        },
        [activeServerId, workspaceRef],
    );

    useEffect(() => {
        const stopHistoryPolling = startVisiblePolling(signal => loadHistory(signal), {
            intervalMs: 15000,
        });
        void loadDocuments().catch(() => undefined);
        if (trusted) void loadSchema();
        return () => {
            stopHistoryPolling();
            invalidateRequests();
        };
    }, [invalidateRequests, loadDocuments, loadHistory, loadSchema, trusted]);

    return {
        functions,
        pythonFunctions,
        tablePermissions,
        schema,
        schemaLoading,
        schemaError,
        serverVersion:
            connectionId === PLAYGROUND_CONNECTION_ID ? playgroundServerVersion : undefined,
        serverVersionLoading:
            connectionId === PLAYGROUND_CONNECTION_ID && playgroundServerVersionLoading,
        documents,
        setDocuments,
        documentsLoaded,
        documentsReadError,
        documentsError,
        historyError,
        documentRevisions,
        revisionsDocumentId,
        revisionLoading,
        revisionError,
        history,
        loadHistory,
        loadDocuments,
        loadDocumentRevisions,
        loadSchema,
        schemaLoadingMore,
        loadMoreSchema,
    };
}
