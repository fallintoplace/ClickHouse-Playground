import assert from 'node:assert/strict';
import test from 'node:test';
import { collectCompactStream } from '../../.core-build/src/backend/database/clickhouse/result-stream.js';
import { LargeCellStore } from '../../.core-build/src/backend/queries/execution/large-cells.js';
import { MemoryStore } from '../../.core-build/src/backend/system/store.js';
import { isLargeCellReference } from '../../.core-build/src/shared/queries/results/large-cells.js';

const header = '["id","value"]\n["UInt64","String"]\n';

test('Incoming streams stop producing chunks at the retained row cap', async () => {
    let generated = 0;
    let closed = false;
    async function* source() {
        try {
            yield Buffer.from(header);
            for (let first = 0; first < 100_000; first += 100) {
                generated += 100;
                yield Buffer.from(
                    Array.from({ length: 100 }, (_, index) =>
                        JSON.stringify([String(first + index), 'short']),
                    ).join('\n') + '\n',
                );
            }
        } finally {
            closed = true;
        }
    }
    const result = await collectCompactStream(source(), { rows: 1_000, bytes: 2_000_000 });
    assert.equal(result.rows.length, 1_000);
    assert.equal(result.truncated, true);
    assert.equal(result.truncationReason, 'rows');
    assert.equal(result.rows.at(-1)[0], '999');
    assert.ok(generated < 100_000);
    assert.equal(closed, true);
});

test('Fragmented oversized cells stop before retaining the row', async () => {
    let chunksRead = 0;
    let closed = false;
    async function* source() {
        try {
            yield Buffer.from(header);
            yield Buffer.from('["1","');
            for (let index = 0; index < 1_000; index++) {
                chunksRead++;
                yield Buffer.alloc(1_024, 120);
            }
        } finally {
            closed = true;
        }
    }
    const result = await collectCompactStream(source(), { rows: 100, bytes: 8_192 });
    assert.equal(result.truncated, true);
    assert.equal(result.truncationReason, 'bytes');
    assert.equal(result.rows.length, 0);
    assert.ok(chunksRead < 20);
    assert.equal(closed, true);
});

test('Large-cell cleanup waits for an active run lease', async () => {
    const storage = new MemoryStore();
    const cells = new LargeCellStore(storage);
    const value = '界'.repeat(100_000);
    const release = cells.protectRun('memory-owner', 'memory-run');
    try {
        const result = await collectCompactStream(
            [header, JSON.stringify(['1', value]) + '\n'],
            { rows: 10, bytes: 20_000 },
            {
                store: cells,
                ownerKey: 'memory-owner',
                runId: 'memory-run',
                referenceToken: 'memory-token',
            },
        );
        assert.equal(result.truncated, false);
        const reference = result.rows[0][1];
        assert.ok(isLargeCellReference(reference, 'memory-token'));
        assert.equal(storage.count('large-cells'), 1);
        assert.equal(cells.get('memory-owner', 'memory-run', reference.id)?.value, value);
        cells.deleteRun('memory-owner', 'memory-run');
        assert.equal(storage.count('large-cells'), 1);
        release();
        assert.equal(storage.count('large-cells'), 0);
        assert.equal(storage.count('large-cell-index'), 0);
        assert.equal(cells.get('memory-owner', 'memory-run', reference.id), undefined);
    } finally {
        release();
    }
});
