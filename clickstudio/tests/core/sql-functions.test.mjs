import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import {
    SQL_FUNCTION_TEMPLATES,
    SQL_FUNCTION_CREATION_TEMPLATES,
    createSqlFunctionQuery,
    sqlFunctionNameIssue,
    sqlFunctionParameters,
    functionArgumentSql,
    changeFunctionArgumentKind,
    testSqlFunctionQuery,
    isFunctionCatalog,
    isSqlFunctionDrop,
} from '../../.core-build/src/shared/database/functions/sql-functions.js';
import {
    createSqlFunction,
    loadSqlFunctions,
    functionCreationPermission,
    functionDeletionPermission,
    dropSqlFunction,
} from '../../.core-build/src/backend/database/functions/sql-functions.js';

const first = SQL_FUNCTION_TEMPLATES[0];
const second = SQL_FUNCTION_TEMPLATES[1];
function client({
    settings = { readonly: 0, allow_ddl: 1 },
    grant = 1,
    dropGrant = 1,
    metadata = [],
    target = { origin: 'SQLUserDefined' },
    fail = false,
} = {}) {
    const queries = [],
        commands = [];
    const parameters = [];
    return {
        queries,
        commands,
        parameters,
        async exec({ query, query_params }) {
            queries.push(query);
            parameters.push(query_params);
            if (fail) throw new Error('permission unavailable');
            let values = metadata;
            if (query.includes('getSetting')) values = [settings];
            else if (query.startsWith('CHECK GRANT DROP')) values = [{ result: dropGrant }];
            else if (query.startsWith('CHECK')) values = [{ result: grant }];
            else if (query.startsWith('SELECT origin')) values = target ? [target] : [];
            return { stream: Readable.from(values.map(value => JSON.stringify(value) + '\n')) };
        },
        async command(input) {
            commands.push(input);
        },
    };
}

test('SQL UDF templates use the requested names and existing higher-order functions', () => {
    assert.equal(first.name, 'udf_array_remove_at');
    assert.equal(second.name, 'udf_map_remove');
    for (const template of SQL_FUNCTION_TEMPLATES) {
        const sql = createSqlFunctionQuery(template);
        assert.equal(sql.startsWith(`CREATE FUNCTION \`${template.name}\` AS`), true);
        assert.deepEqual(sqlFunctionParameters(sql), template.parameters);
        assert.doesNotMatch(sql, /OR REPLACE|IF NOT EXISTS/);
    }
    assert.match(first.expression, /arrayEnumerate/);
    assert.match(second.expression, /mapFilter/);
});

