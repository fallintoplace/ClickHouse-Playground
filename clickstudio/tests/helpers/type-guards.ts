import type { Server } from 'node:http';

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function jsonRecord(value: unknown, label = 'JSON value'): Record<string, unknown> {
    if (!isRecord(value)) throw new Error(`${label} was not an object`);
    return value;
}

export function jsonValue(text: string): unknown {
    const value: unknown = JSON.parse(text);
    return value;
}

export function stringValue(value: unknown, label = 'value'): string {
    if (typeof value !== 'string') throw new Error(`${label} was not a string`);
    return value;
}

export function numberValue(value: unknown, label = 'value'): number {
    if (typeof value !== 'number' || !Number.isFinite(value))
        throw new Error(`${label} was not a finite number`);
    return value;
}

export function arrayValue(value: unknown, label = 'value'): unknown[] {
    if (!Array.isArray(value)) throw new Error(`${label} was not an array`);
    return value;
}

export function decodeValue<T>(
    value: unknown,
    guard: (value: unknown) => value is T,
    label = 'JSON value',
): T {
    if (!guard(value)) throw new Error(`${label} had an unexpected shape`);
    return value;
}

export function decodeArray<T>(
    value: unknown,
    guard: (value: unknown) => value is T,
    label = 'JSON array',
): T[] {
    return arrayValue(value, label).map((item, index) =>
        decodeValue(item, guard, `${label} item ${index}`),
    );
}

export async function responseJson(response: { json(): Promise<unknown> }): Promise<unknown> {
    return response.json();
}

export async function responseRecord(
    response: { json(): Promise<unknown> },
    label?: string,
): Promise<Record<string, unknown>> {
    return jsonRecord(await responseJson(response), label);
}

export async function responseValue<T>(
    response: { json(): Promise<unknown> },
    guard: (value: unknown) => value is T,
    label?: string,
): Promise<T> {
    return decodeValue(await responseJson(response), guard, label);
}

export async function responseErrorCode(response: { json(): Promise<unknown> }): Promise<string> {
    const body = await responseRecord(response, 'Error response');
    const error = jsonRecord(body.error, 'Error detail');
    return stringValue(error.code, 'Error code');
}

export function serverPort(server: Server): number {
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Server is not listening on a TCP port');
    return address.port;
}
