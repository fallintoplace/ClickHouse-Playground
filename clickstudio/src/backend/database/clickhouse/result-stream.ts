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

interface StreamState {
    stage: 0 | 1 | 2;
    names: string[];
    columns: Column[];
    rows: Row[];
    bytes: number;
    largeCellBytes: number;
    largeCellSerializedBytes: number;
    truncated: boolean;
    truncationReason?: ResultTruncationReason;
}

interface DetachedCell {
    id: string;
    index: number;
    columnName: string;
    value: string;
    valueType: 'text' | 'json';
    bytes: number;
    serializedBytes: number;
}

interface PreparedRow {
    row: Row;
    cells: DetachedCell[];
    bytes: number;
    serializedBytes: number;
}

function isRow(value: unknown): value is Row {
    return Array.isArray(value) && value.every(isJson);
}

function parseCompactLine(line: string): unknown {
    try {
        return JSON.parse(line);
    } catch {
        throw new AppError(
            502,
            'RESULT_STREAM_ERROR',
            'ClickHouse interrupted the result stream or returned invalid data. Inspect this query ID on the server.',
        );
    }
}

function markTruncated(state: StreamState, reason: ResultTruncationReason): void {
    state.truncated = true;
    state.truncationReason = reason;
}

function consumeHeader(data: unknown[], size: number, state: StreamState): void {
    requireThat(
        isStringArray(data) && data.length > 0 && data.length <= 500,
        502,
        'RESULT_METADATA',
        'Invalid names/types header',
    );
    if (state.stage === 0) {
        state.names = data;
    } else {
        requireThat(
            data.length === state.names.length,
            502,
            'RESULT_METADATA',
            'Column names and types differ',
        );
        state.columns = state.names.map((name, index) => {
            const type = data[index];
            requireThat(
                type !== undefined,
                502,
                'RESULT_METADATA',
                'Column names and types differ',
            );
            return { name, type };
        });
    }
    state.bytes += size;
    state.stage = state.stage === 0 ? 1 : 2;
}

function prepareRow(
    data: Row,
    columns: Column[],
    largeCellContext: LargeCellContext | undefined,
    state: StreamState,
): PreparedRow | undefined {
    const row = [...data];
    const cells: DetachedCell[] = [];
    let bytes = 0;
    let serializedBytes = 0;

    if (!largeCellContext) return { row, cells, bytes, serializedBytes };

    for (let index = 0; index < data.length; index++) {
        const value = data[index];
        if (value === undefined || value === null) continue;
        const valueType = typeof value === 'string' ? 'text' : 'json';
        const fullValue =
            typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value));
        const jsonValue = JSON.stringify(value) ?? fullValue;
        const cellBytes = Buffer.byteLength(fullValue);
        const cellSerializedBytes = Buffer.byteLength(jsonValue);
        if (cellBytes <= LARGE_CELL_INLINE_BYTES) continue;

        const nextBytes = bytes + cellBytes;
        const nextSerializedBytes = serializedBytes + cellSerializedBytes;
        if (
            cellBytes > MAX_LARGE_CELL_BYTES ||
            cellSerializedBytes > MAX_LARGE_CELL_BYTES ||
            state.largeCellBytes + nextBytes > MAX_LARGE_CELL_BYTES_PER_RESULT ||
            state.largeCellSerializedBytes + nextSerializedBytes > MAX_LARGE_CELL_BYTES_PER_RESULT
        ) {
            return undefined;
        }

        const column = columns[index];
        requireThat(
            column !== undefined,
            502,
            'RESULT_WIDTH',
            'Unexpected number of fields in a result row',
        );
        const id = largeCellContext.expiresAt
            ? `e${largeCellContext.expiresAt.toString(36)}_${randomUUID()}`
            : randomUUID();
        row[index] = {
            __clickstudioLargeCell: largeCellContext.referenceToken,
            id,
            bytes: cellBytes,
            serializedBytes: cellSerializedBytes,
            fingerprint: createHash('sha256')
                .update(valueType)
                .update('\0')
                .update(fullValue)
                .digest('hex'),
            preview: previewResultCell(value),
            valueType,
        };
        cells.push({
            id,
            index,
            columnName: column.name,
            value: fullValue,
            valueType,
            bytes: cellBytes,
            serializedBytes: cellSerializedBytes,
        });
        bytes = nextBytes;
        serializedBytes = nextSerializedBytes;
    }

    return { row, cells, bytes, serializedBytes };
}

