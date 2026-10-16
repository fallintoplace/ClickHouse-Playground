import { exportCsv } from '../../../shared/queries/results/results';
import { isRecord } from '../../../shared/common/values';
import { api, apiResponses, download, isFrontendDemoPreview, message } from '../../api/client';
import {
    CLICKHOUSE_CLOUD_CONNECTION_ID,
    downloadClickHouseCloudCsv,
} from '../../database/connections/cloud-connection';
import type { Draft } from '../editor/drafts/workspace-state';
import type { useRunEvidence } from '../execution/useRunEvidence';
import type { useWorkspaceNotifications } from '../../workspace/layout/notifications/useWorkspaceNotifications';
import { hydrateLargeCells, largeCellUrl } from './large-cell-actions';

export function createQueryExportActions({
    setError,
    active,
    evidence,
}: {
    setError: ReturnType<typeof useWorkspaceNotifications>['setError'];
    active: Pick<Draft, 'name' | 'sql'>;
    evidence: Pick<ReturnType<typeof useRunEvidence>, 'run' | 'snapshot'>;
}) {
    const { run, snapshot } = evidence;
    const exportCurrentCsv = async () => {
        if (!run) return;
        try {
            if (isFrontendDemoPreview || run.connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID) {
                let full =
                    snapshot?.runId === run.id
                        ? snapshot
                        : await api(
                              `/runs/${encodeURIComponent(run.id)}/snapshot`,
                              apiResponses.isResultResponse,
                          );
                if (run.connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID)
                    full = await hydrateLargeCells(full, cellId =>
                        largeCellUrl(run.id, run.queryId, true, cellId),
                    );
                download(`${run.queryId}.csv`, exportCsv(full), 'text/csv;charset=utf-8');
                return;
            }
            const response = await fetch(
                `/api/runs/${encodeURIComponent(run.id)}/export?format=csv`,
                {
                    credentials: 'same-origin',
                    headers: { 'X-ClickStudio-Intent': '1' },
                },
            );
            if (!response.ok) {
                const content: unknown = await response.json().catch(() => null);
                const error =
                    isRecord(content) &&
                    isRecord(content.error) &&
                    typeof content.error.message === 'string'
                        ? content.error.message
                        : `The server returned HTTP ${response.status}.`;
                throw new Error(error);
            }
            const objectUrl = URL.createObjectURL(await response.blob());
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = `${run.queryId}.csv`;
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        } catch (caught) {
            setError('Couldn’t prepare the CSV export. Try again.', { detail: message(caught) });
        }
    };

    const downloadFullResultCsv = () => {
        if (!run) return;
        try {
            if (run.connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID) {
                downloadClickHouseCloudCsv(run.sql, run.parameters, run.tags.preview_limit);
                return;
            }
            const link = document.createElement('a');
            link.href = `/api/runs/${encodeURIComponent(run.id)}/full-export`;
            link.click();
        } catch (caught) {
            setError('Couldn’t start the full result download. Try again.', {
                detail: message(caught),
            });
        }
    };

    const exportCurrentQuery = () => {
        const baseName = active.name
            .trim()
            .replace(/\.sql$/i, '')
            .replace(/[<>:"/\\|?*\p{Cc}]/gu, '_')
            .trim();
        download(`${baseName || 'query'}.sql`, active.sql, 'application/sql;charset=utf-8');
    };

    return { exportCurrentQuery, exportCurrentCsv, downloadFullResultCsv };
}
