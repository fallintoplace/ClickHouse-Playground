import { useState, type ReactNode } from 'react';
import type { ProfilePipeline, QueryProfile } from '../../../shared/queries/inspection/types';
import type { ApiError } from '../../../shared/common/errors';
import type { Result, ResultPage } from '../../../shared/queries/results/types';
import type { Run, Script } from '../../../shared/queries/execution/types';
import type { FlamegraphSnapshot } from '../../../shared/queries/inspection/flamegraph';
import type { NativeParseSnapshot, NativeParserStatus } from '../../../shared/sql/parser';
import type { Copy, ExperienceLevel } from '../../ui/copy';
import type { BusyAction, Connected, ResultsView } from '../../workspace/workspace-types';
import type { Draft } from '../editor/drafts/workspace-state';
import type { FailedQueryError } from '../../workspace/workspace-helpers';
import { CLICKHOUSE_CLOUD_CONNECTION_ID } from '../../database/connections/cloud-connection';
import type { WorkspacePanelController } from '../../workspace/layout/panels/useWorkspacePanels';
import type { WorkspaceViewState } from '../../workspace/layout/useWorkspaceViewState';
import { ChartView, GeoView, InsightsView, ResultGrid } from './ResultViews';
import { ExplainAnalyzeView } from '../inspection/performance/ExplainAnalyzeView';
import { ExplainIndexesView } from '../inspection/plans/ExplainIndexesView';
import { ExplainPlanView } from '../inspection/plans/ExplainPlanView';
import { PipelineGraph } from '../inspection/diagrams/PipelineGraph';
import { SqlFlowView } from '../inspection/diagrams/SqlFlowView';
import { Button, cx, Spinner } from '../../ui/components/primitives';
import { Icon } from '../../ui/components/icons';
import {
    ScriptCancelAction,
    ScriptResultsSelector,
    ScriptRunningResults,
} from './ScriptResultsSelector';
import { ScrollEdgeFrame } from '../../ui/components/ScrollEdgeShadows';
import { QueryFailureNotice } from './QueryFailureNotice';
import { resultsTabLabel } from '../../workspace/workspace-helpers';
import { WorkspaceInlineNotice } from '../../workspace/layout/notifications/WorkspaceInlineNotice';
import type { WorkspaceFeedback } from '../../workspace/layout/notifications/useWorkspaceNotifications';

export type WorkspaceResultsPanelState = Readonly<{
    active: Draft;
    connection: Connected;
    copy: Copy;
    run?: Run;
    failedAttempt?: FailedQueryError;
    script?: Script;
    history: Run[];
    page: number;
    resultPage?: ResultPage;
    profile?: QueryProfile;
    pipeline?: ProfilePipeline;
    flamegraph?: FlamegraphSnapshot;
    profilesByRun: Readonly<Record<string, QueryProfile>>;
    pipelinesByRun: Readonly<Record<string, ProfilePipeline>>;
    nativeParserStatus: NativeParserStatus;
    nativeParseSnapshot?: NativeParseSnapshot;
    trusted: boolean;
    busy: BusyAction;
    assistantBusy: boolean;
    execution?: Readonly<{ sql: string; runId?: string; scriptId?: string }>;
    retainedExecutionResult?: Readonly<{ run: Run; page: ResultPage; pageIndex: number }>;
    cancelling: boolean;
    experience: ExperienceLevel;
    readFeedback?: WorkspaceFeedback;
}>;

export type WorkspaceResultsPanelActions = Readonly<{
    onSelectView: (view: ResultsView) => void;
    onSelectScriptRun: (runId: string) => void;
    onSelectScriptError: () => void;
    onCancel: () => void;
    onPage: (page: number) => void;
    onPatch: (values: Partial<Draft>) => void;
    onLoadProfile: () => void;
    onLoadPipeline: () => void;
    onLoadFlamegraph: () => void;
    onRevealRange: (from: number, to: number) => void;
    onFixWithAi: () => void;
    onRetryRead?: () => void;
}>;

