import test from 'node:test';
import assert from 'node:assert/strict';
import { sameParameters } from '../../.workspace-build/src/frontend/queries/history/query-parameter-comparison.js';

for (const [title, left, right, expected] of [
    ['Empty parameters match', {}, {}, true],
    ['Insertion order does not change evidence', { a: '1', b: '2' }, { b: '2', a: '1' }, true],
    ['Changed parameter makes evidence stale', { value: 'before' }, { value: 'after' }, false],
    ['Missing key is not an empty value', { value: '' }, {}, false],
    ['Additional parameter is detected', {}, { value: '' }, false],
    [
        'UInt64 strings remain exact',
        { n: '18446744073709551615' },
        { n: '18446744073709551614' },
        false,
    ],
    ['Only own keys participate', { toString: 'x' }, {}, false],
])
    test(title, () => assert.equal(sameParameters(left, right), expected));
