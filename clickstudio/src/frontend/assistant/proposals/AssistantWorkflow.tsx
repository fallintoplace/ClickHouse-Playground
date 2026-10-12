import type { ExperienceLevel } from '../../ui/styles/appearance-types';
import { MAX_SCRIPT_STATEMENTS } from '../../../shared/queries/execution/limits';
import {
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { diffLines } from 'diff';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { statementOutline, type SqlOperation } from '../../queries/editor/sql-editor-helpers';
import type { Proposal, ProposalAlternative } from '../../../shared/assistant/types';
import {
    assistantSqlReview,
    type AssistantSqlReview,
    type AssistantChat,
    type AssistantChatTurn,
} from '../chat/assistant-chat-state';
import { AssistantChatHistory } from '../chat/AssistantChatHistory';
import { ScrollEdgeFrame } from '../../ui/components/ScrollEdgeShadows';
import { Button, cx, Spinner } from '../../ui/components/primitives';
import { Icon } from '../../ui/components/icons';

export type AssistantWorkflowProps = {
    mode: ExperienceLevel;
    sql: string;
    draftId: string;
    connectionId: string;
    question: string;
    onQuestionChange: (question: string) => void;
    chats: readonly AssistantChat[];
    activeChatId: string;
    turns: readonly AssistantChatTurn[];
    storageError: string;
    onNewChat: () => void;
    onSelectChat: (chatId: string) => void;
    onRenameChat: (chatId: string, title: string) => void;
    onDeleteChat: (chatId: string) => void;
    busy: boolean;
    cancelable: boolean;
    phase?: 'preparing' | 'generating' | 'deciding';
    error: string;
    notice: string;
    trusted: boolean;
    onAskAI: () => void;
    onCancelRequest: () => void;
    schemaReady: boolean;
    schemaLoading: boolean;
    schemaStatus: string;
    onRefreshSchema: () => void;
    onOpenSqlDraft: (name: string, sql: string) => void;
};

type SqlDiffRow = {
    kind: 'added' | 'removed' | 'context';
    text: string;
    oldLine?: number;
    newLine?: number;
};
type SqlDiffChange = ReturnType<typeof diffLines>[number];

function sqlDiffRows(changes: readonly SqlDiffChange[]): SqlDiffRow[] {
    let oldLine = 1;
    let newLine = 1;
    return changes.flatMap(change => {
        const lines = change.value.split('\n');
        if (lines.at(-1) === '') lines.pop();
        let kind: 'added' | 'removed' | 'context';

        if (change.added) {
            kind = 'added';
        } else if (change.removed) {
            kind = 'removed';
        } else {
            kind = 'context';
        }
        return lines.map(text => {
            const row: SqlDiffRow = {
                kind,
                text: text.replace(/\r$/, ''),
                ...(kind === 'added' ? {} : { oldLine }),
                ...(kind === 'removed' ? {} : { newLine }),
            };
            if (kind !== 'added') oldLine++;
            if (kind !== 'removed') newLine++;
            return row;
        });
    });
}

function AssistantSqlProposalDiff({
    proposal,
    review,
}: {
    proposal: Proposal;
    review: AssistantSqlReview;
}) {
    const [open, setOpen] = useState(review.status === 'Needs review');
    const changes = useMemo(
        () => diffLines(proposal.baseSql, proposal.sql ?? ''),
        [proposal.baseSql, proposal.sql],
    );
    const { added, removed } = useMemo(
        () =>
            changes.reduce(
                (counts, change) => {
                    const lines =
                        change.value.split('\n').length - Number(change.value.endsWith('\n'));
                    if (change.added) counts.added += lines;
                    if (change.removed) counts.removed += lines;
                    return counts;
                },
                { added: 0, removed: 0 },
            ),
        [changes],
    );
    const rows = useMemo(() => (open ? sqlDiffRows(changes) : []), [changes, open]);
    return (
        <div className="assistant-sql-review">
            <details
                className="sql-proposal-diff"
                data-testid="sql-proposal-diff"
                open={open}
                onToggle={event => setOpen(event.currentTarget.open)}
            >
                <summary className="sql-proposal-diff-toggle">
                    <span className="sql-proposal-diff-title">
                        <span className="sql-proposal-diff-label">SQL changes</span>
                        <span
                            className={cx(
                                'sql-proposal-review-status',
                                `is-${proposal.decision}`,
                                proposal.decision === 'pending' &&
                                    !review.message &&
                                    review.status !== 'Needs review' &&
                                    'is-informational',
                            )}
                        >
                            {review.status}
                        </span>
                    </span>
                    <span className="sql-proposal-diff-count">
                        <span className="is-added" aria-hidden="true">
                            +{added}
                        </span>
                        <span className="is-removed" aria-hidden="true">
                            −{removed}
                        </span>
                        <span className="sr-only">
                            {added} {added === 1 ? 'line' : 'lines'} added, {removed}{' '}
                            {removed === 1 ? 'line' : 'lines'} removed
                        </span>
                    </span>
                    <span className="sql-proposal-diff-chevron" aria-hidden="true">
                        <Icon name="chevron" />
                    </span>
                </summary>
                <ScrollEdgeFrame<HTMLPreElement> className="sql-proposal-diff-scroll-frame">
                    {ref => (
                        <pre
                            ref={ref}
                            className="sql-proposal-diff-code"
                            aria-label="Line-by-line SQL changes"
                        >
                            <code>
                                {rows.map((row, index) => {
                                    const getDiffPrefix = () => {
                                        switch (row.kind) {
                                            case 'added':
                                                return '+';

                                            case 'removed':
                                                return '−';

                                            default:
                                                return ' ';
                                        }
                                    };
                                    return (
                                        <span
                                            className={`sql-proposal-diff-line is-${row.kind}`}
                                            key={`${row.kind}-${index}`}
                                        >
                                            <span className="sql-proposal-diff-gutter">
                                                {row.oldLine ?? ''} {row.newLine ?? ''}
                                            </span>
                                            <span className="sql-proposal-diff-sign">
                                                {getDiffPrefix()}
                                            </span>
                                            <span>{row.text || ' '}</span>
                                        </span>
                                    );
                                })}
                            </code>
                        </pre>
                    )}
                </ScrollEdgeFrame>
            </details>
            {review.message && (
                <p className="sql-proposal-review-message" role="status">
                    {review.message}
                </p>
            )}
        </div>
    );
}

function normalizeCitationMarkdown(text: string, sources: readonly { url: string }[]) {
    return sources.reduce((normalized, source) => {
        let url: URL;
        try {
            url = new URL(source.url);
        } catch {
            return normalized;
        }
        if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password)
            return normalized;
        const canonicalUrl = url.href;
        const escapedUrl = canonicalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const nestedCitation = new RegExp(
            String.raw`\[([^\]]+)\]\\?\(\s*\[\s*${escapedUrl}\s*\]\(\s*${escapedUrl}\s*\)\s*\)`,
            'g',
        );
        return normalized.replace(
            nestedCitation,
            (_match, label: string) => `[${label}](${canonicalUrl})`,
        );
    }, text);
}