export function WorkspaceResultsPanel({
    state,
    actions,
    panels,
    viewState,
}: {
    state: WorkspaceResultsPanelState;
    actions: WorkspaceResultsPanelActions;
    panels: WorkspacePanelController;
    viewState: WorkspaceViewState;
}) {
    const [tableToolbar, setTableToolbar] = useState<HTMLDivElement | null>(null);
    const [tableRowCount, setTableRowCount] = useState<HTMLSpanElement | null>(null);
    const {
        copy,
        run,
        failedAttempt,
        script,
        history,
        page,
        resultPage,
        execution,
        retainedExecutionResult,
        experience,
    } = state;
    const { visibleResultsView, resultsPanelLabel, failureError } = viewState;

    const showPreviousResult = Boolean(
        execution && retainedExecutionResult && visibleResultsView === 'results',
    );
    const runningScript =
        script?.status === 'running' &&
        visibleResultsView === 'results' &&
        !failedAttempt &&
        (!execution || execution.scriptId === script.id)
            ? script
            : undefined;
    const resultsRun = showPreviousResult ? retainedExecutionResult!.run : run;
    const resultsPage = showPreviousResult ? retainedExecutionResult!.page : resultPage;
    const resultsPageIndex = showPreviousResult ? retainedExecutionResult!.pageIndex : page;
    const executionSql = execution?.sql.replace(/\s+/g, ' ').trim();
    const executionSqlPreview =
        executionSql && executionSql.length > 180
            ? `${executionSql.slice(0, 177).trimEnd()}…`
            : executionSql;
    const failedScriptStatement = script?.statements.find(
        statement => statement.status === 'failed' && statement.error,
    );
    const rowsUnavailable =
        run?.resultState === 'unavailable' && ['succeeded', 'truncated'].includes(run.status);
    const showFailure = Boolean(failureError && !execution && visibleResultsView !== 'sqlmap');
    const previousSuccessfulResult = Boolean(
        (failedAttempt || (failedScriptStatement && !failedScriptStatement.runId)) &&
        run?.resultState === 'reopenable' &&
        run.status !== 'failed',
    );

    if (
        !run &&
        !script &&
        !execution &&
        !failedAttempt &&
        !failedScriptStatement &&
        !state.readFeedback &&
        visibleResultsView !== 'sqlmap'
    )
        return null;

    return (
        <section
            className={cx(
                'results-surface',
                showFailure && 'has-error-output',
                experience === 'expert' && 'results-expert',
                panels.resultsCollapsed && 'is-collapsed',
            )}
            aria-label={showFailure ? copy.common.queryResults : resultsPanelLabel}
        >
            {renderResultsHeader({
                showFailure,
                setTableToolbar,
                setTableRowCount,
                panels,
                previousSuccessfulResult,
                actions,
                viewState,
                state,
            })}
            <WorkspaceInlineNotice feedback={state.readFeedback} onRetry={actions.onRetryRead} />
            {runningScript && visibleResultsView === 'results' && !panels.resultsCollapsed && (
                <ScriptRunningResults
                    key={runningScript.id}
                    statements={runningScript.statements}
                    runs={history}
                    activeRunId={run?.id}
                    onSelectRun={actions.onSelectScriptRun}
                    onSelectError={actions.onSelectScriptError}
                    errorSelected={false}
                />
            )}
            <ScrollEdgeFrame<HTMLDivElement>
                className="results-content-frame"
                hidden={panels.resultsCollapsed}
            >
                {ref => (
                    <WorkspaceResultsBody
                        contentRef={ref}
                        state={state}
                        actions={actions}
                        panels={panels}
                        viewState={viewState}
                        showFailure={showFailure}
                        showPreviousResult={showPreviousResult}
                        runningScript={runningScript}
                        executionSqlPreview={executionSqlPreview}
                        resultsRun={resultsRun}
                        resultsPage={resultsPage}
                        resultsPageIndex={resultsPageIndex}
                        previousSuccessfulResult={previousSuccessfulResult}
                        rowsUnavailable={rowsUnavailable}
                        tableToolbar={tableToolbar}
                        tableRowCount={tableRowCount}
                    />
                )}
            </ScrollEdgeFrame>
        </section>
    );
}

