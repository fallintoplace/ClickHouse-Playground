import test from 'node:test';
import assert from 'node:assert/strict';
import {
    objectTypeFooterHelp,
    objectTypeLabel,
} from '../../.workspace-build/src/frontend/database/explorer/objects/tree/object-type-labels.js';

test('Object type labels use readable names for the known ClickHouse types', () => {
    assert.equal(objectTypeLabel('Dictionary'), 'Dictionary');
    assert.equal(objectTypeLabel('SharedMergeTree'), 'Shared MergeTree');
    assert.equal(objectTypeLabel('MaterializedView'), 'Materialized View');
});

test('Object type labels preserve unknown engine names', () => {
    assert.equal(objectTypeLabel('ReplacingMergeTree'), 'ReplacingMergeTree');
    assert.equal(objectTypeLabel('CustomEngine'), 'CustomEngine');
    assert.equal(objectTypeLabel('toString'), 'toString');
    assert.equal(objectTypeLabel('constructor'), 'constructor');
});

test('Object type footer help explains the known ClickHouse types', () => {
    assert.match(
        objectTypeFooterHelp('Dictionary'),
        /lookup table backed by a ClickHouse dictionary/i,
    );
    assert.match(objectTypeFooterHelp('SharedMergeTree'), /shared object storage/i);
    assert.match(objectTypeFooterHelp('MaterializedView'), /results of a saved query in a table/i);
});

test('Object type footer help is empty for unknown engine names', () => {
    assert.equal(objectTypeFooterHelp('CustomEngine'), undefined);
    assert.equal(objectTypeFooterHelp('toString'), undefined);
    assert.equal(objectTypeFooterHelp('constructor'), undefined);
});
