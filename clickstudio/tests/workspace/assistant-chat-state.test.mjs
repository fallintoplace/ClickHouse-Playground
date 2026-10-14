import test from 'node:test';
import assert from 'node:assert/strict';
import {
    assistantChatsStorageKey,
    assistantSqlReview,
    createAssistantChatState,
    loadAssistantChatState,
    pendingEditorProposal,
    recoverAssistantChatState,
} from '../../.workspace-build/src/frontend/assistant/chat/assistant-chat-state.js';

test('Assistant chat storage is scoped to each connection', () => {
    assert.notEqual(assistantChatsStorageKey('local/one'), assistantChatsStorageKey('local/two'));
    assert.match(assistantChatsStorageKey('local/one'), /local%2Fone/);
});

function sqlTurn(overrides = {}) {
    return {
        id: 'turn',
        draftId: 'draft',
        question: 'Update this query',
        contextSql: 'SELECT 1',
        includeRun: false,
        status: 'complete',
        proposal: {
            id: 'proposal',
            owner: 'local-owner',
            connectionId: 'demo',
            action: 'ask',
            createdAt: '2026-10-11T00:00:00.000Z',
            baseSql: 'SELECT 1',
            responseId: 'response',
            model: 'fixture',
            promptVersion: 'test',
            contextSummary: [],
            decision: 'pending',
            sql: 'SELECT 2',
            summary: 'Updated query',
            assumptions: [],
            tables: [],
            caveats: [],
            clarification: null,
            findings: [],
        },
        ...overrides,
    };
}

const reviewContext = {
    sql: 'SELECT 1',
    draftId: 'draft',
    connectionId: 'demo',
    latestTurnId: 'turn',
};

test('Current SQL changes need editor review', () => {
    assert.deepEqual(assistantSqlReview(sqlTurn(), reviewContext), {
        status: 'Needs review',
    });
});

test('Returned SQL can be reviewed regardless of the request action', () => {
    const turn = sqlTurn();
    for (const action of ['explain', 'review']) {
        const state = assistantSqlReview(
            sqlTurn({ proposal: { ...turn.proposal, action } }),
            reviewContext,
        );
        assert.deepEqual(state, { status: 'Needs review' });
        assert.equal(
            pendingEditorProposal(
                [sqlTurn({ proposal: { ...turn.proposal, action } })],
                'draft',
                'demo',
                'SELECT 1',
            ).proposal.action,
            action,
        );
    }
    assert.deepEqual(
        assistantSqlReview(
            sqlTurn({ proposal: { ...turn.proposal, sql: turn.proposal.baseSql } }),
            reviewContext,
        ),
        { status: 'No SQL changes' },
    );
});

test('Old, unowned and cross-connection proposals stay informational', () => {
    const turn = sqlTurn();
    const cases = [
        [turn, { ...reviewContext, latestTurnId: 'later' }],
        [sqlTurn({ draftId: undefined }), reviewContext],
        [turn, { ...reviewContext, connectionId: 'other' }],
        ...['pending', 'failed', 'cancelled'].map(status => [sqlTurn({ status }), reviewContext]),
    ];
    for (const [candidate, context] of cases)
        assert.deepEqual(assistantSqlReview(candidate, context), {
            status: 'Earlier proposal',
        });
});

test('Accepted and rejected history keeps the recorded decision', () => {
    const turn = sqlTurn();
    for (const [decision, status] of [
        ['accepted', 'Applied'],
        ['rejected', 'Rejected'],
    ]) {
        const candidate = sqlTurn({ proposal: { ...turn.proposal, decision } });
        assert.deepEqual(
            assistantSqlReview(candidate, { ...reviewContext, latestTurnId: 'later' }),
            { status },
        );
    }
});

