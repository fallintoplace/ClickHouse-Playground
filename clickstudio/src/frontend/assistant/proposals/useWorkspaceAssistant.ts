import type {
    AssistantRepairContext,
    ProposalDecisionAction,
} from '../../../shared/assistant/actions';
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { flushSync } from 'react-dom';
import { parseAssistantProposal } from './assistant-proposal';
import type { AssistantConversationMessage } from '../../../shared/assistant/types';
import type { Result } from '../../../shared/queries/results/types';
import type { Schema } from '../../../shared/database/schema/types';
import { apiResponses, isFrontendDemoPreview, message, post } from '../../api/client';
import { useAssistantChats } from '../chat/useAssistantChats';
import {
    pendingEditorProposal,
    type AssistantChat,
    type AssistantChatTurn,
} from '../chat/assistant-chat-state';
import {
    checkpoint,
    type Draft,
    type WorkspaceState,
} from '../../queries/editor/drafts/workspace-state';

function boundedAssistantResult(result?: Result): Result | undefined {
    if (!result) return undefined;
    const columns = result.columns.slice(0, 100);
    const bounded: Result = { ...result, columns, rows: [] };
    let bytes = JSON.stringify(bounded).length;
    for (const row of result.rows) {
        const boundedRow = row.slice(0, columns.length);
        const rowBytes = JSON.stringify(boundedRow).length;
        if (bounded.rows.length >= 100 || bytes + rowBytes > 24_000) break;
        bounded.rows.push(boundedRow);
        bytes += rowBytes;
    }
    return bounded;
}

const MAX_ASSISTANT_HISTORY_BYTES = 24_000;
const MAX_ASSISTANT_HISTORY_TURNS = 8;
const MAX_RECENT_ASSISTANT_TURN_BYTES = 12_000;

function compactConversationTurn(turn: AssistantChatTurn): AssistantConversationMessage[] {
    const messages: AssistantConversationMessage[] = [
        {
            role: 'user',
            content: JSON.stringify({ question: turn.question.slice(0, 2_000) }),
        },
    ];
    if (turn.proposal) {
        messages.push({
            role: 'assistant',
            content: JSON.stringify({
                summary: turn.proposal.summary.slice(0, 1_500),
                clarification: turn.proposal.clarification?.slice(0, 500) ?? null,
            }),
        });
    } else if (turn.error) {
        messages.push({ role: 'assistant', content: turn.error.slice(0, 800) });
    }
    return messages;
}

function detailedConversationTurn(turn: AssistantChatTurn): AssistantConversationMessage[] {
    const messages: AssistantConversationMessage[] = [
        {
            role: 'user',
            content: JSON.stringify({
                question: turn.question,
                sql: turn.contextSql,
                includeRun: turn.includeRun,
                ...(turn.runId ? { runId: turn.runId } : {}),
                ...(turn.runContext ? { runContext: turn.runContext } : {}),
            }),
        },
    ];
    if (turn.proposal) {
        const {
            summary,
            clarification,
            sql,
            alternatives,
            assumptions,
            tables,
            caveats,
            sources,
            findings,
            decision,
            quality,
        } = turn.proposal;
        messages.push({
            role: 'assistant',
            content: JSON.stringify({
                summary,
                clarification,
                sql,
                alternatives,
                assumptions,
                tables,
                caveats,
                sources,
                findings,
                decision,
                quality,
            }),
        });
    } else if (turn.error) {
        messages.push({ role: 'assistant', content: turn.error });
    }
    return messages;
}

function conversationHistory(turns: readonly AssistantChatTurn[]): AssistantConversationMessage[] {
    const completed = turns
        .filter(turn => turn.status !== 'pending')
        .slice(-MAX_ASSISTANT_HISTORY_TURNS);
    const bundles = completed.map((turn, index) => {
        const compact = compactConversationTurn(turn);
        if (index !== completed.length - 1) return compact;
        const detailed = detailedConversationTurn(turn);
        return new TextEncoder().encode(JSON.stringify(detailed)).length <=
            MAX_RECENT_ASSISTANT_TURN_BYTES
            ? detailed
            : compact;
    });
    const history = () => bundles.flat();
    const bytes = () => new TextEncoder().encode(JSON.stringify(history())).length;
    while (bundles.length > 1 && bytes() > MAX_ASSISTANT_HISTORY_BYTES) bundles.shift();
    if (bytes() > MAX_ASSISTANT_HISTORY_BYTES && bundles.length)
        bundles[0] = compactConversationTurn(completed[completed.length - 1]!);
    return bytes() <= MAX_ASSISTANT_HISTORY_BYTES ? history() : [];
}

