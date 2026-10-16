import { isRecord } from '../../common/values.js';

const LARGE_CELL_ID =
    /^(?:e[0-9a-z]{1,10}_)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const LARGE_CELL_INLINE_BYTES = 256_000;
export const MAX_LARGE_CELL_BYTES = 50_000_000;
export const MAX_LARGE_CELL_BYTES_PER_RESULT = 50_000_000;
export const MAX_LARGE_CELL_ROW_BYTES = MAX_LARGE_CELL_BYTES + 1_000_000;
export const MAX_LARGE_CELL_STORAGE_BYTES = 1_000_000_000;

export interface LargeCellReference {
    __clickstudioLargeCell: string;
    id: string;
    bytes: number;
    serializedBytes: number;
    fingerprint: string;
    preview: string;
    valueType: 'text' | 'json';
}

export function isLargeCellReference(value: unknown, token?: string): value is LargeCellReference {
    return (
        isRecord(value) &&
        typeof token === 'string' &&
        value.__clickstudioLargeCell === token &&
        typeof value.id === 'string' &&
        LARGE_CELL_ID.test(value.id) &&
        typeof value.bytes === 'number' &&
        Number.isSafeInteger(value.bytes) &&
        value.bytes > 0 &&
        typeof value.serializedBytes === 'number' &&
        Number.isSafeInteger(value.serializedBytes) &&
        value.serializedBytes >= value.bytes &&
        typeof value.fingerprint === 'string' &&
        /^[0-9a-f]{64}$/i.test(value.fingerprint) &&
        typeof value.preview === 'string' &&
        (value.valueType === 'text' || value.valueType === 'json')
    );
}
