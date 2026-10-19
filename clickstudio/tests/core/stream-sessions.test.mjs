import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { collectCompactStream } from '../../.core-build/src/backend/database/clickhouse/result-stream.js';
import { SessionService } from '../../.core-build/src/backend/system/login/sessions.js';
import { DEFAULT_LIMITS } from '../../.core-build/src/shared/queries/execution/settings.js';
import { CLOUD_QUERY_LIMITS } from '../../.core-build/src/shared/database/connections/cloud-policy.js';
import { FileStore, MemoryStore, audit } from '../../.core-build/src/backend/system/store.js';
import { LargeCellStore } from '../../.core-build/src/backend/queries/execution/large-cells.js';
import {
    isLargeCellReference,
    LARGE_CELL_INLINE_BYTES,
} from '../../.core-build/src/shared/queries/results/large-cells.js';
import { isRecord } from '../../.core-build/src/shared/common/values.js';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const header = '["id","text"]\n["UInt64","String"]\n';

function isNumericDocument(value) {
    return isRecord(value) && Number.isFinite(value.v);
}

test('Compact streaming preserves large integer strings and UTF-8 across byte boundaries', async () => {
    const buffer = Buffer.from(header + '["18446744073709551615","árvíztűrő"]\n');
    const output = await collectCompactStream(
        Readable.from([...buffer].map(n => Buffer.from([n]))),
        DEFAULT_LIMITS,
    );
    assert.equal(output.rows[0][0], '18446744073709551615');
    assert.equal(output.rows[0][1], 'árvíztűrő');
    assert.equal(output.truncated, false);
});
test('Streaming distinguishes exactly-at-limit complete results', async () => {
    const output = await collectCompactStream(Readable.from([header + '["1","a"]\n']), {
        ...DEFAULT_LIMITS,
        rows: 1,
    });
    assert.equal(output.truncated, false);
    assert.equal(output.rows.length, 1);
});
test('Cloud LIMIT results with three or five rows stay complete', async () => {
    for (const count of [3, 5]) {
        const result =
            header +
            Array.from(
                { length: count },
                (_, index) => `["${index + 1}","row-${index + 1}"]\n`,
            ).join('');
        const output = await collectCompactStream(Readable.from([result]), CLOUD_QUERY_LIMITS);
        assert.equal(output.rows.length, count);
        assert.equal(output.truncated, false);
    }
});
test('Cloud results below the display caps stay complete', async () => {
    const result =
        header +
        Array.from({ length: 2_000 }, (_, index) => `["${index + 1}","row-${index + 1}"]\n`).join(
            '',
        );
    const output = await collectCompactStream(Readable.from([result]), CLOUD_QUERY_LIMITS);
    assert.equal(output.rows.length, 2_000);
    assert.equal(output.truncated, false);
});
test('Cloud result caps retain the row prefix and flag an extra row', async () => {
    const result =
        header +
        Array.from(
            { length: CLOUD_QUERY_LIMITS.rows + 1 },
            (_, index) => `["${index + 1}","row-${index + 1}"]\n`,
        ).join('');
    const output = await collectCompactStream(Readable.from([result]), CLOUD_QUERY_LIMITS);
    assert.equal(output.rows.length, CLOUD_QUERY_LIMITS.rows);
    assert.equal(output.rows.at(-1)?.[0], String(CLOUD_QUERY_LIMITS.rows));
    assert.equal(output.truncated, true);
    assert.equal(output.truncationReason, 'rows');
});
test('Cloud results at the byte cap are complete until another row arrives', async () => {
    const firstRow = '["1","one"]\n',
        secondRow = '["2","two"]\n';
    const cap = Buffer.byteLength(header + firstRow);
    const complete = await collectCompactStream(Readable.from([header + firstRow]), {
        rows: 10,
        bytes: cap,
    });
    const bounded = await collectCompactStream(Readable.from([header + firstRow + secondRow]), {
        rows: 10,
        bytes: cap,
    });
    assert.equal(complete.truncated, false);
    assert.equal(complete.rows.length, 1);
    assert.equal(bounded.truncated, true);
    assert.equal(bounded.truncationReason, 'bytes');
    assert.deepEqual(bounded.rows, [['1', 'one']]);
});
test('Streaming closes the source after observing an extra row', async () => {
    let closed = false;
    async function* source() {
        try {
            yield Buffer.from(header + '["1","a"]\n["2","b"]\n');
            yield Buffer.alloc(1e6);
        } finally {
            closed = true;
        }
    }
    const output = await collectCompactStream(source(), { ...DEFAULT_LIMITS, rows: 1 });
    assert.equal(output.truncated, true);
    assert.equal(output.truncationReason, 'rows');
    assert.equal(output.rows.length, 1);
    assert.equal(closed, true);
});
test('Oversized unterminated rows are bounded before JSON.parse', async () => {
    const output = await collectCompactStream(
        Readable.from([header, '["1","' + 'x'.repeat(1000)]),
        { ...DEFAULT_LIMITS, bytes: 200 },
    );
    assert.equal(output.truncated, true);
    assert.equal(output.truncationReason, 'bytes');
    assert.equal(output.rows.length, 0);
});
test('Large result cells are stored separately and can be recovered losslessly', async () => {
    const value = 'x'.repeat(260_001);
    const objectValue = { payload: value };
    const store = new LargeCellStore(new MemoryStore());
    const output = await collectCompactStream(
        Readable.from([
            `${JSON.stringify(['text', 'json'])}\n`,
            `${JSON.stringify(['String', 'JSON'])}\n`,
            `${JSON.stringify([value, objectValue])}\n`,
        ]),
        { ...DEFAULT_LIMITS, bytes: 2_000 },
        { store, ownerKey: 'owner', runId: 'run', referenceToken: 'cell-token' },
    );
    const textReference = output.rows[0]?.[0];
    const jsonReference = output.rows[0]?.[1];
    assert.equal(output.truncated, false);
    assert.ok(isLargeCellReference(textReference, 'cell-token'));
    assert.ok(isLargeCellReference(jsonReference, 'cell-token'));
    assert.equal(store.jsonValue(store.get('owner', 'run', textReference.id)), value);
    assert.deepEqual(store.jsonValue(store.get('owner', 'run', jsonReference.id)), objectValue);
});
test('Wide short-string streams retain every cell without detached-cell writes', async () => {
    const names = Array.from({ length: 120 }, (_, index) => 'column_' + index);
    const types = names.map(() => 'String');
    const row = names.map((_, index) => `value-${index}-界🧪`);
    const rows = Array.from({ length: 20 }, () => row);
    const payload =
        [JSON.stringify(names), JSON.stringify(types), ...rows.map(JSON.stringify)].join('\n') +
        '\n';
    let detachedWrites = 0;
    const output = await collectCompactStream(
        Readable.from([Buffer.from(payload)]),
        { rows: 20, bytes: 2_000_000 },
        {
            store: { save: () => detachedWrites++ },
            ownerKey: 'owner',
            runId: 'wide',
            referenceToken: 'wide-token',
        },
    );
    assert.equal(output.truncated, false);
    assert.equal(output.columns.length, names.length);
    assert.deepEqual(output.rows, rows);
    assert.equal(detachedWrites, 0);
});

