import type { OpenSqlDraft } from '../../../queries/execution/sql-draft-observer';
import type { FunctionTestEvidence } from '../../../database/functions/SqlFunctionDetails';
import type { SqlFunctionCatalogState } from '../../../database/functions/useSqlFunctionCatalog';
import type { PythonFunctionCatalogState } from '../../../database/functions/usePythonFunctionCatalog';
import type { TablePermissionCatalogState } from '../../../database/tables/useTablePermissionCatalog';
import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { QueryProfile } from '../../../../shared/queries/inspection/types';
import type { QueryDocument } from '../../../../shared/queries/saved-queries/types';
import type { Run } from '../../../../shared/queries/execution/types';
import type { Schema, SchemaTable } from '../../../../shared/database/schema/types';
import type {
    AssistantChat,
    AssistantChatTurn,
} from '../../../assistant/chat/assistant-chat-state';
import { AssistantWorkflow } from '../../../assistant/proposals/AssistantWorkflow';
import type {
    AssistantImageAttachment,
    AssistantTextFileAttachment,
} from '../../../assistant/proposals/assistant-attachments';
import { Button, cx, Spinner } from '../../../ui/components/primitives';
import { formatBytes } from '../../../browser/metric-formatters';
import { Icon } from '../../../ui/components/icons';
import { inspectorLabel } from './inspector-labels';
import { Status } from '../../../queries/execution/status';
import type { Connected, ImportedTableTarget, Inspector } from '../../workspace-types';
import type { NativeParseSnapshot, NativeParserStatus } from '../../../../shared/sql/parser';
import { NativeParserInspector } from '../../../queries/editor/parser/NativeParserInspector';
import { ObjectExplorer } from '../../../database/explorer/objects/ObjectExplorer';
import { ReferenceExplorer } from '../../../help/reference/ReferenceExplorer';
import { WorkspaceInlineNotice } from '../notifications/WorkspaceInlineNotice';
import type { WorkspaceFeedback } from '../notifications/useWorkspaceNotifications';
import type { Copy } from '../../../ui/copy';
import {
    inspectorMoreNavigation,
    primaryInspectorNavigation,
    type PrimaryInspectorDestination,
    type SecondaryInspectorDestination,
} from './inspector-navigation';

export type InspectorPaneProps = {
    copy: Copy['common'];
    inspector: Inspector;
    setInspector: (inspector: Inspector) => void;
    connection: Connected;
    functionCatalog: SqlFunctionCatalogState;
    pythonFunctionCatalog: PythonFunctionCatalogState;
    tablePermissionCatalog: TablePermissionCatalogState;
    serverVersion?: string;
    schema?: Schema;
    schemaLoading: boolean;
    schemaLoadingMore?: boolean;
    schemaError: string;
    importFeedback?: WorkspaceFeedback;
    documentsError?: string;
    evidenceFeedback?: WorkspaceFeedback;
    search: string;
    setSearch: (search: string) => void;
    documents: QueryDocument[];
    hasSavedQuery: boolean;
    canSaveQuery: boolean;
    savingQuery: boolean;
    revisions: QueryDocument[];
    revisionsDocumentId?: string;
    revisionLoading: boolean;
    revisionError: string;
    currentRevision?: number;
    unsavedDraft: boolean;
    canRestoreRevision: boolean;
    run?: Run;
    functionTest?: FunctionTestEvidence;
    profile?: QueryProfile;
    onRefreshSchema: () => void;
    onLoadMoreSchema?: () => void;
    importedTableTarget?: ImportedTableTarget;
    onImportedTableRevealed: (target: ImportedTableTarget) => void;
    onInsert: (value: string) => void;
    onOpenSqlDraft: OpenSqlDraft;
    onTableDeleted: (table: Pick<SchemaTable, 'database' | 'name'>) => void;
    onDatabaseDeleted: (database: string) => void;
    onOpenDocument: (document: QueryDocument) => void;
    onLoadProfile: () => void;
    connectionId: string;
    sql: string;
    draftId: string;
    trusted: boolean;
    onRefreshDocuments: () => void;
    onRefreshRevisions: () => void;
    onSaveQuery: () => void;
    onRestoreRevision: (revision: QueryDocument) => void;
    assistantQuestion: string;
    onAssistantQuestion: (question: string) => void;
    assistantChats: readonly AssistantChat[];
    activeAssistantChatId: string;
    assistantTurns: readonly AssistantChatTurn[];
    assistantChatStorageError: string;
    onNewAssistantChat: () => void;
    onSelectAssistantChat: (chatId: string) => void;
    onRenameAssistantChat: (chatId: string, title: string) => void;
    onDeleteAssistantChat: (chatId: string) => void;
    assistantBusy: boolean;
    assistantCancelable: boolean;
    assistantPhase?: 'preparing' | 'generating' | 'deciding';
    assistantError: string;
    assistantNotice: string;
    nativeParserStatus: NativeParserStatus;
    nativeParseSnapshot?: NativeParseSnapshot;
    onRetryParser: () => void;
    onAskAI: (
        schema?: Schema,
        serverVersion?: string,
        database?: string,
        images?: readonly AssistantImageAttachment[],
        files?: readonly AssistantTextFileAttachment[],
        question?: string,
        sampleExample?: boolean,
    ) => void;
    onCancelAssistantRequest: () => void;
    expert?: boolean;
    docked?: boolean;
    onClose?: () => void;
};

