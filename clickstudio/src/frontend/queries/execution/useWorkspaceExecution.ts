import type { SqlDraftObserver, SqlDraftOpenOptions } from './sql-draft-observer';
import { useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import {
    parameterNames,
    selectedStatement,
    splitSql,
    SqlSyntaxError,
} from '../../../shared/sql/sql';
import type { Run, Script } from '../../../shared/queries/execution/types';
import type { RunKind } from '../../../shared/queries/execution/status';
import { DEFAULT_LIMITS } from '../../../shared/queries/execution/settings';
import { TABLE_PREVIEW_ROW_LIMIT } from '../../../shared/queries/execution/limits';
import { rememberRunIds } from '../saved-queries/draft-save-state';
import { api, apiResponses, message, post, RequestError } from '../../api/client';
import { SavedQueryUnavailableError } from '../../api/browser-workspace-api';
import type { EditorHandle } from '../editor/components/SqlEditor';
import { terminal } from './status';
import type { Copy, ExperienceLevel } from '../../ui/copy';
import type { SqlExample } from '../../help/examples/sql-examples';
import {
    isSchemaChangingSql,
    type useImportedTableReveal,
} from '../../database/tables/useImportedTableReveal';
import type { usePendingExecution } from './usePendingExecution';
import type { useRunEvidence } from './useRunEvidence';
import type { useScopedValue } from '../../browser/useScopedValue';
import type { useScriptExecution } from './useScriptExecution';
import type { useWorkspaceNotifications } from '../../workspace/layout/notifications/useWorkspaceNotifications';
import type { WorkspacePanelController } from '../../workspace/layout/panels/useWorkspacePanels';
import {
    apiErrorDetail,
    apiRequestId,
    type FailedQueryError,
} from '../../workspace/workspace-helpers';
import {
    MAX_TABS,
    newDraft,
    nextBlankQueryName,
    type Draft,
    type WorkspaceState,
} from '../editor/drafts/workspace-state';
import type { BusyAction, Connected, ResultsView } from '../../workspace/workspace-types';

type WorkspaceExecutionOptions = {
    active: Draft;
    connection: Connected;
    trusted: boolean;
    reviewingSql: boolean;
    experience: ExperienceLevel;
    demoMode: boolean;
    copy: Copy;
    onSelectConnection: (id: string) => void;
    workspaceRef: RefObject<WorkspaceState>;
    setWorkspace: Dispatch<SetStateAction<WorkspaceState>>;
    editor: RefObject<EditorHandle | null>;
    update: (id: string, change: (draft: Draft) => Draft) => void;
    panels: WorkspacePanelController;
    evidence: ReturnType<typeof useRunEvidence>;
    importedReveal: ReturnType<typeof useImportedTableReveal>;
    pendingExecution: ReturnType<typeof usePendingExecution>;
    script?: Script;
    setScripts: Dispatch<SetStateAction<Record<string, Script>>>;
    scriptFollowRef: ReturnType<typeof useScriptExecution>;
    trackSchemaRefresh: (runId: string, draftId: string, baseline?: ReadonlySet<string>) => void;
    loadHistory: () => Promise<void>;
    busy: BusyAction;
    setBusy: Dispatch<SetStateAction<BusyAction>>;
    setCancelling: Dispatch<SetStateAction<boolean>>;
    setExampleChartRunId: Dispatch<SetStateAction<string | undefined>>;
    setError: ReturnType<typeof useWorkspaceNotifications>['setError'];
    clearFailedQueryError: (draftId: string) => void;
    storeFailedQueryError: (failure: FailedQueryError) => void;
    setViewForDraft: ReturnType<typeof useScopedValue<ResultsView>>[1];
};

async function performWorkspaceTask(
    context: Pick<WorkspaceExecutionOptions, 'busy' | 'setBusy' | 'setError'>,
    task: () => Promise<void>,
    kind: BusyAction = 'save',
    onFailure?: (caught: unknown) => void,
) {
    if (context.busy) return;
    context.setBusy(kind);
    try {
        await task();
    } catch (caught) {
        if (onFailure) onFailure(caught);
        else context.setError(message(caught));
    } finally {
        context.setBusy('');
    }
}

export function createExampleDraft(example: SqlExample, copy: Copy['common']) {
    const name =
        example.category === 'schema'
            ? copy.examplePreviewTable.replace('{table}', example.name.replace(/^Preview /, ''))
            : example.name;
    const draft = newDraft(`${name}.sql`, example.sql);
    draft.chart = {
        ...example.chart,
        title: example.chart.title,
        ys: [...example.chart.ys],
        ...(example.chart.candlestick ? { candlestick: { ...example.chart.candlestick } } : {}),
    };
    return draft;
}

function activateMatchingPreviewDraft(
    tabs: readonly Draft[],
    name: string,
    sql: string,
    activate: (draftId: string) => void,
    runPreview: (draft: Draft) => void,
) {
    const existing = tabs.find(draft => draft.name === name && draft.sql === sql);
    if (!existing) return false;
    activate(existing.id);
    runPreview(existing);
    return true;
}

export function useWorkspaceExecution({
    active,
    connection,
    trusted,
    reviewingSql,
    experience,
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
}: WorkspaceExecutionOptions) {
    const executionInFlightRef = useRef(false);
    const cancellingRef = useRef(false);
    const { run, setRunForRun } = evidence;
    const perform = (
        task: () => Promise<void>,
        kind: BusyAction = 'save',
        onFailure?: (caught: unknown) => void,
    ) => performWorkspaceTask({ busy, setBusy, setError }, task, kind, onFailure);

    const performExecution = async (
        task: () => Promise<void>,
        kind: BusyAction = 'run',
        onFailure?: (caught: unknown) => void,
    ) => {
        if (executionInFlightRef.current) return;
        executionInFlightRef.current = true;
        try {
            await performWorkspaceTask({ busy, setBusy, setError }, task, kind, onFailure);
        } finally {
            executionInFlightRef.current = false;
        }
    };

    const addDraft = (draft: Draft) => {
        if (workspaceRef.current.tabs.length >= MAX_TABS) {
            setError(`${MAX_TABS} tabs open. Close one to create another.`, {
                tone: 'warning',
            });
            return false;
        }
        setWorkspace(current => ({
            ...current,
            tabs: [...current.tabs, draft],
            activeId: draft.id,
        }));
        return true;
    };
    const openNewDraft = (draft: Draft, revealQuery = false) => {
        if (!addDraft(draft)) return false;
        if (revealQuery) panels.revealPanelTemporarily('query', draft.id);
        return true;
    };
    const recordFailedQueryError = (failure: FailedQueryError) => {
        storeFailedQueryError(failure);
        setViewForDraft(failure.draftId, 'results', true);
        if (workspaceRef.current.activeId !== failure.draftId) {
            const draft = workspaceRef.current.tabs.find(item => item.id === failure.draftId);
            const name =
                draft?.name ??
                workspaceRef.current.closedTabs?.find(item => item.id === failure.draftId)?.name ??
                'Query';
            setError(`“${name}” failed.${draft ? ' Open the tab to see the error.' : ''}`, {
                context: `query:${failure.draftId}`,
                detail: failure.error.message,
                action: draft
                    ? {
                          label: 'Open tab',
                          onSelect: () => {
                              if (
                                  !workspaceRef.current.tabs.some(
                                      item => item.id === failure.draftId,
                                  )
                              )
                                  return;
                              setWorkspace(current => ({ ...current, activeId: failure.draftId }));
                              panels.revealPanelTemporarily('results', failure.draftId);
                          },
                      }
                    : undefined,
            });
            return;
        }
        panels.revealPanelTemporarily('results', failure.draftId);
    };

    const executeSqlForDraft = createDraftExecutor({
        performExecution,
        trusted,
        connection,
        importedReveal,
        experience,
        clearFailedQueryError,
        active,
        pendingExecution,
        recordFailedQueryError,
        scriptFollowRef,
        setScripts,
        update,
        setViewForDraft,
        setExampleChartRunId,
        trackSchemaRefresh,
        panels,
        loadHistory,
        evidence,
    });

    const runExample = (example: SqlExample, output: 'results' | 'chart' | 'geography') => {
        if (busy || executionInFlightRef.current) {
            setError(copy.common.runActionWait, { tone: 'warning' });
            return true;
        }
        if (!trusted) {
            setError(copy.common.runActionTrustRequired, { tone: 'warning' });
            return true;
        }
        const draft = createExampleDraft(example, copy.common);
        if (output === 'geography') draft.chart = { ...draft.chart, kind: 'geography' };
        if (!openNewDraft(draft, true)) return true;
        void executeSqlForDraft(draft, draft.sql, {
            view: output === 'geography' ? 'chart' : output,
            expandResults: true,
            trackChartRun: true,
        });
        return true;
    };

    const execute = (kind: RunKind = 'query', sqlOverride?: string) => {
        if (reviewingSql) return Promise.resolve();
        const editorSnapshot = editor.current?.snapshot() ?? {
            sql: active.sql,
            from: active.from,
            to: active.to,
        };
        const selection =
            editorSnapshot.to > editorSnapshot.from
                ? {
                      sql: editorSnapshot.sql.slice(editorSnapshot.from, editorSnapshot.to),
                      from: editorSnapshot.from,
                      to: editorSnapshot.to,
                  }
                : undefined;
        let sql = sqlOverride ?? selection?.sql ?? editorSnapshot.sql;
        let sourceRange = sqlOverride === undefined ? selection : undefined;
        if (kind !== 'query' && sqlOverride === undefined && !selection) {
            try {
                const selected = selectedStatement(editorSnapshot.sql, editorSnapshot.from);
                sql = selected?.sql ?? '';
                sourceRange = selected;
            } catch {
                sql = editorSnapshot.sql;
            }
        }
        return executeSqlForDraft(active, sql, { kind, sourceRange, draftSql: editorSnapshot.sql });
    };

    const cancel = async () => {
        if (cancellingRef.current) return;
        const scriptId = script?.status === 'running' ? script.id : undefined;
        const runId = !scriptId && run && !terminal(run) ? run.id : undefined;
        if (!scriptId && !runId) return;
        cancellingRef.current = true;
        setCancelling(true);
        try {
            if (scriptId) {
                const cancelled = await post(
                    `/scripts/${encodeURIComponent(scriptId)}/cancel`,
                    {},
                    apiResponses.isScriptResponse,
                );
                setScripts(current => ({ ...current, [cancelled.id]: cancelled }));
            } else if (runId) {
                setRunForRun(
                    runId,
                    await post(
                        `/runs/${encodeURIComponent(runId)}/cancel`,
                        {},
                        apiResponses.isRunResponse,
                    ),
                );
            }
        } catch (caught) {
            setError('Couldn’t confirm cancellation. Check the query status.', {
                tone: 'warning',
                detail: message(caught),
            });
        } finally {
            cancellingRef.current = false;
            setCancelling(false);
        }
    };

    const openRun = (selected: Run) => {
        if (selected.connectionId !== connection.id) {
            onSelectConnection(selected.connectionId);
            return;
        }
        const draft = newDraft(
            `${selected.kind === 'query' ? 'Query' : selected.kind.toUpperCase()} ${new Date(selected.createdAt).toLocaleTimeString()}.sql`,
            selected.sql,
        );
        draft.parameters = selected.parameters;
        draft.activeRunId = selected.id;
        draft.runIds = [selected.id];
        if (!addDraft(draft)) return;
        const getSelectedView = (): ResultsView => {
            switch (selected.kind) {
                case 'plan':
                    return 'plan';

                case 'pipeline':
                    return 'pipeline';

                case 'analyze':
                    return 'runtime';

                default:
                    return 'results';
            }
        };
        setViewForDraft(draft.id, getSelectedView(), true);
        panels.revealPanelTemporarily('results', draft.id);
    };

    const openSqlDraft = (
        name: string,
        sql: string,
        run: boolean,
        reuseExisting = false,
        observer?: SqlDraftObserver,
        openOptions: SqlDraftOpenOptions = {},
    ) => {
        if (run && (busy || executionInFlightRef.current)) {
            setError(copy.common.runActionWait, { tone: 'warning' });
            return;
        }
        if (run && !trusted) {
            setError(copy.common.runActionTrustRequired, { tone: 'warning' });
            return;
        }
        let reusedDraft: { draftId: string } | undefined;
        if (
            run &&
            reuseExisting &&
            activateMatchingPreviewDraft(
                workspaceRef.current.tabs,
                name,
                sql,
                id => setWorkspace(current => ({ ...current, activeId: id })),
                draft => {
                    if (openOptions.generatedPreviewSql)
                        draft.generatedPreviewSql = openOptions.generatedPreviewSql;
                    reusedDraft = { draftId: draft.id };
                    void executeObservedDraft(draft, executeSqlForDraft, connection.id, observer);
                },
            )
        )
            return reusedDraft;
        const draft = newDraft(name, sql);
        if (openOptions.generatedPreviewSql)
            draft.generatedPreviewSql = openOptions.generatedPreviewSql;
        if (!openNewDraft(draft, !run)) return;
        if (!run) {
            window.requestAnimationFrame(() => editor.current?.focus());
            return { draftId: draft.id };
        }
        void executeObservedDraft(draft, executeSqlForDraft, connection.id, observer);
        return { draftId: draft.id };
    };
    const startBlankSql = () => {
        if (!openNewDraft(newDraft(nextBlankQueryName(workspaceRef.current)), true)) return false;
        window.requestAnimationFrame(() => editor.current?.focus());
        return true;
    };
    return {
        perform,
        execute,
        runExample,
        cancel,
        openRun,
        openNewDraft,
        openSqlDraft,
        startBlankSql,
        addDraft,
    };
}

function createDraftExecutor({
    performExecution,
    trusted,
    connection,
    importedReveal,
    experience,
    clearFailedQueryError,
    active,
    pendingExecution,
    recordFailedQueryError,
    scriptFollowRef,
    setScripts,
    update,
    setViewForDraft,
    setExampleChartRunId,
    trackSchemaRefresh,
    panels,
    loadHistory,
    evidence,
}: {
    performExecution: (
        task: () => Promise<void>,
        kind?: BusyAction,
        onFailure?: (caught: unknown) => void,
    ) => Promise<void>;
    trusted: WorkspaceExecutionOptions['trusted'];
    connection: WorkspaceExecutionOptions['connection'];
    importedReveal: WorkspaceExecutionOptions['importedReveal'];
    experience: WorkspaceExecutionOptions['experience'];
    clearFailedQueryError: WorkspaceExecutionOptions['clearFailedQueryError'];
    active: WorkspaceExecutionOptions['active'];
    pendingExecution: WorkspaceExecutionOptions['pendingExecution'];
    recordFailedQueryError: (failure: FailedQueryError) => void;
    scriptFollowRef: WorkspaceExecutionOptions['scriptFollowRef'];
    setScripts: WorkspaceExecutionOptions['setScripts'];
    update: WorkspaceExecutionOptions['update'];
    setViewForDraft: WorkspaceExecutionOptions['setViewForDraft'];
    setExampleChartRunId: WorkspaceExecutionOptions['setExampleChartRunId'];
    trackSchemaRefresh: WorkspaceExecutionOptions['trackSchemaRefresh'];
    panels: WorkspaceExecutionOptions['panels'];
    loadHistory: WorkspaceExecutionOptions['loadHistory'];
    evidence: WorkspaceExecutionOptions['evidence'];
}) {
    const { run, resultPage, page, setRunForRun } = evidence;

    return (
        draft: Draft,
        sql: string,
        options: {
            kind?: RunKind;
            view?: ResultsView;
            sourceRange?: { from: number; to: number };
            draftSql?: string;
            expandResults?: boolean;
            trackChartRun?: boolean;
            preview?: boolean;
            observer?: SqlDraftObserver;
        } = {},
    ) => {
        const kind = options.kind ?? 'query';
        let statements: ReturnType<typeof splitSql> = [];
        let parseError: unknown;
        let parseFailed = false;
        try {
            statements = splitSql(sql);
        } catch (caught) {
            parseFailed = true;
            parseError = caught;
        }
        if (!parseFailed && statements.length === 0) return Promise.resolve();
        const isScript = kind === 'query' && statements.length > 1;
        const statement = isScript ? undefined : statements[0];
        const draftSql = options.draftSql ?? draft.sql;
        let sourceRange: { from: number; to: number } | undefined = options.sourceRange;
        if (isScript) sourceRange = options.sourceRange;
        else if (statement) {
            if (options.sourceRange)
                sourceRange = {
                    from: options.sourceRange.from + statement.from,
                    to: options.sourceRange.from + statement.to,
                };
            else if (sql === draftSql) sourceRange = statement;
        }

        return performExecution(
            async () => {
                const validateExecutionRequest = () => {
                    if (parseFailed) throw parseError;
                    if (!trusted)
                        throw new Error(
                            'Review and trust this read only connection before running SQL.',
                        );
                    if (isScript && connection.manifest?.scripts.available !== true)
                        throw new Error(
                            connection.manifest?.scripts.reason ??
                                'Scripts are unavailable on this connection.',
                        );
                    if (kind === 'explain' && connection.manifest?.explain.available === false)
                        throw new Error(
                            connection.manifest.explain.reason ??
                                'EXPLAIN is unavailable on this connection.',
                        );
                    const explainPlan =
                        connection.manifest?.explainPlan ?? connection.manifest?.explain;
                    if (kind === 'plan' && explainPlan?.available === false)
                        throw new Error(
                            explainPlan.reason ?? 'EXPLAIN PLAN is unavailable on this connection.',
                        );
                    const explainPipeline =
                        connection.manifest?.explainPipeline ?? connection.manifest?.pipeline;
                    if (kind === 'pipeline' && explainPipeline?.available === false)
                        throw new Error(
                            explainPipeline.reason ??
                                'EXPLAIN PIPELINE is unavailable on this connection.',
                        );
                    const explainAnalyze = connection.manifest?.explainAnalyze;
                    if (kind === 'analyze' && explainAnalyze?.available === false)
                        throw new Error(
                            explainAnalyze.reason ??
                                'EXPLAIN ANALYZE is unavailable on this connection.',
                        );
                    if (!isScript && statements.length > 1)
                        throw new Error('This action accepts exactly one SQL statement.');
                    if (
                        parameterNames(sql).length &&
                        connection.manifest?.parameters.available === false
                    )
                        throw new Error(
                            connection.manifest.parameters.reason ??
                                'Query parameters are unavailable on this connection.',
                        );
                };
                validateExecutionRequest();

                const importedSqlBaseline = await importedReveal.captureImportedSqlBaseline(
                    draft.id,
                    isScript
                        ? statements.some(item => isSchemaChangingSql(item.sql))
                        : Boolean(statement && isSchemaChangingSql(statement.sql)),
                );

                let documentId = draft.serverId;
                if (documentId) {
                    try {
                        const document = await api(
                            `/documents/${encodeURIComponent(documentId)}`,
                            apiResponses.isQueryDocumentResponse,
                        );
                        if (document.deletedAt) documentId = undefined;
                    } catch (caught) {
                        if (
                            !(caught instanceof SavedQueryUnavailableError) &&
                            !(
                                caught instanceof RequestError &&
                                caught.status === 404 &&
                                caught.detail.code === 'NOT_FOUND'
                            )
                        )
                            throw caught;
                        documentId = undefined;
                    }
                }

                const runSql = isScript ? sql : statement!.sql;
                const generatedPreviewStatements = draft.generatedPreviewSql
                    ? splitSql(draft.generatedPreviewSql)
                    : [];
                const generatedPreviewLimit =
                    !isScript &&
                    generatedPreviewStatements.length === 1 &&
                    generatedPreviewStatements[0]!.sql === runSql
                        ? String(TABLE_PREVIEW_ROW_LIMIT)
                        : undefined;
                const payload = {
                    clientRequestId: crypto.randomUUID(),
                    connectionId: connection.id,
                    documentId,
                    sql: runSql,
                    parameters: draft.parameters,
                    parentRunId: draft.parentRunId,
                    kind,
                    limits: {
                        rows: connection.limits.rows || DEFAULT_LIMITS.rows,
                        seconds: connection.limits.seconds || DEFAULT_LIMITS.seconds,
                    },
                    tags: {
                        workspace: 'clickstudio',
                        experience,
                        ...(generatedPreviewLimit ? { preview_limit: generatedPreviewLimit } : {}),
                    },
                    ...(sourceRange
                        ? { sourceFrom: sourceRange.from, sourceTo: sourceRange.to }
                        : {}),
                };
                clearFailedQueryError(draft.id);
                const previousResult =
                    draft.id === active.id && run && terminal(run) && resultPage
                        ? { draftId: draft.id, run, page: resultPage, pageIndex: page }
                        : undefined;

                const submitScript = async () => {
                    pendingExecution.start(
                        payload.clientRequestId,
                        draft.id,
                        payload.sql,
                        previousResult,
                    );
                    let created: Script;
                    try {
                        created = await post(
                            '/scripts',
                            { ...payload, stopOnError: true },
                            apiResponses.isScriptResponse,
                        );
                    } catch (caught) {
                        pendingExecution.clear(payload.clientRequestId);
                        throw caught;
                    }
                    pendingExecution.acceptScript(payload.clientRequestId, created.id);
                    importedReveal.rememberImportedSqlScript(
                        draft.id,
                        created.id,
                        importedSqlBaseline,
                    );
                    scriptFollowRef.current = { scriptId: created.id, enabled: true };
                    setScripts(current => ({ ...current, [created.id]: created }));
                    const first = created.statements.find(item => item.runId);
                    update(draft.id, current =>
                        first?.runId
                            ? {
                                  ...current,
                                  activeRunId: first.runId,
                                  scriptId: created.id,
                                  runIds: rememberRunIds(current.runIds, [first.runId]),
                              }
                            : { ...current, scriptId: created.id },
                    );
                    setViewForDraft(draft.id, 'results', true);
                    if (options.trackChartRun) setExampleChartRunId(undefined);
                };
                const submitRun = async () => {
                    pendingExecution.start(
                        payload.clientRequestId,
                        draft.id,
                        payload.sql,
                        previousResult,
                    );
                    let created: Run;
                    try {
                        created = await post('/runs', payload, apiResponses.isRunResponse);
                    } catch (caught) {
                        pendingExecution.clear(payload.clientRequestId);
                        throw caught;
                    }
                    pendingExecution.acceptRun(payload.clientRequestId, created.id);
                    if (
                        connection.dataSource === 'clickhouse' &&
                        connection.readonly === false &&
                        statement &&
                        isSchemaChangingSql(statement.sql)
                    )
                        trackSchemaRefresh(created.id, draft.id, importedSqlBaseline);
                    setRunForRun(created.id, created, true);
                    setViewForDraft(draft.id, options.view ?? 'results', true);
                    update(draft.id, current => ({
                        ...current,
                        activeRunId: created.id,
                        scriptId: undefined,
                        runIds: rememberRunIds(current.runIds, [created.id]),
                    }));
                    if (options.trackChartRun)
                        setExampleChartRunId(options.view === 'chart' ? created.id : undefined);
                    options.observer?.submitted(created);
                };
                if (isScript) await submitScript();
                else await submitRun();
                if (options.expandResults) panels.revealPanelTemporarily('results', draft.id);
                void loadHistory().catch(() => undefined);
            },
            isScript ? 'script' : 'run',
            caught => {
                options.observer?.failed(apiErrorDetail(caught));
                const requestId = apiRequestId(caught);
                recordFailedQueryError({
                    draftId: draft.id,
                    draftSql,
                    statementSql: statement?.sql ?? sql,
                    sourceFrom: sourceRange?.from ?? 0,
                    ...(requestId ? { requestId } : {}),
                    error:
                        caught instanceof SqlSyntaxError
                            ? {
                                  code: 'SQL_SYNTAX',
                                  message: caught.message,
                                  position: caught.position,
                              }
                            : apiErrorDetail(caught),
                });
            },
        );
    };
}

async function executeObservedDraft(
    draft: Draft,
    execute: ReturnType<typeof createDraftExecutor>,
    connectionId: string,
    observer?: SqlDraftObserver,
) {
    if (observer && draft.activeRunId) {
        try {
            const previous = await api(
                `/runs/${encodeURIComponent(draft.activeRunId)}`,
                apiResponses.isRunResponse,
            );
            if (!terminal(previous)) {
                const expectedSql = draft.sql.trim().replace(/;$/, '');
                const actualSql = previous.sql.trim().replace(/;$/, '');
                if (
                    previous.kind !== 'query' ||
                    previous.connectionId !== connectionId ||
                    actualSql !== expectedSql
                ) {
                    observer.failed({
                        code: 'FUNCTION_TEST_RUNNING',
                        message:
                            'Another action is running in this query tab. Wait for it to finish, then run the function test.',
                    });
                    return;
                }
                observer.submitted(previous);
                return;
            }
        } catch (error) {
            observer.failed(apiErrorDetail(error));
            return;
        }
    }
    await execute(draft, draft.sql, {
        expandResults: true,
        trackChartRun: true,
        preview: true,
        observer,
    });
}
