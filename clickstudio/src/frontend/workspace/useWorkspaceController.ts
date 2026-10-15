import {
    createDocumentFailureReporter,
    createRevisionRestorer,
} from '../queries/saved-queries/workspace-document-actions';
import { createQueryEvidenceActions } from '../queries/inspection/evidence-actions';
import { createQueryExportActions } from '../queries/results/export-actions';
import { useWorkspaceUiState } from './layout/useWorkspaceUiState';
import type { SqlExample } from '../help/examples/sql-examples';
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type Dispatch,
    type SetStateAction,
} from 'react';
import type { NativeParserStatus, NativeParseSnapshot } from '../../shared/sql/parser';
import { recommendChart } from '../../shared/queries/results/results';
import { parameterNames, type SqlParameter } from '../../shared/sql/sql';
import type { QueryDocument } from '../../shared/queries/saved-queries/types';
import type { Run, Script } from '../../shared/queries/execution/types';
import { apiResponses, message, post } from '../api/client';
import type { EditorHandle } from '../queries/editor/components/SqlEditor';
import { terminal } from '../queries/execution/status';
import type { Copy, ExperienceLevel } from '../ui/copy';
import { PLAYGROUND_CONNECTION_ID } from '../database/connections/playground-client';
import { sqlExamplesFor } from '../help/examples/sql-examples';
import {
    isSchemaChangingSql,
    useImportedTableReveal,
} from '../database/tables/useImportedTableReveal';
import { usePendingExecution } from '../queries/execution/usePendingExecution';
import { useResultSnapshot } from '../queries/execution/useResultSnapshot';
import { useRunEvidence } from '../queries/execution/useRunEvidence';
import { useScopedValue } from '../browser/useScopedValue';
import { useScriptExecution } from '../queries/execution/useScriptExecution';
import {
    useDefaultAssistantRunContext,
    useWorkspaceAssistant,
} from '../assistant/proposals/useWorkspaceAssistant';
import { useWorkspaceData } from './useWorkspaceData';
import { useWorkspacePanels } from './layout/panels/useWorkspacePanels';
import { useWorkspacePersistence } from '../queries/editor/drafts/useWorkspacePersistence';
import { useWorkspaceTabs } from '../queries/editor/tabs/useWorkspaceTabs';
import {
    initialWorkspaceState,
    workspaceStateKey,
} from '../queries/editor/drafts/workspace-initial-state';
import type { WorkspaceState } from '../queries/editor/drafts/workspace-state';
import { draftFromDocument, type Draft } from '../queries/editor/drafts/workspace-state';
import type {
    BusyAction,
    Connected,
    Inspector,
    ResultsView,
    WorkspaceActionRef,
    WorkspaceRunCapability,
    WorkspaceRunCapabilityAction,
} from './workspace-types';
import { useDetachedQueryEditor } from './layout/windows/useDetachedQueryEditor';
import { useWorkspaceDocumentSave } from '../queries/saved-queries/useWorkspaceDocumentSave';
import { useWorkspaceExecution } from '../queries/execution/useWorkspaceExecution';
import type { useWorkspaceNotifications } from './layout/notifications/useWorkspaceNotifications';
import { type WorkspaceFeedback } from './layout/notifications/useWorkspaceNotifications';
import { useWorkspaceSqlFormatter } from '../queries/editor/useWorkspaceSqlFormatter';
import { useWorkspaceViewState } from './layout/useWorkspaceViewState';
import { canOpenInspector } from './layout/panels/inspector-navigation';

export type WorkspaceProps = Readonly<{
    connection: Connected;
    connectionLabel: string;
    connections: readonly Connected[];
    onSelectConnection: (id: Connected['id']) => void;
    onRefreshConnections: () => Promise<void>;
    onDatabaseDeleted: (database: string) => void;
    trustActionRef: WorkspaceActionRef;
    testConnectionActionRef: WorkspaceActionRef;
    demoMode: boolean;
    experience: ExperienceLevel;
    dark: boolean;
    copy: Copy;
}>;

function workspaceWithUpdatedDraft(
    state: WorkspaceState,
    id: string,
    change: (draft: Draft) => Draft,
): WorkspaceState {
    return { ...state, tabs: state.tabs.map(draft => (draft.id === id ? change(draft) : draft)) };
}

type WorkspaceRunActionTitleContext = Readonly<{
    trusted: boolean;
    busy: BusyAction;
    unsupportedParameters: boolean;
    connection: Connected;
    copy: Copy['common'];
}>;

function workspaceRunActionTitle(
    capability: WorkspaceRunCapability | undefined,
    action: WorkspaceRunCapabilityAction,
    { trusted, busy, unsupportedParameters, connection, copy }: WorkspaceRunActionTitleContext,
) {
    if (!trusted) return copy.runActionTrustRequired;
    if (busy) return copy.runActionWait;
    if (unsupportedParameters) return copy.runActionRemoveParameters;
    if (capability?.available === false) {
        if (action === 'script' && connection.id === PLAYGROUND_CONNECTION_ID)
            return copy.playgroundScriptUnavailable;
        return capability.reason;
    }
    if (action === 'explain-analyze') return copy.runtimeExecutesQuery;
    return undefined;
}

