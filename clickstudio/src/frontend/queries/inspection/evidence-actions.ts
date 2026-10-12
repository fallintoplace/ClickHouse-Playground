import type { RefObject } from 'react';
import { api, apiResponses, message } from '../../api/client';
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
            const response = await api(
                `/runs/${encodeURIComponent(runId)}/profile`,
                apiResponses.isQueryProfile,
            );
            setProfileForRun(runId, response);
        });
    };

    const loadPipeline = async () => {
        if (!activeRunId) return;
        if (connection.manifest?.pipeline.available === false) return;
        const runId = activeRunId;
        await loadAsset(runId, 'the query pipeline', async () => {
            const response = await api(
                `/runs/${encodeURIComponent(runId)}/profile/pipeline`,
                apiResponses.isProfilePipeline,
            );
            if (activeRunIdRef.current !== runId) return;
            setPipelineForRun(runId, response);
        });
    };

    const loadFlamegraph = async () => {
        if (!activeRunId || connection.manifest?.traceLog?.available !== true) return;
        const runId = activeRunId;
        await loadAsset(runId, 'the flamegraph', async () => {
            const response = await api(
                `/runs/${encodeURIComponent(runId)}/profile/flamegraph`,
                apiResponses.isFlamegraphSnapshot,
            );
            if (activeRunIdRef.current === runId) setFlamegraphForRun(runId, response);
        });
    };
    return { loadProfile, loadPipeline, loadFlamegraph };
}