function AssistantMarkdown({
    text,
    sources,
    className,
    testId,
}: {
    text: string;
    sources: readonly { url: string }[];
    className: string;
    testId?: string;
}) {
    return (
        <div className={className} data-testid={testId}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    a: ({ href, children, ...props }) => (
                        <a {...props} href={href} target="_blank" rel="noreferrer">
                            {children}
                        </a>
                    ),
                }}
            >
                {normalizeCitationMarkdown(text, sources)}
            </ReactMarkdown>
        </div>
    );
}

const operationLabels: Record<SqlOperation, string> = {
    read: 'Read',
    insert: 'Insert',
    update: 'Update',
    delete: 'Delete',
    schema: 'Schema',
    unknown: 'Unknown',
};
const SCRIPT_PLAN_PAGE_SIZE = 5;

function AssistantExecutionOption({
    title,
    summary,
    sql,
    openDisabled,
    onOpenSqlDraft,
    alternative = false,
}: {
    title: string;
    summary?: string;
    sql: string;
    openDisabled: boolean;
    onOpenSqlDraft: AssistantWorkflowProps['onOpenSqlDraft'];
    alternative?: boolean;
}) {
    const outline = useMemo(() => statementOutline(sql), [sql]);
    const statements = outline.statements;
    const [page, setPage] = useState(0);
    const lastPage = Math.max(0, Math.ceil(statements.length / SCRIPT_PLAN_PAGE_SIZE) - 1);
    const currentPage = Math.min(page, lastPage);
    const pageStart = currentPage * SCRIPT_PLAN_PAGE_SIZE;
    const pageEnd = Math.min(pageStart + SCRIPT_PLAN_PAGE_SIZE, statements.length);
    const hasUpdateBeforeDelete = statements.some(
        (statement, index) =>
            statement.operation === 'update' &&
            statements.slice(index + 1).some(next => next.operation === 'delete'),
    );
    const hasMutation = statements.some(
        statement => statement.operation === 'update' || statement.operation === 'delete',
    );

    const getOptionLabel = () => {
        if (alternative) {
            return 'ALTERNATIVE';
        }

        if (statements.length > 1) {
            return 'SCRIPT PLAN';
        }

        return 'RECOMMENDED OPTION';
    };
    return (
        <section
            className="assistant-execution-option"
            aria-label={`Execution plan: ${title}`}
            data-testid="assistant-execution-option"
        >
            <header className="assistant-execution-heading">
                <div>
                    <span className="eyebrow">{getOptionLabel()}</span>
                    <strong>{title}</strong>
                    {summary && <p>{summary}</p>}
                    {hasMutation && (
                        <p className="assistant-execution-warning" role="status">
                            {hasUpdateBeforeDelete
                                ? 'UPDATE runs before DELETE, which may remove the changed rows. '
                                : ''}
                            ClickHouse mutations may finish asynchronously.
                        </p>
                    )}
                </div>
                <span className="assistant-execution-count">
                    {statements.length} {statements.length === 1 ? 'statement' : 'statements'}
                    {statements.length > 1 ? ' · runs in order' : ''}
                </span>
            </header>
            {outline.error && (
                <p className="assistant-execution-error" role="alert">
                    Could not split this SQL safely: {outline.error}
                </p>
            )}
            {!outline.error && !statements.length && (
                <p className="assistant-execution-error" role="alert">
                    There are no SQL statements to run.
                </p>
            )}
            <ol
                className="assistant-execution-steps"
                aria-label="Statements in execution order"
                start={pageStart + 1}
            >
                {statements.slice(pageStart, pageEnd).map((statement, index) => (
                    <li key={statement.from} data-operation={statement.operation}>
                        <details className="assistant-execution-step-details">
                            <summary className="assistant-execution-step-heading">
                                <span className="assistant-execution-number">
                                    {pageStart + index + 1}
                                </span>
                                <span
                                    className={cx(
                                        'assistant-operation-badge',
                                        `is-${statement.operation}`,
                                    )}
                                >
                                    {operationLabels[statement.operation]}
                                </span>
                                <span className="assistant-execution-label">
                                    {statement.label || 'SQL statement'}
                                </span>
                                <span
                                    className="assistant-execution-step-chevron"
                                    aria-hidden="true"
                                >
                                    <Icon name="chevron" />
                                </span>
                            </summary>
                            <pre>
                                <code>{statement.sql}</code>
                            </pre>
                        </details>
                    </li>
                ))}
            </ol>
            {statements.length > SCRIPT_PLAN_PAGE_SIZE && (
                <nav className="assistant-execution-pagination" aria-label="Script plan pages">
                    <Button
                        variant="secondary"
                        onClick={() => setPage(currentPage - 1)}
                        disabled={currentPage === 0}
                    >
                        Previous
                    </Button>
                    <span aria-live="polite" aria-atomic="true">
                        {pageStart + 1}–{pageEnd} of {statements.length}
                    </span>
                    <Button
                        variant="secondary"
                        onClick={() => setPage(currentPage + 1)}
                        disabled={currentPage === lastPage}
                    >
                        Next
                    </Button>
                </nav>
            )}
            {statements.length > MAX_SCRIPT_STATEMENTS && (
                <p className="assistant-execution-error" role="status">
                    Scripts with more than {MAX_SCRIPT_STATEMENTS} statements cannot run as one
                    script.
                </p>
            )}
            {alternative && (
                <footer className="assistant-alternative-actions">
                    <Button
                        variant="secondary"
                        onClick={() => {
                            if (!openDisabled) onOpenSqlDraft(`${title}.sql`, sql);
                        }}
                        disabled={openDisabled}
                        aria-label={`Open in SQL tab: ${title}`}
                    >
                        Open in SQL tab
                    </Button>
                </footer>
            )}
        </section>
    );
}