test('Large-cell fast path preserves UTF-8 boundary and non-detached strings', async () => {
    const codeUnits = Math.floor(LARGE_CELL_INLINE_BYTES / 3);
    const inlineCjk = '界'.repeat(codeUnits);
    const largeCjk = '界'.repeat(codeUnits + 1);
    const inlineAscii = 'a'.repeat(codeUnits + 1);
    const inlineEmoji = '🧪'.repeat(50_000);
    assert.equal(Buffer.byteLength(inlineCjk), LARGE_CELL_INLINE_BYTES - 1);
    assert.ok(Buffer.byteLength(largeCjk) > LARGE_CELL_INLINE_BYTES);
    const columns = ['cjk', 'ascii', 'emoji', 'large'];
    const row = [inlineCjk, inlineAscii, inlineEmoji, largeCjk];
    const store = new LargeCellStore(new MemoryStore());
    const output = await collectCompactStream(
        Readable.from([
            JSON.stringify(columns) + '\n',
            JSON.stringify(columns.map(() => 'String')) + '\n',
            JSON.stringify(row) + '\n',
        ]),
        { rows: 1, bytes: 2_000_000 },
        { store, ownerKey: 'owner', runId: 'boundary', referenceToken: 'boundary-token' },
    );
    assert.equal(output.truncated, false);
    assert.deepEqual(output.rows[0].slice(0, 3), row.slice(0, 3));
    const detached = output.rows[0][3];
    assert.ok(isLargeCellReference(detached, 'boundary-token'));
    assert.equal(store.jsonValue(store.get('owner', 'boundary', detached.id)), largeCjk);
});

