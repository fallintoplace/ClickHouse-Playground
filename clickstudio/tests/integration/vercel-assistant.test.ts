import test from 'node:test';
import assert from 'node:assert/strict';
import { APIConnectionTimeoutError } from 'openai';
import handler from '../../api/assistant/sql.js';
import {
    arrayValue,
    jsonRecord,
    jsonValue,
    responseErrorCode,
    responseRecord,
    stringValue,
} from '../helpers/type-guards.js';

const endpoint = 'https://clickstudio.example/api/assistant/sql';

function request(body: unknown, headers: Record<string, string> = {}, signal?: AbortSignal) {
    return new Request(endpoint, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            origin: 'https://clickstudio.example',
            'x-clickstudio-intent': '1',
            'x-real-ip': '192.0.2.20',
            ...headers,
        },
        body: JSON.stringify(body),
        signal,
    });
}

function assistantBody() {
    return {
        connectionId: 'clickhouse-cloud',
        question: 'Explain this SQL.',
        sql: 'SELECT 1',
        schema: { fetchedAt: new Date().toISOString(), tables: [], columns: [], truncated: false },
    };
}

test('Vercel assistant answers without schema and marks it as unknown', async t => {
    const priorKey = process.env.OPENAI_API_KEY;
    const priorFetch = globalThis.fetch;
    process.env.OPENAI_API_KEY = 'test-key';
    globalThis.fetch = async (input, init) => {
        if (String(input).endsWith('/responses/input_tokens'))
            return Response.json({ object: 'response.input_tokens', input_tokens: 200 });
        const payload = jsonRecord(jsonValue(String(init?.body)), 'OpenAI request');
        const messages = arrayValue(payload.input).map(item => jsonRecord(item));
        const content = arrayValue(messages[0]?.content).map(item => jsonRecord(item));
        const context = jsonRecord(jsonRecord(jsonValue(stringValue(content[0]?.text))).context);
        assert.deepEqual(context.schema, []);
        assert.deepEqual(context.tables, []);
        assert.equal(context.schemaFetchedAt, '');
        assert.equal(context.schemaIncomplete, true);
        assert.equal(context.tablesIncomplete, true);
        return Response.json({
            id: 'no-schema-response',
            status: 'completed',
            output_text: 'You can ask without loading schema.',
            output: [],
        });
    };
    t.after(() => {
        globalThis.fetch = priorFetch;
        if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = priorKey;
    });
    for (const schema of [undefined, null]) {
        const response = await handler.fetch(
            request({ ...assistantBody(), schema }, { 'x-real-ip': '192.0.2.98' }),
        );
        assert.equal(response.status, 201);
        assert.equal(
            (await responseRecord(response)).summary,
            'You can ask without loading schema.',
        );
    }
});

test('Vercel assistant sends attached SQL files to OpenAI', async t => {
    const priorKey = process.env.OPENAI_API_KEY;
    const priorFetch = globalThis.fetch;
    process.env.OPENAI_API_KEY = 'test-key';
    const content = 'SELECT 1; -- demo file content\n'.repeat(1_500);
    globalThis.fetch = async (input, init) => {
        if (String(input).endsWith('/responses/input_tokens'))
            return Response.json({ object: 'response.input_tokens', input_tokens: 200 });
        const payload = jsonRecord(jsonValue(String(init?.body)), 'OpenAI request');
        const inputItems = arrayValue(payload.input, 'OpenAI input').map(item =>
            jsonRecord(item, 'OpenAI message'),
        );
        const current = jsonRecord(inputItems[0], 'Current OpenAI message');
        const contentItems = arrayValue(current.content, 'Current OpenAI content').map(item =>
            jsonRecord(item, 'OpenAI content item'),
        );
        assert.deepEqual(jsonValue(stringValue(contentItems[1]?.text)), {
            attachedFile: 'demo.sql',
            content,
        });
        return Response.json({
            id: 'response-text-file',
            status: 'completed',
            output_text: 'I reviewed the attached SQL file.',
            output: [],
        });
    };
    t.after(() => {
        globalThis.fetch = priorFetch;
        if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = priorKey;
    });

    const response = await handler.fetch(
        request(
            { ...assistantBody(), files: [{ name: 'demo.sql', content }] },
            { 'x-real-ip': '192.0.2.91' },
        ),
    );
    assert.equal(response.status, 201);
    assert.equal((await responseRecord(response)).summary, 'I reviewed the attached SQL file.');
});

