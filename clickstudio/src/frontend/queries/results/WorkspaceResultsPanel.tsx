import { useState } from 'react';
import type { ProfilePipeline, QueryProfile } from '../../../shared/queries/inspection/types';
import type { ResultPage } from '../../../shared/queries/results/types';
import type { Run, Script } from '../../../shared/queries/execution/types';
import type { FlamegraphSnapshot } from '../../../shared/queries/inspection/flamegraph';
import type { NativeParseSnapshot, NativeParserStatus } from '../../../shared/sql/parser';
import type { Copy, ExperienceLevel } from '../../ui/copy';
import type { BusyAction, Connected, ResultsView } from '../../workspace/workspace-types';
import type { Draft } from '../editor/drafts/workspace-state';
import type { FailedQueryError } from '../../workspace/workspace-helpers';
import type { WorkspacePanelController } from '../../workspace/layout/panels/useWorkspacePanels';
import type { WorkspaceViewState } from '../../workspace/layout/useWorkspaceViewState';
import type { ExplainPlanViewMode } from '../inspection/plans/ExplainPlanView';
import { SqlFlowView, type StructureView } from '../inspection/diagrams/SqlFlowView';
import { cx, Spinner } from '../../ui/components/primitives';
import { ScriptRunningResults } from './ScriptResultsSelector';
import type { OpenResultSql } from './ResultActions';
import type { Schema } from '../../../shared/database/schema/types';
import { ScrollEdgeFrame } from '../../ui/components/ScrollEdgeShadows';
import { QueryFailureNotice } from './QueryFailureNotice';
import { WorkspaceInlineNotice } from '../../workspace/layout/notifications/WorkspaceInlineNotice';
import type { WorkspaceFeedback } from '../../workspace/layout/notifications/useWorkspaceNotifications';
import { WorkspaceResultView } from './WorkspaceResultView';
import { renderResultsHeader } from './WorkspaceResultsHeader';

export type WorkspaceResultsPanelState = Readonly<{
    active: Draft;
    connection: Connected;
    schema?: Schema;
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
    experience: ExperienceLevel;
    readFeedback?: WorkspaceFeedback;
}>;

export type WorkspaceResultsPanelActions = Readonly<{
    onOpenSql: OpenResultSql;
    onSelectView: (view: ResultsView) => void;
    onSelectScriptRun: (runId: string) => void;
    onSelectScriptError: () => void;
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
    const [chartToolbar, setChartToolbar] = useState<HTMLDivElement | null>(null);
    const [tableRowCount, setTableRowCount] = useState<HTMLSpanElement | null>(null);
    const [structureMode, setStructureMode] = useState<StructureView>('flow');
    const [planView, setPlanView] = useState<ExplainPlanViewMode>('graph');
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
                setChartToolbar,
                setTableRowCount,
                panels,
                previousSuccessfulResult,
                actions,
                viewState,
                state,
                structureMode,
                onStructureModeChange: setStructureMode,
                planView,
                onPlanViewChange: setPlanView,
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
                        chartToolbar={chartToolbar}
                        tableRowCount={tableRowCount}
                        structureMode={structureMode}
                        planView={planView}
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
    chartToolbar: HTMLDivElement | null;
    tableRowCount: HTMLSpanElement | null;
    structureMode: StructureView;
    planView: ExplainPlanViewMode;
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
    chartToolbar,
    tableRowCount,
    structureMode,
    planView,
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
                    mode={structureMode}
                    showHeading={false}
                    showModeTabs={false}
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
                        chartToolbar={chartToolbar}
                        tableRowCount={tableRowCount}
                        planView={planView}
                    />
                </>
            )}
        </div>
    );
}
