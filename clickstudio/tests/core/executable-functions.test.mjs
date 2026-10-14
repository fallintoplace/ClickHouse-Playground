import test from 'node:test';
import assert from 'node:assert/strict';
import { loadExecutableFunctions } from '../../.core-build/src/backend/database/functions/executable-functions.js';
import {
    executableCatalogSchema,
    testPythonFunctionQuery,
} from '../../.core-build/src/shared/database/functions/python-functions.js';

test('Executable discovery reads ordered names, types and return types without calling a UDF', async () => {
    const queries = [];
    const catalog = await loadExecutableFunctions({
        async query(options) {
            queries.push(options);
            return {
                json: async () => [
                    {
                        name: 'count_tokens',
                        argumentNames: ['text', 'limit'],
                        argumentTypes: ['String', 'UInt64'],
                        returnType: 'UInt64',
                    },
                    {
                        name: 'unnamed',
                        argumentNames: ['', 'value'],
                        argumentTypes: ['Int64', 'Bool'],
                        returnType: 'String',
                    },
                    {
                        name: 'no_names',
                        argumentNames: [],
                        argumentTypes: ['Float64'],
                        returnType: 'Float64',
                    },
                    {
                        name: 'no_inputs',
                        argumentNames: [],
                        argumentTypes: [],
                        returnType: 'String',
                    },
                    {
                        name: 'external_type',
                        argumentNames: ['items'],
                        argumentTypes: ['Array(String)'],
                        returnType: 'UInt32',
                    },
                ],
            };
        },
    });
    assert.equal(queries.length, 1);
    assert.match(
        queries[0].query,
        /FROM system.user_defined_functions WHERE load_status = 'Success' ORDER BY name LIMIT 1000$/,
    );
    assert.equal(queries[0].format, 'JSONEachRow');
    assert.ok(queries[0].abort_signal instanceof AbortSignal);
    assert.deepEqual(
        catalog.functions.map(fn => fn.arguments),
        [
            [
                { name: 'text', type: 'String' },
                { name: 'limit', type: 'UInt64' },
            ],
            [
                { name: 'arg1', type: 'Int64' },
                { name: 'value', type: 'Bool' },
            ],
            [{ name: 'arg1', type: 'Float64' }],
            [],
            [{ name: 'items', type: 'Array(String)' }],
        ],
    );
    assert.equal(catalog.functions[0].returnType, 'UInt64');
    assert.equal(catalog.functions[0].createQuery, '');
});

test('Older servers and restricted metadata retain executable discovery with a manual signature', async () => {
    for (const code of ['47', 60, '497']) {
        const queries = [];
        const functions = [{ name: 'installed_elsewhere', createQuery: '' }];
        const catalog = await loadExecutableFunctions({
            async query(options) {
                queries.push(options.query);
                if (queries.length === 1)
                    throw Object.assign(new Error('Metadata unavailable'), { code });
                return { json: async () => functions };
            },
        });
        assert.deepEqual(catalog, { functions });
        assert.equal(catalog.functions[0].arguments, undefined);
        assert.equal(queries.length, 2);
        assert.match(queries[1], /FROM system.functions WHERE origin = 'ExecutableUserDefined'/);
    }
});

test('Discovery preserves connection errors and rejects inconsistent or invalid metadata', async () => {
    for (const error of [new Error('Connection failed'), { code: '159' }, null, 'failure']) {
        let queries = 0;
        await assert.rejects(
            loadExecutableFunctions({
                async query() {
                    queries++;
                    throw error;
                },
            }),
            value => value === error,
        );
        assert.equal(queries, 1);
    }
    for (const metadata of [
        [
            {
                name: 'broken',
                argumentNames: ['a'],
                argumentTypes: ['String', 'Bool'],
                returnType: 'String',
            },
        ],
        [{ name: 'broken', argumentNames: [], argumentTypes: [''], returnType: 'String' }],
        [{ name: 'broken', argumentNames: [], argumentTypes: [1], returnType: 'String' }],
        { functions: [] },
    ]) {
        let queries = 0;
        await assert.rejects(
            loadExecutableFunctions({
                async query() {
                    queries++;
                    return { json: async () => metadata };
                },
            }),
        );
        assert.equal(queries, 1);
    }
    assert.deepEqual(
        await loadExecutableFunctions({
            async query() {
                return { json: async () => [] };
            },
        }),
        { functions: [] },
    );
});

test('Fallback failures and malformed fallback catalogs are not presented as successful discovery', async () => {
    for (const failQuery of [true, false]) {
        let queries = 0;
        await assert.rejects(
            loadExecutableFunctions({
                async query() {
                    if (++queries === 1) throw { code: '60' };
                    if (failQuery) throw new Error('Legacy metadata denied');
                    return { json: async () => [{ name: 1 }] };
                },
            }),
        );
        assert.equal(queries, 2);
    }
});

test('Catalog signatures retain unsupported types and distinguish unknown from zero arguments', () => {
    const unknown = executableCatalogSchema.parse({
        functions: [{ name: 'unknown', createQuery: '' }],
    });
    const zero = executableCatalogSchema.parse({
        functions: [{ name: 'zero', createQuery: '', arguments: [] }],
    });
    assert.equal(unknown.functions[0].arguments, undefined);
    assert.deepEqual(zero.functions[0].arguments, []);
    assert.throws(
        () => testPythonFunctionQuery('installed', [{ type: 'UInt32', value: '1' }]),
        /does not support UInt32/,
    );
    assert.throws(
        () => testPythonFunctionQuery('installed', Array(17).fill({ type: 'String', value: 'x' })),
        /at most 16/,
    );
});