function AssistantOutput({
    mode,
    sql,
    draftId,
    connectionId,
    turn,
    latestTurnId,
    busy,
    onOpenSqlDraft,
}: {
    mode: AssistantWorkflowProps['mode'];
    sql: string;
    draftId: string;
    connectionId: string;
    turn: AssistantChatTurn;
    latestTurnId: string | undefined;
    busy: boolean;
    onOpenSqlDraft: AssistantWorkflowProps['onOpenSqlDraft'];
}) {
    const proposal = turn.proposal;
    const proposalSql = proposal?.sql ?? null;
    const mainOutline = useMemo(
        () => (proposalSql === null ? undefined : statementOutline(proposalSql)),
        [proposalSql],
    );
    if (turn.status === 'pending')
        return (
            <div className="assistant-pending" role="status">
                <Spinner size={14} />
                Thinking…
            </div>
        );
    if (turn.error)
        return (
            <div
                className={cx(
                    'assistant-turn-error',
                    turn.status === 'cancelled' && 'is-cancelled',
                )}
                role={turn.status === 'failed' ? 'alert' : 'status'}
            >
                {turn.error}
            </div>
        );
    if (!proposal) return null;

    const alternatives: ProposalAlternative[] = proposal.alternatives ?? [];
    const beginner = mode === 'beginner';
    const proposalIsScript = (mainOutline?.statements.length ?? 0) > 1;
    const proposalHasNonReadStatement =
        mainOutline?.statements.some(statement => statement.operation !== 'read') ?? false;
    const proposalHasNoStatements = proposalSql !== null && mainOutline?.statements.length === 0;
    const showExecutionOptions =
        proposalSql !== null &&
        (proposalIsScript ||
            alternatives.length > 0 ||
            proposalHasNonReadStatement ||
            Boolean(mainOutline?.error) ||
            proposalHasNoStatements);
    const review = assistantSqlReview(
        { ...turn, proposal },
        { sql, draftId, connectionId, latestTurnId },
    );
    const openDisabled = busy || !review.canOpenAlternative;
    const sources = (proposal.sources ?? []).flatMap(source => {
        try {
            const url = new URL(source.url);
            return url.protocol === 'http:' || url.protocol === 'https:'
                ? [{ ...source, url: url.href, label: source.title || url.hostname }]
                : [];
        } catch {
            return [];
        }
    });
    const findingCards = proposal.findings.map((item, index) => (
        <div className="proposal-finding" key={`${index}-${item.severity}-${item.message}`}>
            <strong>{item.severity}</strong>
            <AssistantMarkdown
                text={item.message}
                sources={sources}
                className="assistant-proposal-markdown"
            />
            <AssistantMarkdown
                text={item.evidence}
                sources={sources}
                className="assistant-proposal-markdown assistant-proposal-finding-evidence"
            />
        </div>
    ));
    const supportingDetailCount =
        proposal.assumptions.length + proposal.caveats.length + sources.length;
    const hasSupportingDetails = supportingDetailCount > 0;
    const getProposalLabel = () => {
        if (alternatives.length) {
            return 'Recommended option';
        }

        if (proposalIsScript) {
            return 'Script plan';
        }

        return 'SQL action';
    };
    return (
        <div className="proposal-card">
            <div className="proposal-heading">
                {!beginner && proposalSql !== null && (
                    <span
                        className={cx('proposal-quality', proposal.quality?.status)}
                        title="Automated SQL checks, not a guarantee that the query returns the right answer."
                        aria-label={`Automated SQL check score: ${proposal.quality?.score ?? 'unavailable'}`}
                    >
                        {proposal.quality?.score ?? '—'}
                        <small>CHECKS</small>
                    </span>
                )}
                <div>
                    <AssistantMarkdown
                        text={proposal.summary}
                        sources={sources}
                        className={
                            proposalSql === null
                                ? 'assistant-answer-markdown'
                                : 'assistant-proposal-summary'
                        }
                        testId={
                            proposalSql === null
                                ? 'assistant-answer-markdown'
                                : 'assistant-proposal-summary'
                        }
                    />
                </div>
            </div>
            {proposal.clarification && (
                <div className="callout">
                    <AssistantMarkdown
                        text={proposal.clarification}
                        sources={sources}
                        className="assistant-proposal-markdown"
                    />
                </div>
            )}
            {!beginner && findingCards.length > 0 && (
                <details className="assistant-supporting-details">
                    <summary>
                        Details <span>{findingCards.length}</span>
                    </summary>
                    <div className="assistant-supporting-details-content">{findingCards}</div>
                </details>
            )}
            {!beginner && hasSupportingDetails && (
                <details className="assistant-supporting-details">
                    <summary>
                        Assumptions, notes and sources <span>{supportingDetailCount}</span>
                    </summary>
                    <div className="assistant-supporting-details-content">
                        {proposal.assumptions.map((item, index) => (
                            <div className="proposal-point" key={`${index}-${item}`}>
                                <span>ASSUMPTION</span>
                                <AssistantMarkdown
                                    text={item}
                                    sources={sources}
                                    className="assistant-proposal-markdown"
                                />
                            </div>
                        ))}
                        {proposal.caveats.map((item, index) => (
                            <div className="proposal-point" key={`${index}-${item}`}>
                                <span>NOTE</span>
                                <AssistantMarkdown
                                    text={item}
                                    sources={sources}
                                    className="assistant-proposal-markdown"
                                />
                            </div>
                        ))}
                        {sources.length > 0 && (
                            <div className="assistant-web-sources">
                                <span className="eyebrow">WEB SOURCES</span>
                                <ul>
                                    {sources.map(source => (
                                        <li key={source.url}>
                                            <a
                                                href={source.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                            >
                                                {source.label}
                                            </a>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </details>
            )}
            {proposalSql !== null && (
                <>
                    <AssistantSqlProposalDiff
                        key={`${proposal.id}:${proposal.decision}`}
                        proposal={proposal}
                        review={review}
                    />
                    {showExecutionOptions && (
                        <div className="assistant-execution-options">
                            <AssistantExecutionOption
                                key={`${proposal.id}:recommended`}
                                title={getProposalLabel()}
                                sql={proposalSql}
                                openDisabled={openDisabled}
                                onOpenSqlDraft={onOpenSqlDraft}
                            />
                            {alternatives.map((option, index) => (
                                <AssistantExecutionOption
                                    key={`${proposal.id}:alternative:${index}`}
                                    title={option.title}
                                    summary={option.summary}
                                    sql={option.sql}
                                    openDisabled={openDisabled}
                                    onOpenSqlDraft={onOpenSqlDraft}
                                    alternative
                                />
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

export function AssistantWorkflow(props: AssistantWorkflowProps) {
    const {
        mode,
        sql,
        draftId,
        connectionId,
        question,
        onQuestionChange,
        chats,
        activeChatId,
        turns,
        storageError,
        onNewChat,
        onSelectChat,
        onRenameChat,
        onDeleteChat,
        busy,
        error,
        trusted,
        cancelable,
        phase,
        notice,
        onAskAI,
        onCancelRequest,
        schemaReady,
        schemaLoading,
        schemaStatus,
        onRefreshSchema,
        onOpenSqlDraft,
    } = props;
    const transcriptViewport = useRef<HTMLDivElement>(null);
    const [questionInput, setQuestionInput] = useState<HTMLTextAreaElement | null>(null);
    const activeChat = chats.find(chat => chat.id === activeChatId);
    const canSubmit = !busy && trusted && schemaReady && Boolean(question.trim());
    const latestTurnIds = useMemo(
        () => new Map(turns.map(turn => [turn.draftId, turn.id])),
        [turns],
    );

    useLayoutEffect(() => {
        const viewport = transcriptViewport.current;
        if (viewport) viewport.scrollTop = viewport.scrollHeight;
    }, [activeChatId, turns]);

    useLayoutEffect(() => {
        if (!questionInput) return;
        const resize = () => {
            const scrollTop = questionInput.scrollTop;
            questionInput.style.height = '0px';
            questionInput.style.height = `${questionInput.scrollHeight}px`;
            questionInput.scrollTop = scrollTop;
        };
        resize();
        let width = questionInput.clientWidth;
        const observer = new ResizeObserver(() => {
            if (width === questionInput.clientWidth) return;
            width = questionInput.clientWidth;
            resize();
        });
        observer.observe(questionInput);
        return () => observer.disconnect();
    }, [question, questionInput]);

    const ask = () => {
        void onAskAI();
    };
    const sendOnEnter = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (canSubmit) ask();
        }
    };
    const renderSubmitAction = () => {
        if (busy) {
            if (cancelable) {
                return (
                    <Button
                        variant="danger"
                        className="assistant-composer-submit"
                        onClick={onCancelRequest}
                        aria-label="Stop assistant response"
                        title="Stop generating"
                    >
                        <Icon name="stop" />
                    </Button>
                );
            }

            return (
                <Button
                    variant="secondary"
                    className="assistant-composer-submit"
                    disabled
                    aria-label={phase === 'deciding' ? 'Applying…' : 'Working…'}
                    title={phase === 'deciding' ? 'Applying…' : 'Working…'}
                >
                    <Spinner size={14} />
                </Button>
            );
        }

        return (
            <Button
                variant="primary"
                className="assistant-composer-submit"
                disabled={!canSubmit}
                onClick={ask}
                aria-label="Send"
                title="Send (Enter)"
            >
                <Icon name="arrowUp" />
            </Button>
        );
    };
    return (
        <section className="assistant-panel animate-enter" aria-label="Ask AI">
            <AssistantChatHistory
                chats={chats}
                activeChatId={activeChatId}
                onNewChat={onNewChat}
                onSelectChat={onSelectChat}
                onRenameChat={onRenameChat}
                onDeleteChat={onDeleteChat}
            />
            {storageError && (
                <div className="assistant-feedback callout callout-error" role="alert">
                    {storageError}
                </div>
            )}
            <div
                id={`assistant-chat-panel-${activeChatId}`}
                className="assistant-chat-panel"
                role="region"
                aria-label={`Conversation: ${activeChat?.title ?? 'New chat'}`}
            >
                <ScrollEdgeFrame<HTMLDivElement> className="assistant-transcript-frame">
                    {ref => (
                        <div
                            ref={element => {
                                transcriptViewport.current = element;
                                ref(element);
                            }}
                            className={cx('assistant-transcript', !turns.length && 'is-empty')}
                            role="log"
                            aria-label="Chat messages"
                            aria-live="polite"
                            aria-relevant="additions text"
                        >
                            {!turns.length && (
                                <div className="assistant-empty-chat">
                                    <span className="assistant-glyph">
                                        <Icon name="assistant" />
                                    </span>
                                    <strong>Start a conversation</strong>
                                    <p>
                                        Ask about your query. Follow-ups keep this chat’s context.
                                    </p>
                                </div>
                            )}
                            {turns.map(turn => (
                                <article className="assistant-turn" key={turn.id}>
                                    <div className="assistant-user-message">
                                        <span>You</span>
                                        <p>{turn.question}</p>
                                    </div>
                                    <div className="assistant-response">
                                        <span className="assistant-response-label">Assistant</span>
                                        <AssistantOutput
                                            mode={mode}
                                            sql={sql}
                                            draftId={draftId}
                                            connectionId={connectionId}
                                            turn={turn}
                                            latestTurnId={latestTurnIds.get(turn.draftId)}
                                            busy={busy}
                                            onOpenSqlDraft={onOpenSqlDraft}
                                        />
                                    </div>
                                </article>
                            ))}
                        </div>
                    )}
                </ScrollEdgeFrame>
            </div>
            <div className="assistant-composer-area">
                {error && (
                    <div className="assistant-feedback callout callout-error" role="alert">
                        {error}
                    </div>
                )}
                {notice && (
                    <div className="assistant-feedback callout" role="status">
                        {notice}
                    </div>
                )}
                {!trusted && (
                    <div className="assistant-feedback callout">
                        Trust this connection before sharing its schema with the assistant.
                    </div>
                )}
                {!schemaReady && trusted && (
                    <div className="assistant-feedback callout assistant-schema-refresh">
                        <span>
                            {schemaStatus ||
                                'Load the ClickHouse schema before asking the assistant.'}
                        </span>
                        <Button
                            variant="secondary"
                            disabled={schemaLoading}
                            onClick={onRefreshSchema}
                        >
                            {schemaLoading ? 'Loading…' : 'Refresh schema'}
                        </Button>
                    </div>
                )}
                <div className="assistant-chat-composer">
                    <ScrollEdgeFrame<HTMLTextAreaElement>
                        className="assistant-question-frame"
                        onViewport={setQuestionInput}
                    >
                        {ref => (
                            <textarea
                                ref={ref}
                                id="assistant-question"
                                className="field-textarea assistant-question-input"
                                aria-label="Ask AI"
                                aria-describedby="assistant-composer-shortcuts"
                                value={question}
                                onChange={event => onQuestionChange(event.target.value)}
                                onKeyDown={sendOnEnter}
                                placeholder="Ask about your SQL…"
                                title="Enter to send. Shift+Enter for a new line."
                                rows={1}
                            />
                        )}
                    </ScrollEdgeFrame>
                    {renderSubmitAction()}
                    <span id="assistant-composer-shortcuts" className="sr-only">
                        Enter to send. Shift+Enter for a new line.
                    </span>
                </div>
            </div>
        </section>
    );
}