function readFailureFeedback(message: string, detail?: string): WorkspaceFeedback | undefined {
    return detail ? { tone: 'error', message, detail } : undefined;
}

function panelTitle(inspector: Inspector, copy: Copy['common']): string {
    switch (inspector) {
        case 'schema':
            return copy.objects;
        case 'reference':
            return copy.reference;
        case 'documents':
            return copy.queries;
        case 'assistant':
            return copy.assistant;
        default:
            return inspectorLabel(inspector);
    }
}

function PrimaryInspectorTab({
    item,
    copy,
    selected,
    onSelect,
}: {
    item: PrimaryInspectorDestination;
    copy: Copy['common'];
    selected: boolean;
    onSelect: (inspector: Inspector) => void;
}) {
    return (
        <button
            type="button"
            className={item.id === 'assistant' ? 'is-assistant-tab' : undefined}
            aria-label={copy[item.copyKey]}
            aria-pressed={selected}
            onClick={() => onSelect(item.id)}
        >
            <Icon name={item.icon} />
            <span>{copy[item.copyKey]}</span>
        </button>
    );
}

function InspectorCloseButton({ onClose }: { onClose?: () => void }) {
    return (
        <Button
            variant="ghost"
            className="icon-only"
            aria-label="Close inspector"
            onClick={onClose}
        >
            <Icon name="close" />
        </Button>
    );
}

function InspectorPaneHeading({
    title,
    copy,
    inspector,
    expert,
    docked,
    hideHeading,
    primaryNavigation,
    onSelect,
    onClose,
}: {
    title: string;
    copy: Copy['common'];
    inspector: Inspector;
    expert: boolean;
    docked: boolean;
    hideHeading: boolean;
    primaryNavigation: readonly PrimaryInspectorDestination[];
    onSelect: (inspector: Inspector) => void;
    onClose?: () => void;
}) {
    if (hideHeading) return null;

    return (
        <header className="inspector-header">
            {docked && !expert ? (
                <nav className="inspector-header-switch" aria-label={copy.workspaceBrowser}>
                    {primaryNavigation.map(item => (
                        <PrimaryInspectorTab
                            key={item.id}
                            item={item}
                            copy={copy}
                            selected={inspector === item.id}
                            onSelect={onSelect}
                        />
                    ))}
                </nav>
            ) : (
                <h2>{title}</h2>
            )}
            {docked && <InspectorCloseButton onClose={onClose} />}
        </header>
    );
}

