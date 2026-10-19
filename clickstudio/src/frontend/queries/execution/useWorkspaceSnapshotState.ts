import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react';
import type { Run } from '../../../shared/queries/execution/types';
import { recommendChart } from '../../../shared/queries/results/results';
import { message } from '../../api/client';
import type { ResultsView } from '../../workspace/workspace-types';
import type { Draft, WorkspaceState } from '../editor/drafts/workspace-state';
import { terminal } from './status';
import { useResultSnapshot } from './useResultSnapshot';
import type { useRunEvidence } from './useRunEvidence';

export function useWorkspaceSnapshotState({
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