test('An accepted proposal that missed its draft is not reported as applied', () => {
    const turn = sqlTurn({ applied: false });
    turn.proposal.decision = 'accepted';
    const state = createAssistantChatState();
    state.chats[0].turns = [turn];
    const restored = recoverAssistantChatState(state).chats[0].turns[0];
    assert.equal(restored.applied, false);
    assert.deepEqual(assistantSqlReview(restored, reviewContext), {
        status: 'Not applied',
        message: 'The original SQL draft closed before this proposal could be applied.',
    });
    for (const applied of [true, undefined, 'false']) {
        state.chats[0].turns = [{ ...turn, applied }];
        const recovered = recoverAssistantChatState(state).chats[0].turns[0];
        assert.equal(assistantSqlReview(recovered, reviewContext).status, 'Applied');
        if (applied === true) assert.equal(recovered.applied, true);
        else assert.equal(Object.hasOwn(recovered, 'applied'), false);
    }
});

test('Changing tabs retains the proposal ownership warning without replacing another draft', () => {
    assert.deepEqual(assistantSqlReview(sqlTurn(), { ...reviewContext, draftId: 'other' }), {
        status: 'Another query',
        message: 'Open the original SQL tab to review this proposal.',
    });
});

test('Edited drafts and stored static checks do not block returned SQL', () => {
    assert.deepEqual(assistantSqlReview(sqlTurn(), { ...reviewContext, sql: 'SELECT 99' }), {
        status: 'Needs review',
    });
    const turn = sqlTurn();
    const failed = sqlTurn({ proposal: { ...turn.proposal, quality: { status: 'fail' } } });
    assert.deepEqual(assistantSqlReview(failed, reviewContext), {
        status: 'Needs review',
    });
});

test('Editor proposals belong to the originating query and connection', () => {
    const turn = sqlTurn();
    assert.equal(pendingEditorProposal([turn], 'draft', 'demo', 'SELECT 1').id, 'turn');
    assert.equal(pendingEditorProposal([turn], 'other-draft', 'demo', 'SELECT 1'), undefined);
    assert.equal(pendingEditorProposal([turn], 'draft', 'other-connection', 'SELECT 1'), undefined);
    assert.equal(
        pendingEditorProposal([sqlTurn({ draftId: undefined })], 'draft', 'demo', 'SELECT 1'),
        undefined,
    );
});

test('A background reply can review and replace an edited SQL draft', () => {
    const turn = sqlTurn();
    assert.equal(pendingEditorProposal([turn], 'draft', 'demo', 'SELECT 1').id, 'turn');
    for (const sql of ['SELECT 3', '', 'SELECT 1;'])
        assert.equal(pendingEditorProposal([turn], 'draft', 'demo', sql).id, 'turn');
    assert.deepEqual(assistantSqlReview(turn, { ...reviewContext, sql: 'SELECT 3' }), {
        status: 'Needs review',
    });
});

test('Only complete, undecided SQL changes open an editor review', () => {
    const turn = sqlTurn();
    for (const status of ['pending', 'failed', 'cancelled'])
        assert.equal(
            pendingEditorProposal([sqlTurn({ status })], 'draft', 'demo', 'SELECT 1'),
            undefined,
        );
    for (const proposal of [
        undefined,
        { ...turn.proposal, decision: 'accepted' },
        { ...turn.proposal, decision: 'rejected' },
        { ...turn.proposal, sql: null },
        { ...turn.proposal, sql: turn.proposal.baseSql },
    ])
        assert.equal(
            pendingEditorProposal([sqlTurn({ proposal })], 'draft', 'demo', 'SELECT 1'),
            undefined,
        );
    assert.equal(
        pendingEditorProposal(
            [sqlTurn({ proposal: { ...turn.proposal, sql: '' } })],
            'draft',
            'demo',
            'SELECT 1',
        ).proposal.sql,
        '',
    );
});