test('Vercel assistant rejects unsupported and oversized text attachments before OpenAI', async t => {
    const priorKey = process.env.OPENAI_API_KEY;
    const priorFetch = globalThis.fetch;
    process.env.OPENAI_API_KEY = 'test-key';
    globalThis.fetch = async () => {
        throw new Error('Invalid attachments must not reach OpenAI.');
    };
    t.after(() => {
        globalThis.fetch = priorFetch;
        if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = priorKey;
    });

    const unsupported = await handler.fetch(
        request({ ...assistantBody(), files: [{ name: 'demo.json', content: '{}' }] }),
    );
    assert.equal(unsupported.status, 400);
    assert.equal(await responseErrorCode(unsupported), 'FILE_TYPE');

    const oversized = await handler.fetch(
        request({
            ...assistantBody(),
            files: [{ name: 'large.txt', content: 'x'.repeat(100_001) }],
        }),
    );
    assert.equal(oversized.status, 413);
    assert.equal(await responseErrorCode(oversized), 'FILE_SIZE');
});

test('Vercel assistant defaults to Fast processing and honors the server service tier', async t => {
    const priorKey = process.env.OPENAI_API_KEY;
    const priorTier = process.env.OPENAI_SERVICE_TIER;
    const priorFetch = globalThis.fetch;
    process.env.OPENAI_API_KEY = 'test-key';
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = async (input, init) => {
        const body = jsonRecord(jsonValue(String(init?.body)), 'OpenAI request');
        if (String(input).endsWith('/responses/input_tokens')) {
            assert.equal(body.service_tier, undefined);
            return Response.json({ object: 'response.input_tokens', input_tokens: 200 });
        }
        requestBody = body;
        return Response.json({
            id: 'response-tier',
            status: 'completed',
            output_text: 'This SQL returns one row.',
            output: [],
        });
    };
    t.after(() => {
        globalThis.fetch = priorFetch;
        if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = priorKey;
        if (priorTier === undefined) delete process.env.OPENAI_SERVICE_TIER;
        else process.env.OPENAI_SERVICE_TIER = priorTier;
    });
    for (const tier of [undefined, '', ' fast ', 'priority', 'default']) {
        if (tier === undefined) delete process.env.OPENAI_SERVICE_TIER;
        else process.env.OPENAI_SERVICE_TIER = tier;
        const response = await handler.fetch(
            request(assistantBody(), { 'x-real-ip': '192.0.2.21' }),
        );
        assert.equal(response.status, 201);
        assert.equal(requestBody?.service_tier, tier === 'default' ? 'default' : 'priority');
        assert.equal(requestBody?.reasoning, undefined);
        assert.equal(requestBody?.store, false);
        assert.equal(
            stringValue((await responseRecord(response, 'Assistant response')).summary, 'Summary'),
            'This SQL returns one row.',
        );
    }
});

test('Vercel assistant rejects an invalid service tier before contacting OpenAI', async t => {
    const priorKey = process.env.OPENAI_API_KEY;
    const priorTier = process.env.OPENAI_SERVICE_TIER;
    const priorFetch = globalThis.fetch;
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_SERVICE_TIER = 'unknown';
    globalThis.fetch = async () => {
        throw new Error('Invalid service tiers must not reach the provider.');
    };
    t.after(() => {
        globalThis.fetch = priorFetch;
        if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = priorKey;
        if (priorTier === undefined) delete process.env.OPENAI_SERVICE_TIER;
        else process.env.OPENAI_SERVICE_TIER = priorTier;
    });
    const response = await handler.fetch(request(assistantBody()));
    assert.equal(response.status, 400);
    assert.equal(await responseErrorCode(response), 'OPENAI_SERVICE_TIER');
});

