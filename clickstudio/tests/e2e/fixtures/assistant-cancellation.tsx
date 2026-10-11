import type {} from '../assistant-cancellation-harness.js';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useWorkspaceAssistant } from '../../../src/frontend/assistant/proposals/useWorkspaceAssistant.js';
import {
    newDraft,
    type WorkspaceState,
} from '../../../src/frontend/queries/editor/drafts/workspace-state.js';
import type { Schema } from '../../../src/shared/database/schema/types.js';
import { assistantSqlReview } from '../../../src/frontend/assistant/chat/assistant-chat-state.js';

const active = newDraft('Cancellation regression', 'SELECT 1');
const workspaceRef = {
    current: { version: 1, activeId: active.id, tabs: [active] } as WorkspaceState,
};
const schema: Schema = {
    connectionId: 'assistant-cancellation-test',
    fetchedAt: '2026-10-10T00:00:00.000Z',
    databases: [],
    tables: [],
    columns: [],
    warnings: [],
    truncated: false,
};
let assistant: ReturnType<typeof useWorkspaceAssistant>;
let setHarnessWorkspace: (state: WorkspaceState) => void;
let activeRunId = 'selected-run';

function Harness() {
    const [workspace, setWorkspace] = useState(workspaceRef.current);
    workspaceRef.current = workspace;
    setHarnessWorkspace = setWorkspace;
    assistant = useWorkspaceAssistant({
        active: workspace.tabs.find(draft => draft.id === workspace.activeId)!,
        activeRunId,
        connectionId: schema.connectionId,
        trusted: true,
        workspaceRef,
        setWorkspace,
    });
    return null;
}

const root = createRoot(document.getElementById('assistant-harness')!);
function renderHarness() {
    root.render(
        <StrictMode>
            <Harness />
        </StrictMode>,
    );
}

flushSync(renderHarness);

function snapshot() {
    return {
        busy: assistant.assistantBusy,
        phase: assistant.assistantPhase,
        statuses: assistant.assistantTurns.map(turn => turn.status),
    };
}

async function cancelRequest(mode: 'ask' | 'repair' | 'run') {
    flushSync(() => {
        assistant.setIncludeRun(mode === 'run');
        assistant.changeAssistantQuestion('Explain this query');
    });
    let releaseContext: (() => void) | undefined;
    const context = new Promise<{ evidenceSql: string }>(resolve => {
        releaseContext = () => resolve({ evidenceSql: 'SELECT 1' });
    });
    let request: Promise<void>;
    flushSync(() => {
        request = assistant.requestAssistantSql(
            schema,
            undefined,
            undefined,
            () => context,
            mode === 'repair' ? { repair: { sql: 'SELECT broken()', error: 'Failed' } } : undefined,
        );
        if (mode !== 'run') assistant.cancelAssistantRequest();
    });
    if (mode === 'run') {
        releaseContext?.();
        await Promise.resolve();
        flushSync(() => assistant.cancelAssistantRequest());
    }
    await request!;
    flushSync(renderHarness);
    return snapshot();
}

