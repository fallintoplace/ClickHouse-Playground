import { useEffect, useState } from 'react';
import type { Run } from '../../../shared/queries/execution/types';
import type { Result } from '../../../shared/queries/results/types';
import { api, apiResponses, message } from '../../api/client';
import { terminal } from '../../queries/execution/status';
import { startVisiblePolling } from '../../browser/visible-polling';

export function useFunctionTestResult(runId?: string) {
    const [loaded, setLoaded] = useState<{
        runId: string;
        run?: Run;
        result?: Result;
        error?: string;
    }>();
    useEffect(() => {
        if (!runId) return;
        let stop = () => {};
        stop = startVisiblePolling(
            async signal => {
                try {
                    const run = await api(
                        `/runs/${encodeURIComponent(runId)}`,
                        apiResponses.isRunResponse,
                        { signal },
                    );
                    if (signal.aborted) return;
                    setLoaded({ runId, run });
                    if (!terminal(run)) return;
                    const result =
                        run.resultState === 'reopenable'
                            ? await api(
                                  `/runs/${encodeURIComponent(runId)}/result?offset=0&count=1`,
                                  apiResponses.isResultPage,
                                  { signal },
                              )
                            : undefined;
                    if (signal.aborted) return;
                    setLoaded({ runId, run, result });
                    stop();
                } catch (error) {
                    if (!signal.aborted) {
                        setLoaded({ runId, error: message(error) });
                        stop();
                    }
                }
            },
            { intervalMs: 500 },
        );
        return () => stop();
    }, [runId]);
    return loaded?.runId === runId ? loaded : undefined;
}
