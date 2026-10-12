/** Values remain lossless JSON: Int64/UInt64 and Decimal arrive as strings. */
export type Json =
    | null
    | boolean
    | number
    | string
    | Json[]
    | {
          [key: string]: Json;
      };

export type Row = Json[];

export interface Column {
    name: string;
    type: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isJson(value: unknown): value is Json {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.every(isJson);
    return isRecord(value) && Object.values(value).every(isJson);
}

export function parseJson(text: string): unknown {
    return JSON.parse(text);
}