function retainRow(
    data: unknown[],
    state: StreamState,
    limits: Pick<Limits, 'rows' | 'bytes'>,
    largeCellContext?: LargeCellContext,
): void {
    requireThat(isRow(data), 502, 'RESULT_FORMAT', 'Expected a compact JSON row');
    requireThat(
        data.length === state.columns.length,
        502,
        'RESULT_WIDTH',
        'Unexpected number of fields in a result row',
    );
    const prepared = prepareRow(data, state.columns, largeCellContext, state);
    if (!prepared) {
        markTruncated(state, 'bytes');
        return;
    }
    const rowBytes = Buffer.byteLength(JSON.stringify(prepared.row));
    if (state.bytes + rowBytes > limits.bytes) {
        markTruncated(state, 'bytes');
        return;
    }
    for (const cell of prepared.cells) {
        largeCellContext?.store.save({
            ownerKey: largeCellContext.ownerKey,
            runId: largeCellContext.runId,
            cellId: cell.id,
            value: cell.value,
            valueType: cell.valueType,
            bytes: cell.bytes,
            serializedBytes: cell.serializedBytes,
            columnName: cell.columnName,
            columnIndex: cell.index,
            rowNumber: state.rows.length + 1,
        });
    }
    state.largeCellBytes += prepared.bytes;
    state.largeCellSerializedBytes += prepared.serializedBytes;
    state.rows.push(prepared.row);
    state.bytes += rowBytes;
}

function consumeLine(
    line: string,
    state: StreamState,
    limits: Pick<Limits, 'rows' | 'bytes'>,
    largeCellContext?: LargeCellContext,
): void {
    if (!line.trim()) return;
    const size = Buffer.byteLength(line);
    if (state.stage < 2 && state.bytes + size > limits.bytes) {
        throw new AppError(
            413,
            'METADATA_TOO_LARGE',
            'Result metadata exceeds the configured byte limit',
        );
    }
    if (state.stage >= 2 && state.rows.length >= limits.rows) {
        markTruncated(state, 'rows');
        return;
    }
    const maxRowBytes = largeCellContext ? MAX_LARGE_CELL_ROW_BYTES : limits.bytes - state.bytes;
    if (state.stage >= 2 && size > maxRowBytes) {
        markTruncated(state, 'bytes');
        return;
    }

    const data = parseCompactLine(line);
    requireThat(Array.isArray(data), 502, 'RESULT_FORMAT', 'Expected a compact JSON row');
    if (state.stage < 2) consumeHeader(data, size, state);
    else retainRow(data, state, limits, largeCellContext);
}

/** Bounded parsing before JSON.parse: even one very large string cannot grow without limit. */
export async function collectCompactStream(
    stream: AsyncIterable<Buffer | string>,
    limits: Pick<Limits, 'rows' | 'bytes'>,
    largeCellContext?: LargeCellContext,
): Promise<DriverResult> {
    const decoder = new StringDecoder('utf8');
    const state: StreamState = {
        stage: 0,
        names: [],
        columns: [],
        rows: [],
        bytes: 0,
        largeCellBytes: 0,
        largeCellSerializedBytes: 0,
        truncated: false,
    };
    let pending = '';

    outer: for await (const chunk of stream) {
        pending += typeof chunk === 'string' ? chunk : decoder.write(chunk);
        let newline: number;
        while ((newline = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, newline);
            pending = pending.slice(newline + 1);
            consumeLine(line, state, limits, largeCellContext);
            if (state.truncated) break outer;
        }
        // Limit an unterminated row before it is parsed. Exiting for-await closes the source
        // stream.
        const pendingBytes = Buffer.byteLength(pending);
        if (
            state.stage < 2
                ? pendingBytes + state.bytes > limits.bytes
                : pendingBytes > MAX_LARGE_CELL_ROW_BYTES
        ) {
            if (state.stage < 2) {
                throw new AppError(
                    413,
                    'METADATA_TOO_LARGE',
                    'Result metadata exceeds the configured byte limit',
                );
            }
            markTruncated(state, 'bytes');
            break;
        }
    }
    if (!state.truncated) {
        pending += decoder.end();
        if (pending.trim()) consumeLine(pending, state, limits, largeCellContext);
    }
    requireThat(
        state.stage === 2,
        502,
        'RESULT_INCOMPLETE',
        'The server did not return a complete result header',
    );
    return {
        columns: state.columns,
        rows: state.rows,
        bytes: state.bytes,
        truncated: state.truncated,
        ...(state.truncationReason ? { truncationReason: state.truncationReason } : {}),
        bounded: { rows: limits.rows, bytes: limits.bytes },
    };
}
