import test from 'node:test';
import assert from 'node:assert/strict';
import {
    objectTypeFooterHelp,
    objectTypeLabel,
} from '../../.workspace-build/src/frontend/database/explorer/objects/tree/object-type-labels.js';
import { copy } from '../../.workspace-build/src/frontend/ui/copy.js';

const objectTypes = copy.common.objectTypes;

test('Object type labels use readable names for the known ClickHouse types', () => {
    assert.equal(objectTypeLabel('Dictionary', objectTypes), 'Dictionary');
    assert.equal(objectTypeLabel('SharedMergeTree', objectTypes), 'Shared MergeTree');
    assert.equal(objectTypeLabel('MaterializedView', objectTypes), 'Materialized View');
});

test('Object type labels preserve unknown engine names', () => {
    assert.equal(objectTypeLabel('ReplacingMergeTree', objectTypes), 'ReplacingMergeTree');
    assert.equal(objectTypeLabel('CustomEngine', objectTypes), 'CustomEngine');
    assert.equal(objectTypeLabel('toString', objectTypes), 'toString');
    assert.equal(objectTypeLabel('constructor', objectTypes), 'constructor');
});

test('Object type footer help explains the known ClickHouse types', () => {
    assert.match(
        objectTypeFooterHelp('Dictionary', objectTypes),
        /lookup table backed by a ClickHouse dictionary/i,
    );
    assert.match(objectTypeFooterHelp('SharedMergeTree', objectTypes), /shared object storage/i);
    assert.match(
        objectTypeFooterHelp('MaterializedView', objectTypes),
        /results of a saved query in a table/i,
    );
});

test('Object type footer help is empty for unknown engine names', () => {
    assert.equal(objectTypeFooterHelp('CustomEngine', objectTypes), undefined);
    assert.equal(objectTypeFooterHelp('toString', objectTypes), undefined);
    assert.equal(objectTypeFooterHelp('constructor', objectTypes), undefined);
});
