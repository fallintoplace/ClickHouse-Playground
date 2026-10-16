import { StringDecoder } from 'node:string_decoder';
import { createHash, randomUUID } from 'node:crypto';
import { isJson, isStringArray, type Column, type Row } from '../../../shared/common/values.js';
import type { Limits } from '../../../shared/queries/execution/settings.js';
import type { ResultTruncationReason } from '../../../shared/queries/results/types.js';
import {
    LARGE_CELL_INLINE_BYTES,
    MAX_LARGE_CELL_BYTES,
    MAX_LARGE_CELL_BYTES_PER_RESULT,
    MAX_LARGE_CELL_ROW_BYTES,
} from '../../../shared/queries/results/large-cells.js';
import { previewResultCell } from '../../../shared/queries/results/results.js';
import { AppError, requireThat } from '../../system/requests/errors.js';
import type { DriverResult } from '../../queries/execution/runs.js';
import type { LargeCellContext } from '../../queries/execution/large-cells.js';

function isRow(value: unknown): value is Row {
    return Array.isArray(value) && value.every(isJson);
}
/** Bounded parsing before JSON.parse: even one very large string cannot grow without limit. */
export async function collectCompactStream(
    stream: AsyncIterable<Buffer | string>,
    limits: Pick<Limits, 'rows' | 'bytes'>,
    largeCellContext?: LargeCellContext,
): Promise<DriverResult> {
    const decoder = new StringDecoder('utf8');
    let pending = '',
        stage = 0,
        names: string[] = [],
        columns: Column[] = [];
    let bytes = 0,
        largeCellBytes = 0,
        largeCellSerializedBytes = 0,
        truncated = false,
        truncationReason: ResultTruncationReason | undefined;
    const rows: Row[] = [];
    const consume = (line: string) => {
        if (!line.trim()) return;
        const size = Buffer.byteLength(line);
        if (stage < 2 && bytes + size > limits.bytes)
            throw new AppError(
                413,
                'METADATA_TOO_LARGE',
                'Result metadata exceeds the configured byte limit',
            );
        if (stage >= 2 && rows.length >= limits.rows) {
            truncated = true;
            truncationReason = 'rows';
            return;
        }
        if (stage >= 2 && size > MAX_LARGE_CELL_ROW_BYTES) {
            truncated = true;
            truncationReason = 'bytes';
            return;
        }
        let data: unknown;
        try {
            data = JSON.parse(line);
        } catch {
            throw new AppError(
                502,
                'RESULT_STREAM_ERROR',
                'ClickHouse interrupted the result stream or returned invalid data. Inspect this query ID on the server.',
            );
        }
        requireThat(Array.isArray(data), 502, 'RESULT_FORMAT', 'Expected a compact JSON row');
        if (stage < 2) {
            requireThat(
                isStringArray(data) && data.length > 0 && data.length <= 500,
                502,
                'RESULT_METADATA',
                'Invalid names/types header',
            );
            if (stage === 0) names = data;
            else {
                requireThat(
                    data.length === names.length,
                    502,
                    'RESULT_METADATA',
                    'Column names and types differ',
                );
                columns = names.map((name, i) => {
                    const type = data[i];
                    requireThat(
                        type !== undefined,
                        502,
                        'RESULT_METADATA',
                        'Column names and types differ',
                    );
                    return { name, type };
                });
            }
            bytes += size;
            stage++;
            return;
        }
        requireThat(isRow(data), 502, 'RESULT_FORMAT', 'Expected a compact JSON row');
        requireThat(
            data.length === columns.length,
            502,
            'RESULT_WIDTH',
            'Unexpected number of fields in a result row',
        );
        const row = [...data];
        const detachedCells: {
            id: string;
            index: number;
            value: string;
            valueType: 'text' | 'json';
            bytes: number;
            serializedBytes: number;
        }[] = [];
        for (let index = 0; index < data.length; index++) {
            const value = data[index];
            if (value === undefined || value === null) continue;
            const valueType = typeof value === 'string' ? 'text' : 'json';
            const fullValue =
                valueType === 'text' ? (value as string) : (JSON.stringify(value) ?? String(value));
            const cellBytes = Buffer.byteLength(fullValue);
            const serializedBytes =
                valueType === 'text' ? Buffer.byteLength(JSON.stringify(value)) : cellBytes;
            if (cellBytes <= LARGE_CELL_INLINE_BYTES || !largeCellContext) continue;
            if (
                cellBytes > MAX_LARGE_CELL_BYTES ||
                serializedBytes > MAX_LARGE_CELL_BYTES ||
                largeCellBytes +
                    detachedCells.reduce((total, cell) => total + cell.bytes, 0) +
                    cellBytes >
                    MAX_LARGE_CELL_BYTES_PER_RESULT ||
                largeCellSerializedBytes +
                    detachedCells.reduce((total, cell) => total + cell.serializedBytes, 0) +
                    serializedBytes >
                    MAX_LARGE_CELL_BYTES_PER_RESULT
            ) {
                truncated = true;
                truncationReason = 'bytes';
                return;
            }
            const cellId = randomUUID();
            const id = largeCellContext!.expiresAt
                ? `e${largeCellContext!.expiresAt.toString(36)}_${cellId}`
                : cellId;
            row[index] = {
                __clickstudioLargeCell: largeCellContext.referenceToken,
                id,
                bytes: cellBytes,
                serializedBytes,
                fingerprint: createHash('sha256')
                    .update(valueType)
                    .update('\0')
                    .update(fullValue)
                    .digest('hex'),
                preview: previewResultCell(value),
                valueType,
            };
            detachedCells.push({
                id,
                index,
                value: fullValue,
                valueType,
                bytes: cellBytes,
                serializedBytes,
            });
        }
        const retainedRowBytes = Buffer.byteLength(JSON.stringify(row));
        if (bytes + retainedRowBytes > limits.bytes) {
            truncated = true;
            truncationReason = 'bytes';
            return;
        }
        for (const cell of detachedCells) {
            largeCellContext!.store.save({
                ownerKey: largeCellContext!.ownerKey,
                runId: largeCellContext!.runId,
                cellId: cell.id,
                value: cell.value,
                valueType: cell.valueType,
                bytes: cell.bytes,
                serializedBytes: cell.serializedBytes,
                columnName: columns[cell.index]!.name,
                columnIndex: cell.index,
                rowNumber: rows.length + 1,
            });
            largeCellBytes += cell.bytes;
            largeCellSerializedBytes += cell.serializedBytes;
        }
        rows.push(row);
        bytes += retainedRowBytes;
    };
    outer: for await (const chunk of stream) {
        pending += typeof chunk === 'string' ? chunk : decoder.write(chunk);
        let newline: number;
        while ((newline = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, newline);
            pending = pending.slice(newline + 1);
            consume(line);
            if (truncated) break outer;
        }
        // Limit an unterminated row before it is parsed. Exiting for-await closes the source
        // stream.
        const pendingBytes = Buffer.byteLength(pending);
        if (
            stage < 2
                ? pendingBytes + bytes > limits.bytes
                : pendingBytes > MAX_LARGE_CELL_ROW_BYTES
        ) {
            if (stage < 2)
                throw new AppError(
                    413,
                    'METADATA_TOO_LARGE',
                    'Result metadata exceeds the configured byte limit',
                );
            truncated = true;
            truncationReason = 'bytes';
            break;
        }
    }
    if (!truncated) {
        pending += decoder.end();
        if (pending.trim()) consume(pending);
    }
    requireThat(
        stage === 2,
        502,
        'RESULT_INCOMPLETE',
        'The server did not return a complete result header',
    );
    return {
        columns,
        rows,
        bytes,
        truncated,
        ...(truncationReason ? { truncationReason } : {}),
        bounded: { rows: limits.rows, bytes: limits.bytes },
    };
}
