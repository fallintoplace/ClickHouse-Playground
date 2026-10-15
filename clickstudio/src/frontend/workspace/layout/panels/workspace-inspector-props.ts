import type { Run } from '../../../../shared/queries/execution/types';
import type { Result } from '../../../../shared/queries/results/types';
import type { Schema, SchemaTable } from '../../../../shared/database/schema/types';
import { sqlReferencesQualifiedTable } from '../../../../shared/database/tables/delete-table';
import { sqlReferencesQualifiedDatabase } from '../../../../shared/database/databases/delete-database';
import { metadataConnectionKey } from '../../../database/schema/metadata-state';
import { api, apiResponses } from '../../../api/client';
import { PLAYGROUND_CONNECTION_ID } from '../../../database/connections/playground-client';
import type { Draft, WorkspaceState } from '../../../queries/editor/drafts/workspace-state';
import { terminal } from '../../../queries/execution/status';
import type { useWorkspaceController, WorkspaceProps } from '../../useWorkspaceController';
import type { InspectorPaneProps } from './InspectorPane';
import type {
    AssistantImageAttachment,
    AssistantTextFileAttachment,
} from '../../../assistant/proposals/assistant-attachments';

async function loadAssistantRunContext(
    run: Run | undefined,
    snapshot: Result | undefined,
    signal: AbortSignal,
) {
    if (!run || !terminal(run))
        throw new Error('Wait for the latest run to finish before including it.');
    let result;

    if (run.resultState === 'reopenable') {
        if (snapshot?.runId === run.id) {
            result = snapshot;
        } else {
            result = await api(
                `/runs/${encodeURIComponent(run.id)}/snapshot`,
                apiResponses.isResultResponse,
                { signal },
            );
        }
    } else {
        result = undefined;
    }
    signal.throwIfAborted();
    return { result, evidenceSql: run.sql, error: run.error?.message };
}

function workspaceAfterTableDeleted(
    state: WorkspaceState,
    table: Pick<SchemaTable, 'database' | 'name'>,
): WorkspaceState {
    return {
        ...state,
        tabs: state.tabs.map(draft =>
            draft.activeRunId && sqlReferencesQualifiedTable(draft.sql, table.database, table.name)
                ? {
                      ...draft,
                      invalidatedSource: {
                          database: table.database,
                          table: table.name,
                          runId: draft.activeRunId,
                      },
                  }
                : draft,
        ),
    };
}

