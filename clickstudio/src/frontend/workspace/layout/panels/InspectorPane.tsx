import type { OpenSqlDraft } from '../../../queries/execution/sql-draft-observer';
import type { FunctionTestEvidence } from '../../../database/functions/SqlFunctionDetails';
import type { SqlFunctionCatalogState } from '../../../database/functions/useSqlFunctionCatalog';
import type { PythonFunctionCatalogState } from '../../../database/functions/usePythonFunctionCatalog';
import type { TablePermissionCatalogState } from '../../../database/tables/useTablePermissionCatalog';
import { RunComparisonLauncher } from '../../../queries/history/RunComparison';
import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { ProfilePipeline, QueryProfile } from '../../../../shared/queries/inspection/types';
import type { QueryDocument } from '../../../../shared/queries/saved-queries/types';
import type { Run } from '../../../../shared/queries/execution/types';
import type { Schema, SchemaTable } from '../../../../shared/database/schema/types';
import type {
    AssistantChat,
    AssistantChatTurn,
} from '../../../assistant/chat/assistant-chat-state';
import { AssistantWorkflow } from '../../../assistant/proposals/AssistantWorkflow';
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
    historyError?: string;
    documentsError?: string;
    evidenceFeedback?: WorkspaceFeedback;
    search: string;
    setSearch: (search: string) => void;
    history: Run[];
    documents: QueryDocument[];
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
    comparisonProfiles?: Readonly<Record<string, QueryProfile>>;
    comparisonPipelines?: Readonly<Record<string, ProfilePipeline>>;
    pipeline?: ProfilePipeline;
    onRefreshSchema: () => void;
    onLoadMoreSchema?: () => void;
    importedTableTarget?: ImportedTableTarget;
    onImportedTableRevealed: (target: ImportedTableTarget) => void;
    onRefreshHistory: () => void;
    onInsert: (value: string) => void;
    onOpenSqlDraft: OpenSqlDraft;
    onTableDeleted: (table: Pick<SchemaTable, 'database' | 'name'>) => void;
    onDatabaseDeleted: (database: string) => void;
    onOpenRun: (run: Run) => void;
    onOpenDocument: (document: QueryDocument) => void;
    onLoadProfile: () => void;
    onLoadPipeline: () => void;
    onOpenGraph: () => void;
    connectionId: string;
    sql: string;
    draftId: string;
    trusted: boolean;
    onRefreshDocuments: () => void;
    onRefreshRevisions: () => void;
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
    onAskAI: (schema?: Schema, serverVersion?: string, database?: string) => void;
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
        case 'history':
            return copy.history;
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

function InspectorPaneHeading({
    title,
    copy,
    inspector,
    expert,
    docked,
    primaryNavigation,
    onSelect,
    onClose,
}: {
    title: string;
    copy: Copy['common'];
    inspector: Inspector;
    expert: boolean;
    docked: boolean;
    primaryNavigation: readonly PrimaryInspectorDestination[];
    onSelect: (inspector: Inspector) => void;
    onClose?: () => void;
}) {
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
            {docked && (
                <Button
                    variant="ghost"
                    className="icon-only"
                    aria-label="Close inspector"
                    onClick={onClose}
                >
                    <Icon name="close" />
                </Button>
            )}
        </header>
    );
}

