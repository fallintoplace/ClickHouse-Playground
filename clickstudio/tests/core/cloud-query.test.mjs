import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudResultStreamQuery } from '../../.core-build/src/backend/database/clickhouse/query-format.js';
import { splitSql } from '../../.core-build/src/shared/sql/sql.js';
import { isCapability } from '../../.core-build/src/shared/database/connections/types.js';
import { isImportFormat } from '../../.core-build/src/shared/database/imports/limits.js';

test('Cloud result format follows a normalized SQL statement', () => {
    for (const sql of ['SELECT 1;', 'SELECT 1; -- trailing comment', "SELECT ';'"]) {
        const [statement] = splitSql(sql);
        assert.ok(statement);
        assert.equal(
            cloudResultStreamQuery(statement),
            `${statement.sql}\nFORMAT JSONCompactEachRowWithNamesAndTypes`,
        );
        assert.doesNotMatch(cloudResultStreamQuery(statement), /;\s*\nFORMAT/);
    }
});

test('Shared cloud capability validation accepts only supported shapes', () => {
    assert.equal(isCapability({ available: true }), true);
    assert.equal(isCapability({ available: false, reason: 'Not supported' }), true);
    for (const value of [null, [], {}, { available: 1 }, { available: true, reason: null }])
        assert.equal(isCapability(value), false);
});

test('Import format validation accepts the supported formats only', () => {
    for (const format of ['csv', 'json', 'ndjson']) assert.equal(isImportFormat(format), true);
    for (const format of ['parquet', 'CSV', '', null, {}])
        assert.equal(isImportFormat(format), false);
});