test('Invalid names/types headers are rejected', async () => {
    await assert.rejects(
        collectCompactStream(Readable.from(['["n"]\n["UInt64","String"]\n']), DEFAULT_LIMITS),
        { code: 'RESULT_METADATA' },
    );
});
test('A broken ClickHouse stream cannot become a successful empty answer', async () => {
    await assert.rejects(
        collectCompactStream(
            Readable.from([header, 'Code: 123. DB::Exception: interrupted']),
            DEFAULT_LIMITS,
        ),
        { code: 'RESULT_STREAM_ERROR' },
    );
});
test('Repeated column names remain separate positional columns', async () => {
    const output = await collectCompactStream(
        Readable.from(['["n","n"]\n["UInt64","UInt64"]\n["1","2"]\n']),
        DEFAULT_LIMITS,
    );
    assert.deepEqual(output.rows, [['1', '2']]);
    assert.equal(output.columns[1].name, 'n');
});
test('Header-only output is a valid empty result', async () => {
    const output = await collectCompactStream(Readable.from([header]), DEFAULT_LIMITS);
    assert.equal(output.rows.length, 0);
    assert.equal(output.truncated, false);
});
test('Fragmented large rows preserve detachable values and Unicode', async () => {
    const value = '🧪'.repeat(300_000);
    const encoded = Buffer.from(header + JSON.stringify(['1', value]) + '\n');
    const chunks = Array.from({ length: Math.ceil(encoded.length / 4096) }, (_, index) =>
        encoded.subarray(index * 4096, (index + 1) * 4096),
    );
    const store = new LargeCellStore(new MemoryStore());
    const output = await collectCompactStream(
        Readable.from(chunks),
        { ...DEFAULT_LIMITS, bytes: 2_000 },
        { store, ownerKey: 'owner', runId: 'chunked', referenceToken: 'token' },
    );
    const reference = output.rows[0]?.[1];
    assert.equal(output.truncated, false);
    assert.equal(output.rows.length, 1);
    assert.ok(isLargeCellReference(reference, 'token'));
    assert.equal(store.jsonValue(store.get('owner', 'chunked', reference.id)), value);
});

test('Chunked rows preserve boundaries and a final row without a newline', async () => {
    const result = header + '["1","first"]\n["2","🧪"]';
    const encoded = Buffer.from(result);
    const output = await collectCompactStream(
        Readable.from([...encoded].map(byte => Buffer.from([byte]))),
        DEFAULT_LIMITS,
    );
    assert.deepEqual(output.rows, [
        ['1', 'first'],
        ['2', '🧪'],
    ]);
    assert.equal(output.truncated, false);
});

test('String chunks split across surrogate pairs retain exact header byte limits', async () => {
    const names = '["value"]';
    const types = '["🧪🧪"]';
    const output = await collectCompactStream(
        Readable.from([names + '\n', '["', '\ud83e', '\uddea', '\ud83e', '\uddea', '"]\n']),
        {
            ...DEFAULT_LIMITS,
            bytes: Buffer.byteLength(names) + Buffer.byteLength(types),
        },
    );
    assert.deepEqual(output.columns, [{ name: 'value', type: '🧪🧪' }]);
    assert.equal(output.truncated, false);
});