function chatTitle(question: string) {
    return question.replace(/\s+/g, ' ').trim();
}

type AssistantPhase = 'preparing' | 'generating' | 'deciding';
type AssistantRunContext = { result?: Result; evidenceSql?: string; error?: string };
type AssistantRunContextLoader = (signal: AbortSignal) => Promise<AssistantRunContext>;
type AssistantRequestOptions = {
    repair?: AssistantRepairContext;
    loadSchema?: () => Promise<Schema | undefined>;
};
type AssistantActivity = { turnId: string; phase: AssistantPhase };
type ActiveAssistantRequest = {
    turnId: string;
    phase: AssistantPhase;
    controller: AbortController;
};

type AssistantSqlRequestContext = {
    active: Draft;
    activeRunId?: string;
    connectionId: string;
    trusted: boolean;
    activeChat: AssistantChat;
    includeRun: boolean;
    assistantQuestion: string;
    requestsRef: { current: Map<string, ActiveAssistantRequest> };
    beginAssistantRequest: (
        chatId: string,
        turnId: string,
        phase: AssistantPhase,
    ) => ActiveAssistantRequest;
    finishAssistantRequest: (chatId: string, request: ActiveAssistantRequest) => void;
    setAssistantError: (error: string, chatId?: string) => void;
    setQuestionDrafts: Dispatch<SetStateAction<Record<string, string>>>;
    setActivities: Dispatch<SetStateAction<Record<string, AssistantActivity>>>;
    updateChat: ReturnType<typeof useAssistantChats>['updateChat'];
};