export function InspectorPane({
    copy,
    inspector,
    setInspector,
    connection,
    functionCatalog,
    pythonFunctionCatalog,
    tablePermissionCatalog,
    serverVersion,
    schema,
    schemaLoading,
    schemaLoadingMore,
    schemaError,
    importFeedback,
    documentsError,
    evidenceFeedback,
    search,
    setSearch,
    documents,
    hasSavedQuery,
    canSaveQuery,
    savingQuery,
    revisions,
    revisionsDocumentId,
    revisionLoading,
    revisionError,
    currentRevision,
    unsavedDraft,
    canRestoreRevision,
    run,
    functionTest,
    profile,
    onRefreshSchema,
    onLoadMoreSchema,
    importedTableTarget,
    onImportedTableRevealed,
    onInsert,
    onOpenSqlDraft,
    onTableDeleted,
    onDatabaseDeleted,
    onOpenDocument,
    onLoadProfile,
    connectionId,
    sql,
    draftId,
    trusted,
    onRefreshDocuments,
    onRefreshRevisions,
    onSaveQuery,
    onRestoreRevision,
    assistantQuestion,
    onAssistantQuestion,
    assistantChats,
    activeAssistantChatId,
    assistantTurns,
    assistantChatStorageError,
    onNewAssistantChat,
    onSelectAssistantChat,
    onRenameAssistantChat,
    onDeleteAssistantChat,
    assistantBusy,
    assistantCancelable,
    assistantPhase,
    assistantError,
    assistantNotice,
    nativeParserStatus,
    nativeParseSnapshot,
    onRetryParser,
    onAskAI,
    onCancelAssistantRequest,
    expert = false,
    docked = false,
    onClose,
}: InspectorPaneProps) {
    const visibleDocuments = documents.filter(
        document => document.connectionId === connectionId && !document.deletedAt,
    );
    const [selectedRevisionNumber, setSelectedRevisionNumber] = useState<number>();
    const [referenceTarget, setReferenceTarget] = useState<{ name: string; type: string }>();
    const firstRevisionNumber = revisions[0]?.revision;
    useEffect(() => {
        setSelectedRevisionNumber(currentRevision ?? firstRevisionNumber);
    }, [revisionsDocumentId, currentRevision, firstRevisionNumber]);
    const selectedRevision =
        revisions.find(revision => revision.revision === selectedRevisionNumber) ?? revisions[0];
    const title = panelTitle(inspector, copy);
    let assistantServerVersion: string | undefined;

    if (connection.dataSource === 'fixture') {
        assistantServerVersion = undefined;
    } else if (connection.manifest?.serverVersion === 'ClickHouse SQL Playground') {
        assistantServerVersion = serverVersion;
    } else {
        assistantServerVersion = serverVersion ?? connection.manifest?.serverVersion;
    }

    useEffect(() => {
        setReferenceTarget(undefined);
    }, [connection.id]);
    const openReference = (name: string, type: string) => {
        setReferenceTarget({ name, type });
        setInspector('reference');
    };
    const clearReferenceTarget = useCallback(() => setReferenceTarget(undefined), []);
    const isExpert = Boolean(expert);
    const primaryNavigation = primaryInspectorNavigation(isExpert);
    const hasPrimaryInspectorTab = primaryNavigation.some(item => item.id === inspector);
    const moreItems = inspectorMoreNavigation(isExpert, Boolean(run));
    const hasMoreInspectorTab = moreItems.some(item => item.id === inspector);
    const hideHeading = isExpert && docked && (hasPrimaryInspectorTab || hasMoreInspectorTab);
    const selectInspector = (next: Inspector) => {
        if (next === 'reference') setReferenceTarget(undefined);
        setInspector(next);
    };

    return (
        <aside className={cx('inspector-pane', docked && 'is-docked-inspector')} aria-label={title}>
            <InspectorPaneHeading
                title={title}
                copy={copy}
                inspector={inspector}
                expert={isExpert}
                docked={docked}
                hideHeading={hideHeading}
                primaryNavigation={primaryNavigation}
                onSelect={selectInspector}
                onClose={onClose}
            />
            {isExpert && docked && (
                <nav className="inspector-tabs is-browser-tabs" aria-label={copy.workspaceBrowser}>
                    {primaryNavigation.map(item => (
                        <PrimaryInspectorTab
                            key={item.id}
                            item={item}
                            copy={copy}
                            selected={inspector === item.id}
                            onSelect={selectInspector}
                        />
                    ))}
                    <InspectorMoreMenu
                        copy={copy}
                        inspector={inspector}
                        onSelect={selectInspector}
                        items={moreItems}
                    />
                    {hideHeading && (
                        <div>
                            <InspectorCloseButton onClose={onClose} />
                        </div>
                    )}
                </nav>
            )}
            <div
                className={cx(
                    'inspector-content',
                    inspector === 'assistant' && 'is-assistant-content',
                )}
            >
                {inspector === 'schema' && (
                    <WorkspaceInlineNotice feedback={importFeedback} onRetry={onRefreshSchema} />
                )}
                {inspector === 'schema' && (
                    <ObjectExplorer
                        key={connection.id}
                        copy={copy}
                        connection={connection}
                        expert={isExpert}
                        functionTest={functionTest}
                        functionCatalog={functionCatalog}
                        pythonFunctionCatalog={pythonFunctionCatalog}
                        tablePermissionCatalog={tablePermissionCatalog}
                        schema={schema}
                        schemaLoading={schemaLoading}
                        schemaLoadingMore={schemaLoadingMore}
                        schemaError={schemaError}
                        search={search}
                        setSearch={setSearch}
                        trusted={trusted}
                        onRefreshSchema={onRefreshSchema}
                        onLoadMoreSchema={onLoadMoreSchema}
                        importedTableTarget={importedTableTarget}
                        onImportedTableRevealed={onImportedTableRevealed}
                        onInsert={onInsert}
                        compact={docked}
                        onOpenSqlDraft={onOpenSqlDraft}
                        onTableDeleted={onTableDeleted}
                        onDatabaseDeleted={onDatabaseDeleted}
                        onOpenReference={openReference}
                    />
                )}
                {inspector === 'reference' && (
                    <ReferenceExplorer
                        copy={copy}
                        connection={connection}
                        trusted={trusted}
                        target={referenceTarget}
                        onTargetHandled={clearReferenceTarget}
                        onInsert={onInsert}
                    />
                )}
                <InspectorSavedViews
                    copy={copy}
                    inspector={inspector}
                    documentsError={documentsError}
                    visibleDocuments={visibleDocuments}
                    onRefreshDocuments={onRefreshDocuments}
                    onOpenDocument={onOpenDocument}
                />
                {inspector === 'revisions' &&
                    renderRevisionHistory({
                        hasSavedQuery,
                        canSaveQuery,
                        savingQuery,
                        revisionsDocumentId,
                        revisions,
                        currentRevision,
                        onRefreshRevisions,
                        onSaveQuery,
                        revisionLoading,
                        revisionError,
                        selectedRevision,
                        setSelectedRevisionNumber,
                        canRestoreRevision,
                        onRestoreRevision,
                        unsavedDraft,
                    })}
                {inspector === 'parser' && (
                    <NativeParserInspector
                        status={nativeParserStatus}
                        snapshot={nativeParseSnapshot}
                        onRetry={onRetryParser}
                    />
                )}
                {inspector === 'details' && <WorkspaceInlineNotice feedback={evidenceFeedback} />}
                {inspector === 'details' && (
                    <RunDetails
                        run={run}
                        profile={profile}
                        onLoad={onLoadProfile}
                        unavailableReason={
                            connection.manifest?.queryLog.available === false
                                ? connection.manifest.queryLog.reason
                                : undefined
                        }
                    />
                )}
                {inspector === 'assistant' && (
                    <AssistantWorkflow
                        mode={expert ? 'expert' : 'beginner'}
                        sql={sql}
                        draftId={draftId}
                        connectionId={connectionId}
                        question={assistantQuestion}
                        onQuestionChange={onAssistantQuestion}
                        chats={assistantChats}
                        activeChatId={activeAssistantChatId}
                        turns={assistantTurns}
                        storageError={assistantChatStorageError}
                        onNewChat={onNewAssistantChat}
                        onSelectChat={onSelectAssistantChat}
                        onRenameChat={onRenameAssistantChat}
                        onDeleteChat={onDeleteAssistantChat}
                        busy={assistantBusy}
                        cancelable={assistantCancelable}
                        phase={assistantPhase}
                        error={assistantError}
                        notice={assistantNotice}
                        trusted={trusted}
                        onAskAI={(images, files, question, sampleExample) =>
                            onAskAI(
                                schema,
                                assistantServerVersion,
                                connection.database,
                                images,
                                files,
                                question,
                                sampleExample,
                            )
                        }
                        onCancelRequest={onCancelAssistantRequest}
                    />
                )}
            </div>
        </aside>
    );
}