test('Older proposals do not reopen after a later answer for the same query', () => {
    const turn = sqlTurn();
    const later = sqlTurn({ id: 'later', proposal: { ...turn.proposal, decision: 'accepted' } });
    const otherDraft = sqlTurn({ id: 'other', draftId: 'other-draft' });
    assert.equal(
        pendingEditorProposal([turn, later, otherDraft], 'draft', 'demo', 'SELECT 1'),
        undefined,
    );
    assert.equal(pendingEditorProposal([turn, otherDraft], 'draft', 'demo', 'SELECT 1').id, 'turn');
    assert.equal(
        pendingEditorProposal([turn, sqlTurn({ status: 'pending' })], 'draft', 'demo', 'SELECT 1'),
        undefined,
    );
});

test('Restored proposals retain query ownership without assigning legacy turns', () => {
    const state = createAssistantChatState();
    state.chats[0].turns = [sqlTurn(), sqlTurn({ id: 'legacy', draftId: undefined })];
    const turns = recoverAssistantChatState(state).chats[0].turns;
    assert.equal(turns[0].draftId, 'draft');
    assert.equal(Object.hasOwn(turns[1], 'draftId'), false);
    assert.equal(pendingEditorProposal(turns, 'draft', 'demo', 'SELECT 1').id, 'turn');
});

test('Restored turns retain attachment labels without storing image data', () => {
    const state = createAssistantChatState();
    state.chats[0].turns = [
        sqlTurn({ images: ['snowflake.png', 'databricks.png', 'data:image/png;base64,abc'] }),
    ];

    assert.deepEqual(recoverAssistantChatState(state).chats[0].turns[0].images, [
        'snowflake.png',
        'databricks.png',
    ]);
    state.chats[0].turns = [
        sqlTurn({ images: Array.from({ length: 13 }, (_, index) => `${index}.png`) }),
    ];
    assert.equal(recoverAssistantChatState(state).chats[0].turns[0].images, undefined);
});

test('Assistant chats restore the selected thread and keep every conversation', () => {
    const first = {
        id: 'first',
        title: 'First question',
        createdAt: 'now',
        updatedAt: 'now',
        turns: [],
    };
    const second = {
        id: 'second',
        title: 'Follow-up',
        createdAt: 'later',
        updatedAt: 'later',
        turns: [
            {
                id: 'turn-1',
                question: 'Why?',
                contextSql: 'SELECT 1',
                includeRun: true,
                runId: 'run-1',
                runContext: {
                    evidenceSql: 'SELECT answer',
                    error: 'Fixture error',
                    result: {
                        runId: 'run-1',
                        queryId: 'query-1',
                        columns: [{ name: 'answer', type: 'UInt8' }],
                        rows: [['1']],
                        completeness: 'complete',
                        createdAt: 'now',
                    },
                },
                status: 'complete',
            },
        ],
    };
    const recovered = recoverAssistantChatState({
        version: 1,
        activeChatId: 'second',
        chats: [first, second],
    });

    assert.equal(recovered.activeChatId, 'second');
    assert.deepEqual(
        recovered.chats.map(chat => chat.id),
        ['first', 'second'],
    );
    assert.equal(recovered.chats[1].turns[0].question, 'Why?');
    assert.equal(recovered.chats[1].turns[0].runContext.evidenceSql, 'SELECT answer');
    assert.deepEqual(recovered.chats[1].turns[0].runContext.result.rows, [['1']]);
});

test('Malformed retained run results are discarded without losing other turns', () => {
    const result = {
        runId: 'run-1',
        queryId: 'query-1',
        columns: [{ name: 'answer', type: 'UInt8' }],
        rows: [['1']],
        completeness: 'complete',
        createdAt: 'now',
    };
    const recovered = recoverAssistantChatState({
        version: 1,
        activeChatId: 'chat',
        chats: [
            {
                id: 'chat',
                title: 'A chat',
                createdAt: 'now',
                updatedAt: 'now',
                turns: [
                    {
                        id: 'valid',
                        question: 'Keep me',
                        contextSql: 'SELECT 1',
                        includeRun: true,
                        status: 'complete',
                        runContext: { result },
                    },
                    {
                        id: 'bad-row-width',
                        question: 'Drop me',
                        contextSql: 'SELECT 2',
                        includeRun: true,
                        status: 'complete',
                        runContext: { result: { ...result, rows: [['1', 'extra']] } },
                    },
                    {
                        id: 'bad-cell',
                        question: 'Drop me too',
                        contextSql: 'SELECT 3',
                        includeRun: true,
                        status: 'complete',
                        runContext: { result: { ...result, rows: [[undefined]] } },
                    },
                ],
            },
        ],
    });

    assert.deepEqual(
        recovered.chats[0].turns.map(turn => turn.id),
        ['valid'],
    );
});