function useSchemaRefreshAfterDdl(
    run: Run | undefined,
    connectionId: string,
    refreshAfterRun: (draftId: string, runId: string, baseline?: ReadonlySet<string>) => void,
) {
    const pending = useRef(new Map<string, { draftId: string; baseline?: ReadonlySet<string> }>());
    const track = useCallback((runId: string, draftId: string, baseline?: ReadonlySet<string>) => {
        pending.current.set(runId, { draftId, baseline });
    }, []);
    useEffect(() => {
        if (!run || run.connectionId !== connectionId || !terminal(run)) return;
        const refresh = pending.current.get(run.id);
        if (!refresh) return;
        pending.current.delete(run.id);
        if (run.status === 'succeeded' && isSchemaChangingSql(run.sql))
            refreshAfterRun(refresh.draftId, run.id, refresh.baseline);
    }, [connectionId, refreshAfterRun, run]);
    return track;
}

function createWorkspaceConnectionActions({
    connection,
    connectionLabel,
    trusted,
    demoMode,
    onRefreshConnections,
    perform,
    setError,
}: {
    connection: Connected;
    connectionLabel: string;
    trusted: boolean;
    demoMode: boolean;
    onRefreshConnections: WorkspaceProps['onRefreshConnections'];
    perform: ReturnType<typeof useWorkspaceExecutionView>['perform'];
    setError: ReturnType<typeof useWorkspaceUiState>['setError'];
}) {
    const trustConnection = () =>
        perform(
            async () => {
                if (
                    !trusted &&
                    !demoMode &&
                    !window.confirm(
                        `Check these connection details before continuing:\n\nConnection: ${connectionLabel}\nServer: ${connection.host}\nDatabase: ${connection.database}\nUser: ${connection.username}\nAccess: read-only\n\nAllow read-only access so you can run queries?`,
                    )
                )
                    return;
                await post(
                    `/connections/${encodeURIComponent(connection.id)}/trust`,
                    {
                        trusted: !trusted,
                        confirmation: connection.id,
                    },
                    apiResponses.isUnknown,
                );
                await onRefreshConnections();
            },
            'save',
            caught =>
                setError('Couldn’t update connection access. Check its details and try again.', {
                    detail: message(caught),
                }),
        );
    const testConnection = () =>
        perform(
            async () => {
                await post(
                    `/connections/${encodeURIComponent(connection.id)}/test`,
                    {},
                    apiResponses.isConnected,
                );
                await onRefreshConnections();
            },
            'save',
            caught =>
                setError('Couldn’t test the connection. Check its details and try again.', {
                    detail: message(caught),
                }),
        );
    return { trustConnection, testConnection };
}