function InspectorSavedViews({
    copy,
    inspector,
    documentsError,
    visibleDocuments,
    onRefreshDocuments,
    onOpenDocument,
}: Pick<
    InspectorPaneProps,
    'copy' | 'inspector' | 'documentsError' | 'onRefreshDocuments' | 'onOpenDocument'
> & { visibleDocuments: QueryDocument[] }) {
    return (
        <>
            {inspector === 'documents' && (
                <section className="inspector-section saved-queries-section">
                    <div className="schema-heading">
                        <span>{copy.queries.toUpperCase()}</span>
                        <Button
                            variant="ghost"
                            className="inspector-refresh-action"
                            aria-label="Refresh saved queries"
                            title="Refresh saved queries"
                            onClick={onRefreshDocuments}
                        >
                            <Icon name="refresh" />
                        </Button>
                    </div>
                    <WorkspaceInlineNotice
                        feedback={readFailureFeedback(
                            'Couldn’t load saved queries. Try again.',
                            documentsError,
                        )}
                        onRetry={onRefreshDocuments}
                    />
                    {visibleDocuments.length
                        ? visibleDocuments.map(document => (
                              <button
                                  type="button"
                                  className="document-card"
                                  key={document.id}
                                  title={document.name}
                                  onClick={() => onOpenDocument(document)}
                              >
                                  <span className="document-card-mark" aria-hidden="true">
                                      SQL
                                  </span>
                                  <span>
                                      <strong>{document.name}</strong>
                                      <small>
                                          Version {document.revision} ·{' '}
                                          {new Date(document.updatedAt).toLocaleDateString()}
                                      </small>
                                  </span>
                                  <span className="history-open" aria-hidden="true">
                                      ↗
                                  </span>
                              </button>
                          ))
                        : !documentsError && (
                              <div className="inspector-empty">
                                  <Icon name="documents" />
                                  <strong>Nothing saved yet</strong>
                                  <p>
                                      Save the current query to keep a named revision on this
                                      connection.
                                  </p>
                              </div>
                          )}
                </section>
            )}
        </>
    );
}

