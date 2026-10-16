import type { Json } from '../../../shared/common/values';
import { isLargeCellReference } from '../../../shared/queries/results/large-cells';
import type { Result } from '../../../shared/queries/results/types';

export interface LargeCellRunContext {
    runId: string;
    queryId: string;
    isCloud: boolean;
}

export const LARGE_CELL_FETCH_CONCURRENCY = 6;

export function largeCellUrl(
    runId: string,
    queryId: string,
    isCloud: boolean,
    cellId: string,
): string {
    return isCloud
        ? `/api/cloud/cells/${encodeURIComponent(queryId)}/${encodeURIComponent(cellId)}`
        : `/api/runs/${encodeURIComponent(runId)}/cells/${encodeURIComponent(cellId)}`;
}

export async function fetchLargeCellText(url: string, signal?: AbortSignal): Promise<string> {
    const response = await fetch(url, { credentials: 'same-origin', signal });
    if (!response.ok) throw new Error('This large cell value is unavailable.');
    return await response.text();
}

export async function downloadLargeCell(url: string): Promise<void> {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('This large cell value is unavailable.');

    const fileName = /filename="([^"]+)"/i.exec(
        response.headers.get('content-disposition') ?? '',
    )?.[1];
    const objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName || 'large-cell';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export async function hydrateLargeCells(
    result: Result,
    urlFor: (cellId: string) => string,
): Promise<Result> {
    const rows: Json[][] = result.rows.map(row => [...row]);
    const cells = result.rows.flatMap((row, rowIndex) =>
        row.flatMap((value, columnIndex) =>
            isLargeCellReference(value, result.largeCellToken)
                ? [{ rowIndex, columnIndex, reference: value }]
                : [],
        ),
    );
    const controller = new AbortController();
    let nextCell = 0;
    const hydrateWorker = async () => {
        while (!controller.signal.aborted) {
            const cellIndex = nextCell++;
            const cell = cells[cellIndex];
            if (!cell) return;
            try {
                const text = await fetchLargeCellText(urlFor(cell.reference.id), controller.signal);
                const value: Json =
                    cell.reference.valueType === 'text' ? text : (JSON.parse(text) as Json);
                const row = rows[cell.rowIndex];
                if (row) row[cell.columnIndex] = value;
            } catch (error) {
                controller.abort();
                throw error;
            }
        }
    };
    await Promise.all(
        Array.from({ length: Math.min(LARGE_CELL_FETCH_CONCURRENCY, cells.length) }, () =>
            hydrateWorker(),
        ),
    );
    return { ...result, rows };
}