test('Cyclic run context is discarded without throwing during recovery', () => {
    const runContext = {};
    runContext.self = runContext;
    const recovered = recoverAssistantChatState({
        version: 1,
        activeChatId: 'chat',
        chats: [
            {
                id: 'chat',
                title: 'A chat',
                createdAt: 'now',
                updatedAt: 'now',
                turns: [
                    {
                        id: 'cycle',
                        question: 'Recover safely',
                        contextSql: 'SELECT 1',
                        includeRun: true,
                        status: 'complete',
                        runContext,
                    },
                ],
            },
        ],
    });

    assert.deepEqual(recovered.chats[0].turns, []);
});

test('An in-flight chat turn becomes a clear cancelled message after reload', () => {
    const state = createAssistantChatState();
    state.chats[0].turns.push({
        id: 'pending-turn',
        question: 'Explain this',
        contextSql: 'SELECT 1',
        includeRun: false,
        status: 'pending',
    });

    const recovered = recoverAssistantChatState(state);

    assert.equal(recovered.chats[0].turns[0].status, 'cancelled');
    assert.match(recovered.chats[0].turns[0].error, /interrupted when the page closed/);
});

test('Restored chat errors keep interruption priority, empty text and absent properties', () => {
    const state = createAssistantChatState();
    const cases = [
        { status: 'pending', error: 'Previous error' },
        { status: 'failed', error: 'x'.repeat(4_001) },
        { status: 'failed', error: '' },
        { status: 'complete' },
        { status: 'failed', error: { message: 'Invalid error' } },
    ];
    state.chats[0].turns = cases.map((entry, index) => ({
        id: `turn-${index}`,
        question: 'Explain this',
        contextSql: 'SELECT 1',
        includeRun: false,
        ...entry,
    }));
    const turns = recoverAssistantChatState(state).chats[0].turns;
    assert.equal(turns.length, cases.length);
    assert.equal(turns[0].status, 'cancelled');
    assert.match(turns[0].error, /interrupted when the page closed/);
    assert.equal(turns[1].error, 'x'.repeat(4_000));
    assert.equal(turns[2].error, '');
    assert.equal(Object.hasOwn(turns[2], 'error'), true);
    assert.equal(Object.hasOwn(turns[3], 'error'), false);
    assert.equal(Object.hasOwn(turns[4], 'error'), false);
});

test('Malformed turns are discarded without losing the rest of a chat', () => {
    const recovered = recoverAssistantChatState({
        version: 1,
        activeChatId: 'chat',
        chats: [
            {
                id: 'chat',
                title: 'A chat',
                createdAt: 'now',
                updatedAt: 'now',
                turns: [
                    {
                        id: 'valid',
                        question: 'Keep me',
                        contextSql: 'SELECT 1',
                        includeRun: false,
                        status: 'complete',
                    },
                    {
                        id: 'invalid',
                        question: 'x'.repeat(4_001),
                        contextSql: 'SELECT 2',
                        includeRun: false,
                        status: 'complete',
                    },
                ],
            },
        ],
    });

    assert.deepEqual(
        recovered.chats[0].turns.map(turn => turn.id),
        ['valid'],
    );
});

test('Unreadable assistant chat storage returns a visible recovery error', () => {
    const loaded = loadAssistantChatState('chat-key', {
        getItem: () => {
            throw new Error('storage denied');
        },
    });

    assert.equal(loaded.state.chats.length, 1);
    assert.match(loaded.error, /storage is unavailable/);
});