function renderRevisionHistory({
    hasSavedQuery,
    canSaveQuery,
    savingQuery,
    revisionsDocumentId,
    revisions,
    currentRevision,
    onRefreshRevisions,
    onSaveQuery,
    revisionLoading,
    revisionError,
    selectedRevision,
    setSelectedRevisionNumber,
    canRestoreRevision,
    onRestoreRevision,
    unsavedDraft,
}: {
    hasSavedQuery: InspectorPaneProps['hasSavedQuery'];
    canSaveQuery: InspectorPaneProps['canSaveQuery'];
    savingQuery: InspectorPaneProps['savingQuery'];
    revisionsDocumentId: InspectorPaneProps['revisionsDocumentId'];
    revisions: InspectorPaneProps['revisions'];
    currentRevision: InspectorPaneProps['currentRevision'];
    onRefreshRevisions: InspectorPaneProps['onRefreshRevisions'];
    onSaveQuery: InspectorPaneProps['onSaveQuery'];
    revisionLoading: InspectorPaneProps['revisionLoading'];
    revisionError: InspectorPaneProps['revisionError'];
    selectedRevision: QueryDocument | undefined;
    setSelectedRevisionNumber: import('react').Dispatch<
        import('react').SetStateAction<number | undefined>
    >;
    canRestoreRevision: InspectorPaneProps['canRestoreRevision'];
    onRestoreRevision: InspectorPaneProps['onRestoreRevision'];
    unsavedDraft: InspectorPaneProps['unsavedDraft'];
}) {
    return (
        <section className="inspector-section revision-history-section">
            <div className="schema-heading">
                <span>
                    {revisionsDocumentId
                        ? (revisions.find(revision => revision.revision === currentRevision)
                              ?.name ?? 'QUERY VERSIONS')
                        : 'QUERY VERSIONS'}
                </span>
                {hasSavedQuery && (
                    <Button
                        variant="ghost"
                        className="inspector-refresh-action"
                        aria-label={revisionLoading ? 'Refreshing versions' : 'Refresh versions'}
                        title={revisionLoading ? 'Refreshing versions' : 'Refresh versions'}
                        aria-busy={revisionLoading}
                        onClick={onRefreshRevisions}
                        disabled={revisionLoading || !revisionsDocumentId}
                    >
                        {revisionLoading ? <Spinner size={14} /> : <Icon name="refresh" />}
                    </Button>
                )}
            </div>
            {!hasSavedQuery && (
                <div className="revision-empty-state">
                    <span className="revision-empty-mark" aria-hidden="true">
                        <Icon name="history" />
                    </span>
                    <strong>Save your first version</strong>
                    <p>Keep a saved copy of this query so you can return to it later.</p>
                    <Button
                        variant="secondary"
                        className="revision-empty-action"
                        onClick={onSaveQuery}
                        disabled={!canSaveQuery || savingQuery}
                        aria-busy={savingQuery}
                    >
                        {savingQuery ? <Spinner size={14} /> : <Icon name="documents" />}
                        {savingQuery ? 'Saving…' : 'Save query'}
                    </Button>
                </div>
            )}
            {hasSavedQuery && (
                <p className="revision-history-help">
                    Browse saved versions. Restoring one creates a new version.
                </p>
            )}
            {hasSavedQuery && revisionError && (
                <div className="callout callout-error" role="alert">
                    {revisionError}
                </div>
            )}
            {hasSavedQuery && revisionLoading && !revisions.length && (
                <div className="inspector-empty">
                    <Spinner />
                    <p>Loading saved versions…</p>
                </div>
            )}
            {hasSavedQuery && !revisionLoading && !revisionError && !revisions.length && (
                <div className="inspector-empty">
                    <Icon name="history" />
                    <strong>No saved versions</strong>
                    <p>Save this query to start a version history.</p>
                </div>
            )}
            {hasSavedQuery && revisions.length > 0 && (
                <>
                    <div className="revision-list" aria-label="Saved query versions">
                        {revisions.map(revision => (
                            <button
                                type="button"
                                key={`${revision.id}-${revision.revision}`}
                                className={cx(
                                    'revision-item',
                                    selectedRevision?.revision === revision.revision &&
                                        'is-selected',
                                )}
                                aria-pressed={selectedRevision?.revision === revision.revision}
                                onClick={() => setSelectedRevisionNumber(revision.revision)}
                            >
                                <span className="revision-item-mark">
                                    <Icon name="history" />
                                </span>
                                <span className="revision-item-copy">
                                    <strong>Version {revision.revision}</strong>
                                    <small>{new Date(revision.updatedAt).toLocaleString()}</small>
                                </span>
                                {revision.revision === currentRevision && (
                                    <span className="revision-item-current">Current</span>
                                )}
                                <span className="history-open" aria-hidden="true">
                                    ›
                                </span>
                            </button>
                        ))}
                    </div>
                    {selectedRevision && (
                        <div className="revision-preview">
                            <div className="revision-preview-heading">
                                <span>VERSION {selectedRevision.revision}</span>
                                {selectedRevision.revision !== currentRevision && (
                                    <Button
                                        variant="secondary"
                                        className="toolbar-small"
                                        title={
                                            canRestoreRevision
                                                ? 'Restore this version as a new latest version'
                                                : 'Restore the saved query before restoring a version'
                                        }
                                        disabled={revisionLoading || !canRestoreRevision}
                                        onClick={() => onRestoreRevision(selectedRevision)}
                                    >
                                        Restore
                                    </Button>
                                )}
                            </div>
                            <pre aria-label={`SQL from version ${selectedRevision.revision}`}>
                                {selectedRevision.sql}
                            </pre>
                            {unsavedDraft && (
                                <small className="revision-unsaved-note">
                                    Your draft stays unchanged until you confirm the restore.
                                </small>
                            )}
                        </div>
                    )}
                </>
            )}
        </section>
    );
}