type WorkspaceResultsBodyProps = {
    contentRef: (element: HTMLDivElement | null) => void;
    state: WorkspaceResultsPanelState;
    actions: WorkspaceResultsPanelActions;
    panels: WorkspacePanelController;
    viewState: WorkspaceViewState;
    showFailure: boolean;
    showPreviousResult: boolean;
    runningScript?: Script;
    executionSqlPreview?: string;
    resultsRun?: Run;
    resultsPage?: ResultPage;
    resultsPageIndex: number;
    previousSuccessfulResult: boolean;
    rowsUnavailable: boolean;
    tableToolbar: HTMLDivElement | null;
    tableRowCount: HTMLSpanElement | null;
};

function WorkspaceResultsBody({
    contentRef,
    state,
    actions,
    panels,
    viewState,
    showFailure,
    showPreviousResult,
    runningScript,
    executionSqlPreview,
    resultsRun,
    resultsPage,
    resultsPageIndex,
    previousSuccessfulResult,
    rowsUnavailable,
    tableToolbar,
    tableRowCount,
}: WorkspaceResultsBodyProps) {
    const {
        active,
        connection,
        copy,
        execution,
        failedAttempt,
        nativeParserStatus,
        nativeParseSnapshot,
        run,
    } = state;
    const {
        visibleResultsView,
        failureError,
        failureSql,
        sqlMapStatement,
        sqlMapParseStatement,
        queryTreeAvailable,
        queryTreeUnavailableReason,
    } = viewState;
    return (
        <div
            id="query-results-content"
            ref={contentRef}
            className={cx(
                'panel-content results-content',
                (showFailure ||
                    ['insights', 'indexes', 'plan', 'pipeline', 'runtime'].includes(
                        visibleResultsView,
                    )) &&
                    'results-content-scrollable',
            )}
            hidden={panels.resultsCollapsed}
        >
            {visibleResultsView === 'sqlmap' && (
                <SqlFlowView
                    copy={copy.common}
                    sql={sqlMapStatement?.sql ?? active.sql}
                    sourceOffset={sqlMapStatement?.from ?? 0}
                    parseResult={sqlMapParseStatement?.result}
                    parserStatus={nativeParserStatus}
                    parseDurationMs={nativeParseSnapshot?.elapsedMs}
                    connectionId={connection.id}
                    parameters={active.parameters}
                    analyzerAvailable={queryTreeAvailable}
                    analyzerUnavailableReason={queryTreeUnavailableReason}
                    onRevealRange={actions.onRevealRange}
                />
            )}
            {execution && !runningScript && visibleResultsView !== 'sqlmap' && (
                <div
                    className={cx('result-execution-progress', !showPreviousResult && 'is-initial')}
                    aria-busy="true"
                >
                    <div className="result-execution-heading">
                        <Spinner size={16} />
                        <span role="status" aria-live="polite">
                            {copy.common.statusRunning}
                        </span>
                        <strong className="result-execution-query" title={active.name}>
                            {active.name}
                        </strong>
                    </div>
                    <pre className="result-execution-sql is-preview">{executionSqlPreview}</pre>
                    {execution.sql.length > 180 && (
                        <details className="result-execution-details">
                            <summary>{copy.common.expandQuery}</summary>
                            <pre className="result-execution-sql is-full">{execution.sql}</pre>
                        </details>
                    )}
                </div>
            )}
            {showFailure && failureError ? (
                <QueryFailureNotice
                    key={`${failureError.code}:${failureError.message}:${failureSql}`}
                    error={failureError}
                    sql={failureSql}
                    copy={copy.common}
                    errorRange={viewState.failureRange}
                    location={viewState.failureLocation}
                    runId={run?.error === failureError ? run.id : undefined}
                    requestId={failedAttempt?.requestId}
                />
            ) : (
                <>
                    <WorkspaceResultView
                        state={state}
                        actions={actions}
                        viewState={viewState}
                        showPreviousResult={showPreviousResult}
                        resultsRun={resultsRun}
                        resultsPage={resultsPage}
                        resultsPageIndex={resultsPageIndex}
                        previousSuccessfulResult={previousSuccessfulResult}
                        rowsUnavailable={rowsUnavailable}
                        tableToolbar={tableToolbar}
                        tableRowCount={tableRowCount}
                    />
                </>
            )}
        </div>
    );
}

