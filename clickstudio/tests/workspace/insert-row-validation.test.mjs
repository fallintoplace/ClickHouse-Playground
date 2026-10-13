import test from 'node:test';
import assert from 'node:assert/strict';
import {
    insertRowValidationErrors,
    insertRowValuePlaceholder,
    isOptionalInsertRowColumn,
} from '../../.workspace-build/src/frontend/database/tables/insert-row-validation.js';

function column(name, type, defaultKind = '') {
    return { database: 'default', table: 'events', name, type, defaultKind, comment: '' };
}

function errorsFor(value, type) {
    return insertRowValidationErrors([column('value', type)], { value: true }, { value });
}

test('Blank integer and timestamp fields have separate errors while empty strings are valid', () => {
    const columns = [
        column('event_id', 'UInt64'),
        column('event_time', 'DateTime'),
        column('event_name', 'LowCardinality(String)'),
        column('event_count', 'UInt64'),
    ];
    const errors = insertRowValidationErrors(columns, {}, {});
    assert.deepEqual([...errors.keys()], ['event_id', 'event_time', 'event_count']);
    assert.ok([...errors.values()].every(error => error === 'Enter a value.'));
    assert.equal(errorsFor('', 'String').size, 0);
    assert.equal(errorsFor('   ', 'LowCardinality(String)').size, 0);
});

test('Integer validation preserves exact UInt64 bounds and rejects overflow', () => {
    for (const value of ['0', '00042', '18446744073709551615'])
        assert.equal(errorsFor(value, 'UInt64').size, 0);
    assert.match(errorsFor('18446744073709551616', 'UInt64').get('value'), /UInt64 range/);
    assert.equal(errorsFor('-128', 'Int8').size, 0);
    assert.equal(errorsFor('127', 'Int8').size, 0);
    assert.match(errorsFor('-129', 'Int8').get('value'), /Int8 range/);
    assert.match(errorsFor('128', 'Int8').get('value'), /Int8 range/);
});

test('Integer errors distinguish negative, fractional, and non-numeric values', () => {
    assert.match(errorsFor('-1', 'UInt64').get('value'), /zero or a positive/);
    for (const value of ['12.5', '1e3', 'abc'])
        assert.equal(errorsFor(value, 'UInt64').get('value'), 'Enter a number.');
    assert.equal(errorsFor('   ', 'UInt64').get('value'), 'Enter a value.');
    assert.equal(errorsFor('7', 'LowCardinality(Nullable(UInt64))').size, 0);
});

test('Date and timestamp validation checks calendar dates and clock components', () => {
    assert.equal(errorsFor('2024-02-29', 'Date').size, 0);
    for (const value of ['2026-02-29', '2026-02-30', '2026-13-01'])
        assert.match(errorsFor(value, 'Date').get('value'), /valid date/);
    for (const value of [
        '2024-02-29 12:30:59',
        '2024-02-29T12:30:59Z',
        '2024-02-29T12:30:59.123456+01:00',
    ])
        assert.equal(errorsFor(value, "DateTime64(6, 'UTC')").size, 0);
    for (const value of [
        'not a date',
        '2026-02-30 12:30:59',
        '2026-10-13 24:00:00',
        '2026-10-13 12:60:00',
        '2026-10-13 12:00:60',
        '2026-10-13T12:00:00+24:00',
    ])
        assert.match(errorsFor(value, "DateTime('UTC')").get('value'), /valid date and time/);
});

test('Omitted defaulted and nullable columns are skipped while included values are validated', () => {
    const columns = [
        column('created_at', 'DateTime', 'DEFAULT'),
        column('optional_count', 'LowCardinality(Nullable(UInt64))'),
    ];
    assert.ok(columns.every(isOptionalInsertRowColumn));
    assert.equal(insertRowValidationErrors(columns, {}, {}).size, 0);
    assert.equal(
        insertRowValidationErrors(columns, { created_at: true, optional_count: true }, {}).size,
        2,
    );
    assert.equal(
        insertRowValidationErrors(
            columns,
            { created_at: true },
            { created_at: '2026-10-13 12:00:00' },
        ).size,
        0,
    );
});

test('Field errors support column names that overlap with object properties', () => {
    const columns = [column('__proto__', 'UInt64'), column('constructor', 'DateTime')];
    assert.deepEqual(
        [...insertRowValidationErrors(columns, {}, {}).keys()],
        ['__proto__', 'constructor'],
    );
});

test('Placeholders describe date formats and other types keep database validation', () => {
    assert.equal(insertRowValuePlaceholder(column('day', 'Nullable(Date32)')), 'YYYY-MM-DD');
    assert.equal(
        insertRowValuePlaceholder(column('time', "DateTime('UTC')")),
        'YYYY-MM-DD HH:mm:ss',
    );
    assert.equal(insertRowValuePlaceholder(column('label', 'String')), 'Value');
    assert.equal(errorsFor('', "Enum8('' = 0, 'active' = 1)").size, 0);
});
