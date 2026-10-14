import type { ExperienceLevel } from '../../ui/styles/appearance-types';
import { MAX_SCRIPT_STATEMENTS } from '../../../shared/queries/execution/limits';
import {
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ComponentPropsWithoutRef,
    type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { diffLines } from 'diff';
import ReactMarkdown, { type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Nodes, Root } from 'mdast';
import { statementOutline, type SqlOperation } from '../../queries/editor/sql-editor-helpers';
import type { Proposal } from '../../../shared/assistant/types';
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
import {
    AssistantImageAttachments,
    useAssistantImageAttachments,
    type AssistantImageAttachment,
} from './assistant-image-attachments';

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
    onAskAI: (images: readonly AssistantImageAttachment[], question?: string) => void;
    onCancelRequest: () => void;
};

type SqlDiffRow = {
    kind: 'added' | 'removed' | 'context';
    text: string;
    oldLine?: number;
    newLine?: number;
};
type SqlDiffChange = ReturnType<typeof diffLines>[number];

const generateTaskPrompts = [
    'Create a ClickHouse table for movies with title, genre, release year, and rating. Insert representative sample records, then query average rating by genre.',
    'Create a ClickHouse table for countries with country, region, population, and land area. Insert representative sample records, then query population density by region.',
    'Create a ClickHouse table for sports results with sport, team, game date, points, and outcome. Insert representative sample records, then query win rate and average points by team.',
    'Create a ClickHouse table for music streams with stream time, artist, track, and genre. Insert representative sample records, then query stream counts by artist and genre.',
] as const;

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
    const outline = useMemo(() => statementOutline(proposal.sql ?? ''), [proposal.sql]);
    const showPlan =
        outline.statements.length > 1 ||
        Boolean(outline.error) ||
        outline.statements.some(statement => statement.operation !== 'read') ||
        outline.statements.length === 0;
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
                {showPlan && <AssistantScriptPlan sql={proposal.sql ?? ''} />}
            </details>
            {review.message && (
                <p className="sql-proposal-review-message" role="status">
                    {review.message}
                </p>
            )}
        </div>
    );
}

function normalizeCitationLinks(sources: readonly { url: string }[]) {
    const urls = new Set(
        sources.flatMap(source => {
            try {
                const url = new URL(source.url);
                return (url.protocol === 'http:' || url.protocol === 'https:') &&
                    !url.username &&
                    !url.password
                    ? [url.href]
                    : [];
            } catch {
                return [];
            }
        }),
    );
    return () => (tree: Root) => {
        const visit = (node: Nodes) => {
            if (node.type === 'link') {
                const nested = /^\[\s*(.+?)\s*\]\(\s*(.+?)\s*\)$/.exec(node.url);
                if (nested && nested[1] === nested[2] && urls.has(nested[1]!))
                    node.url = nested[1]!;
            }
            if (!('children' in node)) return;
            node.children.forEach(visit);
            for (let index = 1; index < node.children.length - 1; index++) {
                const before = node.children[index - 1];
                const link = node.children[index];
                const after = node.children[index + 1];
                if (
                    before?.type !== 'text' ||
                    link?.type !== 'link' ||
                    after?.type !== 'text' ||
                    !urls.has(link.url)
                )
                    continue;
                const label = /\[([^\]]+)\]\(\s*$/.exec(before.value);
                if (
                    !label ||
                    !/^\s*\)/.test(after.value) ||
                    link.children.length !== 1 ||
                    link.children[0]?.type !== 'text' ||
                    link.children[0].value.trim() !== link.url
                )
                    continue;
                before.value = before.value.slice(0, label.index);
                link.children[0].value = label[1]!;
                after.value = after.value.replace(/^\s*\)/, '');
            }
        };
        visit(tree);
    };
}

