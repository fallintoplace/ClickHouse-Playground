import type { ReactNode } from 'react';
import type { ApiError } from '../../../shared/common/errors';
import type { Run, Script } from '../../../shared/queries/execution/types';
import type { FailedQueryError } from '../../workspace/workspace-helpers';
import type { WorkspacePanelController } from '../../workspace/layout/panels/useWorkspacePanels';
import type { WorkspaceViewState } from '../../workspace/layout/useWorkspaceViewState';
import type {
    WorkspaceResultsPanelState,
    WorkspaceResultsPanelActions,
} from './WorkspaceResultsPanel';
import { RuntimeSummaryCards } from '../inspection/performance/ExplainAnalyzeView';
import {
    ExplainPlanViewControls,
    type ExplainPlanViewMode,
} from '../inspection/plans/ExplainPlanView';
import { SqlFlowModeTabs, type StructureView } from '../inspection/diagrams/SqlFlowView';
import { Button, cx } from '../../ui/components/primitives';
import { Icon } from '../../ui/components/icons';
import { ScriptResultsSelector } from './ScriptResultsSelector';
import { ResultActions } from './ResultActions';
import { resultsTabLabel, resultsViewHelpHint } from '../../workspace/workspace-helpers';

export function renderResultsHeader({
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
    onStructureModeChange,
    planView,
    onPlanViewChange,
}: {
    showFailure: boolean;
    setTableToolbar: import('react').Dispatch<
        import('react').SetStateAction<HTMLDivElement | null>
    >;
    setChartToolbar: import('react').Dispatch<
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
    structureMode: StructureView;
    onStructureModeChange: (mode: StructureView) => void;
    planView: ExplainPlanViewMode;
    onPlanViewChange: (mode: ExplainPlanViewMode) => void;
}) {
    const {
        visibleResultsView,
        resultsTitle,
        snapshotChart,
        resultTabs,
        resultsPanelLabel,
        failureSql,
    } = viewState;
    const { copy, run, script, history, assistantBusy, busy, execution, failedAttempt } = state;
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
                    <div
                        className={cx(
                            'results-heading',
                            visibleResultsView === 'plan' && 'results-plan-heading',
                            visibleResultsView === 'runtime' && 'results-runtime-heading',
                        )}
                    >
                        <h2>{resultsTitle}</h2>
                        {visibleResultsView === 'plan' && viewState.explainPlan && (
                            <ExplainPlanViewControls
                                view={planView}
                                onViewChange={onPlanViewChange}
                                nodeCount={viewState.explainPlan.nodeCount}
                                copy={copy.common}
                            />
                        )}
                        {visibleResultsView === 'runtime' && viewState.analyzeEvidence && (
                            <RuntimeSummaryCards
                                evidence={viewState.analyzeEvidence}
                                copy={copy.common}
                                compact
                            />
                        )}
                    </div>
                )}
                {visibleResultsView === 'sqlmap' && (
                    <SqlFlowModeTabs
                        copy={copy.common}
                        mode={structureMode}
                        onModeChange={onStructureModeChange}
                        parseResult={viewState.sqlMapParseStatement?.result}
                        parserStatus={state.nativeParserStatus}
                        analyzerAvailable={viewState.queryTreeAvailable}
                        analyzerUnavailableReason={viewState.queryTreeUnavailableReason}
                    />
                )}
                {queryCard}
                <span
                    ref={setTableRowCount}
                    className="results-row-summary"
                    hidden={panels.resultsCollapsed || showFailure}
                />
            </div>
            <div className="results-actions">
                {state.experience === 'expert' &&
                    !showFailure &&
                    !execution &&
                    !panels.resultsCollapsed &&
                    showQueryCard &&
                    run && (
                        <ResultActions
                            key={`${state.connection.id}:${state.connection.database}:${run.id}`}
                            run={run}
                            database={state.connection.database}
                            schema={state.schema}
                            onOpenSql={actions.onOpenSql}
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
                {!showFailure &&
                    visibleResultsView === 'chart' &&
                    snapshotChart?.config.kind !== 'table' && (
                        <div
                            ref={setChartToolbar}
                            className="results-chart-tools"
                            hidden={panels.resultsCollapsed}
                        />
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
                                data-footer-help={resultsViewHelpHint(tab, copy.common)}
                                onClick={() => {
                                    if (tab !== 'sqlmap') onStructureModeChange('flow');
                                    actions.onSelectView(tab);
                                }}
                            >
                                {resultsTabLabel(tab, copy.common)}
                            </button>
                        ))}
                    </div>
                )}
                {showFailure && failureSql && (
                    <Button
                        variant="secondary"
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