export function InspectorPane({
    comparisonProfiles,
    comparisonPipelines,
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
    historyError,
    documentsError,
    evidenceFeedback,
    search,
    setSearch,
    history,
    documents,
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
    pipeline,
    onRefreshSchema,
    onLoadMoreSchema,
    importedTableTarget,
    onImportedTableRevealed,
    onRefreshHistory,
    onInsert,
    onOpenSqlDraft,
    onTableDeleted,
    onDatabaseDeleted,
    onOpenRun,
    onOpenDocument,
    onLoadProfile,
    onLoadPipeline,
    onOpenGraph,
    connectionId,
    sql,
    draftId,
    trusted,
    onRefreshDocuments,
    onRefreshRevisions,
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
    const moreItems = inspectorMoreNavigation(isExpert, Boolean(run));
    const selectPrimaryInspector = (next: Inspector) => {
        if (next === 'reference') setReferenceTarget(undefined);
        setInspector(next);
    };

    return (
        <aside className={cx('inspector-pane', docked && 'is-docked-inspector')}>
            <InspectorPaneHeading
                title={title}
                copy={copy}
                inspector={inspector}
                expert={isExpert}
                docked={docked}
                primaryNavigation={primaryNavigation}
                onSelect={selectPrimaryInspector}
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
                            onSelect={selectPrimaryInspector}
                        />
                    ))}
                    <InspectorMoreMenu
                        copy={copy}
                        inspector={inspector}
                        onSelect={setInspector}
                        items={moreItems}
                    />
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
                    connection={connection}
                    connectionId={connectionId}
                    trusted={trusted}
                    expert={expert}
                    history={history}
                    historyError={historyError}
                    documentsError={documentsError}
                    visibleDocuments={visibleDocuments}
                    run={run}
                    comparisonProfiles={comparisonProfiles}
                    comparisonPipelines={comparisonPipelines}
                    onRefreshHistory={onRefreshHistory}
                    onRefreshDocuments={onRefreshDocuments}
                    onOpenRun={onOpenRun}
                    onOpenDocument={onOpenDocument}
                />
                {inspector === 'revisions' &&
                    renderRevisionHistory({
                        revisionsDocumentId,
                        revisions,
                        currentRevision,
                        onRefreshRevisions,
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
                {['details', 'pipeline'].includes(inspector) && (
                    <WorkspaceInlineNotice feedback={evidenceFeedback} />
                )}
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
                {inspector === 'pipeline' && (
                    <PipelineView
                        run={run}
                        profile={profile}
                        pipeline={pipeline}
                        onLoad={onLoadPipeline}
                        onOpenGraph={onOpenGraph}
                        available={connection.manifest?.pipeline.available !== false}
                        unavailableReason={
                            connection.manifest?.pipeline.available === false
                                ? connection.manifest.pipeline.reason
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
                        onAskAI={() => onAskAI(schema, assistantServerVersion, connection.database)}
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
    connection,
    connectionId,
    trusted,
    expert,
    history,
    historyError,
    documentsError,
    visibleDocuments,
    run,
    comparisonProfiles,
    comparisonPipelines,
    onRefreshHistory,
    onRefreshDocuments,
    onOpenRun,
    onOpenDocument,
}: Pick<
    InspectorPaneProps,
    | 'copy'
    | 'inspector'
    | 'connection'
    | 'connectionId'
    | 'trusted'
    | 'expert'
    | 'history'
    | 'historyError'
    | 'documentsError'
    | 'run'
    | 'comparisonProfiles'
    | 'comparisonPipelines'
    | 'onRefreshHistory'
    | 'onRefreshDocuments'
    | 'onOpenRun'
    | 'onOpenDocument'
> & { visibleDocuments: QueryDocument[] }) {
    return (
        <>
            {inspector === 'history' && (
                <section className="inspector-section">
                    <div className="schema-heading">
                        <span>{copy.history.toUpperCase()}</span>
                        {expert && (
                            <RunComparisonLauncher
                                connectionId={connectionId}
                                trusted={trusted}
                                history={history}
                                initialRun={run}
                                profiles={comparisonProfiles}
                                pipelines={comparisonPipelines}
                                queryLogAvailable={connection.manifest?.queryLog.available === true}
                            />
                        )}
                        <Button
                            variant="ghost"
                            className="toolbar-small"
                            onClick={onRefreshHistory}
                        >
                            ↻ Refresh
                        </Button>
                    </div>
                    <WorkspaceInlineNotice
                        feedback={readFailureFeedback(
                            'Couldn’t load query history. Try again.',
                            historyError,
                        )}
                        onRetry={onRefreshHistory}
                    />
                    {history.length
                        ? history.slice(0, 30).map(item => (
                              <button
                                  type="button"
                                  className="history-card"
                                  key={item.id}
                                  onClick={() => onOpenRun(item)}
                              >
                                  <span className={cx('run-state-mark', `state-${item.status}`)} />
                                  <span className="history-card-copy">
                                      <strong>{item.sql.replace(/\s+/g, ' ').slice(0, 58)}</strong>
                                      <small>
                                          {new Date(item.createdAt).toLocaleString()} <i>·</i>{' '}
                                          {Math.round(item.elapsedMs)} ms <i>·</i>{' '}
                                          {item.rowCount.toLocaleString()} rows
                                      </small>
                                  </span>
                                  <span className="history-open">↗</span>
                              </button>
                          ))
                        : !historyError && (
                              <div className="inspector-empty">
                                  <Icon name="history" />
                                  <strong>No runs yet</strong>
                                  <p>Your recent ClickHouse executions appear here.</p>
                              </div>
                          )}
                </section>
            )}
            {inspector === 'documents' && (
                <section className="inspector-section">
                    <div className="schema-heading">
                        <span>{copy.queries.toUpperCase()}</span>
                        <Button
                            variant="ghost"
                            className="toolbar-small"
                            onClick={onRefreshDocuments}
                        >
                            ↻ Refresh
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
                                  onClick={() => onOpenDocument(document)}
                              >
                                  <span className="file-type-icon small">SQL</span>
                                  <span>
                                      <strong>{document.name}</strong>
                                      <small>
                                          revision {document.revision} ·{' '}
                                          {new Date(document.updatedAt).toLocaleDateString()}
                                      </small>
                                  </span>
                                  <span className="history-open">↗</span>
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
    revisionsDocumentId,
    revisions,
    currentRevision,
    onRefreshRevisions,
    revisionLoading,
    revisionError,
    selectedRevision,
    setSelectedRevisionNumber,
    canRestoreRevision,
    onRestoreRevision,
    unsavedDraft,
}: {
    revisionsDocumentId: InspectorPaneProps['revisionsDocumentId'];
    revisions: InspectorPaneProps['revisions'];
    currentRevision: InspectorPaneProps['currentRevision'];
    onRefreshRevisions: InspectorPaneProps['onRefreshRevisions'];
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
                <Button
                    variant="ghost"
                    className="toolbar-small"
                    onClick={onRefreshRevisions}
                    disabled={revisionLoading || !revisionsDocumentId}
                >
                    {revisionLoading ? 'Loading…' : 'Refresh'}
                </Button>
            </div>
            <p className="revision-history-help">
                Browse saved versions. Restoring one creates a new version.
            </p>
            {revisionError && (
                <div className="callout callout-error" role="alert">
                    {revisionError}
                </div>
            )}
            {revisionLoading && !revisions.length && (
                <div className="inspector-empty">
                    <Spinner />
                    <p>Loading saved versions…</p>
                </div>
            )}
            {!revisionLoading && !revisionError && !revisions.length && (
                <div className="inspector-empty">
                    <Icon name="history" />
                    <strong>No saved versions</strong>
                    <p>Save this query to start a version history.</p>
                </div>
            )}
            {revisions.length > 0 && (
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
                                    <strong>
                                        Version {revision.revision}
                                        {revision.revision === currentRevision && <em>Current</em>}
                                    </strong>
                                    <small>{new Date(revision.updatedAt).toLocaleString()}</small>
                                </span>
                                <span className="history-open">›</span>
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
    const items: Array<[string, string]> = [
        ['Query ID', run.queryId],
        ['Duration', `${Math.round(summary?.durationMs ?? run.elapsedMs)} ms`],
        ...(summary?.readRows === undefined
            ? []
            : [['Rows read', Number(summary.readRows).toLocaleString()] as [string, string]]),
        ...(summary?.readBytes === undefined
            ? []
            : [['Bytes read', formatBytes(summary.readBytes)] as [string, string]]),
        ...(summary?.memory === undefined
            ? []
            : [['Memory', formatBytes(summary.memory)] as [string, string]]),
        ['Rows returned', run.rowCount.toLocaleString()],
        ...(run.executedAs ? [['Executed as', run.executedAs] as [string, string]] : []),
        ...(run.serverVersion ? [['Server', run.serverVersion] as [string, string]] : []),
    ];
    return (
        <section className="inspector-section">
            <div className="run-detail-hero">
                <span className="eyebrow">LATEST EXECUTION</span>
                <Status run={run} />
                <small>{new Date(run.createdAt).toLocaleString()}</small>
            </div>
            <div className="run-fact-list">
                {items.map(([label, value]) => (
                    <div
                        key={label}
                        data-testid={label === 'Query ID' ? 'run-query-id' : undefined}
                    >
                        <span>{label}</span>
                        <strong>{value}</strong>
                        {label === 'Query ID' && (
                            <button
                                title="Copy query ID"
                                onClick={() => void navigator.clipboard.writeText(value)}
                            >
                                <Icon name="copy" />
                            </button>
                        )}
                    </div>
                ))}
            </div>
            {run.error && (
                <div className="callout callout-error">
                    {run.error.code}: {run.error.message}
                </div>
            )}
            {unavailableReason ? (
                <p className="profile-note">{unavailableReason}</p>
            ) : (
                <Button variant="secondary" className="w-full mt-4" onClick={onLoad}>
                    Load query log evidence
                </Button>
            )}
            {profile?.notice && <p className="profile-note">{profile.notice}</p>}
        </section>
    );
}

function PipelineView({
    run,
    profile,
    pipeline,
    onLoad,
    onOpenGraph,
    available,
    unavailableReason,
}: {
    run?: Run;
    profile?: QueryProfile;
    pipeline?: ProfilePipeline;
    onLoad: () => void;
    onOpenGraph: () => void;
    available: boolean;
    unavailableReason?: string;
}) {
    if (!run)
        return (
            <div className="inspector-empty">Run a query to inspect its execution pipeline.</div>
        );
    const stages = pipeline?.nodes ?? profile?.pipeline.nodes ?? [];
    return (
        <section className="inspector-section">
            <div className="schema-heading">
                <span>EXECUTION PIPELINE</span>
                <Button
                    variant="ghost"
                    className="toolbar-small"
                    onClick={onLoad}
                    disabled={!available}
                    title={unavailableReason}
                >
                    Load evidence
                </Button>
            </div>
            {pipeline?.notice && <p className="profile-note">{pipeline.notice}</p>}
            {stages.length ? (
                <>
                    <Button variant="secondary" className="w-full" onClick={onOpenGraph}>
                        Open operator graph in Insights
                    </Button>
                    <div className="pipeline-list">
                        {stages.map((stage, index) => (
                            <article
                                className={`pipeline-stage stage-${stage.status}`}
                                key={stage.id}
                            >
                                <span className="pipeline-stage-index">
                                    {String(index + 1).padStart(2, '0')}
                                </span>
                                <span className="pipeline-connector" />
                                <span className="pipeline-stage-body">
                                    <strong>{stage.label}</strong>
                                    <small>
                                        {stage.detail ?? stage.kind} · {stage.status}
                                    </small>
                                    <span>
                                        {[
                                            stage.durationMs === undefined
                                                ? ''
                                                : `${Math.round(stage.durationMs)} ms`,
                                            stage.rows ? `${stage.rows} rows` : '',
                                            stage.bytes ? `${stage.bytes} bytes` : '',
                                        ]
                                            .filter(Boolean)
                                            .join(' · ') || 'No stage-level measurements'}
                                    </span>
                                </span>
                                <span className="stage-evidence">{stage.status}</span>
                            </article>
                        ))}
                    </div>
                </>
            ) : (
                <div className="inspector-empty">
                    <Icon name="pipeline" />
                    <strong>
                        {available
                            ? 'Pipeline evidence is not loaded'
                            : 'Pipeline evidence is unavailable'}
                    </strong>
                    <p>
                        {unavailableReason ??
                            'Available ClickHouse versions can return an EXPLAIN PIPELINE graph.'}
                    </p>
                </div>
            )}
        </section>
    );
}