test('Vercel Fix with AI sends failure context without a saved run and returns a repair proposal', async t => {
    const priorKey = process.env.OPENAI_API_KEY;
    const priorFetch = globalThis.fetch;
    process.env.OPENAI_API_KEY = 'test-key';
    t.after(() => {
        globalThis.fetch = priorFetch;
        if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = priorKey;
    });
    const sql = 'SELECT 1;\nSELECT event_count FROM demo.events;\nSELECT 2;';
    const repairedSql = sql.replace('event_count', 'events');
    globalThis.fetch = async (input, init) => {
        if (String(input).endsWith('/responses/input_tokens'))
            return Response.json({ object: 'response.input_tokens', input_tokens: 200 });
        const payload = jsonRecord(jsonValue(String(init?.body)), 'OpenAI request');
        const messages = arrayValue(payload.input, 'OpenAI input').map(item =>
            jsonRecord(item, 'OpenAI message'),
        );
        const content = arrayValue(messages[0]?.content, 'OpenAI message content').map(item =>
            jsonRecord(item, 'OpenAI content item'),
        );
        const current = jsonRecord(
            jsonValue(stringValue(content[0]?.text, 'OpenAI context text')),
            'Assistant context',
        );
        const context = jsonRecord(current.context, 'Assistant context details');
        assert.equal(context.action, 'repair');
        assert.match(stringValue(current.question, 'Assistant question'), /Fix this query error/i);
        assert.equal(context.sql, sql);
        assert.equal(context.evidenceSql, 'SELECT event_count FROM demo.events');
        assert.equal(context.error, '[47] Unknown column event_count');
        assert.equal(context.result, undefined);
        return Response.json({
            id: 'repair-response',
            status: 'completed',
            output_text: JSON.stringify({
                sql: repairedSql,
                summary: 'Use the events column.',
                assumptions: [],
                tables: ['demo.events'],
                caveats: [],
                clarification: null,
                findings: [],
            }),
            output: [],
        });
    };
    const response = await handler.fetch(
        request({
            ...assistantBody(),
            question: 'Fix this query error.',
            sql,
            action: 'repair',
            includeRun: true,
            result: { rows: [['old result']] },
            repair: {
                sql: 'SELECT event_count FROM demo.events',
                error: '[47] Unknown column event_count',
            },
        }),
    );
    assert.equal(response.status, 201);
    const proposal = await responseRecord(response, 'Assistant proposal');
    assert.equal(proposal.action, 'repair');
    assert.equal(proposal.baseSql, sql);
    assert.equal(proposal.sql, repairedSql);
});

test('Vercel Fix with AI rejects incomplete failure context before calling the provider', async t => {
    const priorKey = process.env.OPENAI_API_KEY;
    const priorFetch = globalThis.fetch;
    process.env.OPENAI_API_KEY = 'test-key';
    t.after(() => {
        globalThis.fetch = priorFetch;
        if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = priorKey;
    });
    globalThis.fetch = async () => {
        throw new Error('Invalid repair requests must not reach the provider');
    };
    for (const repair of [undefined, {}, { sql: 'SELECT 1' }, { sql: 'SELECT 1', error: '' }]) {
        const response = await handler.fetch(
            request({ ...assistantBody(), action: 'repair', repair }),
        );
        assert.equal(response.status, 400);
        assert.equal(await responseErrorCode(response), 'INVALID_REQUEST');
    }
});