function createAssistantSqlRequestHandler(context: AssistantSqlRequestContext) {
    const {
        active,
        activeRunId,
        connectionId,
        trusted,
        activeChat,
        includeRun,
        assistantQuestion,
        requestsRef,
        beginAssistantRequest,
        finishAssistantRequest,
        setAssistantError,
        setQuestionDrafts,
        setActivities,
        updateChat,
    } = context;
    const requestAssistantSql = async (
        schema?: Schema,
        serverVersion?: string,
        database?: string,
        loadRunContext?: AssistantRunContextLoader,
        options?: AssistantRequestOptions,
    ) => {
        if (!trusted || requestsRef.current.has(activeChat.id)) return;
        const repair = options?.repair;
        const requestIncludesRun = includeRun && !repair;
        const question = repair
            ? 'Fix this query error and return the updated SQL draft, keeping the other statements unchanged.'
            : assistantQuestion.trim();
        if (!question) {
            setAssistantError('Ask a question or describe the SQL you want first.');
            return;
        }
        if (!schema && !options?.loadSchema) {
            setAssistantError('Refresh the ClickHouse schema before asking the assistant.');
            return;
        }
        if (requestIncludesRun && !activeRunId) {
            setAssistantError('Run a query before including its run context.');
            return;
        }
        const chatId = activeChat.id;
        const draftId = active.id;
        const turnId = crypto.randomUUID();
        const history = conversationHistory(activeChat.turns);
        const now = new Date().toISOString();
        const turn: AssistantChatTurn = {
            id: turnId,
            draftId,
            question,
            contextSql: active.sql,
            includeRun: requestIncludesRun,
            ...(requestIncludesRun && activeRunId ? { runId: activeRunId } : {}),
            status: 'pending' as const,
        };
        const request = beginAssistantRequest(
            chatId,
            turnId,
            requestIncludesRun || !schema ? 'preparing' : 'generating',
        );
        const { controller } = request;
        setAssistantError('');
        if (!repair) setQuestionDrafts(current => ({ ...current, [chatId]: '' }));
        updateChat(chatId, chat => ({
            ...chat,
            title:
                chat.turns.length || chat.title !== 'New chat' ? chat.title : chatTitle(question),
            updatedAt: now,
            turns: [...chat.turns, turn],
        }));
        try {
            const currentSchema = schema ?? (await options?.loadSchema?.());
            controller.signal.throwIfAborted();
            if (!currentSchema) throw new Error('Could not load the ClickHouse schema. Try again.');
            const prepareRunContext = async () => {
                let runContext;

                if (repair) {
                    runContext = { evidenceSql: repair.sql, error: repair.error };
                } else if (requestIncludesRun) {
                    runContext = await loadRunContext?.(controller.signal);
                } else {
                    runContext = undefined;
                }
                controller.signal.throwIfAborted();
                if (requestIncludesRun && !runContext)
                    throw new Error('Could not load the selected run context. Try again.');
                const storedRunContext = runContext
                    ? {
                          ...(runContext.result
                              ? { result: boundedAssistantResult(runContext.result) }
                              : {}),
                          ...(runContext.evidenceSql
                              ? { evidenceSql: runContext.evidenceSql }
                              : {}),
                          ...(runContext.error ? { error: runContext.error } : {}),
                      }
                    : undefined;
                if (storedRunContext && JSON.stringify(storedRunContext).length > 60_000)
                    throw new Error(
                        'The selected run context is too large to keep in this chat. Start a new chat or select a smaller run.',
                    );
                return storedRunContext;
            };
            const storedRunContext = await prepareRunContext();
            controller.signal.throwIfAborted();
            if (storedRunContext)
                updateChat(chatId, chat => ({
                    ...chat,
                    turns: chat.turns.map(current =>
                        current.id === turnId
                            ? { ...current, runContext: storedRunContext }
                            : current,
                    ),
                }));
            request.phase = 'generating';
            setActivities(current => ({
                ...current,
                [chatId]: { turnId, phase: 'generating' },
            }));
            const response = await post(
                '/assistant/sql',
                {
                    connectionId,
                    question,
                    conversation: history,
                    sql: turn.contextSql,
                    schema: {
                        ...currentSchema,
                        columns: currentSchema.columns.map(
                            ({ database: columnDatabase, table, name, type }) => ({
                                database: columnDatabase,
                                table,
                                name,
                                type,
                            }),
                        ),
                    },
                    serverVersion,
                    database,
                    action: repair ? 'repair' : 'ask',
                    repair,
                    runId: turn.runId,
                    includeRun: requestIncludesRun,
                    result: storedRunContext?.result,
                    evidenceSql: storedRunContext?.evidenceSql,
                    error: storedRunContext?.error,
                },
                apiResponses.isUnknown,
                { signal: controller.signal },
            );
            controller.signal.throwIfAborted();
            if (requestsRef.current.get(chatId) !== request) return;
            const proposal = parseAssistantProposal(response);
            if (!proposal) throw new Error('The assistant returned incomplete data. Try again.');
            updateChat(chatId, chat => ({
                ...chat,
                updatedAt: new Date().toISOString(),
                turns: chat.turns.map(current =>
                    current.id === turnId ? { ...current, status: 'complete', proposal } : current,
                ),
            }));
        } catch (caught) {
            if (requestsRef.current.get(chatId) === request) {
                const error = message(caught);
                updateChat(chatId, chat => ({
                    ...chat,
                    updatedAt: new Date().toISOString(),
                    turns: chat.turns.map(current =>
                        current.id === turnId ? { ...current, status: 'failed', error } : current,
                    ),
                }));
            }
        } finally {
            finishAssistantRequest(chatId, request);
        }
    };
    return requestAssistantSql;
}

export function useDefaultAssistantRunContext(
    runId: string | undefined,
    includeRun: boolean,
    assistantBusy: boolean,
    setIncludeRun: (include: boolean) => void,
) {
    const defaultedRunIdRef = useRef<string | undefined>(undefined);
    useEffect(() => {
        if (!runId) {
            defaultedRunIdRef.current = undefined;
            if (includeRun) setIncludeRun(false);
            return;
        }
        if (assistantBusy || defaultedRunIdRef.current === runId) return;
        defaultedRunIdRef.current = runId;
        setIncludeRun(true);
    }, [assistantBusy, includeRun, runId, setIncludeRun]);
}

