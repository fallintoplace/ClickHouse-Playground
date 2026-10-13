import test from 'node:test';
import assert from 'node:assert/strict';
import { APIConnectionTimeoutError } from 'openai';
import { OpenAIDriver } from '../../src/backend/assistant/openai-client.js';
import {
    ASSISTANT_REQUEST_TIMEOUT_MS,
    type PreparedContext,
} from '../../src/backend/assistant/proposals/assistant.js';
import { AppError } from '../../src/backend/system/requests/errors.js';
import { createApp } from '../../src/backend/app/app.js';
import { loadConfig } from '../../src/backend/system/config.js';
import { DemoDriver } from '../../src/backend/database/clickhouse/sample-client.js';
import { MemoryStore } from '../../src/backend/system/store.js';
import { arrayValue, jsonRecord, jsonValue, stringValue } from '../helpers/type-guards.js';

function assistantContext(
    payload: PreparedContext['payload'] = {
        instructions: 'Use the supplied context.',
        question: 'Summarize this SQL.',
        context: JSON.stringify({ sql: 'SELECT 1' }),
    },
): PreparedContext {
    return {
        id: 'test-context',
        owner: 'test-owner',
        connectionId: 'demo',
        action: 'explain',
        createdAt: '2026-09-28T00:00:00.000Z',
        expiresAt: '2026-09-28T00:05:00.000Z',
        baseSql: 'SELECT 1',
        payload,
        summary: [],
        state: 'ready',
    };
}

function isAssistantTimeout(error: unknown): boolean {
    return error instanceof AppError && error.status === 504 && error.code === 'AI_TIMEOUT';
}

test('OpenAI counting and generation both allow work beyond the old deadline', async t => {
    const originalFetch = globalThis.fetch;
    t.after(() => {
        globalThis.fetch = originalFetch;
    });
    for (const phase of ['input_tokens', 'responses'])
        await t.test(phase, async step => {
            step.mock.timers.enable({ apis: ['setTimeout'] });
            let receivedSignal: AbortSignal | undefined;
            let markStarted: () => void = () => {};
            const started = new Promise<void>(resolve => {
                markStarted = resolve;
            });
            globalThis.fetch = async (input, init) => {
                if (String(input).endsWith('/responses/input_tokens') && phase === 'responses')
                    return Response.json({ object: 'response.input_tokens', input_tokens: 200 });
                const signal = init?.signal;
                assert.ok(signal);
                receivedSignal = signal;
                markStarted();
                return await new Promise<Response>((_resolve, reject) =>
                    signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
                );
            };
            const driver = new OpenAIDriver('test-key', 'test-model');
            const rejected = assert.rejects(
                driver.propose(assistantContext(), new AbortController().signal),
                isAssistantTimeout,
            );
            await started;
            step.mock.timers.tick(45_000);
            assert.equal(receivedSignal?.aborted, false);
            step.mock.timers.tick(ASSISTANT_REQUEST_TIMEOUT_MS - 45_000);
            await rejected;
            assert.equal(receivedSignal?.aborted, true);
        });
});