test('Chunked rows still stop at the retained result byte budget', async () => {
    const firstRow = '["1","one"]';
    const secondRow = '["2","' + 'x'.repeat(512) + '"]';
    const encoded = Buffer.from(header + firstRow + '\n' + secondRow + '\n');
    const chunks = Array.from({ length: Math.ceil(encoded.length / 17) }, (_, index) =>
        encoded.subarray(index * 17, (index + 1) * 17),
    );
    const output = await collectCompactStream(Readable.from(chunks), {
        ...DEFAULT_LIMITS,
        bytes: Buffer.byteLength(header) + Buffer.byteLength(firstRow) + 20,
    });
    assert.deepEqual(output.rows, [['1', 'one']]);
    assert.equal(output.truncated, true);
    assert.equal(output.truncationReason, 'bytes');
});

test('Unterminated rows without large-cell storage stop at the remaining byte cap', async () => {
    let chunksRead = 0;
    let closed = false;
    async function* source() {
        try {
            yield header;
            for (let index = 0; index < 100; index++) {
                chunksRead++;
                yield 'x'.repeat(64);
            }
        } finally {
            closed = true;
        }
    }
    const output = await collectCompactStream(source(), {
        ...DEFAULT_LIMITS,
        bytes: Buffer.byteLength(header) + 128,
    });
    assert.equal(output.truncated, true);
    assert.equal(output.truncationReason, 'bytes');
    assert.equal(output.rows.length, 0);
    assert.equal(chunksRead, 3);
    assert.equal(closed, true);
});

test('Row caps take precedence over bytes for a fragmented extra row', async () => {
    const firstRow = '["1","one"]\n';
    const output = await collectCompactStream(
        Readable.from([header + firstRow, '["2","', 'x'.repeat(500)]),
        {
            ...DEFAULT_LIMITS,
            rows: 1,
            bytes: Buffer.byteLength(header + firstRow) + 16,
        },
    );
    assert.deepEqual(output.rows, [['1', 'one']]);
    assert.equal(output.truncated, true);
    assert.equal(output.truncationReason, 'rows');
});

test('Row caps stop before buffering an unterminated extra row', async () => {
    for (const withLargeCells of [false, true]) {
        let chunksRead = 0;
        let closed = false;
        async function* source() {
            try {
                yield Buffer.from(header + '["1","one"]\n');
                for (let index = 0; index < 1_000; index++) {
                    chunksRead++;
                    yield Buffer.alloc(64 * 1024, 120);
                }
            } finally {
                closed = true;
            }
        }
        const context = withLargeCells
            ? {
                  store: {
                      save: () => {
                          throw new Error('Short cells must remain inline');
                      },
                  },
                  ownerKey: 'owner',
                  runId: 'cap',
                  referenceToken: 'cap-token',
              }
            : undefined;
        const output = await collectCompactStream(
            source(),
            { rows: 1, bytes: 55_000_000 },
            context,
        );
        assert.deepEqual(output.rows, [['1', 'one']]);
        assert.equal(output.truncated, true);
        assert.equal(output.truncationReason, 'rows');
        assert.equal(chunksRead, 1);
        assert.equal(closed, true);
    }
});

test('Trailing whitespace after an exact row cap does not imply truncation', async () => {
    const lastRow = '["1","one"]';
    const output = await collectCompactStream(
        Readable.from([header + lastRow + '\n', ' '.repeat(128_000), '\n  ']),
        { rows: 1, bytes: Buffer.byteLength(header + lastRow) },
    );
    assert.deepEqual(output.rows, [['1', 'one']]);
    assert.equal(output.truncated, false);
});

test('Whitespace-only traffic after a row cap has a bounded read budget', async () => {
    let chunksRead = 0;
    let closed = false;
    async function* source() {
        try {
            yield header + '["1","one"]\n';
            for (let index = 0; index < 5_000; index++) {
                chunksRead++;
                yield ' '.repeat(16_384);
            }
        } finally {
            closed = true;
        }
    }
    const output = await collectCompactStream(source(), { rows: 1, bytes: 55_000_000 });
    assert.deepEqual(output.rows, [['1', 'one']]);
    assert.equal(output.truncated, true);
    assert.equal(output.truncationReason, 'bytes');
    assert.ok(chunksRead < 100);
    assert.equal(closed, true);
});