function useWorkspacePanelEffects({
    active,
    inspector,
    loadDocumentRevisions,
    experience,
    setCompactViewport,
    setDrawerOpen,
}: {
    active: Draft;
    inspector: Inspector;
    loadDocumentRevisions: ReturnType<typeof useWorkspaceData>['loadDocumentRevisions'];
    experience: ExperienceLevel;
    setCompactViewport: ReturnType<typeof useWorkspaceUiState>['setCompactViewport'];
    setDrawerOpen: ReturnType<typeof useWorkspaceUiState>['setDrawerOpen'];
}) {
    useEffect(() => {
        if (inspector === 'revisions') void loadDocumentRevisions(active.serverId);
    }, [active.serverId, inspector, loadDocumentRevisions]);

    useEffect(() => {
        const media = window.matchMedia('(max-width: 850px)');
        const update = () => {
            setCompactViewport(media.matches);
            setDrawerOpen(experience === 'expert' && !media.matches);
        };
        update();
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, [experience, setCompactViewport, setDrawerOpen]);
}

function useWorkspaceDraftActions({
    active,
    setWorkspace,
    workspaceRef,
    clearDraftFeedbackInfo,
}: {
    active: Draft;
    setWorkspace: Dispatch<SetStateAction<WorkspaceState>>;
    workspaceRef: { current: WorkspaceState };
    clearDraftFeedbackInfo: ReturnType<typeof useWorkspaceUiState>['clearDraftFeedbackInfo'];
}) {
    const update = useCallback(
        (id: string, change: (draft: Draft) => Draft) =>
            setWorkspace(current => workspaceWithUpdatedDraft(current, id, change)),
        [setWorkspace],
    );
    const clearUnavailableRun = useCallback(
        (runId: string) =>
            update(active.id, draft =>
                draft.activeRunId === runId ? { ...draft, activeRunId: undefined } : draft,
            ),
        [active.id, update],
    );
    const patch = useCallback(
        (values: Partial<Draft>) => {
            const draft = workspaceRef.current.tabs.find(item => item.id === active.id);
            const contentChanged = Object.entries(values).some(([key, value]) => {
                if (key === 'from' || key === 'to') return false;
                const existing = Object.entries(draft ?? {}).find(([field]) => field === key)?.[1];
                return value !== existing;
            });
            update(active.id, draft => ({ ...draft, ...values }));
            if (contentChanged) clearDraftFeedbackInfo(active.id);
        },
        [active.id, update, clearDraftFeedbackInfo, workspaceRef],
    );
    return { update, clearUnavailableRun, patch };
}

export function useWorkspaceController({
    connection,
    connectionLabel,
    connections,
    onSelectConnection,
    onRefreshConnections,
    trustActionRef,
    testConnectionActionRef,
    demoMode,
    experience,
    copy,
}: WorkspaceProps) {
    const key = workspaceStateKey(connection.id);
    const [workspace, setWorkspace] = useState(() => initialWorkspaceState(connection.id));
    const workspaceRef = useRef(workspace);
    workspaceRef.current = workspace;
    const tabs = useWorkspaceTabs(workspace, setWorkspace);
    const { active, finishTabRename: updateTabRename } = tabs;
    const emptySqlActionRef = useFocusEmptySqlAction(workspace.tabs.length);
    const activeRunId = active.activeRunId;
    const activeRunIdRef = useRef(activeRunId);
    activeRunIdRef.current = activeRunId;
    const editor = useRef<EditorHandle>(null);
    const [nativeParserStatus, setNativeParserStatus] = useState<NativeParserStatus>('loading');
    const [nativeParseSnapshot, setNativeParseSnapshot] = useState<NativeParseSnapshot>();
    const [savingDraftIds, setSavingDraftIds] = useState<Record<string, boolean>>({});
    const [scripts, setScripts] = useState<Record<string, Script>>({});
    const script = active.scriptId ? scripts[active.scriptId] : undefined;
    const [draftView, setViewForDraft, , updateViewForDraft] = useScopedValue<ResultsView>(
        active.id,
    );
    const view = draftView ?? 'results';
    const [selectedScriptResult, setSelectedScriptResult] = useScopedValue<string>(active.id);
    const setView = useCallback<Dispatch<SetStateAction<ResultsView>>>(
        next => {
            updateViewForDraft(
                active.id,
                current => (typeof next === 'function' ? next(current ?? 'results') : next),
                true,
            );
        },
        [active.id, updateViewForDraft],
    );
    const [exampleChartRunId, setExampleChartRunId] = useState<string>();
    const ui = useWorkspaceUiState({ experience, active });
    const {
        busy,
        setError,
        clearToast,
        beginDraftFeedback,
        clearDraftFeedbackInfo,
        setSearch,
        setInspector,
        setDrawerOpen,
        inspector,
        setCompactViewport,
        inspectorRef,
        setRestoreRevisionConfirmation,
        drawerOpen,
    } = ui;

    useDismissVisibleDraftToast(active.id, clearToast);

    const storageError = useWorkspacePersistence(key, workspace);
    const parameters = useMemo(() => {
        try {
            return parameterNames(active.sql);
        } catch {
            return [];
        }
    }, [active.sql]);
    const unsupportedParameters =
        parameters.length > 0 && connection.manifest?.parameters.available === false;
    const currentConnection = connections.find(item => item.id === connection.id) ?? connection;
    const trusted = currentConnection.trusted;
    const runActionTitle = createRunActionTitle({
        trusted,
        busy,
        unsupportedParameters,
        connection,
        copy: copy.common,
    });

    const assistant = useWorkspaceAssistant({
        active,
        activeRunId,
        connectionId: connection.id,
        trusted,
        workspaceRef,
        setWorkspace,
    });
    const { assistantBusy, includeRun, setIncludeRun } = assistant;
    const data = useWorkspaceData({
        connection,
        trusted,
        objectsOpen: drawerOpen && inspector === 'schema',
        activeServerId: active.serverId,
        setWorkspace,
        workspaceRef,
    });
    const { schema, setDocuments, loadHistory, loadDocumentRevisions, loadSchema } = data;
    const importedReveal = useImportedTableReveal({
        connectionId: connection.id,
        demoMode,
        canRevealSqlTables: connection.dataSource === 'clickhouse' && connection.readonly === false,
        loadSchema,
        setSearch,
        setInspector,
        setDrawerOpen,
        openInspectorDrawer: experience === 'expert',
    });
    const sqlExamples = useMemo(() => sqlExamplesFor(connection, schema), [connection, schema]);
    useWorkspacePanelEffects({
        active,
        inspector,
        loadDocumentRevisions,
        experience,
        setCompactViewport,
        setDrawerOpen,
    });
    const { update, clearUnavailableRun, patch } = useWorkspaceDraftActions({
        active,
        setWorkspace,
        workspaceRef,
        clearDraftFeedbackInfo,
    });
    const formatActiveSql = useWorkspaceSqlFormatter(
        active,
        editor,
        nativeParserStatus,
        Boolean(assistant.editorProposal),
    );

    const evidence = useRunEvidence({
        activeRunId,
        connectionId: connection.id,
        loadHistory,
        onRunUnavailable: clearUnavailableRun,
    });
    const { run, snapshot, setSnapshotForRun, setAssetReadFeedback } = evidence;
    const trackSchemaRefresh = useSchemaRefreshAfterDdl(
        run,
        connection.id,
        importedReveal.refreshAfterImportedSqlRun,
    );
    const selectableRunId = run && terminal(run) ? run.id : undefined;
    useDefaultAssistantRunContext(selectableRunId, includeRun, assistantBusy, setIncludeRun);
    const pendingExecution = usePendingExecution({ activeDraftId: active.id, busy, run, script });
    const [scriptReadFeedback, reportScriptReadError] = useScriptReadFeedback(active.scriptId);
    const scriptFollowRef = useScriptExecution({
        scriptId: active.scriptId,
        draftId: active.id,
        updateDraft: update,
        setScripts,
        loadHistory,
        setReadError: reportScriptReadError,
        onComplete: importedReveal.refreshAfterImportedSqlScript,
    });

    const executionView = useWorkspaceExecutionView({
        active,
        reviewingSql: Boolean(assistant.editorProposal),
        connection,
        savingDraftIds,
        script,
        selectedScriptResult,
        copy,
        experience,
        view,
        trusted,
        unsupportedParameters,
        nativeParseSnapshot,
        pendingExecution,
        editor,
        demoMode,
        onSelectConnection,
        workspaceRef,
        setWorkspace,
        update,
        evidence,
        importedReveal,
        setScripts,
        scriptFollowRef,
        trackSchemaRefresh,
        setExampleChartRunId,
        setViewForDraft,
        data,
        ui,
    });
    const { perform, addDraft } = executionView;

    const reportDocumentFailure = createDocumentFailureReporter({
        workspaceRef,
        setWorkspace,
        setError,
        panels: executionView.panels,
    });

    const { saveDraft, finishTabRename, restoreDocumentRevision } = useWorkspaceDocumentActions({
        active,
        reviewingSql: Boolean(assistant.editorProposal),
        busy,
        connectionId: connection.id,
        workspaceRef,
        inspectorRef,
        perform,
        updateDraft: update,
        setSavingDraftIds,
        setDocuments,
        loadDocumentRevisions,
        beginDraftFeedback,
        clearToast,
        update,
        updateTabRename,
        setRestoreRevisionConfirmation,
        data,
        reportDocumentFailure,
    });

    useWorkspaceSnapshotState({
        active,
        activeRunId,
        activeRunIdRef,
        exampleChartRunId,
        setExampleChartRunId,
        run,
        snapshot,
        setSnapshotForRun,
        setAssetReadFeedback,
        patch,
        view,
        workspaceRef,
    });

    const evidenceActions = createQueryEvidenceActions({
        activeRunId,
        connection,
        activeRunIdRef,
        evidence,
    });
    const queryExports = createQueryExportActions({ setError, active, evidence });
    const resultActions = { ...evidenceActions, ...queryExports };
    const { loadProfile } = evidenceActions;

    const showInspector = (next: Inspector) => {
        if (!canOpenInspector(next, experience === 'expert')) return;
        setInspector(next);
        setDrawerOpen(true);
        if (next === 'profile') void perform(loadProfile, 'save');
    };

    const { trustConnection, testConnection } = createWorkspaceConnectionActions({
        connection,
        connectionLabel,
        trusted,
        demoMode,
        onRefreshConnections,
        perform,
        setError,
    });
    trustActionRef.current = trustConnection;
    testConnectionActionRef.current = testConnection;

    const openDocument = (document: QueryDocument) => {
        addDraft(draftFromDocument(document));
    };
    return createWorkspaceControllerModel({
        tabs,
        assistant,
        data,
        evidence,
        showInspector,
        importedReveal,
        editor,
        setWorkspace,
        openDocument,
        setView,
        trusted,
        restoreDocumentRevision,
        selectableRunId,
        nativeParserStatus,
        nativeParseSnapshot,
        unsupportedParameters,
        parameters,
        pendingExecution,
        patch,
        saveDraft,
        formatActiveSql,
        runActionTitle,
        setNativeParserStatus,
        setNativeParseSnapshot,
        script,
        setSelectedScriptResult,
        scriptFollowRef,
        scriptReadFeedback,
        update,
        inspectorDocked: drawerOpen,
        storageError,
        workspace,
        savingDraftIds,
        finishTabRename,
        sqlExamples,
        workspaceRef,
        emptySqlActionRef,
        ui,
        executionView,
        resultActions,
    });
}

function useFocusEmptySqlAction(tabCount: number) {
    const emptySqlActionRef = useRef<HTMLButtonElement>(null);
    const previousTabCount = useRef(tabCount);
    useEffect(() => {
        const closedLastTab = previousTabCount.current > 0 && tabCount === 0;
        previousTabCount.current = tabCount;
        if (!closedLastTab) return;
        const frame = window.requestAnimationFrame(() => emptySqlActionRef.current?.focus());
        return () => window.cancelAnimationFrame(frame);
    }, [tabCount]);
    return emptySqlActionRef;
}

function useWorkspaceDocumentActions({
    active,
    busy,
    reviewingSql,
    connectionId,
    workspaceRef,
    inspectorRef,
    perform,
    updateDraft,
    setSavingDraftIds,
    setDocuments,
    beginDraftFeedback,
    clearToast,
    loadDocumentRevisions,
    update,
    updateTabRename,
    setRestoreRevisionConfirmation,
    data,
    reportDocumentFailure,
}: Omit<Parameters<typeof useWorkspaceDocumentSave>[0], 'onFailure'> & {
    update: (id: string, change: (draft: Draft) => Draft) => void;
    updateTabRename: ReturnType<typeof useWorkspaceTabs>['finishTabRename'];
    setRestoreRevisionConfirmation: ReturnType<
        typeof useWorkspaceUiState
    >['setRestoreRevisionConfirmation'];
    data: ReturnType<typeof useWorkspaceData>;
    reportDocumentFailure: ReturnType<typeof createDocumentFailureReporter>;
}) {
    const saveDraft = useWorkspaceDocumentSave({
        active,
        reviewingSql,
        busy,
        connectionId,
        workspaceRef,
        inspectorRef,
        perform,
        updateDraft,
        setSavingDraftIds,
        setDocuments,
        loadDocumentRevisions,
        beginDraftFeedback,
        clearToast,
        onFailure: (draft, caught, complete) =>
            reportDocumentFailure(draft, 'save', caught, complete),
    });
    const finishTabRename = (
        id: string,
        value: string,
        restoreFocus = false,
        saveAfterRename = true,
    ) => {
        const renamedDraft = updateTabRename(id, value, restoreFocus);
        if (saveAfterRename && renamedDraft) void saveDraft(renamedDraft);
    };
    const restoreDocumentRevision = createRevisionRestorer({
        perform,
        workspaceRef,
        setRestoreRevisionConfirmation,
        update,
        data,
        beginDraftFeedback,
        clearToast,
        reportDocumentFailure,
    });
    return { saveDraft, finishTabRename, restoreDocumentRevision };
}

function useWorkspaceSnapshotState({
    active,
    activeRunId,
    activeRunIdRef,
    exampleChartRunId,
    setExampleChartRunId,
    run,
    snapshot,
    setSnapshotForRun,
    setAssetReadFeedback,
    patch,
    view,
    workspaceRef,
}: {
    active: Draft;
    activeRunId: string | undefined;
    activeRunIdRef: { current: string | undefined };
    exampleChartRunId: string | undefined;
    setExampleChartRunId: Dispatch<SetStateAction<string | undefined>>;
    run: Run | undefined;
    snapshot: ReturnType<typeof useRunEvidence>['snapshot'];
    setSnapshotForRun: ReturnType<typeof useRunEvidence>['setSnapshotForRun'];
    setAssetReadFeedback: ReturnType<typeof useRunEvidence>['setAssetReadFeedback'];
    patch: (values: Partial<Draft>) => void;
    view: ResultsView;
    workspaceRef: { current: WorkspaceState };
}) {
    const loadSnapshot = useResultSnapshot({
        activeRunId,
        run,
        snapshot,
        setSnapshotForRun,
        onSnapshot: (runId, full) => {
            setAssetReadFeedback(runId, undefined);
            if (activeRunIdRef.current !== runId || workspaceRef.current.activeId !== active.id)
                return;
            const suggestion = recommendChart(full.columns, full.rows);
            if (active.chart.kind === 'table' && suggestion.config.kind !== 'table')
                patch({ chart: suggestion.config });
        },
    });
    const reportSnapshotFailure = useSnapshotReadFailure(loadSnapshot, setAssetReadFeedback);

    useEffect(() => {
        if (
            !exampleChartRunId ||
            exampleChartRunId !== activeRunId ||
            run?.id !== exampleChartRunId ||
            !terminal(run)
        )
            return;
        if (snapshot?.runId === exampleChartRunId || run.resultState !== 'reopenable') {
            setExampleChartRunId(undefined);
            return;
        }
        void loadSnapshot()
            .catch(caught => reportSnapshotFailure(exampleChartRunId, caught))
            .finally(() => {
                setExampleChartRunId(current =>
                    current === exampleChartRunId ? undefined : current,
                );
            });
    }, [
        activeRunId,
        exampleChartRunId,
        loadSnapshot,
        run,
        reportSnapshotFailure,
        setExampleChartRunId,
        snapshot?.runId,
    ]);

    useEffect(() => {
        if (
            !run ||
            !['chart', 'indexes', 'plan', 'pipeline', 'runtime'].includes(view) ||
            !terminal(run) ||
            run.resultState !== 'reopenable' ||
            snapshot?.runId === run.id
        )
            return;
        void loadSnapshot().catch(caught => reportSnapshotFailure(run.id, caught));
    }, [loadSnapshot, run, reportSnapshotFailure, snapshot?.runId, view]);
}

function useDismissVisibleDraftToast(
    draftId: string,
    clearToast: ReturnType<typeof useWorkspaceNotifications>['clearToast'],
) {
    useEffect(() => {
        clearToast(`draft:${draftId}:save`);
        clearToast(`draft:${draftId}:restore`);
        clearToast(`query:${draftId}`);
    }, [draftId, clearToast]);
}

function createRunActionTitle(options: Parameters<typeof workspaceRunActionTitle>[2]) {
    return (capability: WorkspaceRunCapability | undefined, action: WorkspaceRunCapabilityAction) =>
        workspaceRunActionTitle(capability, action, options);
}

function useSnapshotReadFailure(
    loadSnapshot: ReturnType<typeof useResultSnapshot>,
    setAssetReadFeedback: ReturnType<typeof useRunEvidence>['setAssetReadFeedback'],
) {
    const reportSnapshotFailure = useCallback(
        function report(runId: string, caught: unknown) {
            setAssetReadFeedback(runId, {
                tone: 'error',
                message: 'Couldn’t load the result data. Try again.',
                detail: message(caught),
                retry: () => void loadSnapshot().catch(next => report(runId, next)),
            });
        },
        [loadSnapshot, setAssetReadFeedback],
    );

    return reportSnapshotFailure;
}

function useScriptReadFeedback(scriptId?: string) {
    const [scriptReadFeedback, setScriptReadFeedback] = useScopedValue<
        WorkspaceFeedback | undefined
    >(scriptId);
    const reportScriptReadError = useCallback(
        (detail: string) => {
            if (!scriptId) return;
            setScriptReadFeedback(
                scriptId,
                detail
                    ? {
                          tone: 'warning',
                          message: 'Couldn’t refresh the script status. Retrying…',
                          detail,
                      }
                    : undefined,
            );
        },
        [scriptId, setScriptReadFeedback],
    );
    return [scriptReadFeedback, reportScriptReadError] as const;
}

function useWorkspaceExecutionView({
    active,
    reviewingSql,
    connection,
    savingDraftIds,
    script,
    selectedScriptResult,
    copy,
    experience,
    view,
    trusted,
    unsupportedParameters,
    nativeParseSnapshot,
    pendingExecution,
    editor,
    demoMode,
    onSelectConnection,
    workspaceRef,
    setWorkspace,
    update,
    evidence,
    importedReveal,
    setScripts,
    scriptFollowRef,
    trackSchemaRefresh,
    setExampleChartRunId,
    setViewForDraft,
    data,
    ui,
}: {
    active: ReturnType<typeof useWorkspaceTabs>['active'];
    reviewingSql: boolean;
    connection: WorkspaceProps['connection'];
    savingDraftIds: Record<string, boolean>;
    script: Script | undefined;
    selectedScriptResult: string | undefined;
    copy: WorkspaceProps['copy'];
    experience: WorkspaceProps['experience'];
    view: ResultsView;
    trusted: boolean;
    unsupportedParameters: boolean;
    nativeParseSnapshot: NativeParseSnapshot | undefined;
    pendingExecution: ReturnType<typeof usePendingExecution>;
    editor: import('react').RefObject<EditorHandle | null>;
    demoMode: WorkspaceProps['demoMode'];
    onSelectConnection: WorkspaceProps['onSelectConnection'];
    workspaceRef: import('react').RefObject<WorkspaceState>;
    setWorkspace: import('react').Dispatch<import('react').SetStateAction<WorkspaceState>>;
    update: (id: string, change: (draft: Draft) => Draft) => void;
    evidence: ReturnType<typeof useRunEvidence>;
    importedReveal: ReturnType<typeof useImportedTableReveal>;
    setScripts: import('react').Dispatch<import('react').SetStateAction<Record<string, Script>>>;
    scriptFollowRef: ReturnType<typeof useScriptExecution>;
    trackSchemaRefresh: ReturnType<typeof useSchemaRefreshAfterDdl>;
    setExampleChartRunId: import('react').Dispatch<
        import('react').SetStateAction<string | undefined>
    >;
    setViewForDraft: ReturnType<typeof useScopedValue<ResultsView>>[1];
    data: ReturnType<typeof useWorkspaceData>;
    ui: ReturnType<typeof useWorkspaceUiState>;
}) {
    const { documents, documentsLoaded, documentsReadError, history, loadHistory } = data;
    const { run, snapshot } = evidence;
    const {
        failedQueryError,
        compactViewport,
        setError,
        busy,
        setBusy,
        setCancelling,
        clearFailedQueryError,
        storeFailedQueryError,
    } = ui;

    const viewState = useWorkspaceViewState({
        active,
        connection,
        documents,
        documentsLoaded,
        documentsReadError,
        savingDraftIds,
        history,
        run,
        failedQueryError,
        script,
        scriptResultSelected: selectedScriptResult === `${script?.id}:${active.activeRunId}`,
        copy,
        experience,
        view,
        trusted,
        unsupportedParameters,
        nativeParseSnapshot,
        snapshot,
    });

    const {
        sortedHistory,
        savedDocument,
        saveStatus,
        sqlMapStatement,
        queryTreeAvailable,
        queryTreeUnavailableReason,
        sqlMapParseStatement,
        visibleResultsView,
    } = viewState;

    const outputVisible = Boolean(
        active.activeRunId ||
        run ||
        failedQueryError ||
        script ||
        pendingExecution.execution ||
        visibleResultsView === 'sqlmap',
    );
    const panels = useWorkspacePanels({
        activeDraftId: active.id,
        canCollapse: experience === 'expert',
        compactViewport,
        hasOutput: outputVisible,
    });
    const detachedEditor = useDetachedQueryEditor({
        activeDraftId: active.id,
        activeName: active.name,
        experience,
        panels,
        editorRef: editor,
        setError,
    });

    const {
        perform,
        execute,
        runExample,
        cancel,
        openRun,
        openNewDraft,
        openSqlDraft,
        startBlankSql,
        addDraft,
    } = useWorkspaceExecution({
        active,
        reviewingSql,
        connection,
        trusted,
        experience,
        demoMode,
        copy,
        onSelectConnection,
        workspaceRef,
        setWorkspace,
        editor,
        update,
        panels,
        evidence,
        importedReveal,
        pendingExecution,
        script,
        setScripts,
        scriptFollowRef,
        trackSchemaRefresh,
        loadHistory,
        busy,
        setBusy,
        setCancelling,
        setExampleChartRunId,
        setError,
        clearFailedQueryError,
        storeFailedQueryError,
        setViewForDraft,
    });

    return {
        perform,
        addDraft,
        sortedHistory,
        savedDocument,
        saveStatus,
        openSqlDraft,
        openRun,
        execute,
        cancel,
        detachedEditor,
        panels,
        viewState,
        sqlMapStatement,
        sqlMapParseStatement,
        queryTreeAvailable,
        queryTreeUnavailableReason,
        openNewDraft,
        runExample,
        startBlankSql,
        outputVisible,
        visibleResultsView,
    };
}

function createWorkspaceControllerModel({
    tabs,
    assistant,
    data,
    evidence,
    showInspector,
    importedReveal,
    editor,
    setWorkspace,
    openDocument,
    setView,
    trusted,
    restoreDocumentRevision,
    selectableRunId,
    nativeParserStatus,
    nativeParseSnapshot,
    unsupportedParameters,
    parameters,
    pendingExecution,
    patch,
    saveDraft,
    formatActiveSql,
    runActionTitle,
    setNativeParserStatus,
    setNativeParseSnapshot,
    script,
    setSelectedScriptResult,
    scriptFollowRef,
    scriptReadFeedback,
    update,
    inspectorDocked,
    storageError,
    workspace,
    savingDraftIds,
    finishTabRename,
    sqlExamples,
    workspaceRef,
    emptySqlActionRef,
    ui,
    executionView,
    resultActions,
}: {
    tabs: ReturnType<typeof useWorkspaceTabs>;
    assistant: ReturnType<typeof useWorkspaceAssistant>;
    data: ReturnType<typeof useWorkspaceData>;
    evidence: ReturnType<typeof useRunEvidence>;
    showInspector: (next: Inspector) => void;
    importedReveal: ReturnType<typeof useImportedTableReveal>;
    editor: import('react').RefObject<EditorHandle | null>;
    setWorkspace: import('react').Dispatch<import('react').SetStateAction<WorkspaceState>>;
    openDocument: (document: QueryDocument) => void;
    setView: Dispatch<SetStateAction<ResultsView>>;
    trusted: boolean;
    restoreDocumentRevision: ReturnType<typeof createRevisionRestorer>;
    selectableRunId: string | undefined;
    nativeParserStatus: NativeParserStatus;
    nativeParseSnapshot: NativeParseSnapshot | undefined;
    unsupportedParameters: boolean;
    parameters: SqlParameter[];
    pendingExecution: ReturnType<typeof usePendingExecution>;
    patch: (values: Partial<Draft>) => void;
    saveDraft: ReturnType<typeof useWorkspaceDocumentSave>;
    formatActiveSql: ReturnType<typeof useWorkspaceSqlFormatter>;
    runActionTitle: (
        capability: WorkspaceRunCapability | undefined,
        action: WorkspaceRunCapabilityAction,
    ) => string | undefined;
    setNativeParserStatus: import('react').Dispatch<
        import('react').SetStateAction<NativeParserStatus>
    >;
    setNativeParseSnapshot: import('react').Dispatch<
        import('react').SetStateAction<NativeParseSnapshot | undefined>
    >;
    script: Script | undefined;
    setSelectedScriptResult: ReturnType<typeof useScopedValue<string>>[1];
    scriptFollowRef: ReturnType<typeof useScriptExecution>;
    scriptReadFeedback: WorkspaceFeedback | undefined;
    update: (id: string, change: (draft: Draft) => Draft) => void;
    inspectorDocked: boolean;
    storageError: ReturnType<typeof useWorkspacePersistence>;
    workspace: WorkspaceState;
    savingDraftIds: Record<string, boolean>;
    finishTabRename: (
        id: string,
        value: string,
        restoreFocus?: boolean,
        saveAfterRename?: boolean,
    ) => void;
    sqlExamples: SqlExample[];
    workspaceRef: import('react').RefObject<WorkspaceState>;
    emptySqlActionRef: import('react').RefObject<HTMLButtonElement | null>;
    ui: ReturnType<typeof useWorkspaceUiState>;
    executionView: ReturnType<typeof useWorkspaceExecutionView>;
    resultActions: ReturnType<typeof createQueryEvidenceActions> &
        ReturnType<typeof createQueryExportActions>;
}) {
    const {
        inspector,
        search,
        setSearch,
        busy,
        cancelling,
        failedQueryError,
        setError,
        toast,
        dismissToast,
        draftFeedback,
        drawerOpen,
        setImportOpen,
        setExportOpen,
        clearFailedQueryError,
        helpPanelOpen,
        helpPanelSection,
        setHelpPanelSection,
        closeHelpPanel,
        setObservabilityOpen,
        setDrawerOpen,
        observabilityOpen,
        importOpen,
        exportOpen,
        restoreRevisionConfirmation,
        setRestoreRevisionConfirmation,
        openHelp,
    } = ui;
    const {
        sortedHistory,
        savedDocument,
        saveStatus,
        openSqlDraft,
        openRun,
        perform,
        execute,
        cancel,
        detachedEditor,
        panels,
        viewState,
        sqlMapStatement,
        sqlMapParseStatement,
        queryTreeAvailable,
        queryTreeUnavailableReason,
        openNewDraft,
        runExample,
        startBlankSql,
        outputVisible,
        visibleResultsView,
    } = executionView;
    const { loadProfile, loadPipeline, loadFlamegraph, exportCurrentQuery, exportCurrentCsv } =
        resultActions;

    return {
        tabs,
        assistant,
        data,
        evidence,
        inspector,
        showInspector,
        search,
        setSearch,
        sortedHistory,
        savedDocument,
        saveStatus,
        importedReveal,
        editor,
        openSqlDraft,
        setWorkspace,
        openRun,
        openDocument,
        perform,
        loadProfile,
        loadPipeline,
        setView,
        trusted,
        restoreDocumentRevision,
        selectableRunId,
        nativeParserStatus,
        nativeParseSnapshot,
        execute,
        busy,
        unsupportedParameters,
        parameters,
        pendingExecution,
        cancelling,
        patch,
        saveDraft,
        formatActiveSql,
        cancel,
        runActionTitle,
        setNativeParserStatus,
        setNativeParseSnapshot,
        detachedEditor,
        panels,
        viewState,
        failedQueryError,
        script,
        setSelectedScriptResult,
        scriptFollowRef,
        scriptReadFeedback,
        update,
        loadFlamegraph,
        inspectorDocked,
        setError,
        toast,
        dismissToast,
        draftFeedback,
        storageError,
        drawerOpen,
        setImportOpen,
        setExportOpen,
        workspace,
        savingDraftIds,
        finishTabRename,
        clearFailedQueryError,
        helpPanelOpen,
        helpPanelSection,
        setHelpPanelSection,
        closeHelpPanel,
        setObservabilityOpen,
        sqlExamples,
        sqlMapStatement,
        sqlMapParseStatement,
        queryTreeAvailable,
        queryTreeUnavailableReason,
        openNewDraft,
        runExample,
        startBlankSql,
        workspaceRef,
        outputVisible,
        visibleResultsView,
        emptySqlActionRef,
        setDrawerOpen,
        observabilityOpen,
        importOpen,
        exportOpen,
        exportCurrentQuery,
        exportCurrentCsv,
        restoreRevisionConfirmation,
        setRestoreRevisionConfirmation,
        openHelp,
    };
}
