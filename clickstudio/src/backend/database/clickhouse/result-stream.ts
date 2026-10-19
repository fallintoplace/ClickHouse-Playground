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
    allowDetachedCells: boolean;
    trailingRowCapWhitespaceBytes: number;
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

// UTF-8 encodes each UTF-16 code unit in at most three bytes (surrogate pairs
// use four bytes for two units). Strings at or below this length cannot reach
// the detached-cell byte threshold, regardless of their contents.
const MAX_INLINE_STRING_CODE_UNITS = Math.floor(LARGE_CELL_INLINE_BYTES / 3);
// Keep a bounded read budget for malformed streams that never end after the row cap.
const MAX_ROW_CAP_TRAILING_WHITESPACE_BYTES = 1_000_000;

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
    // Rows without detachable cells can be retained directly.
    if (!largeCellContext) return { row: data, cells: [], bytes: 0, serializedBytes: 0 };

    // Most result rows contain no detached cells. Avoid copying every row.
    let row = data;
    const cells: DetachedCell[] = [];
    let bytes = 0;
    let serializedBytes = 0;

    for (let index = 0; index < data.length; index++) {
        const value = data[index];
        // Most result cells are short strings. Check them before other JSON types.
        // The UTF-16 bound is safe even for CJK, emoji, and unpaired surrogates.
        if (typeof value === 'string') {
            if (value.length <= MAX_INLINE_STRING_CODE_UNITS) continue;
        } else if (value === null || typeof value !== 'object') {
            continue;
        }

        const valueType = typeof value === 'string' ? 'text' : 'json';
        const fullValue =
            typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value));
        const cellBytes = Buffer.byteLength(fullValue);
        if (cellBytes <= LARGE_CELL_INLINE_BYTES) continue;

        // Only detached strings need their quoted JSON size. For objects/arrays,
        // the serialized value is already the representation we measured.
        const cellSerializedBytes =
            valueType === 'text' ? Buffer.byteLength(JSON.stringify(value)) : cellBytes;
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
        // Copy only when the first detached cell needs a replacement reference.
        if (row === data) row = [...data];
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

function rejectEmbeddedClickHouseException(data: unknown[], columns: Column[]): void {
    if (
        data.length !== 1 ||
        columns.length !== 1 ||
        typeof data[0] !== 'string' ||
        !data[0].startsWith('Code: ') ||
        // Text and variant columns can legitimately contain error-like strings.
        /String|Enum|JSON|Dynamic|Variant|Object/.test(columns[0]!.type)
    )
        return;
    // Older ClickHouse HTTP responses can encode an exception as a JSON array
    // after the result headers. A one-column numeric result would otherwise
    // accept the error message as a successful data row.
    if (/^Code: \d+\. DB::Exception:/.test(data[0]))
        throw new AppError(
            502,
            'RESULT_STREAM_ERROR',
            'ClickHouse interrupted the result stream. Inspect this query ID on the server.',
        );
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
    rejectEmbeddedClickHouseException(data, state.columns);
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

function retainTrailingRowCapWhitespace(state: StreamState, bytes: number): boolean {
    state.trailingRowCapWhitespaceBytes += bytes;
    if (state.trailingRowCapWhitespaceBytes <= MAX_ROW_CAP_TRAILING_WHITESPACE_BYTES) return true;
    markTruncated(state, 'bytes');
    return false;
}

function consumeLine(
    line: string,
    state: StreamState,
    limits: Pick<Limits, 'rows' | 'bytes'>,
    largeCellContext?: LargeCellContext,
): void {
    if (!line.trim()) {
        if (state.stage === 2 && state.rows.length >= limits.rows) {
            // Include line separators when counting repeated empty lines.
            retainTrailingRowCapWhitespace(state, Buffer.byteLength(line) + 1);
        }
        return;
    }
    // Avoid measuring a full extra row once the retained result is complete.
    if (state.stage === 2 && state.rows.length >= limits.rows) {
        markTruncated(state, 'rows');
        return;
    }
    const size = Buffer.byteLength(line);
    if (state.stage < 2 && state.bytes + size > limits.bytes) {
        throw new AppError(
            413,
            'METADATA_TOO_LARGE',
            'Result metadata exceeds the configured byte limit',
        );
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

interface PendingLine {
    fragments: string[];
    bytes: number;
}

function appendPendingFragment(
    pending: PendingLine,
    fragment: string,
    state: StreamState,
    limits: Pick<Limits, 'rows' | 'bytes'>,
): boolean {
    // An extra row needs no buffering or JSON parsing once the row cap is met.
    // Ignore trailing whitespace so an exactly-at-limit result stays complete.
    if (state.stage === 2 && state.rows.length >= limits.rows) {
        if (fragment.trim()) {
            markTruncated(state, 'rows');
            return false;
        }
        return retainTrailingRowCapWhitespace(state, Buffer.byteLength(fragment));
    }
    pending.fragments.push(fragment);
    pending.bytes += Buffer.byteLength(fragment);
    const limit =
        state.stage < 2 || !state.allowDetachedCells
            ? limits.bytes - state.bytes
            : MAX_LARGE_CELL_ROW_BYTES;
    if (pending.bytes <= limit) return true;

    // A string source may split a surrogate pair between chunks. Its halves
    // overestimate UTF-8 bytes, so remeasure the joined value only near the cap.
    const combined = pending.fragments.join('');
    pending.bytes = Buffer.byteLength(combined);
    if (pending.bytes > limit) {
        if (state.stage < 2) {
            throw new AppError(
                413,
                'METADATA_TOO_LARGE',
                'Result metadata exceeds the configured byte limit',
            );
        }
        markTruncated(state, state.rows.length >= limits.rows ? 'rows' : 'bytes');
        return false;
    }
    pending.fragments = [combined];
    return true;
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
        allowDetachedCells: largeCellContext !== undefined,
        trailingRowCapWhitespaceBytes: 0,
    };
    // Keep incomplete lines as fragments instead of rebuilding and measuring their
    // entire contents for every network chunk. Large values may span thousands of chunks.
    const pending: PendingLine = { fragments: [], bytes: 0 };

    outer: for await (const chunk of stream) {
        const decoded = typeof chunk === 'string' ? chunk : decoder.write(chunk);
        let start = 0;
        let newline = decoded.indexOf('\n');
        while (newline >= 0) {
            let line = decoded.slice(start, newline);
            if (pending.fragments.length) {
                pending.fragments.push(line);
                line = pending.fragments.join('');
                pending.fragments = [];
            }
            pending.bytes = 0;
            consumeLine(line, state, limits, largeCellContext);
            if (state.truncated) break outer;
            start = newline + 1;
            newline = decoded.indexOf('\n', start);
        }

        if (start === decoded.length) continue;
        if (!appendPendingFragment(pending, decoded.slice(start), state, limits)) break;
    }
    if (!state.truncated) {
        const tail = decoder.end();
        if (tail) pending.fragments.push(tail);
        const remainder = pending.fragments.join('');
        if (remainder.trim()) consumeLine(remainder, state, limits, largeCellContext);
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