export function useWorkspaceAssistant({
    active,
    activeRunId,
    connectionId,
    trusted,
    workspaceRef,
    setWorkspace,
}: {
    active: Draft;
    activeRunId?: string;
    connectionId: string;
    trusted: boolean;
    workspaceRef: { current: WorkspaceState };
    setWorkspace: Dispatch<SetStateAction<WorkspaceState>>;
}) {
    const {
        chats: assistantChats,
        activeChat,
        storageError: assistantChatStorageError,
        updateChat,
        selectChat,
        renameChat,
        createChat,
        deleteChat,
    } = useAssistantChats(connectionId);
    const [questionDrafts, setQuestionDrafts] = useState<Record<string, string>>({});
    const [activities, setActivities] = useState<Record<string, AssistantActivity>>({});
    const [assistantErrors, setAssistantErrors] = useState<Record<string, string>>({});
    const [includeRun, setIncludeRunState] = useState(false);
    const requestsRef = useRef(new Map<string, ActiveAssistantRequest>());
    const assistantQuestion = questionDrafts[activeChat.id] ?? '';
    const activity = activities[activeChat.id];
    const assistantBusy = Boolean(activity);
    const assistantPhase = activity?.phase;
    const assistantCancelable = assistantBusy && assistantPhase !== 'deciding';
    const assistantError = assistantErrors[activeChat.id] ?? '';
    const setAssistantError = (error: string, chatId = activeChat.id) =>
        setAssistantErrors(current => ({ ...current, [chatId]: error }));

    const beginAssistantRequest = (chatId: string, turnId: string, phase: AssistantPhase) => {
        const request = { turnId, phase, controller: new AbortController() };
        requestsRef.current.set(chatId, request);
        setActivities(current => ({ ...current, [chatId]: { turnId, phase } }));
        return request;
    };

    const finishAssistantRequest = (chatId: string, request: ActiveAssistantRequest) => {
        if (requestsRef.current.get(chatId) !== request) return;
        requestsRef.current.delete(chatId);
        setActivities(current => {
            const next = { ...current };
            delete next[chatId];
            return next;
        });
    };

    const cancelAssistantRequest = (chatId: string) => {
        const request = requestsRef.current.get(chatId);
        if (!request) return false;
        finishAssistantRequest(chatId, request);
        request.controller.abort();
        updateChat(chatId, chat => ({
            ...chat,
            updatedAt: new Date().toISOString(),
            turns: chat.turns.map(turn =>
                turn.id === request.turnId && turn.status === 'pending'
                    ? {
                          ...turn,
                          status: 'cancelled',
                          error: 'Request cancelled.',
                      }
                    : turn,
            ),
        }));
        return true;
    };
    useEffect(() => {
        const requests = requestsRef.current;
        return () => {
            for (const request of requests.values()) request.controller.abort();
            requests.clear();
        };
    }, []);

    const changeAssistantQuestion = (question: string) => {
        setQuestionDrafts(current => ({ ...current, [activeChat.id]: question }));
        setAssistantError('');
    };

    const setIncludeRun = (include: boolean) => {
        if (include === includeRun) return;
        setIncludeRunState(include);
        setAssistantError('');
    };

    const newAssistantChat = () => {
        const chatId = createChat(Boolean(assistantQuestion.trim()));
        setAssistantError('', chatId);
        return chatId;
    };

    const selectAssistantChat = (chatId: string) => {
        if (chatId === activeChat.id) return;
        selectChat(chatId);
    };

    const deleteAssistantChat = (chatId: string) => {
        cancelAssistantRequest(chatId);
        deleteChat(chatId);
        if (assistantChats.length === 1 && activeRunId) setIncludeRunState(true);
        setQuestionDrafts(current => {
            const next = { ...current };
            delete next[chatId];
            return next;
        });
        setAssistantErrors(current => {
            const next = { ...current };
            delete next[chatId];
            return next;
        });
    };

    const requestAssistantSql = createAssistantSqlRequestHandler({
        active,
        activeRunId,
        connectionId,
        trusted,
        activeChat,
        includeRun,
        assistantQuestion,
        requestsRef,
        beginAssistantRequest,
        finishAssistantRequest,
        setAssistantError,
        setQuestionDrafts,
        setActivities,
        updateChat,
    });

    const decideAssistantProposal = async (turnId: string, decision: ProposalDecisionAction) => {
        if (requestsRef.current.has(activeChat.id)) return;
        const turn = activeChat.turns.find(
            item => item.id === turnId || item.proposal?.id === turnId,
        );
        const proposal = turn?.proposal;
        if (
            !turn ||
            !proposal ||
            proposal.decision !== 'pending' ||
            proposal.connectionId !== connectionId ||
            (decision === 'accepted' &&
                (proposal.baseSql !== active.sql ||
                    (turn.draftId !== undefined && turn.draftId !== active.id) ||
                    proposal.quality?.status === 'fail' ||
                    proposal.action === 'explain' ||
                    proposal.action === 'review'))
        )
            return;
        const chatId = activeChat.id;
        const draftId = active.id;
        const chatTurnId = turn.id;
        const request = beginAssistantRequest(chatId, chatTurnId, 'deciding');
        setAssistantError('');
        try {
            const response: unknown =
                isFrontendDemoPreview && proposal.owner === 'vercel-session'
                    ? { ...proposal, decision, decidedAt: new Date().toISOString() }
                    : await post(
                          `/assistant/proposals/${encodeURIComponent(proposal.id)}/decision`,
                          { decision, connectionId, currentSql: active.sql },
                          apiResponses.isUnknown,
                          { signal: request.controller.signal },
                      );
            request.controller.signal.throwIfAborted();
            if (requestsRef.current.get(chatId) !== request) return;
            const reviewed = parseAssistantProposal(response);
            if (!reviewed) throw new Error('The assistant returned incomplete data. Try again.');
            const currentDraft = workspaceRef.current.tabs.find(draft => draft.id === draftId);
            const reviewedSql = reviewed.sql;
            let applied = false;
            if (
                decision === 'accepted' &&
                reviewedSql !== null &&
                currentDraft?.sql === proposal.baseSql
            ) {
                flushSync(() => {
                    setWorkspace(current => {
                        const target = current.tabs.find(draft => draft.id === draftId);
                        applied = target?.sql === proposal.baseSql;
                        if (!applied) return current;
                        return {
                            ...current,
                            tabs: current.tabs.map(draft =>
                                draft.id === draftId
                                    ? {
                                          ...checkpoint(draft, 'Before accepted AI proposal'),
                                          sql: reviewedSql,
                                          from: 0,
                                          to: 0,
                                      }
                                    : draft,
                            ),
                        };
                    });
                });
            }
            updateChat(chatId, chat => ({
                ...chat,
                updatedAt: new Date().toISOString(),
                turns: chat.turns.map(current =>
                    current.id === chatTurnId
                        ? {
                              ...current,
                              proposal: reviewed,
                              ...(decision === 'accepted' ? { applied } : {}),
                          }
                        : current,
                ),
            }));
        } catch (caught) {
            if (requestsRef.current.get(chatId) === request)
                setAssistantError(message(caught), chatId);
        } finally {
            finishAssistantRequest(chatId, request);
        }
    };

    return {
        assistantQuestion,
        changeAssistantQuestion,
        assistantTurns: activeChat.turns,
        editorProposal: pendingEditorProposal(
            activeChat.turns,
            active.id,
            connectionId,
            active.sql,
        ),
        assistantChats,
        activeAssistantChatId: activeChat.id,
        assistantChatStorageError,
        newAssistantChat,
        selectAssistantChat,
        renameAssistantChat: renameChat,
        deleteAssistantChat,
        assistantBusy,
        assistantCancelable,
        assistantPhase,
        assistantError,
        assistantNotice: '',
        includeRun,
        setIncludeRun,
        requestAssistantSql,
        cancelAssistantRequest: () => {
            if (requestsRef.current.get(activeChat.id)?.phase === 'deciding') return false;
            return cancelAssistantRequest(activeChat.id);
        },
        decideAssistantProposal,
    };
}