test('Local-only sessions are explicit single-owner identities', () =>
    assert.equal(new SessionService().principal().id, 'local-owner'));
test('Configured sessions require authentication and use random cookies', () => {
    const sessions = new SessionService('s'.repeat(40));
    assert.equal(sessions.principal(), undefined);
    const a = sessions.login('s'.repeat(40), 'local'),
        b = sessions.login('s'.repeat(40), 'local');
    assert.notEqual(a, b);
    assert.equal(sessions.principal(`other=x; clickstudio_session=${a}`).role, 'owner');
});
test('Wrong login token cannot create a session', () => {
    const sessions = new SessionService('s'.repeat(40));
    assert.throws(() => sessions.login('wrong', 'local'), { code: 'INVALID_TOKEN' });
});
test('Login brute-force budget is enforced', () => {
    const sessions = new SessionService('s'.repeat(40));
    for (let i = 0; i < 10; i++) assert.throws(() => sessions.login('wrong', 'local'));
    assert.throws(() => sessions.login('s'.repeat(40), 'local'), { code: 'LOGIN_RATE_LIMIT' });
});
test('Logout immediately invalidates the server-side cookie', () => {
    const sessions = new SessionService('s'.repeat(40)),
        token = sessions.login('s'.repeat(40), 'local'),
        cookie = `clickstudio_session=${token}`;
    sessions.logout(cookie);
    assert.equal(sessions.principal(cookie), undefined);
});
test('File storage is atomic, private, and independent of returned object mutation', () => {
    const path = mkdtempSync(join(tmpdir(), 'clickstudio-'));
    try {
        const store = new FileStore(path);
        store.put('docs', 'one', { v: 1 });
        const read = store.get('docs', 'one', isNumericDocument);
        read.v = 2;
        assert.equal(store.get('docs', 'one', isNumericDocument).v, 1);
        assert.equal(statSync(join(path, 'docs', 'one.json')).mode & 0o777, 0o600);
        store.put('docs', 'one', { v: 3 });
        assert.equal(store.list('docs', isNumericDocument).length, 1);
        assert.equal(store.get('docs', 'one', isNumericDocument).v, 3);
    } finally {
        rmSync(path, { recursive: true, force: true });
    }
});
test('Store key counts distinguish creates from updates', () => {
    const store = new MemoryStore();
    store.put('docs', 'one', { v: 1 });
    store.put('docs', 'one', { v: 2 });
    store.put('docs', 'two', { v: 3 });
    assert.equal(store.count('docs'), 2);
    assert.deepEqual(store.keys('docs').sort(), ['one', 'two']);
    store.delete('docs', 'one');
    assert.equal(store.count('docs'), 1);
});
test('Audit retention prunes by keys without scanning stored event values', () => {
    const store = new MemoryStore();
    store.list = () => {
        throw new Error('audit pruning must not parse all stored events');
    };
    const principal = { id: 'local-owner', role: 'owner' };
    for (let i = 0; i < 5001; i++) audit(store, principal, 'test', String(i));
    assert.equal(store.count('audit'), 4500);
});
test('Storage keys reject filesystem traversal', () => {
    const path = mkdtempSync(join(tmpdir(), 'clickstudio-'));
    try {
        const store = new FileStore(path);
        assert.throws(() => store.put('../outside', 'x', {}), { code: 'INVALID_STORAGE_KEY' });
        assert.throws(() => store.get('docs', '../../outside', isNumericDocument), {
            code: 'INVALID_STORAGE_KEY',
        });
    } finally {
        rmSync(path, { recursive: true, force: true });
    }
});
test('Corrupt durable state is surfaced, never silently replaced', () => {
    const path = mkdtempSync(join(tmpdir(), 'clickstudio-'));
    try {
        const store = new FileStore(path);
        store.put('docs', 'one', {});
        writeFileSync(join(path, 'docs', 'one.json'), 'broken');
        assert.throws(() => store.get('docs', 'one', isNumericDocument));
    } finally {
        rmSync(path, { recursive: true, force: true });
    }
});