test('OpenAI receives prior chat messages before the fresh SQL context', async t => {
    const originalFetch = globalThis.fetch;
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = async (input, init) => {
        const url = String(input);
        const body = jsonRecord(jsonValue(String(init?.body)), 'OpenAI request');
        if (url.endsWith('/responses/input_tokens'))
            return new Response(
                JSON.stringify({ object: 'response.input_tokens', input_tokens: 200 }),
                { status: 200, headers: { 'content-type': 'application/json' } },
            );
        requestBody = body;
        return new Response(
            JSON.stringify({
                id: 'response-1',
                status: 'completed',
                output_text: JSON.stringify({
                    sql: null,
                    summary: 'Follow-up answer',
                    assumptions: [],
                    tables: [],
                    caveats: [],
                    clarification: null,
                    findings: [],
                }),
                output: [],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
        );
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
    });

    const context = assistantContext({
        instructions: 'Use prior messages for follow-ups.',
        question: 'And now?',
        context: JSON.stringify({ sql: 'SELECT 2' }),
        conversation: [
            { role: 'user', content: 'Show the old question' },
            { role: 'assistant', content: 'I need an airport table.' },
        ],
    });
    const driver = new OpenAIDriver('test-key', 'test-model');

    await driver.propose(context, new AbortController().signal);

    assert.equal(requestBody?.store, false);
    assert.equal(requestBody?.service_tier, 'priority');
    assert.equal(requestBody?.reasoning, undefined);
    const input = arrayValue(requestBody?.input, 'OpenAI input');
    assert.deepEqual(input.slice(0, 2), [
        { role: 'user', content: 'Show the old question' },
        { role: 'assistant', content: 'I need an airport table.' },
    ]);
    const freshMessage = jsonRecord(input[2], 'Fresh OpenAI message');
    assert.equal(freshMessage.role, 'user');
    const freshContent = jsonRecord(arrayValue(freshMessage.content, 'Fresh message content')[0]);
    assert.deepEqual(jsonValue(stringValue(freshContent.text, 'Fresh message text')), {
        question: 'And now?',
        context: { sql: 'SELECT 2' },
    });
});

test('OpenAI replies preserve standalone alternatives without local output limits', async t => {
    const priorFetch = globalThis.fetch;
    t.after(() => {
        globalThis.fetch = priorFetch;
    });
    const content = {
        sql: null,
        alternatives: Array.from({ length: 5 }, (_, index) => ({
            title: `Option ${index}`,
            summary: 'x'.repeat(1001),
            sql: `SELECT ${index}`,
        })),
        summary: 'x'.repeat(20001),
        assumptions: Array.from({ length: 51 }, () => 'x'.repeat(4001)),
        tables: [],
        caveats: [],
        clarification: null,
        findings: [],
    };
    globalThis.fetch = async (input, init) => {
        const body = jsonRecord(jsonValue(String(init?.body)), 'OpenAI request');
        assert.equal(body.max_output_tokens, undefined);
        if (String(input).endsWith('/responses/input_tokens'))
            return Response.json({ object: 'response.input_tokens', input_tokens: 200 });
        return Response.json({
            id: 'alternatives-response',
            status: 'completed',
            output_text: JSON.stringify(content),
            output: [],
        });
    };
    const driver = new OpenAIDriver('test-key', 'test-model');
    const response = await driver.propose(assistantContext(), new AbortController().signal);
    assert.deepEqual(response.content, content);
});

test('OpenAI text, refusals and partial replies are displayed as returned', async t => {
    const priorFetch = globalThis.fetch;
    t.after(() => {
        globalThis.fetch = priorFetch;
    });
    for (const reply of [
        {
            status: 'completed',
            output_text: 'Here is the full answer.',
            output: [],
            expected: 'Here is the full answer.',
        },
        {
            status: 'completed',
            output_text: '{"unexpected":"reply"}',
            output: [],
            expected: '{"unexpected":"reply"}',
        },
        {
            status: 'completed',
            output_text: '',
            output: [
                {
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'refusal', refusal: 'I cannot help with that request.' }],
                },
            ],
            expected: 'I cannot help with that request.',
        },
        {
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' },
            output_text: 'The reply stopped here',
            output: [],
            expected: 'The reply stopped here',
        },
        {
            status: 'incomplete',
            incomplete_details: { reason: 'content_filter' },
            output_text: 'This is the returned portion.',
            output: [],
            expected: 'This is the returned portion.',
        },
    ]) {
        const { expected, ...body } = reply;
        globalThis.fetch = async input =>
            String(input).endsWith('/responses/input_tokens')
                ? Response.json({ object: 'response.input_tokens', input_tokens: 200 })
                : Response.json({ id: 'text-response', ...body });
        const response = await new OpenAIDriver('test-key', 'test-model').propose(
            assistantContext(),
            new AbortController().signal,
        );
        assert.equal(response.content.summary, expected);
        assert.equal(response.content.sql, null);
        assert.deepEqual(response.content.alternatives, []);
    }
});

test('OpenAI replies preserve all web citations', async t => {
    const priorFetch = globalThis.fetch;
    t.after(() => {
        globalThis.fetch = priorFetch;
    });
    const annotations = Array.from({ length: 25 }, (_, index) => ({
        type: 'url_citation',
        title: `Source ${index}`,
        url: `https://example.com/${index}`,
        start_index: 0,
        end_index: 1,
    }));
    globalThis.fetch = async input =>
        String(input).endsWith('/responses/input_tokens')
            ? Response.json({ object: 'response.input_tokens', input_tokens: 200 })
            : Response.json({
                  id: 'sources-response',
                  status: 'completed',
                  output: [
                      {
                          type: 'message',
                          role: 'assistant',
                          content: [{ type: 'output_text', text: 'Returned answer', annotations }],
                      },
                  ],
              });
    const response = await new OpenAIDriver('test-key', 'test-model').propose(
        assistantContext(),
        new AbortController().signal,
    );
    assert.equal(response.content.summary, 'Returned answer');
    assert.deepEqual(
        response.content.sources,
        annotations.map(({ title, url }) => ({ title, url })),
    );
});

test('OpenAI network failures and empty responses still return errors', async t => {
    const priorFetch = globalThis.fetch;
    t.after(() => {
        globalThis.fetch = priorFetch;
    });
    globalThis.fetch = async input => {
        if (String(input).endsWith('/responses/input_tokens'))
            return Response.json({ object: 'response.input_tokens', input_tokens: 200 });
        throw new TypeError('Network connection lost');
    };
    await assert.rejects(
        new OpenAIDriver('test-key', 'test-model').propose(
            assistantContext(),
            new AbortController().signal,
        ),
        {
            code: 'AI_PROVIDER_ERROR',
        },
    );
    globalThis.fetch = async input =>
        String(input).endsWith('/responses/input_tokens')
            ? Response.json({ object: 'response.input_tokens', input_tokens: 200 })
            : Response.json({ id: 'empty-response', status: 'completed', output: [] });
    await assert.rejects(
        new OpenAIDriver('test-key', 'test-model').propose(
            assistantContext(),
            new AbortController().signal,
        ),
        {
            code: 'AI_INCOMPLETE',
        },
    );
});