type WorkspaceResultViewProps = Pick<
    WorkspaceResultsBodyProps,
    | 'state'
    | 'actions'
    | 'viewState'
    | 'showPreviousResult'
    | 'resultsRun'
    | 'resultsPage'
    | 'resultsPageIndex'
    | 'previousSuccessfulResult'
    | 'rowsUnavailable'
    | 'tableToolbar'
    | 'tableRowCount'
>;

function WorkspaceResultView({
    state,
    actions,
    viewState,
    showPreviousResult,
    resultsRun,
    resultsPage,
    resultsPageIndex,
    previousSuccessfulResult,
    rowsUnavailable,
    tableToolbar,
    tableRowCount,
}: WorkspaceResultViewProps) {
    const {
        active,
        connection,
        copy,
        run,
        history,
        page,
        resultPage,
        profile,
        pipeline,
        flamegraph,
        profilesByRun,
        pipelinesByRun,
        trusted,
        busy,
    } = state;
    const {
        visibleResultsView,
        retainedSnapshot,
        explainPlan,
        explainIndexAnalysis,
        pipelineResult,
        analyzeEvidence,
        snapshotChart,
    } = viewState;
    switch (visibleResultsView) {
        case 'results':
            if (!resultsRun || (state.execution && !showPreviousResult)) return null;
            return (
                <ResultGrid
                    key={resultsRun.id}
                    run={resultsRun}
                    page={resultsPage}
                    pageIndex={resultsPageIndex}
                    loading={!resultsPage && resultsRun.resultState === 'reopenable'}
                    onPage={actions.onPage}
                    showPagination={!showPreviousResult}
                    obscured={showPreviousResult}
                    toolbarContainer={tableToolbar}
                    rowCountContainer={tableRowCount}
                    previousRunLabel={
                        previousSuccessfulResult ? copy.common.previousRun : undefined
                    }
                />
            );
        case 'indexes':
            if (!run || rowsUnavailable) return null;
            return (
                <ExplainIndexesView
                    analysis={explainIndexAnalysis}
                    loading={!retainedSnapshot && run.resultState === 'reopenable'}
                    copy={copy.common}
                />
            );
        case 'plan':
            if (!run || rowsUnavailable) return null;
            return (
                <ExplainPlanView
                    plan={explainPlan}
                    loading={!retainedSnapshot && run.resultState === 'reopenable'}
                    copy={copy.common}
                />
            );
        case 'pipeline':
            if (!run || rowsUnavailable) return null;
            return pipelineResult ? (
                <PipelineGraph
                    pipeline={pipelineResult}
                    copy={copy.common}
                    heading={copy.common.pipelineGraph}
                    subheading={copy.common.pipelineGraphDescription}
                />
            ) : (
                <div className="pipeline-graph-empty" role="status">
                    {copy.common.pipelineNoOutput}
                </div>
            );
        case 'runtime':
            if (!run || rowsUnavailable) return null;
            return (
                <ExplainAnalyzeView
                    evidence={analyzeEvidence}
                    loading={!retainedSnapshot && run.resultState === 'reopenable'}
                    copy={copy.common}
                />
            );
        case 'chart':
            return renderChartResult({
                run,
                rowsUnavailable,
                snapshotChart,
                resultPage,
                page,
                actions,
                tableToolbar,
                tableRowCount,
                previousSuccessfulResult,
                copy,
                retainedSnapshot,
                active,
            });
        case 'map':
            if (!run || rowsUnavailable) return null;
            return (
                <GeoView
                    result={retainedSnapshot}
                    loading={!retainedSnapshot && run.resultState === 'reopenable'}
                />
            );
        case 'insights':
            if (!run) return null;
            return (
                <InsightsView
                    comparison={{
                        connectionId: connection.id,
                        trusted,
                        history,
                        initialRun: run,
                        profiles: profilesByRun,
                        pipelines: pipelinesByRun,
                        queryLogAvailable: connection.manifest?.queryLog.available === true,
                    }}
                    run={run}
                    profile={profile}
                    pipeline={pipeline}
                    pipelineAvailable={Boolean(trusted && connection.manifest?.pipeline.available)}
                    flamegraph={flamegraph}
                    flamegraphCapability={
                        trusted
                            ? connection.manifest?.traceLog
                            : {
                                  available: false,
                                  reason: 'Trust this connection to inspect profiler samples.',
                              }
                    }
                    onLoad={actions.onLoadProfile}
                    onLoadPipeline={actions.onLoadPipeline}
                    onLoadFlamegraph={actions.onLoadFlamegraph}
                    loading={busy === 'save'}
                />
            );
        default:
            return null;
    }
}