function InspectorMoreMenu({
    copy,
    inspector,
    onSelect,
    items,
}: {
    copy: Copy['common'];
    inspector: Inspector;
    onSelect: (inspector: Inspector) => void;
    items: readonly SecondaryInspectorDestination[];
}) {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null),
        trigger = useRef<HTMLButtonElement>(null),
        menu = useRef<HTMLDivElement>(null);
    const active = items.some(item => item.id === inspector);

    useEffect(() => {
        if (!open) return;
        const closeOutside = (event: PointerEvent) => {
            if (!root.current || !event.composedPath().includes(root.current)) setOpen(false);
        };
        const closeOnEscape = (event: globalThis.KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            setOpen(false);
            trigger.current?.focus();
        };
        const frame = window.requestAnimationFrame(() =>
            menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus(),
        );
        document.addEventListener('pointerdown', closeOutside);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            window.cancelAnimationFrame(frame);
            document.removeEventListener('pointerdown', closeOutside);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [open]);

    const moveMenuFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const items = Array.from(
            menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
        );
        if (!items.length) return;
        const activeElement = document.activeElement;
        const current =
            activeElement instanceof HTMLButtonElement ? items.indexOf(activeElement) : -1;
        let next: number | undefined;

        switch (event.key) {
            case 'ArrowDown':
                next = (current + 1) % items.length;
                break;
            case 'ArrowUp':
                next = (current - 1 + items.length) % items.length;
                break;
            case 'Home':
                next = 0;
                break;
            case 'End':
                next = items.length - 1;
                break;
            default:
                next = undefined;
                break;
        }
        if (next === undefined) return;
        event.preventDefault();
        items[next]?.focus();
    };

    return (
        <div className="inspector-more" ref={root}>
            <button
                ref={trigger}
                data-testid="workspace-panels"
                type="button"
                className={cx('inspector-more-trigger', active && 'is-active')}
                aria-label={copy.workspacePanels}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen(value => !value)}
            >
                {copy.more} <Icon name="chevron" />
            </button>
            {open && (
                <div
                    className="inspector-more-menu"
                    role="menu"
                    aria-label={copy.workspacePanels}
                    ref={menu}
                    onKeyDown={moveMenuFocus}
                >
                    {items.map(item => (
                        <button
                            key={item.id}
                            data-testid={`workspace-panel-${item.id}`}
                            type="button"
                            role="menuitem"
                            aria-pressed={inspector === item.id}
                            onClick={() => {
                                onSelect(item.id);
                                setOpen(false);
                            }}
                        >
                            <Icon name={item.icon} />
                            <span>
                                {item.copyKey ? copy[item.copyKey] : inspectorLabel(item.id)}
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

function RunDetails({
    run,
    profile,
    onLoad,
    unavailableReason,
}: {
    run?: Run;
    profile?: QueryProfile;
    onLoad: () => void;
    unavailableReason?: string;
}) {
    if (!run) return <div className="inspector-empty">Run a query to see execution details.</div>;
    const summary = profile?.summary;
    const metrics: Array<[string, string, string?]> = [
        ['Duration', Math.round(summary?.durationMs ?? run.elapsedMs).toLocaleString(), 'ms'],
        ['Rows returned', run.rowCount.toLocaleString()],
        ...(summary?.readRows === undefined
            ? []
            : [['Rows read', Number(summary.readRows).toLocaleString()] as [string, string]]),
        ...(summary?.readBytes === undefined
            ? []
            : [['Bytes read', formatBytes(summary.readBytes)] as [string, string]]),
        ...(summary?.memory === undefined
            ? []
            : [['Memory', formatBytes(summary.memory)] as [string, string]]),
    ];
    const items: Array<[string, string]> = [
        ['Query ID', run.queryId],
        ...(run.executedAs ? [['Executed as', run.executedAs] as [string, string]] : []),
        ...(run.serverVersion ? [['Server', run.serverVersion] as [string, string]] : []),
    ];
    const createdAt = new Date(run.createdAt);
    return (
        <section className="inspector-section run-details-section">
            <div className="run-detail-hero">
                <div className="run-detail-heading">
                    <span className="eyebrow">LATEST EXECUTION</span>
                    <time dateTime={run.createdAt}>
                        {createdAt.toLocaleString(undefined, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                        })}
                    </time>
                </div>
                <span className="run-detail-status">
                    <Status run={run} />
                </span>
            </div>
            <div className="run-metric-grid" role="group" aria-label="Execution metrics">
                {metrics.map(([label, value, unit]) => (
                    <div className="run-metric" key={label}>
                        <span>{label}</span>
                        <strong title={unit ? `${value} ${unit}` : value}>
                            <span>{value}</span>
                            {unit && <small>{unit}</small>}
                        </strong>
                    </div>
                ))}
            </div>
            <div className="run-fact-list">
                {items.map(([label, value]) => (
                    <div
                        key={label}
                        className={label === 'Query ID' ? 'is-query-id' : undefined}
                        data-testid={label === 'Query ID' ? 'run-query-id' : undefined}
                    >
                        <span>{label}</span>
                        <div className="run-fact-value">
                            <strong title={value}>{value}</strong>
                            {label === 'Query ID' && (
                                <button
                                    type="button"
                                    aria-label="Copy query ID"
                                    title="Copy query ID"
                                    onClick={() => void navigator.clipboard.writeText(value)}
                                >
                                    <Icon name="copy" />
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
            {run.error && (
                <div className="callout callout-error">
                    {run.error.code}: {run.error.message}
                </div>
            )}
            {unavailableReason ? (
                <div className="run-detail-note" role="note">
                    <Icon name="info" />
                    <span>{unavailableReason}</span>
                </div>
            ) : (
                <Button variant="secondary" className="run-detail-load" onClick={onLoad}>
                    Load query log evidence
                </Button>
            )}
            {profile?.notice && <p className="profile-note">{profile.notice}</p>}
        </section>
    );
}