test('Local assistant requests use the configured service tier without changing reasoning', async t => {
    const originalFetch = globalThis.fetch;
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
            output_text: JSON.stringify({
                sql: null,
                summary: 'This SQL returns one row.',
                assumptions: [],
                tables: [],
                caveats: [],
                clarification: null,
                findings: [],
            }),
            output: [],
        });
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
    });
    for (const tier of [undefined, 'fast', 'priority', 'default']) {
        const config = loadConfig({
            OPENAI_API_KEY: 'test-key',
            OPENAI_MODEL: 'test-model',
            OPENAI_SERVICE_TIER: tier,
        });
        config.profiles = config.profiles.filter(profile => !profile.publicPlayground);
        const service = createApp(config, { store: new MemoryStore(), driver: new DemoDriver() });
        try {
            const owner = { id: 'local-owner', role: 'owner' } as const;
            service.runs.trust(owner, 'demo', true);
            const context = service.ai.prepare(owner, {
                connectionId: 'demo',
                action: 'explain',
                question: 'Explain this SQL.',
                sql: 'SELECT 1',
                schema: {
                    connectionId: 'demo',
                    fetchedAt: new Date().toISOString(),
                    tables: [],
                    columns: [],
                    truncated: false,
                },
            });
            const proposal = await service.ai.propose(owner, context.id, true);
            assert.equal(proposal.summary, 'This SQL returns one row.');
            assert.equal(requestBody?.model, 'test-model');
            assert.equal(requestBody?.service_tier, tier === 'default' ? 'default' : 'priority');
            assert.equal(requestBody?.reasoning, undefined);
            assert.equal(requestBody?.store, false);
        } finally {
            await service.close();
        }
    }
});

test('Fast processing stays enabled when a context-length error retries with less chat history', async t => {
    const originalFetch = globalThis.fetch;
    const requests: Array<Record<string, unknown>> = [];
    globalThis.fetch = async (input, init) => {
        if (String(input).endsWith('/responses/input_tokens'))
            return Response.json({ object: 'response.input_tokens', input_tokens: 200 });
        requests.push(jsonRecord(jsonValue(String(init?.body)), 'OpenAI request'));
        if (requests.length === 1)
            return Response.json(
                { error: { message: 'Context length exceeded.', code: 'context_length_exceeded' } },
                { status: 400 },
            );
        return Response.json({
            id: 'response-retry',
            status: 'completed',
            output_text: JSON.stringify({
                sql: null,
                summary: 'A completed answer.',
                assumptions: [],
                tables: [],
                caveats: [],
                clarification: null,
                findings: [],
            }),
            output: [],
        });
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
    });
    const context = assistantContext();
    context.payload.conversation = [
        { role: 'user', content: 'Earlier question.' },
        { role: 'assistant', content: 'Earlier answer.' },
    ];
    const driver = new OpenAIDriver('test-key', 'test-model');
    await driver.propose(context, new AbortController().signal);
    assert.equal(requests.length, 2);
    assert.deepEqual(
        requests.map(body => body.service_tier),
        ['priority', 'priority'],
    );
    assert.deepEqual(
        requests.map(body => arrayValue(body.input, 'OpenAI input').length),
        [3, 1],
    );
});

test('OpenAI response timeouts become a distinct assistant timeout error', async t => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async input => {
        if (String(input).endsWith('/responses/input_tokens'))
            return Response.json({ object: 'response.input_tokens', input_tokens: 200 });
        throw new APIConnectionTimeoutError();
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
    });

    const driver = new OpenAIDriver('test-key', 'test-model');
    await assert.rejects(
        () => driver.propose(assistantContext(), new AbortController().signal),
        isAssistantTimeout,
    );
});

test('OpenAI input-token request timeouts do not fall through as optional count failures', async t => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
        throw new APIConnectionTimeoutError();
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
    });

    const driver = new OpenAIDriver('test-key', 'test-model');
    await assert.rejects(
        () => driver.propose(assistantContext(), new AbortController().signal),
        isAssistantTimeout,
    );
});

test('assistant deadline aborts become AI_TIMEOUT while caller cancellation stays distinct', async t => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
        if (!init?.signal?.aborted)
            throw new Error('Unexpected OpenAI request without an aborted signal.');
        throw init.signal.reason;
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
    });

    const driver = new OpenAIDriver('test-key', 'test-model');
    const deadline = new AbortController();
    deadline.abort(new DOMException('Deadline reached.', 'TimeoutError'));
    await assert.rejects(
        () => driver.propose(assistantContext(), deadline.signal),
        isAssistantTimeout,
    );

    const cancellation = new AbortController();
    cancellation.abort(new DOMException('Request cancelled.', 'AbortError'));
    await assert.rejects(
        () => driver.propose(assistantContext(), cancellation.signal),
        error =>
            error === cancellation.signal.reason ||
            (error instanceof Error && /abort|cancel/i.test(`${error.name} ${error.message}`)),
    );
});
