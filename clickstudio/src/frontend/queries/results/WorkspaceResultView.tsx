import type { Result, ResultPage } from '../../../shared/queries/results/types';
import type { Run } from '../../../shared/queries/execution/types';
import type { Draft } from '../editor/drafts/workspace-state';
import type { Copy } from '../../ui/copy';
import type { WorkspaceViewState } from '../../workspace/layout/useWorkspaceViewState';
import type {
    WorkspaceResultsPanelState,
    WorkspaceResultsPanelActions,
} from './WorkspaceResultsPanel';
import { ChartView, InsightsView, ResultGrid } from './ResultViews';
import { ExplainAnalyzeView } from '../inspection/performance/ExplainAnalyzeView';
import { ExplainIndexesView } from '../inspection/plans/ExplainIndexesView';
import { ExplainPlanView, type ExplainPlanViewMode } from '../inspection/plans/ExplainPlanView';
import { PipelineGraph } from '../inspection/diagrams/PipelineGraph';
import { CLICKHOUSE_CLOUD_CONNECTION_ID } from '../../../shared/database/connections/cloud-policy';
import type { LargeCellRunContext } from './large-cell-actions';

type WorkspaceResultViewProps = {
    state: WorkspaceResultsPanelState;
    actions: WorkspaceResultsPanelActions;
    viewState: WorkspaceViewState;
    showPreviousResult: boolean;
    resultsRun?: Run;
    resultsPage?: ResultPage;
    resultsPageIndex: number;
    previousSuccessfulResult: boolean;
    rowsUnavailable: boolean;
    tableToolbar: HTMLDivElement | null;
    chartToolbar: HTMLDivElement | null;
    tableRowCount: HTMLSpanElement | null;
    planView: ExplainPlanViewMode;
};

export function WorkspaceResultView({
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
    chartToolbar,
    tableRowCount,
    planView,
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
                    view={planView}
                />
            );
        case 'pipeline':
            if (!run || rowsUnavailable) return null;
            return pipelineResult ? (
                <PipelineGraph
                    pipeline={pipelineResult}
                    showHeading={false}
                    copy={copy.common}
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
                chartToolbar,
                tableRowCount,
                previousSuccessfulResult,
                copy,
                retainedSnapshot,
                active,
            });
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
    chartToolbar,
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
    chartToolbar: HTMLDivElement | null;
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
            largeCellContext={
                {
                    runId: run.id,
                    queryId: run.queryId,
                    isCloud: run.connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID,
                } satisfies LargeCellRunContext
            }
            chart={active.chart}
            onChart={chart => actions.onPatch({ chart })}
            toolbarContainer={chartToolbar}
            copy={copy}
        />
    );
}