test('SQL UDF creation presets have unique names and compose non-native behavior', () => {
    const names = SQL_FUNCTION_CREATION_TEMPLATES.map(template => template.name);
    assert.deepEqual(names, [
        'udf_array_remove_at',
        'udf_map_remove',
        'udf_array_every_nth',
        'udf_round_significant',
        'udf_normalize_whitespace',
    ]);
    assert.equal(new Set(names).size, names.length);
    for (const template of SQL_FUNCTION_CREATION_TEMPLATES) {
        const sql = createSqlFunctionQuery(template);
        assert.deepEqual(sqlFunctionParameters(sql), template.parameters);
        assert.match(sql, / -> .+;$/);
    }
    assert.equal(SQL_FUNCTION_CREATION_TEMPLATES.length, 5);
    assert.doesNotMatch(
        SQL_FUNCTION_CREATION_TEMPLATES.map(template => template.expression).join('\n'),
        /\b(?:arrayDistinct|lowerUTF8|toStartOfMonth)\s*\(/,
    );
});

test('Create SQL validates identifiers, unique bounded parameters and one expression', () => {
    for (const input of [
        { ...first, name: 'bad; DROP TABLE t' },
        { ...first, name: 'a'.repeat(129) },
        { ...first, parameters: [] },
        { ...first, parameters: ['x', 'x'] },
        { ...first, parameters: ['x) -> 1; DROP FUNCTION f'] },
        { ...first, parameters: Array.from({ length: 17 }, (_, i) => `x${i}`) },
        { ...first, expression: '' },
        { ...first, expression: '-- comment only' },
        { ...first, expression: 'x'.repeat(8193) },
        { ...first, expression: '1; DROP TABLE t' },
        { ...first, expression: "'unterminated" },
    ])
        assert.throws(() => createSqlFunctionQuery(input));
    assert.match(
        createSqlFunctionQuery({
            name: 'quoted',
            parameters: ['x'],
            expression: "concat(x, ';') -- comment",
        }),
        /\n;$/,
    );
});

test('SQL function name validation accepts bounded identifiers and explains invalid names', () => {
    for (const name of ['a', '_private', 'name_2', 'a'.repeat(128)])
        assert.equal(sqlFunctionNameIssue(name), '');
    for (const name of ['', '2starts_with_number', 'not-valid', 'a'.repeat(129), 'münchen'])
        assert.equal(
            sqlFunctionNameIssue(name),
            'Use a function name with letters, numbers and underscores.',
        );
});

test('Canonical definitions expose their parameters without confusing inner lambdas', () => {
    assert.deepEqual(
        sqlFunctionParameters(
            'CREATE FUNCTION f AS (items, index) -> arrayFilter((x, i) -> i != index, items, arrayEnumerate(items))',
        ),
        ['items', 'index'],
    );
    assert.deepEqual(sqlFunctionParameters('CREATE FUNCTION f AS (`x`, `y`) -> x + y'), ['x', 'y']);
    assert.deepEqual(sqlFunctionParameters('CREATE FUNCTION f AS (bad-name) -> 1'), []);
    assert.deepEqual(sqlFunctionParameters('CREATE FUNCTION f AS x -> (x + 1)'), ['x']);
    assert.deepEqual(sqlFunctionParameters('CREATE FUNCTION f AS `x` -> (x + 1)'), ['x']);
    assert.deepEqual(sqlFunctionParameters('not a function'), []);
});

test('Tester turns JSON into escaped literals and preserves duplicate map keys', () => {
    assert.equal(
        functionArgumentSql({ kind: 'json', value: '[1, "hello", true, null, [2]]' }),
        "[1, 'hello', true, NULL, [2]]",
    );
    const text = "a'\\; DROP FUNCTION f; --";
    assert.equal(
        functionArgumentSql({ kind: 'json', value: JSON.stringify(text) }),
        "'a\\'\\\\; DROP FUNCTION f; --'",
    );
    assert.equal(
        functionArgumentSql({ kind: 'map', value: '[["a", 1], ["a", 2], ["b", 3]]' }),
        "map('a', 1, 'a', 2, 'b', 3)",
    );
    const fn = {
        name: first.name,
        parameters: first.parameters,
        createQuery: createSqlFunctionQuery(first),
    };
    assert.equal(
        testSqlFunctionQuery(fn, first.arguments),
        'SELECT `udf_array_remove_at`([10, 20, 30, 40], 2) AS result, toJSONString(result) AS result_json;',
    );
    assert.throws(() => testSqlFunctionQuery(fn, []));
    assert.match(testSqlFunctionQuery({ ...fn, name: 'f`x' }, first.arguments), /`f\\`x`/);
});

test('Tester rejects raw SQL, JSON objects, unsafe numbers, huge maps and deep inputs', () => {
    for (const value of [
        'SELECT 1',
        '{}',
        '1e999',
        '9007199254740993',
        JSON.stringify(Array(101).fill(1)),
        '[[[[[[1]]]]]]',
        '"' + 'x'.repeat(8193) + '"',
    ])
        assert.throws(() => functionArgumentSql({ kind: 'json', value }));
    for (const value of [
        '{}',
        '[]',
        '[1, 2]',
        '[["a"]]',
        '[["a", 1, 2]]',
        JSON.stringify(Array(101).fill(['a', 1])),
    ])
        assert.throws(() => functionArgumentSql({ kind: 'map', value }));
});

test('Malformed JSON inputs show one short, actionable validation message', () => {
    const invalid = [
        { kind: 'array', value: '[1, 2' },
        { kind: 'map', value: '[["key", 1]' },
        { kind: 'json', value: '{"key":}' },
    ];
    for (const argument of invalid)
        assert.throws(() => functionArgumentSql(argument), {
            message: 'Enter valid JSON. Check quotes, commas, and brackets.',
        });
});

test('String inputs accept plain text and escape it as one SQL literal', () => {
    for (const value of [
        '',
        '  hello  ',
        '你好 👋',
        '"quoted"',
        'line one\nline two',
        'x'.repeat(8192),
    ])
        assert.equal(functionArgumentSql({ kind: 'string', value }), `'${value}'`);
    assert.equal(
        functionArgumentSql({ kind: 'string', value: "a'\\; DROP FUNCTION f; --" }),
        "'a\\'\\\\; DROP FUNCTION f; --'",
    );
    assert.throws(() => functionArgumentSql({ kind: 'string', value: 'x'.repeat(8193) }));
});

test('Integer inputs preserve exact signed and unsigned 64-bit values', () => {
    for (const [value, sql] of [
        ['0', '0'],
        [' -00042 ', '-42'],
        ['+0042', '42'],
        ['-0', '0'],
        ['9007199254740993', '9007199254740993'],
        ['-9223372036854775808', '-9223372036854775808'],
        ['9223372036854775807', '9223372036854775807'],
        ['18446744073709551615', '18446744073709551615'],
    ])
        assert.equal(functionArgumentSql({ kind: 'integer', value }), sql);
    for (const value of [
        '',
        ' ',
        '1.0',
        '1e2',
        '0x10',
        '--1',
        '1; SELECT 2',
        '-9223372036854775809',
        '18446744073709551616',
        '9'.repeat(8193),
    ])
        assert.throws(() => functionArgumentSql({ kind: 'integer', value }));
});

test('Float inputs keep their type and accept only finite decimal or exponent syntax', () => {
    for (const value of ['2', '2.0', '-0', '+.5', '1.', '-3.14', '1e3', '1E-3', '1e308'])
        assert.equal(
            functionArgumentSql({ kind: 'float', value: ` ${value} ` }),
            `CAST('${value}', 'Float64')`,
        );
    for (const value of [
        '',
        ' ',
        'NaN',
        'Infinity',
        '-Infinity',
        '1e999',
        '0x10',
        '1,5',
        '.',
        '1; SELECT 2',
    ])
        assert.throws(() => functionArgumentSql({ kind: 'float', value }));
});

test('Boolean and Null inputs generate their explicit SQL literals', () => {
    for (const value of ['true', 'false'])
        assert.equal(functionArgumentSql({ kind: 'boolean', value: ` ${value} ` }), value);
    for (const value of ['', 'TRUE', '0', '1', 'null', '"true"', 'true; SELECT 2'])
        assert.throws(() => functionArgumentSql({ kind: 'boolean', value }));
    for (const value of ['', 'retained plain text', 'x'.repeat(8193)])
        assert.equal(functionArgumentSql({ kind: 'null', value }), 'NULL');
});

test('Array inputs require bounded JSON arrays while advanced JSON still accepts scalars', () => {
    for (const [value, sql] of [
        ['[]', '[]'],
        ['[1, "text", true, null, [2]]', "[1, 'text', true, NULL, [2]]"],
        [JSON.stringify(Array(100).fill(1)), `[${Array(100).fill('1').join(', ')}]`],
    ])
        assert.equal(functionArgumentSql({ kind: 'array', value }), sql);
    for (const value of [
        '1',
        '"text"',
        'null',
        '{}',
        '[{}]',
        '[9007199254740993]',
        '[[[[[[1]]]]]]',
        JSON.stringify(Array(101).fill(1)),
    ])
        assert.throws(() => functionArgumentSql({ kind: 'array', value }));
    assert.equal(functionArgumentSql({ kind: 'json', value: '"text"' }), "'text'");
    assert.throws(
        () => functionArgumentSql({ kind: 'unsupported', value: '[[1, 2]]' }),
        /supported input type/,
    );
});

test('Switching between String and advanced JSON preserves quoting and whitespace', () => {
    for (const value of ['', '  hello  ', '"quoted"', "a'\\\n你好", '42', '[1, 2]']) {
        const argument = { kind: 'string', value };
        const json = changeFunctionArgumentKind(argument, 'json');
        assert.deepEqual(json, { kind: 'json', value: JSON.stringify(value) });
        assert.equal(functionArgumentSql(json), functionArgumentSql(argument));
        assert.deepEqual(changeFunctionArgumentKind(json, 'string'), argument);
        const nullJson = changeFunctionArgumentKind(json, 'null');
        assert.deepEqual(changeFunctionArgumentKind(nullJson, 'string'), argument);
        assert.deepEqual(changeFunctionArgumentKind(nullJson, 'json'), json);
        const nullString = changeFunctionArgumentKind(argument, 'null');
        assert.deepEqual(changeFunctionArgumentKind(nullString, 'json'), json);
        assert.deepEqual(
            changeFunctionArgumentKind(changeFunctionArgumentKind(nullString, 'null'), 'string'),
            argument,
        );
        assert.deepEqual(argument, { kind: 'string', value });
        assert.deepEqual(
            changeFunctionArgumentKind(changeFunctionArgumentKind(argument, 'null'), 'string'),
            argument,
        );
    }
    for (const value of ['bad JSON', '42', '[1, 2]'])
        assert.deepEqual(changeFunctionArgumentKind({ kind: 'json', value }, 'string'), {
            kind: 'string',
            value,
        });
    assert.deepEqual(changeFunctionArgumentKind({ kind: 'array', value: '[1, 2]' }, 'json'), {
        kind: 'json',
        value: '[1, 2]',
    });
    assert.deepEqual(changeFunctionArgumentKind({ kind: 'string', value: 'text' }, 'string'), {
        kind: 'string',
        value: 'text',
    });
});

test('SQL UDF discovery returns server definitions independently of databases', async () => {
    const source = client({
        metadata: [{ name: first.name, create_query: createSqlFunctionQuery(first) }],
    });
    const catalog = await loadSqlFunctions(source);
    assert.equal(isFunctionCatalog(catalog), true);
    assert.equal(catalog.canCreate, true);
    assert.equal(catalog.canDrop, true);
    assert.deepEqual(catalog.functions[0].parameters, ['items', 'index']);
    assert.ok(source.queries.some(sql => sql.includes("origin = 'SQLUserDefined'")));
    assert.equal(isFunctionCatalog({ ...catalog, canCreate: 'true' }), false);
    assert.equal(isFunctionCatalog({ ...catalog, functions: [{}] }), false);
    assert.equal(isFunctionCatalog({ ...catalog, canDrop: 'true' }), false);
    assert.equal(isFunctionCatalog({ ...catalog, dropReason: undefined }), false);
});

test('Read-only, DDL-denied and unverified permissions disable creation', async () => {
    for (const settings of [
        { readonly: 1, allow_ddl: 1 },
        { readonly: '2', allow_ddl: '1' },
        { readonly: 0, allow_ddl: 0 },
        {},
        { allow_ddl: 1 },
    ]) {
        const source = client({ settings });
        assert.equal((await functionCreationPermission(source)).canCreate, false);
        assert.equal(source.queries.length, 1);
        await assert.rejects(
            createSqlFunction(source, first),
            error => error.code === 'FUNCTION_PERMISSION',
        );
        assert.equal(source.commands.length, 0);
    }
    for (const options of [{ grant: 0 }, { grant: undefined, settings: {} }, { fail: true }])
        assert.equal((await functionCreationPermission(client(options))).canCreate, false);
    assert.equal(
        (
            await functionCreationPermission(
                client({ settings: { readonly: '0', allow_ddl: '1' }, grant: '1' }),
            )
        ).canCreate,
        true,
    );
});

test('Create checks privileges again before executing exactly one CREATE without overwrite', async () => {
    const source = client();
    const created = await createSqlFunction(source, first);
    assert.equal(created.name, first.name);
    assert.equal(source.commands.length, 1);
    assert.equal(source.commands[0].query, createSqlFunctionQuery(first));
    assert.match(source.commands[0].query_id, /^clickstudio-create-function-/);
    assert.equal(source.queries.at(-1), 'CHECK GRANT CREATE FUNCTION ON *.*');
    await assert.rejects(
        createSqlFunction(source, { ...first, expression: '1; DROP TABLE t' }),
        error => error.code === 'FUNCTION_INPUT',
    );
    await assert.rejects(
        createSqlFunction(source, { parameters: [1] }),
        error => error.code === 'FUNCTION_INPUT',
    );
    assert.equal(source.commands.length, 1);
    const denied = client({ grant: 0 });
    await assert.rejects(
        createSqlFunction(denied, first),
        error => error.code === 'FUNCTION_PERMISSION',
    );
    assert.equal(denied.commands.length, 0);
});

test('Creation surfaces ClickHouse errors and never automatically retries', async () => {
    const source = client();
    let attempts = 0;
    source.command = async () => {
        attempts++;
        throw new Error('Function already exists');
    };
    await assert.rejects(createSqlFunction(source, first), /already exists/);
    assert.equal(attempts, 1);
});

test('Function discovery decodes UTF-8 split across chunks and bounds response bytes', async () => {
    const source = client();
    const originalExec = source.exec;
    source.exec = async input => {
        if (!input.query.includes('system.functions')) return originalExec(input);
        const bytes = Buffer.from(
            JSON.stringify({
                name: 'unicode',
                create_query: "CREATE FUNCTION unicode AS (x) -> concat(x, '你好')",
            }) + '\n',
        );
        const split = bytes.indexOf(Buffer.from('你')) + 1;
        return { stream: Readable.from([bytes.subarray(0, split), bytes.subarray(split)]) };
    };
    assert.match((await loadSqlFunctions(source)).functions[0].createQuery, /你好/);
    source.exec = async input =>
        input.query.includes('system.functions')
            ? { stream: Readable.from([Buffer.alloc(2_000_001)]) }
            : originalExec(input);
    await assert.rejects(
        loadSqlFunctions(source),
        error => error.code === 'FUNCTION_RESPONSE_SIZE',
    );
});

test('Creation and deletion permissions are independent and fail closed', async () => {
    for (const grant of [0, 1]) {
        for (const dropGrant of [0, 1]) {
            const catalog = await loadSqlFunctions(client({ grant, dropGrant }));
            assert.equal(catalog.canCreate, grant === 1);
            assert.equal(catalog.canDrop, dropGrant === 1);
            assert.equal(
                catalog.dropReason,
                dropGrant ? '' : 'DROP FUNCTION privilege is required.',
            );
        }
    }
    for (const settings of [
        { readonly: 1, allow_ddl: 1 },
        { readonly: '2', allow_ddl: '1' },
        { readonly: 0, allow_ddl: 0 },
        {},
        { allow_ddl: 1 },
    ]) {
        const source = client({ settings });
        assert.equal((await functionDeletionPermission(source)).canDrop, false);
        assert.equal(source.queries.length, 1);
        await assert.rejects(
            dropSqlFunction(source, { name: first.name, confirmation: first.name }),
            error => error.code === 'FUNCTION_PERMISSION',
        );
        assert.equal(source.commands.length, 0);
    }
    for (const dropGrant of [0, null, 'unverified'])
        assert.equal((await functionDeletionPermission(client({ dropGrant }))).canDrop, false);
    const failed = await functionDeletionPermission(client({ fail: true }));
    assert.equal(failed.canDrop, false);
    assert.match(failed.dropReason, /Could not verify DROP FUNCTION/);
    assert.equal(
        (
            await functionDeletionPermission(
                client({ settings: { readonly: '0', allow_ddl: '1' }, dropGrant: '1' }),
            )
        ).canDrop,
        true,
    );
});

test('Deletion requires a valid target and exact typed confirmation before any query', async () => {
    const source = client();
    for (const name of [undefined, 7, '', ' ', 'a'.repeat(8193), 'a\n', 'a\u0000', 'a\u007f']) {
        await assert.rejects(
            dropSqlFunction(source, { name, confirmation: name }),
            error => error.code === 'FUNCTION_INPUT',
        );
    }
    for (const confirmation of [
        undefined,
        7,
        '',
        first.name.toUpperCase(),
        `${first.name} `,
        ` ${first.name}`,
    ])
        await assert.rejects(
            dropSqlFunction(source, { name: first.name, confirmation }),
            error => error.code === 'FUNCTION_DROP_CONFIRMATION',
        );
    assert.equal(source.queries.length, 0);
    assert.equal(source.commands.length, 0);
    assert.equal(isSqlFunctionDrop({ name: first.name }), true);
    for (const value of [null, [], {}, { name: 1 }]) assert.equal(isSqlFunctionDrop(value), false);
});

test('Deletion rechecks DROP grant and only targets SQL UDFs', async () => {
    const input = { name: first.name, confirmation: first.name };
    const source = client({ grant: 0 });
    assert.deepEqual(await dropSqlFunction(source, input), { name: first.name });
    assert.equal(source.commands.length, 1);
    assert.equal(source.commands[0].query, `DROP FUNCTION IF EXISTS \`${first.name}\``);
    assert.match(source.commands[0].query_id, /^clickstudio-drop-function-/);
    assert.equal(source.commands[0].abort_signal instanceof AbortSignal, true);
    assert.ok(source.queries.includes('CHECK GRANT DROP FUNCTION ON *.*'));
    assert.deepEqual(source.parameters.at(-1), { name: first.name });
    for (const origin of ['System', 'ExecutableUserDefined', undefined]) {
        const forbidden = client({ target: { origin } });
        await assert.rejects(
            dropSqlFunction(forbidden, input),
            error => error.code === 'FUNCTION_DROP_TARGET',
        );
        assert.equal(forbidden.commands.length, 0);
    }
    const revoked = client({ dropGrant: 0 });
    await assert.rejects(
        dropSqlFunction(revoked, input),
        error => error.code === 'FUNCTION_PERMISSION',
    );
    assert.equal(revoked.commands.length, 0);
    assert.equal(
        revoked.queries.some(query => query.includes('system.functions')),
        false,
    );
});

test('Deletion quotes unusual names and treats already removed functions as success', async () => {
    const name = '函数`\\; DROP TABLE events; --';
    const source = client();
    await dropSqlFunction(source, { name, confirmation: name });
    assert.deepEqual(source.parameters.at(-1), { name });
    assert.equal(
        source.commands[0].query,
        'DROP FUNCTION IF EXISTS `函数\\`\\\\; DROP TABLE events; --`',
    );
    const longName = 'x'.repeat(256);
    await dropSqlFunction(source, { name: longName, confirmation: longName });
    assert.equal(source.commands[1].query, `DROP FUNCTION IF EXISTS \`${longName}\``);
    const gone = client({ target: null });
    assert.deepEqual(await dropSqlFunction(gone, { name: first.name, confirmation: first.name }), {
        name: first.name,
    });
    assert.equal(gone.commands.length, 0);
});

test('Deletion surfaces metadata and command failures without retries', async () => {
    const input = { name: first.name, confirmation: first.name };
    const source = client();
    const originalExec = source.exec;
    source.exec = async params => {
        if (params.query.includes('system.functions')) throw new Error('metadata unavailable');
        return originalExec(params);
    };
    await assert.rejects(dropSqlFunction(source, input), /metadata unavailable/);
    assert.equal(source.commands.length, 0);
    source.exec = originalExec;
    let attempts = 0;
    source.command = async () => {
        attempts++;
        throw new Error('Request timed out');
    };
    await assert.rejects(dropSqlFunction(source, input), /timed out/);
    assert.equal(attempts, 1);
});