async function continueWhilePreparing(mode: 'run' | 'schema' | 'repair') {
    flushSync(() => {
        assistant.setIncludeRun(mode === 'run');
        assistant.changeAssistantQuestion('Explain original SQL');
    });
    let release: (() => void) | undefined;
    const preparation = new Promise<void>(resolve => {
        release = resolve;
    });
    let request: Promise<void>;
    flushSync(() => {
        request = assistant.requestAssistantSql(
            mode === 'run' ? schema : undefined,
            undefined,
            undefined,
            async () => {
                await preparation;
                return { evidenceSql: 'SELECT original_run' };
            },
            {
                loadSchema: async () => {
                    await preparation;
                    return schema;
                },
                ...(mode === 'repair'
                    ? { repair: { sql: 'SELECT broken()', error: 'Original error' } }
                    : {}),
            },
        );
        void assistant.requestAssistantSql(schema);
    });
    const originalChatId = assistant.activeAssistantChatId;
    const otherDraft = newDraft('Another draft', 'SELECT 2');
    activeRunId = 'new-run';
    flushSync(() => {
        setHarnessWorkspace({
            ...workspaceRef.current,
            activeId: otherDraft.id,
            tabs: [{ ...active, sql: 'SELECT edited', parameters: { p: '2' } }, otherDraft],
        });
        assistant.setIncludeRun(false);
        assistant.newAssistantChat();
    });
    release?.();
    await request!;
    flushSync(renderHarness);
    const otherChatBusy = assistant.assistantBusy;
    const originalTurns = assistant.assistantChats.find(chat => chat.id === originalChatId)!.turns;
    flushSync(() => assistant.selectAssistantChat(originalChatId));
    return { ...snapshot(), otherChatBusy, originalTurns, sql: workspaceRef.current.tabs[1]!.sql };
}

async function acceptAfterChange(change: 'edit' | 'close' | 'unmount') {
    flushSync(() => assistant.changeAssistantQuestion('Update original SQL'));
    await assistant.requestAssistantSql(schema);
    flushSync(renderHarness);
    const originalChatId = assistant.activeAssistantChatId;
    const turn = assistant.assistantTurns[0]!;
    let decision: Promise<void>;
    flushSync(() => {
        decision = assistant.decideAssistantProposal(turn.id, 'accepted');
    });
    const otherDraft = newDraft('Another draft', 'SELECT 2');
    if (change === 'unmount') {
        flushSync(() => root.unmount());
    } else {
        flushSync(() => {
            setHarnessWorkspace({
                ...workspaceRef.current,
                activeId: otherDraft.id,
                tabs:
                    change === 'edit'
                        ? [{ ...active, sql: 'SELECT edited' }, otherDraft]
                        : [otherDraft],
            });
            assistant.newAssistantChat();
        });
    }
    await decision!;
    if (change !== 'unmount') flushSync(renderHarness);
    const completed = assistant.assistantChats.find(chat => chat.id === originalChatId)!.turns[0]!;
    return {
        sql: workspaceRef.current.tabs.map(draft => draft.sql),
        applied: completed.applied,
        review: assistantSqlReview(
            { ...completed, proposal: completed.proposal! },
            {
                sql: workspaceRef.current.tabs[0]!.sql,
                draftId: workspaceRef.current.tabs[0]!.id,
                connectionId: schema.connectionId,
                latestTurnId: turn.id,
            },
        ).status,
    };
}

async function acceptConcurrently() {
    flushSync(() => assistant.changeAssistantQuestion('First acceptance'));
    await assistant.requestAssistantSql(schema);
    flushSync(renderHarness);
    const firstChatId = assistant.activeAssistantChatId;
    const firstTurnId = assistant.assistantTurns[0]!.id;
    flushSync(() => assistant.newAssistantChat());
    flushSync(() => assistant.changeAssistantQuestion('Second acceptance'));
    await assistant.requestAssistantSql(schema);
    flushSync(renderHarness);
    const secondTurnId = assistant.assistantTurns[0]!.id;
    const secondDecision = assistant.decideAssistantProposal(secondTurnId, 'accepted');
    flushSync(() => assistant.selectAssistantChat(firstChatId));
    const firstDecision = assistant.decideAssistantProposal(firstTurnId, 'accepted');
    await Promise.all([firstDecision, secondDecision]);
    flushSync(renderHarness);
    return {
        sql: workspaceRef.current.tabs[0]!.sql,
        turns: assistant.assistantChats.map(chat => ({
            applied: chat.turns[0]!.applied,
            sql: chat.turns[0]!.proposal!.sql,
            decision: chat.turns[0]!.proposal!.decision,
        })),
    };
}

window.assistantCancellationHarness = {
    cancelRequest,
    continueWhilePreparing,
    acceptAfterChange,
    acceptConcurrently,
};
