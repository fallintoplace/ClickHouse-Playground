import test from 'node:test';
import assert from 'node:assert/strict';
import { fullResultExportSql } from '../../src/shared/queries/execution/full-result-export.js';

test('full result export removes the generated preview row limit', () => {
    assert.equal(
        fullResultExportSql('SELECT * FROM `analytics`.`events` LIMIT 100;', '100'),
        'SELECT * FROM `analytics`.`events`',
    );
});

test('full result export preserves a user-written limit without a generated preview marker', () => {
    assert.equal(
        fullResultExportSql('SELECT * FROM events LIMIT 100;', undefined),
        'SELECT * FROM events LIMIT 100',
    );
});

test('full result export uses the first statement from a multi-statement run', () => {
    assert.equal(
        fullResultExportSql('SELECT * FROM events LIMIT 100; SELECT 2;', '100'),
        'SELECT * FROM events LIMIT 100',
    );
});

test('full result export preserves different limits and nested limits', () => {
    assert.equal(
        fullResultExportSql('SELECT * FROM events LIMIT 100000;', '100'),
        'SELECT * FROM events LIMIT 100000',
    );
    assert.equal(
        fullResultExportSql('SELECT * FROM (SELECT * FROM events LIMIT 100) LIMIT 100;', '100'),
        'SELECT * FROM (SELECT * FROM events LIMIT 100)',
    );
    assert.equal(
        fullResultExportSql('SELECT * FROM events LIMIT 100 BY key;', '100'),
        'SELECT * FROM events LIMIT 100 BY key',
    );
});