test('Vercel SQL generation requires a same-origin workspace request', async () => {
    const prior = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = '';
    try {
        const response = await handler.fetch(request({}, { origin: 'https://other.example' }));
        assert.equal(response.status, 403);
        assert.equal(await responseErrorCode(response), 'ORIGIN');
    } finally {
        if (prior === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = prior;
    }
});

test('Vercel SQL generation reports a missing server-side API key', async () => {
    const prior = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = '';
    try {
        const response = await handler.fetch(request({}));
        assert.equal(response.status, 503);
        assert.equal(await responseErrorCode(response), 'AI_UNAVAILABLE');
    } finally {
        if (prior === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = prior;
    }
});

test('Vercel assistant reports OpenAI request timeouts with a distinct 504 error', async t => {
    const priorKey = process.env.OPENAI_API_KEY;
    const priorFetch = globalThis.fetch;
    process.env.OPENAI_API_KEY = 'test-key';
    globalThis.fetch = async input => {
        if (String(input).endsWith('/responses/input_tokens'))
            return Response.json({ object: 'response.input_tokens', input_tokens: 200 });
        throw new APIConnectionTimeoutError();
    };
    t.after(() => {
        globalThis.fetch = priorFetch;
        if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = priorKey;
    });

    const response = await handler.fetch(request(assistantBody()));
    assert.equal(response.status, 504);
    assert.deepEqual(await response.json(), {
        error: {
            code: 'AI_TIMEOUT',
            message:
                'The assistant did not finish within 3 minutes. Please try again. No SQL was applied or run.',
        },
    });
});

test('Vercel assistant keeps non-timeout provider failures as 502 errors', async t => {
    const priorKey = process.env.OPENAI_API_KEY;
    const priorFetch = globalThis.fetch;
    process.env.OPENAI_API_KEY = 'test-key';
    globalThis.fetch = async input => {
        if (String(input).endsWith('/responses/input_tokens'))
            return Response.json({ object: 'response.input_tokens', input_tokens: 200 });
        return Response.json({ error: { message: 'Provider unavailable.' } }, { status: 500 });
    };
    t.after(() => {
        globalThis.fetch = priorFetch;
        if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = priorKey;
    });

    const response = await handler.fetch(request(assistantBody()));
    assert.equal(response.status, 502);
    assert.equal(await responseErrorCode(response), 'AI_PROVIDER_ERROR');
});

test('Vercel assistant displays returned text outside the structured format', async t => {
    const priorKey = process.env.OPENAI_API_KEY;
    const priorFetch = globalThis.fetch;
    process.env.OPENAI_API_KEY = 'test-key';
    globalThis.fetch = async input => {
        if (String(input).endsWith('/responses/input_tokens'))
            return Response.json({ object: 'response.input_tokens', input_tokens: 200 });
        return Response.json({
            id: 'resp_invalid_json',
            status: 'completed',
            output_text: '{',
            output: [],
        });
    };
    t.after(() => {
        globalThis.fetch = priorFetch;
        if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = priorKey;
    });

    const response = await handler.fetch(request(assistantBody()));
    assert.equal(response.status, 201);
    assert.equal((await responseRecord(response)).summary, '{');
});

test('Vercel assistant accepts structured replies without enforcing an output format', async t => {
    const priorKey = process.env.OPENAI_API_KEY;
    const priorFetch = globalThis.fetch;
    process.env.OPENAI_API_KEY = 'test-key';
    t.after(() => {
        globalThis.fetch = priorFetch;
        if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = priorKey;
    });

    for (const count of [51, 500]) {
        const tables = Array.from({ length: count }, (_, index) => `default.table_${index}`);
        const content = {
            sql: null,
            summary: 'Review these tables.',
            assumptions: [],
            tables,
            caveats: [],
            clarification: null,
            findings: [],
        };
        const formats: unknown[] = [];
        globalThis.fetch = async (input, init) => {
            const payload = jsonRecord(jsonValue(String(init?.body)), 'OpenAI request');
            formats.push(payload.text);
            if (String(input).endsWith('/responses/input_tokens'))
                return Response.json({ object: 'response.input_tokens', input_tokens: 200 });
            return Response.json({
                id: `resp_${count}_tables`,
                status: 'completed',
                output_text: JSON.stringify(content),
                output: [],
            });
        };

        const response = await handler.fetch(
            request({
                ...assistantBody(),
                schema: {
                    fetchedAt: new Date().toISOString(),
                    tables: tables.map(name => ({
                        database: 'default',
                        name: name.slice('default.'.length),
                        engine: 'MergeTree',
                    })),
                    columns: [],
                    truncated: false,
                },
            }),
        );
        assert.equal(response.status, 201);
        const proposal = await responseRecord(response, 'Assistant proposal');
        assert.deepEqual(proposal.tables, tables);
        assert.equal(proposal.sql, null);
        assert.deepEqual(formats, [undefined, undefined]);
    }
});

test('Vercel assistant preserves table lists beyond the previous limit', async t => {
    const priorKey = process.env.OPENAI_API_KEY;
    const priorFetch = globalThis.fetch;
    process.env.OPENAI_API_KEY = 'test-key';
    globalThis.fetch = async input => {
        if (String(input).endsWith('/responses/input_tokens'))
            return Response.json({ object: 'response.input_tokens', input_tokens: 200 });
        const content = {
            sql: null,
            summary: 'Review these tables.',
            assumptions: [],
            tables: Array.from({ length: 501 }, (_, index) => `default.table_${index}`),
            caveats: [],
            clarification: null,
            findings: [],
        };
        return Response.json({
            id: 'resp_oversized_tables',
            status: 'completed',
            output_text: JSON.stringify(content),
            output: [],
        });
    };
    t.after(() => {
        globalThis.fetch = priorFetch;
        if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = priorKey;
    });

    const response = await handler.fetch(request(assistantBody()));
    assert.equal(response.status, 201);
    assert.equal(arrayValue((await responseRecord(response)).tables).length, 501);
});

test('Vercel assistant keeps caller cancellation separate from its timeout response', async t => {
    const priorKey = process.env.OPENAI_API_KEY;
    const priorFetch = globalThis.fetch;
    const controller = new AbortController();
    let markProviderStarted: () => void = () => {};
    const providerStarted = new Promise<void>(resolve => {
        markProviderStarted = resolve;
    });
    process.env.OPENAI_API_KEY = 'test-key';
    globalThis.fetch = async (input, init) => {
        if (String(input).endsWith('/responses/input_tokens'))
            return Response.json({ object: 'response.input_tokens', input_tokens: 200 });
        markProviderStarted();
        const signal = init?.signal;
        if (!signal) throw new Error('Expected an abort signal for the OpenAI request.');
        return await new Promise<Response>((_resolve, reject) => {
            if (signal.aborted) reject(signal.reason);
            else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
    };
    t.after(() => {
        globalThis.fetch = priorFetch;
        if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = priorKey;
    });

    const responsePromise = handler.fetch(request(assistantBody(), {}, controller.signal));
    await providerStarted;
    controller.abort(new DOMException('Request cancelled.', 'AbortError'));
    const response = await responsePromise;
    assert.equal(response.status, 499);
});

test('Vercel SQL generation rejects an incomplete schema before contacting OpenAI', async () => {
    const prior = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'not-a-real-key';
    try {
        const response = await handler.fetch(
            request({ connectionId: 'cloud', question: 'List rows', sql: 'SELECT 1', schema: {} }),
        );
        assert.equal(response.status, 400);
        assert.equal(await responseErrorCode(response), 'INVALID_SCHEMA');
    } finally {
        if (prior === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = prior;
    }
});

test('Vercel assistant returns a requested table proposal with example geography rows', async () => {
    const priorKey = process.env.OPENAI_API_KEY;
    const priorFetch = globalThis.fetch;
    const sql =
        "CREATE TABLE default.geography_copy ENGINE = MergeTree ORDER BY country AS SELECT 'Poland' AS country, 'Warsaw' AS city, 52.2297 AS latitude, 21.0122 AS longitude UNION ALL SELECT 'Japan', 'Tokyo', 35.6762, 139.6503";
    const content = JSON.stringify({
        sql,
        summary: 'Created a starter geography table with sample rows.',
        assumptions: [],
        tables: [],
        caveats: ['These are example rows, not data copied from an existing table.'],
        clarification: null,
        findings: [],
    });
    process.env.OPENAI_API_KEY = 'test-key';
    globalThis.fetch = async (input, init) => {
        if (String(input).endsWith('/responses/input_tokens'))
            return Response.json({ object: 'response.input_tokens', input_tokens: 200 });
        const payload = jsonRecord(jsonValue(String(init?.body)), 'OpenAI request');
        const instructions = stringValue(payload.instructions, 'OpenAI instructions');
        assert.doesNotMatch(instructions, /SQL must be SELECT\/WITH only/i);
        assert.doesNotMatch(instructions, /Never claim a query ran/i);
        return Response.json({
            id: 'resp_interview',
            status: 'completed',
            output_text: content,
            output: [],
        });
    };
    try {
        const response = await handler.fetch(
            request({
                connectionId: 'clickhouse-cloud',
                question: 'Create a new table called geography_copy with sample geography rows.',
                sql: 'SELECT 1',
                database: 'default',
                schema: {
                    fetchedAt: '2026-09-27T00:00:00.000Z',
                    tables: [
                        {
                            database: 'default',
                            name: 'clickstudio_demo_events',
                            engine: 'MergeTree',
                        },
                    ],
                    columns: [
                        {
                            database: 'default',
                            table: 'clickstudio_demo_events',
                            name: 'day',
                            type: 'Date',
                        },
                    ],
                    truncated: false,
                },
            }),
        );
        assert.equal(response.status, 201);
        const proposal = await responseRecord(response, 'Assistant proposal');
        assert.equal(proposal.sql, sql);
        assert.match(String(arrayValue(proposal.caveats)[0] ?? ''), /example rows/i);
    } finally {
        globalThis.fetch = priorFetch;
        if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = priorKey;
    }
});

test('Vercel assistant returns a full table copy when the source is present', async () => {
    const priorKey = process.env.OPENAI_API_KEY;
    const priorFetch = globalThis.fetch;
    const sql =
        'CREATE TABLE default.geography_copy ENGINE = MergeTree ORDER BY tuple() AS SELECT * FROM default.geography';
    const content = JSON.stringify({
        sql,
        summary: 'Copies every geography column and row into geography_copy.',
        assumptions: [],
        tables: ['default.geography'],
        caveats: [],
        clarification: null,
        findings: [],
    });
    process.env.OPENAI_API_KEY = 'test-key';
    globalThis.fetch = async (input, init) => {
        if (String(input).endsWith('/responses/input_tokens'))
            return Response.json({ object: 'response.input_tokens', input_tokens: 200 });
        const payload = jsonRecord(jsonValue(String(init?.body)), 'OpenAI request');
        const messages = arrayValue(payload.input, 'OpenAI input').map(item =>
            jsonRecord(item, 'OpenAI message'),
        );
        const contentItems = arrayValue(messages[0]?.content, 'OpenAI message content').map(item =>
            jsonRecord(item, 'OpenAI content item'),
        );
        const supplied = jsonRecord(
            jsonValue(stringValue(contentItems[0]?.text, 'OpenAI context text')),
            'Assistant context',
        );
        const context = jsonRecord(supplied.context, 'Assistant context details');
        assert.match(
            stringValue(supplied.question, 'Assistant question'),
            /Include all rows and columns from the source table/i,
        );
        assert.deepEqual(arrayValue(context.tables, 'Assistant tables'), [
            { database: 'default', name: 'geography' },
        ]);
        assert.deepEqual(
            arrayValue(context.schema, 'Assistant schema').map(column =>
                stringValue(jsonRecord(column, 'Assistant schema column').name, 'Column name'),
            ),
            ['country', 'place', 'latitude', 'longitude'],
        );
        return Response.json({
            id: 'resp_table_copy',
            status: 'completed',
            output_text: content,
            output: [],
        });
    };
    try {
        const response = await handler.fetch(
            request({
                connectionId: 'clickhouse-cloud',
                question:
                    'Create a new table called geography_copy using the geography data in this connection. Include all rows and columns from the source table.',
                sql: 'SELECT 1',
                database: 'default',
                schema: {
                    fetchedAt: '2026-09-27T00:00:00.000Z',
                    tables: [{ database: 'default', name: 'geography', engine: 'MergeTree' }],
                    columns: [
                        {
                            database: 'default',
                            table: 'geography',
                            name: 'country',
                            type: 'String',
                        },
                        { database: 'default', table: 'geography', name: 'place', type: 'String' },
                        {
                            database: 'default',
                            table: 'geography',
                            name: 'latitude',
                            type: 'Float64',
                        },
                        {
                            database: 'default',
                            table: 'geography',
                            name: 'longitude',
                            type: 'Float64',
                        },
                    ],
                    truncated: false,
                },
            }),
        );
        assert.equal(response.status, 201);
        const proposal = await responseRecord(response, 'Assistant proposal');
        assert.equal(proposal.sql, sql);
        assert.equal(proposal.quality, undefined);
    } finally {
        globalThis.fetch = priorFetch;
        if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = priorKey;
    }
});
