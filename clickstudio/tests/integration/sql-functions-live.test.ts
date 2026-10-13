import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@clickhouse/client';
import {
    createSqlFunction,
    loadSqlFunctions,
} from '../../src/backend/database/functions/sql-functions.js';
import {
    SQL_FUNCTION_TEMPLATES,
    testSqlFunctionQuery,
    type SqlFunction,
} from '../../src/shared/database/functions/sql-functions.js';

test(
    'SQL UDF templates create, discover and execute on ClickHouse',
    { skip: !process.env.CLICKSTUDIO_UDF_TEST_URL },
    async () => {
        const client = createClient({ url: process.env.CLICKSTUDIO_UDF_TEST_URL });
        const suffix = `${Date.now()}`;
        const names: string[] = [];
        const readerName = `udf_reader_${suffix}`;
        try {
            for (const [index, template] of SQL_FUNCTION_TEMPLATES.entries()) {
                const name = `${template.name}_${suffix}`;
                names.push(name);
                const created: SqlFunction = await createSqlFunction(client, { ...template, name });
                const catalog = await loadSqlFunctions(client);
                const discovered = catalog.functions.find(fn => fn.name === name);
                assert.ok(discovered);
                assert.deepEqual(discovered.parameters, template.parameters);
                const result = await client.query({
                    query: testSqlFunctionQuery(created, template.arguments),
                    format: 'JSONEachRow',
                });
                assert.deepEqual(
                    await result.json(),
                    index === 0
                        ? [{ result: [10, 30, 40], result_json: '[10,30,40]' }]
                        : [{ result: { a: 10, c: 30 }, result_json: '{"a":10,"c":30}' }],
                );
                await assert.rejects(
                    createSqlFunction(client, { ...template, name }),
                    /already exists/i,
                );
                if (index === 0) {
                    const edge = await client.query({
                        query: `SELECT ${name}([10, 20], 0) AS zero, ${name}([10, 20], 99) AS outside, ${name}([], 1) AS empty`,
                        format: 'JSONEachRow',
                    });
                    assert.deepEqual(await edge.json(), [
                        { zero: [10, 20], outside: [10, 20], empty: [] },
                    ]);
                } else {
                    const edge = await client.query({
                        query: `SELECT mapKeys(${name}(map('a', 1, 'a', 2, 'b', 3), 'a')) AS keys, mapValues(${name}(map('a', 1, 'a', 2, 'b', 3), 'a')) AS values`,
                        format: 'JSONEachRow',
                    });
                    assert.deepEqual(await edge.json(), [{ keys: ['b'], values: [3] }]);
                }
            }
            const singleName = `udf_add_tax_${suffix}`;
            names.push(singleName);
            await createSqlFunction(client, {
                name: singleName,
                parameters: ['price'],
                expression: 'price * 1.19',
            });
            assert.deepEqual(
                (await loadSqlFunctions(client)).functions.find(fn => fn.name === singleName)
                    ?.parameters,
                ['price'],
            );
            await client.command({ query: `CREATE USER ${readerName} SETTINGS readonly = 1` });
            await client.command({ query: `GRANT SELECT ON *.* TO ${readerName}` });
            const denied = createClient({
                url: process.env.CLICKSTUDIO_UDF_TEST_URL,
                username: readerName,
            });
            try {
                const catalog = await loadSqlFunctions(denied);
                assert.equal(catalog.canCreate, false);
                assert.ok(catalog.functions.some(fn => fn.name === names[0]));
                await assert.rejects(createSqlFunction(denied, SQL_FUNCTION_TEMPLATES[0]!), /DDL/);
            } finally {
                await client.command({ query: `DROP USER IF EXISTS ${readerName}` });
                await denied.close();
            }
        } finally {
            for (const name of names)
                await client.command({ query: `DROP FUNCTION IF EXISTS ${name}` });
            await client.close();
        }
    },
);