function renderChartResult({
    run,
    rowsUnavailable,
    snapshotChart,
    resultPage,
    page,
    actions,
    tableToolbar,
    tableRowCount,
    previousSuccessfulResult,
    copy,
    retainedSnapshot,
    active,
}: {
    run: Run | undefined;
    rowsUnavailable: boolean;
    snapshotChart: WorkspaceViewState['snapshotChart'];
    resultPage: ResultPage | undefined;
    page: number;
    actions: WorkspaceResultsPanelActions;
    tableToolbar: HTMLDivElement | null;
    tableRowCount: HTMLSpanElement | null;
    previousSuccessfulResult: boolean;
    copy: Copy;
    retainedSnapshot: Result | undefined;
    active: Draft;
}) {
    if (!run || rowsUnavailable) return null;
    if (snapshotChart?.config.kind === 'table')
        return (
            <div className="chart-table-fallback">
                <div className="chart-table-notice" role="status">
                    {copy.chart.fallbackNoMeasure}
                </div>
                <ResultGrid
                    key={`${run.id}-chart-table`}
                    run={run}
                    page={resultPage}
                    pageIndex={page}
                    loading={!resultPage && run.resultState === 'reopenable'}
                    onPage={actions.onPage}
                    toolbarContainer={tableToolbar}
                    rowCountContainer={tableRowCount}
                    previousRunLabel={
                        previousSuccessfulResult ? copy.common.previousRun : undefined
                    }
                />
            </div>
        );
    return (
        <ChartView
            result={retainedSnapshot}
            loading={!retainedSnapshot && run.resultState === 'reopenable'}
            chart={active.chart}
            onChart={chart => actions.onPatch({ chart })}
            copy={copy}
        />
    );
}

