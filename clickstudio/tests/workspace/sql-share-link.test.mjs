import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync } from 'fflate';
import {
    createSqlShareLink,
    readSqlShareHash,
    MAX_SQL_SHARE_URL_LENGTH,
} from '../../.workspace-build/src/frontend/queries/editor/share/sql-share-link.js';

const origin = 'https://clickstudio-eight.vercel.app/';

test('The public SELECT 1 fixture is compatible with raw DEFLATE Base64URL v1', () => {
    assert.deepEqual(readSqlShareHash('#sqlz=v1.C3b1cXUOUTAEAA'), {
        sql: 'SELECT 1',
        name: 'Shared SQL.sql',
    });
});

test('SQL links round trip Unicode, multiline SQL and query names', () => {
    const sql = "SELECT '🐱', 'Grüße', '字'\nFROM numbers(10)\nWHERE value = 1;";
    const link = createSqlShareLink(sql, 'My query & plans.sql', origin);
    const url = new URL(link);
    assert.equal(url.origin + url.pathname, origin);
    assert.deepEqual(readSqlShareHash(url.hash), {
        sql,
        name: 'My query & plans.sql',
    });
});

test('Copied SQL links do not expose connection IDs, query strings or old fragments', () => {
    const link = new URL(
        createSqlShareLink(
            'SELECT 1',
            '',
            origin + 'experimental?connection=private-cloud&api_key=secret#old-fragment',
        ),
    );
    assert.equal(link.pathname, '/experimental');
    assert.equal(link.search, '');
    assert.equal(link.hash.includes('api_key'), false);
    assert.equal(link.hash.includes('connection'), false);
    assert.equal(readSqlShareHash(link.hash).sql, 'SELECT 1');
});

test('No fragment and unrelated fragment are ignored', () => {
    assert.equal(readSqlShareHash(''), undefined);
    assert.equal(readSqlShareHash('#view=chart'), undefined);
});

test('Empty, malformed, duplicate and unsupported share links fail safely', () => {
    assert.throws(() => createSqlShareLink('  ', 'Nothing.sql', origin), /Write SQL/);
    for (const hash of [
        '#sqlz=v1.',
        '#sqlz=v1.?',
        '#sqlz=v2.C3b1cXUOUTAEAA',
        '#sqlz=v1.C3b1cXUOUTAEAA&sqlz=v1.C3b1cXUOUTAEAA',
        '#sqlz=v1.%%%bad%%%',
    ]) {
        assert.throws(() => readSqlShareHash(hash), Error, hash);
    }
});

test('Invalid UTF-8 and uncompressed oversized payloads are rejected', () => {
    const encode = bytes => Buffer.from(deflateSync(Uint8Array.from(bytes))).toString('base64url');
    assert.throws(() => readSqlShareHash('#sqlz=v1.' + encode([255, 254])), /valid UTF-8/);
    assert.throws(
        () => readSqlShareHash('#sqlz=v1.' + encode(Buffer.alloc(200_001, 65))),
        /maximum supported size/,
    );
});

test('Link size is bounded and provides a SQL export fallback', () => {
    const sql = Array.from({ length: 6000 }, (_, i) => ((i * 2654435761) >>> 0).toString(36)).join(
        ' ',
    );
    assert.throws(() => createSqlShareLink(sql, 'Large.sql', origin), /Export a .sql file instead/);
    assert.throws(
        () => readSqlShareHash('#sqlz=' + 'x'.repeat(MAX_SQL_SHARE_URL_LENGTH)),
        /too long/,
    );
});
