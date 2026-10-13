import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@clickhouse/client';
import {
    createSqlFunction,
    loadSqlFunctions,
    dropSqlFunction,
} from '../../src/backend/database/functions/sql-functions.js';
import {
    SQL_FUNCTION_TEMPLATES,
    testSqlFunctionQuery,
    type SqlFunction,
} from '../../src/shared/database/functions/sql-functions.js';
import { quoteIdentifier } from '../../src/shared/sql/sql.js';

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
                assert.equal(catalog.canDrop, false);
                assert.ok(catalog.functions.some(fn => fn.name === names[0]));
                await assert.rejects(createSqlFunction(denied, SQL_FUNCTION_TEMPLATES[0]!), /DDL/);
                await assert.rejects(
                    dropSqlFunction(denied, { name: names[0], confirmation: names[0] }),
                    /DDL/,
                );
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

test(
    'SQL UDF deletion honors independent grants, quoted names and missing targets on ClickHouse',
    { skip: !process.env.CLICKSTUDIO_UDF_TEST_URL },
    async () => {
        const client = createClient({ url: process.env.CLICKSTUDIO_UDF_TEST_URL });
        const suffix = `${Date.now()}`;
        const creatorName = `udf_creator_${suffix}`;
        const dropperName = `udf_dropper_${suffix}`;
        const names = [
            `udf_delete_${suffix}`,
            `udf_${suffix}_${'x'.repeat(150)}`,
            `函数_${suffix}_\`\\`,
        ];
        const creator = createClient({
            url: process.env.CLICKSTUDIO_UDF_TEST_URL,
            username: creatorName,
        });
        const dropper = createClient({
            url: process.env.CLICKSTUDIO_UDF_TEST_URL,
            username: dropperName,
        });
        try {
            for (const name of names)
                await client.command({
                    query: `CREATE FUNCTION ${quoteIdentifier(name)} AS x -> x + 1`,
                });
            for (const user of [creatorName, dropperName]) {
                await client.command({ query: `CREATE USER ${user}` });
                await client.command({ query: `GRANT SELECT ON *.* TO ${user}` });
            }
            await client.command({ query: `GRANT CREATE FUNCTION ON *.* TO ${creatorName}` });
            await client.command({ query: `GRANT DROP FUNCTION ON *.* TO ${dropperName}` });
            const creatorCatalog = await loadSqlFunctions(creator);
            assert.equal(creatorCatalog.canCreate, true);
            assert.equal(creatorCatalog.canDrop, false);
            const dropperCatalog = await loadSqlFunctions(dropper);
            assert.equal(dropperCatalog.canCreate, false);
            assert.equal(dropperCatalog.canDrop, true);
            const name = names[0]!;
            await assert.rejects(
                dropSqlFunction(creator, { name, confirmation: name }),
                /DROP FUNCTION privilege/,
            );
            await assert.rejects(
                dropSqlFunction(dropper, { name, confirmation: `${name} ` }),
                /exact function name/,
            );
            assert.ok((await loadSqlFunctions(client)).functions.some(fn => fn.name === name));
            await assert.rejects(
                dropSqlFunction(dropper, { name: 'plus', confirmation: 'plus' }),
                /Only SQL UDFs/,
            );
            for (const name of names) {
                assert.deepEqual(await dropSqlFunction(dropper, { name, confirmation: name }), {
                    name,
                });
                assert.deepEqual(await dropSqlFunction(dropper, { name, confirmation: name }), {
                    name,
                });
            }
            assert.equal(
                (await loadSqlFunctions(client)).functions.some(fn => names.includes(fn.name)),
                false,
            );
            await client.command({
                query: `CREATE FUNCTION ${quoteIdentifier(name)} AS x -> x + 1`,
            });
            await client.command({ query: `REVOKE DROP FUNCTION ON *.* FROM ${dropperName}` });
            await assert.rejects(
                dropSqlFunction(dropper, { name, confirmation: name }),
                /DROP FUNCTION privilege/,
            );
            assert.ok((await loadSqlFunctions(client)).functions.some(fn => fn.name === name));
        } finally {
            await creator.close();
            await dropper.close();
            for (const name of names)
                await client.command({ query: `DROP FUNCTION IF EXISTS ${quoteIdentifier(name)}` });
            for (const user of [creatorName, dropperName])
                await client.command({ query: `DROP USER IF EXISTS ${user}` });
            await client.close();
        }
    },
);