function renderResultsHeader({
    showFailure,
    setTableToolbar,
    setTableRowCount,
    panels,
    previousSuccessfulResult,
    actions,
    viewState,
    state,
}: {
    showFailure: boolean;
    setTableToolbar: import('react').Dispatch<
        import('react').SetStateAction<HTMLDivElement | null>
    >;
    setTableRowCount: import('react').Dispatch<
        import('react').SetStateAction<HTMLSpanElement | null>
    >;
    panels: WorkspacePanelController;
    previousSuccessfulResult: boolean;
    actions: WorkspaceResultsPanelActions;
    viewState: WorkspaceViewState;
    state: WorkspaceResultsPanelState;
}) {
    const {
        visibleResultsView,
        resultsTitle,
        snapshotChart,
        resultTabs,
        resultsPanelLabel,
        failureSql,
    } = viewState;
    const {
        copy,
        run,
        script,
        history,
        cancelling,
        connection,
        assistantBusy,
        busy,
        execution,
        failedAttempt,
    } = state;
    const headerView = showFailure ? 'results' : visibleResultsView;
    const headerPanelLabel = showFailure ? copy.common.queryResults : resultsPanelLabel;
    const showQueryCard = ['results', 'chart', 'insights'].includes(headerView);
    const querySql = showFailure ? failureSql : (execution?.sql ?? run?.sql);
    const queryCard = renderResultsQueryCard({
        showQueryCard,
        showFailure,
        querySql,
        script,
        failedAttempt,
        execution,
        run,
        history,
        actions,
        failureError: viewState.failureError,
    });

    return (
        <div className="results-header">
            <div className="results-title">
                <span className="results-mark">
                    <Icon
                        name={
                            headerView === 'sqlmap' ||
                            headerView === 'pipeline' ||
                            headerView === 'indexes' ||
                            headerView === 'runtime'
                                ? 'pipeline'
                                : 'chart'
                        }
                    />
                </span>
                {!showQueryCard && (
                    <div>
                        <h2>{resultsTitle}</h2>
                    </div>
                )}
                {queryCard}
                <span
                    ref={setTableRowCount}
                    className="results-row-summary"
                    hidden={panels.resultsCollapsed || showFailure}
                />
            </div>
            <div className="results-actions">
                {headerView === 'results' && script && (
                    <ScriptCancelAction
                        script={script}
                        onCancel={actions.onCancel}
                        disabled={cancelling}
                        afterCurrentStatement={connection.id === CLICKHOUSE_CLOUD_CONNECTION_ID}
                    />
                )}
                <div
                    ref={setTableToolbar}
                    className="results-table-tools"
                    hidden={panels.resultsCollapsed || showFailure}
                />
                {!showFailure &&
                    previousSuccessfulResult &&
                    visibleResultsView !== 'results' &&
                    !(visibleResultsView === 'chart' && snapshotChart?.config.kind === 'table') && (
                        <span
                            className="result-previous-run"
                            title={copy.common.previousResultsDescription}
                        >
                            {copy.common.previousRun}
                        </span>
                    )}
                {!showFailure && run && resultTabs.length > 1 && (
                    <div
                        className="results-tabs"
                        role="tablist"
                        aria-label={copy.common.workspaceOutput}
                    >
                        {resultTabs.map(tab => (
                            <button
                                key={tab}
                                role="tab"
                                aria-selected={visibleResultsView === tab}
                                type="button"
                                onClick={() => actions.onSelectView(tab)}
                            >
                                {resultsTabLabel(tab, copy.common)}
                            </button>
                        ))}
                    </div>
                )}
                {showFailure && failureSql && (
                    <Button
                        variant="danger"
                        className="results-fix-with-ai"
                        onClick={actions.onFixWithAi}
                        disabled={assistantBusy || Boolean(busy)}
                    >
                        <Icon name="assistant" />
                        {copy.common.fixWithAi}
                    </Button>
                )}
                {panels.canCollapse && (
                    <Button
                        variant="ghost"
                        className="panel-collapse-button"
                        aria-label={`${panels.resultsCollapsed ? copy.common.expand : copy.common.collapse} ${headerPanelLabel}`}
                        aria-expanded={!panels.resultsCollapsed}
                        aria-controls="query-results-content"
                        title={
                            panels.resultsCollapsed
                                ? copy.common.expandOutput
                                : copy.common.collapseOutput
                        }
                        onClick={() => panels.setResultsCollapsed(value => !value)}
                    >
                        <Icon className="panel-toggle-icon" name="chevron" />
                    </Button>
                )}
            </div>
        </div>
    );
}

function renderResultsQueryCard({
    showQueryCard,
    showFailure,
    querySql,
    script,
    failedAttempt,
    execution,
    run,
    history,
    actions,
    failureError,
}: {
    showQueryCard: boolean;
    showFailure: boolean;
    querySql: string | undefined;
    script: Script | undefined;
    failedAttempt: FailedQueryError | undefined;
    execution: WorkspaceResultsPanelState['execution'];
    run: Run | undefined;
    history: Run[];
    actions: WorkspaceResultsPanelActions;
    failureError: ApiError | undefined;
}): ReactNode {
    const failedStatement = script?.statements.find(statement => statement.error);
    if (
        showQueryCard &&
        script &&
        !failedAttempt &&
        (!execution || execution.scriptId === script.id)
    )
        return (
            <ScriptResultsSelector
                key={script.id}
                statements={script.statements}
                runs={history}
                activeRunId={run?.id}
                onSelectRun={actions.onSelectScriptRun}
                onSelectError={actions.onSelectScriptError}
                errorSelected={
                    showFailure &&
                    failureError === failedStatement?.error &&
                    !failedStatement?.runId
                }
            />
        );
    if (!showQueryCard || !querySql) return null;
    const queryRun =
        !showFailure && run?.sql === querySql && (!execution || execution.runId === run.id)
            ? run
            : undefined;
    return (
        <ScriptResultsSelector
            key="single-query"
            statements={[
                {
                    sql: querySql,
                    runId: queryRun?.id,
                    status: showFailure ? 'failed' : (queryRun?.status ?? 'running'),
                    error: showFailure ? failureError : undefined,
                },
            ]}
            runs={queryRun ? [queryRun] : []}
            activeRunId={queryRun?.id}
            onSelectRun={actions.onSelectScriptRun}
            onSelectError={actions.onSelectScriptError}
            errorSelected={showFailure}
        />
    );
}