export function createInspectorProps({
    copy,
    connection,
    active,
    experience,
    model,
    onDatabaseDeleted,
    currentConnection,
}: {
    copy: WorkspaceProps['copy'];
    connection: WorkspaceProps['connection'];
    active: Draft;
    experience: WorkspaceProps['experience'];
    model: ReturnType<typeof useWorkspaceController>;
    onDatabaseDeleted: (database: string) => void;
    currentConnection: { current: WorkspaceProps['connection'] };
}) {
    const {
        serverVersion: playgroundServerVersion,
        schema,
        schemaLoading,
        schemaLoadingMore,
        schemaError,
        documents,
        revisionsDocumentId,
        documentRevisions,
        revisionLoading,
        revisionError,
        documentsReadError,
        documentsError,
        loadSchema,
        loadMoreSchema,
        loadDocuments,
        loadDocumentRevisions,
    } = model.data;
    const { run, profile, snapshot } = model.evidence;
    const {
        assistantQuestion,
        changeAssistantQuestion,
        assistantChats,
        activeAssistantChatId,
        assistantTurns,
        assistantChatStorageError,
        newAssistantChat,
        setIncludeRun,
        selectAssistantChat,
        renameAssistantChat,
        deleteAssistantChat,
        assistantBusy,
        assistantCancelable,
        assistantPhase,
        assistantError,
        assistantNotice,
        requestAssistantSql,
        includeRun,
        cancelAssistantRequest,
    } = model.assistant;

    const {
        inspector,
        showInspector,
        search,
        setSearch,
        savedDocument,
        saveStatus,
        importedReveal,
        editor,
        openSqlDraft,
        setWorkspace,
        openDocument,
        perform,
        loadProfile,
        trusted,
        restoreDocumentRevision,
        selectableRunId,
        nativeParserStatus,
        nativeParseSnapshot,
    } = model;

    return {
        copy: copy.common,
        inspector,
        setInspector: showInspector,
        connection,
        functionCatalog: model.data.functions,
        pythonFunctionCatalog: model.data.pythonFunctions,
        tablePermissionCatalog: model.data.tablePermissions,
        serverVersion:
            connection.id === PLAYGROUND_CONNECTION_ID
                ? playgroundServerVersion
                : connection.manifest?.serverVersion,
        schema,
        schemaLoading,
        schemaLoadingMore,
        schemaError,
        search,
        setSearch,
        importFeedback: model.importedReveal.importFeedback,
        documentsError,
        evidenceFeedback: model.evidence.assetReadFeedback,
        documents,
        hasSavedQuery: Boolean(active.serverId),
        canSaveQuery: Boolean(!model.busy && !model.assistant.editorProposal && active.name.trim()),
        savingQuery: Boolean(model.savingDraftIds[active.id]),
        revisions: revisionsDocumentId === active.serverId ? documentRevisions : [],
        revisionsDocumentId,
        revisionLoading,
        revisionError,
        currentRevision:
            revisionsDocumentId === active.serverId
                ? (documentRevisions[0]?.revision ?? savedDocument?.revision ?? active.baseRevision)
                : (savedDocument?.revision ?? active.baseRevision),
        unsavedDraft: saveStatus.state !== 'saved' && saveStatus.state !== 'checking',
        canRestoreRevision: Boolean(
            active.serverId &&
            revisionsDocumentId === active.serverId &&
            documentRevisions.length > 1 &&
            !revisionLoading &&
            !documentsReadError &&
            savedDocument &&
            !savedDocument.deletedAt,
        ),
        run,
        functionTest: {
            busy: Boolean(model.busy || (run && !terminal(run))),
        },
        profile,
        onRefreshSchema: () => void loadSchema(true),
        onLoadMoreSchema: () => void loadMoreSchema(),
        importedTableTarget: importedReveal.importedTableTarget,
        onImportedTableRevealed: importedReveal.onImportedTableRevealed,
        onInsert: (value: string) => editor.current?.insert(value),
        onOpenSqlDraft: openSqlDraft,
        onTableDeleted: table =>
            setWorkspace(current => workspaceAfterTableDeleted(current, table)),
        onDatabaseDeleted: database => {
            onDatabaseDeleted(database);
            if (
                metadataConnectionKey(currentConnection.current) !==
                metadataConnectionKey(connection)
            )
                return;
            setWorkspace(current => ({
                ...current,
                tabs: current.tabs.map(draft =>
                    draft.activeRunId && sqlReferencesQualifiedDatabase(draft.sql, database)
                        ? {
                              ...draft,
                              invalidatedSource: { database, table: '*', runId: draft.activeRunId },
                          }
                        : draft,
                ),
            }));
        },
        onOpenDocument: openDocument,
        onLoadProfile: () => void perform(loadProfile, 'save'),
        connectionId: connection.id,
        sql: active.sql,
        draftId: active.id,
        trusted,
        onRefreshDocuments: () => void loadDocuments().catch(() => undefined),
        onRefreshRevisions: () => void loadDocumentRevisions(active.serverId),
        onSaveQuery: () => void model.saveDraft(),
        onRestoreRevision: restoreDocumentRevision,
        assistantQuestion,
        onAssistantQuestion: changeAssistantQuestion,
        assistantChats,
        activeAssistantChatId,
        assistantTurns,
        assistantChatStorageError,
        onNewAssistantChat: () => {
            newAssistantChat();
            if (selectableRunId) setIncludeRun(true);
        },
        onSelectAssistantChat: selectAssistantChat,
        onRenameAssistantChat: renameAssistantChat,
        onDeleteAssistantChat: deleteAssistantChat,
        assistantBusy,
        assistantCancelable,
        assistantPhase,
        assistantError,
        assistantNotice,
        nativeParserStatus,
        nativeParseSnapshot,
        onRetryParser: () => editor.current?.retryNativeParser(),
        onAskAI: (
            currentSchema?: Schema,
            serverVersion?: string,
            database?: string,
            images?: readonly AssistantImageAttachment[],
            files?: readonly AssistantTextFileAttachment[],
            question?: string,
        ) =>
            void requestAssistantSql(
                currentSchema,
                serverVersion,
                database,
                includeRun ? signal => loadAssistantRunContext(run, snapshot, signal) : undefined,
                images?.length || files?.length || question
                    ? {
                          ...(images?.length ? { images } : {}),
                          ...(files?.length ? { files } : {}),
                          ...(question ? { question } : {}),
                      }
                    : undefined,
            ),
        onCancelAssistantRequest: cancelAssistantRequest,
        expert: experience === 'expert',
    } satisfies InspectorPaneProps;
}