function AssistantCodeBlock({
    node: _node,
    children,
    ...props
}: ComponentPropsWithoutRef<'pre'> & ExtraProps) {
    return (
        <div className="assistant-markdown-code-block">
            <pre {...props}>{children}</pre>
        </div>
    );
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
                remarkPlugins={[remarkGfm, normalizeCitationLinks(sources)]}
                components={{
                    pre: AssistantCodeBlock,
                    a: ({ href, children, ...props }) => (
                        <a {...props} href={href} target="_blank" rel="noreferrer">
                            {children}
                        </a>
                    ),
                }}
            >
                {text}
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

function AssistantScriptPlan({ sql }: { sql: string }) {
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
    const mutationWarning = hasMutation
        ? `${hasUpdateBeforeDelete ? 'UPDATE runs before DELETE, which may remove the changed rows. ' : ''}` +
          'ClickHouse mutations may finish asynchronously.'
        : undefined;

    const executionContent = (
        <>
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
            {(outline.error || !statements.length) && (
                <pre>
                    <code>{sql}</code>
                </pre>
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
        </>
    );

    return (
        <section
            className="assistant-execution-option"
            aria-label="Script plan"
            data-testid="assistant-execution-option"
        >
            <header className="assistant-execution-heading">
                <div>
                    <strong>Script plan</strong>
                    {mutationWarning && (
                        <p className="assistant-execution-warning" role="status">
                            {mutationWarning}
                        </p>
                    )}
                </div>
                <span className="assistant-execution-count">
                    {statements.length} {statements.length === 1 ? 'statement' : 'statements'}
                    {statements.length > 1 ? ' · runs in order' : ''}
                </span>
            </header>
            {executionContent}
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
}: {
    mode: AssistantWorkflowProps['mode'];
    sql: string;
    draftId: string;
    connectionId: string;
    turn: AssistantChatTurn;
    latestTurnId: string | undefined;
}) {
    const proposal = turn.proposal;
    const proposalSql = proposal?.sql ?? null;
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

    const beginner = mode === 'beginner';
    const review = assistantSqlReview(
        { ...turn, proposal },
        {
            sql,
            draftId,
            connectionId,
            latestTurnId,
        },
    );
    const sources = (proposal.sources ?? []).map(source => {
        try {
            const url = new URL(source.url);
            const linkable =
                (url.protocol === 'http:' || url.protocol === 'https:') &&
                !url.username &&
                !url.password;
            return {
                ...source,
                href: linkable ? url.href : undefined,
                label: source.title || url.hostname || source.url,
            };
        } catch {
            return { ...source, href: undefined, label: source.title || source.url };
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
                sources={sources}
                text={item.evidence}
                className="assistant-proposal-markdown assistant-proposal-finding-evidence"
            />
        </div>
    ));
    const supportingDetailCount =
        proposal.assumptions.length + proposal.caveats.length + sources.length;
    const hasSupportingDetails = supportingDetailCount > 0;
    return (
        <div className="proposal-card">
            <div className="proposal-heading">
                <div>
                    <AssistantMarkdown
                        sources={sources}
                        text={proposal.summary}
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
                <div className="assistant-clarification">
                    <span className="assistant-clarification-label">Next step</span>
                    <AssistantMarkdown
                        sources={sources}
                        text={proposal.clarification}
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
                                    sources={sources}
                                    text={item}
                                    className="assistant-proposal-markdown"
                                />
                            </div>
                        ))}
                        {proposal.caveats.map((item, index) => (
                            <div className="proposal-point" key={`${index}-${item}`}>
                                <span>NOTE</span>
                                <AssistantMarkdown
                                    sources={sources}
                                    text={item}
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
                                            {source.href ? (
                                                <a
                                                    href={source.href}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                >
                                                    {source.label}
                                                </a>
                                            ) : (
                                                <span>{source.label}</span>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </details>
            )}
            {proposalSql !== null && (
                <AssistantSqlProposalDiff
                    key={`${proposal.id}:${proposal.decision}`}
                    proposal={proposal}
                    review={review}
                />
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
    } = props;
    const transcriptViewport = useRef<HTMLDivElement>(null);
    const [questionInput, setQuestionInput] = useState<HTMLTextAreaElement | null>(null);
    const {
        images: imageAttachments,
        isReading: isReadingImages,
        error: pasteError,
        clear: clearImageAttachments,
        remove: removeImageAttachment,
        onPaste: pasteImages,
    } = useAssistantImageAttachments(activeChatId, onQuestionChange);
    const activeChat = chats.find(chat => chat.id === activeChatId);
    const canSubmit =
        !busy &&
        !isReadingImages &&
        trusted &&
        (Boolean(question.trim()) || imageAttachments.length > 0);
    const canStartPrompt = !busy && !isReadingImages && trusted;
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

    const ask = (prompt?: string) => {
        if (prompt ? !canStartPrompt : !canSubmit) return;
        const images = imageAttachments;
        clearImageAttachments();
        void onAskAI(images, prompt);
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
                        <Icon name="close" />
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
                                    <strong>SQL Assistant</strong>
                                    <p>
                                        Explain or optimize a ClickHouse query, or generate a new
                                        example.
                                    </p>
                                    {!question.trim() && !imageAttachments.length && (
                                        <div
                                            className="assistant-starter-actions"
                                            role="group"
                                            aria-label="Try a task"
                                        >
                                            <Button
                                                variant="secondary"
                                                disabled={!canStartPrompt}
                                                onClick={() =>
                                                    ask('Explain this SQL query in plain language.')
                                                }
                                            >
                                                Explain this query
                                            </Button>
                                            <Button
                                                variant="secondary"
                                                disabled={!canStartPrompt}
                                                onClick={() =>
                                                    ask(
                                                        'Optimize this ClickHouse query and explain the changes.',
                                                    )
                                                }
                                            >
                                                Optimize this query
                                            </Button>
                                            <Button
                                                variant="secondary"
                                                disabled={!canStartPrompt}
                                                onClick={() =>
                                                    ask(
                                                        generateTaskPrompts[
                                                            Math.floor(
                                                                Math.random() *
                                                                    generateTaskPrompts.length,
                                                            )
                                                        ],
                                                    )
                                                }
                                            >
                                                Generate a random example
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            )}
                            {turns.map(turn => (
                                <article className="assistant-turn" key={turn.id}>
                                    <div className="assistant-user-message">
                                        <span>You</span>
                                        <p>{turn.question}</p>
                                        {turn.images?.length ? (
                                            <div
                                                className="assistant-user-image-attachments"
                                                aria-label={`${turn.images.length} attached images`}
                                            >
                                                {turn.images.map((name, index) => (
                                                    <span
                                                        className="assistant-image-chip"
                                                        key={`${name}:${index}`}
                                                        title={name}
                                                    >
                                                        <Icon name="image" />
                                                        <span>{name}</span>
                                                    </span>
                                                ))}
                                            </div>
                                        ) : null}
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
                {pasteError && (
                    <div className="assistant-feedback callout callout-error" role="alert">
                        {pasteError}
                    </div>
                )}
                {!trusted && (
                    <div className="assistant-feedback callout">
                        Trust this connection before sharing its schema with the assistant.
                    </div>
                )}
                <div className="assistant-chat-composer">
                    {(imageAttachments.length > 0 || isReadingImages) && (
                        <AssistantImageAttachments
                            images={imageAttachments}
                            isReading={isReadingImages}
                            onRemove={removeImageAttachment}
                        />
                    )}
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
                                onPaste={pasteImages}
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
