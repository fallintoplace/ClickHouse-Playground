import { deflateSync, inflateSync, strToU8 } from 'fflate';
import { MAX_SQL_CHARS, MAX_SQL_FILE_BYTES } from '../../../../shared/queries/execution/limits.js';

export const MAX_SQL_SHARE_URL_LENGTH = 8192;
const MAX_SHARE_NAME_CHARS = 160;
const DEFAULT_SHARE_NAME = 'Shared SQL.sql';

export type SharedSql = Readonly<{ sql: string; name: string }>;

function toBase64Url(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
    if (!value || value.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/.test(value))
        throw new Error('Invalid SQL share link data.');
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
    let binary: string;
    try {
        binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    } catch {
        throw new Error('Invalid SQL share link data.');
    }
    return Uint8Array.from(binary, character => character.charCodeAt(0));
}

/**
 * v1 encodes the UTF-8 SQL bytes as raw DEFLATE, then unpadded Base64URL.
 * An optional name is a separate fragment parameter. Never include credentials,
 * query parameters, connection profiles, or result data.
 */
export function createSqlShareLink(sql: string, name: string, currentUrl: string): string {
    if (!sql.trim()) throw new Error('Write SQL before sharing.');
    if (sql.length > MAX_SQL_CHARS) throw new Error('This SQL is too large to share as a link.');

    const utf8 = strToU8(sql);
    if (utf8.length > MAX_SQL_FILE_BYTES)
        throw new Error('This SQL is too large for a share link. Export a .sql file instead.');

    // Start from the origin and pathname so private connection IDs and other
    // search/hash parameters cannot leak into the copied URL.
    const current = new URL(currentUrl);
    const shared = new URL(current.pathname, current.origin);
    const fragment = new URLSearchParams();
    fragment.set('sqlz', 'v1.' + toBase64Url(deflateSync(utf8)));
    if (name.trim()) fragment.set('name', name.trim().slice(0, MAX_SHARE_NAME_CHARS));
    shared.hash = fragment.toString();

    const link = shared.toString();
    if (link.length > MAX_SQL_SHARE_URL_LENGTH)
        throw new Error('The share link is too long. Export a .sql file instead.');
    return link;
}

/** Read a share fragment without sending it to a server or executing its SQL. */
export function readSqlShareHash(hash: string): SharedSql | undefined {
    if (!hash.startsWith('#sqlz=')) return undefined;
    if (hash.length > MAX_SQL_SHARE_URL_LENGTH) throw new Error('The SQL share link is too long.');

    const fragment = new URLSearchParams(hash.slice(1));
    const versions = fragment.getAll('sqlz');
    if (versions.length !== 1 || fragment.getAll('name').length > 1)
        throw new Error('Invalid SQL share link.');
    const token = versions[0] ?? '';
    if (!token.startsWith('v1.')) throw new Error('Unsupported SQL share link version.');

    const compressed = fromBase64Url(token.slice(3));
    let decoded: Uint8Array;
    try {
        // An explicit output cap prevents a crafted DEFLATE payload from
        // allocating arbitrarily large decompressed buffers.
        decoded = inflateSync(compressed, { out: new Uint8Array(MAX_SQL_FILE_BYTES + 1) });
    } catch {
        throw new Error('The SQL share link is invalid or damaged.');
    }
    if (decoded.length > MAX_SQL_FILE_BYTES)
        throw new Error('The shared SQL exceeds the maximum supported size.');

    let sql: string;
    try {
        sql = new TextDecoder('utf-8', { fatal: true }).decode(decoded);
    } catch {
        throw new Error('The shared SQL is not valid UTF-8.');
    }
    if (!sql.trim() || sql.length > MAX_SQL_CHARS)
        throw new Error('The shared SQL is empty or too large.');

    const name = fragment.get('name')?.trim() || DEFAULT_SHARE_NAME;
    if (name.length > MAX_SHARE_NAME_CHARS) throw new Error('The shared query name is too long.');
    return { sql, name };
}
