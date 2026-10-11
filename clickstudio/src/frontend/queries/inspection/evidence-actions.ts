import type { RefObject } from 'react';
import type { FlamegraphSnapshot } from '../../../shared/queries/inspection/flamegraph';
import type { ProfilePipeline, QueryProfile } from '../../../shared/queries/inspection/types';
import { api, message } from '../../api/client';
import type { Connected } from '../../workspace/workspace-types';
import type { useRunEvidence } from '../execution/useRunEvidence';

export function createQueryEvidenceActions({
    activeRunId,
    connection,
    activeRunIdRef,
    evidence,
}: {
    activeRunId: string | undefined;
    connection: Connected;
    activeRunIdRef: RefObject<string | undefined>;
    evidence: Pick<
        ReturnType<typeof useRunEvidence>,
        'setProfileForRun' | 'setPipelineForRun' | 'setFlamegraphForRun' | 'setAssetReadFeedback'
    >;
}) {
    const { setProfileForRun, setPipelineForRun, setFlamegraphForRun, setAssetReadFeedback } =
        evidence;
    const loadAsset = async (
        runId: string,
        label: string,
        task: () => Promise<void>,
    ): Promise<void> => {
        try {
            await task();
            setAssetReadFeedback(runId, undefined);
        } catch (caught) {
            setAssetReadFeedback(runId, {
                tone: 'error',
                message: `Couldn’t load ${label}. Try again.`,
                detail: message(caught),
                retry: () => void loadAsset(runId, label, task),
            });
        }
    };

    const loadProfile = async () => {
        if (!activeRunId) return;
        if (connection.manifest?.queryLog.available === false) return;
        const runId = activeRunId;
        await loadAsset(runId, 'the query profile', async () => {
            const response = await api<QueryProfile>(`/runs/${encodeURIComponent(runId)}/profile`);
            setProfileForRun(runId, response);
        });
    };

    const loadPipeline = async () => {
        if (!activeRunId) return;
        if (connection.manifest?.pipeline.available === false) return;
        const runId = activeRunId;
        await loadAsset(runId, 'the query pipeline', async () => {
            const response = await api<ProfilePipeline>(
                `/runs/${encodeURIComponent(runId)}/profile/pipeline`,
            );
            if (activeRunIdRef.current !== runId) return;
            setPipelineForRun(runId, response);
        });
    };

    const loadFlamegraph = async () => {
        if (!activeRunId || connection.manifest?.traceLog?.available !== true) return;
        const runId = activeRunId;
        await loadAsset(runId, 'the flamegraph', async () => {
            const response = await api<FlamegraphSnapshot>(
                `/runs/${encodeURIComponent(runId)}/profile/flamegraph`,
            );
            if (activeRunIdRef.current === runId) setFlamegraphForRun(runId, response);
        });
    };
    return { loadProfile, loadPipeline, loadFlamegraph };
}
