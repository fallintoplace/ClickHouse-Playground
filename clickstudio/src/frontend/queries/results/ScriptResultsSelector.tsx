import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Run, Script } from '../../../shared/queries/execution/types';
import { Button, cx } from '../../ui/components/ui';
import { Icon } from '../../ui/components/icons';
import { statementOutcome } from './statement-outcome';

type ResultStatement = Pick<Script['statements'][number], 'sql' | 'runId' | 'status' | 'error'>;

type StatementResultsProps = {
    statements: readonly ResultStatement[];
    runs: Run[];
    activeRunId?: string;
    onSelectRun: (runId: string) => void;
    onSelectError: () => void;
    errorSelected: boolean;
};

function statementDetails(statement: ResultStatement, run?: Run) {
    const error = run?.error ?? statement.error;
    if (error) return `${error.code}: ${error.message}`;
    const status = run?.status ?? statement.status;
    if (status === 'pending' || status === 'queued') return 'Waiting to run';
    if (status === 'running') return 'Running';
    if (run && ['succeeded', 'truncated'].includes(status))
        return `${statementOutcome(run)} · ${Math.round(run.elapsedMs)} ms`;
    return `${status.charAt(0).toUpperCase()}${status.slice(1).replace(/_/g, ' ')}`;
}

function StatementCardContent({
    statement,
    index,
    details,
    showHeading = false,
}: {
    statement: ResultStatement;
    index: number;
    details: string;
    showHeading?: boolean;
}) {
    return (
        <>
            <span className={cx('script-statement-index', `status-${statement.status}`)}>
                {String(index + 1).padStart(2, '0')}
            </span>
            <span className="script-statement-copy">
                {showHeading && <strong>Statement {index + 1}</strong>}
                <code>{statement.sql.replace(/\s+/g, ' ').trim()}</code>
                <small>{details}</small>
            </span>
            <span className={cx('script-status', `status-${statement.status}`)}>
                {statement.status}
            </span>
        </>
    );
}

export function ScriptRunningResults({
    statements,
    runs,
    activeRunId,
    onSelectRun,
    onSelectError,
    errorSelected,
}: StatementResultsProps) {
    const list = useRef<HTMLDivElement>(null);
    const runningIndex = statements.findIndex(statement =>
        ['running', 'queued'].includes(statement.status),
    );
    const runningRunId = statements[runningIndex]?.runId;
    const byId = new Map(runs.map(run => [run.id, run]));

    useEffect(() => {
        if (runningIndex < 0 || (activeRunId && activeRunId !== runningRunId)) return;
        list.current?.children[runningIndex]?.scrollIntoView({
            block: 'nearest',
            inline: 'nearest',
        });
    }, [activeRunId, runningIndex, runningRunId]);

    useLayoutEffect(() => {
        const element = list.current;
        return () => {
            if (element?.contains(element.ownerDocument.activeElement))
                element
                    .closest('.results-surface')
                    ?.querySelector<HTMLButtonElement>('.script-results-trigger')
                    ?.focus();
        };
    }, []);

    return (
        <section className="script-running-results" aria-label="Script statement results">
            <div
                ref={list}
                className="script-statement-list"
                role="group"
                aria-label="Select a statement result"
            >
                {statements.map((statement, index) => {
                    const active = statement.runId
                        ? !errorSelected && statement.runId === activeRunId
                        : Boolean(statement.error && errorSelected);
                    const run = statement.runId ? byId.get(statement.runId) : undefined;
                    const details = statementDetails(
                        statement,
                        run?.status === statement.status ? run : undefined,
                    );
                    return (
                        <button
                            key={index}
                            type="button"
                            className={cx('script-statement', active && 'is-active')}
                            aria-label={`Statement ${index + 1}: ${statement.status}`}
                            aria-pressed={active}
                            title={`${statement.sql.replace(/\s+/g, ' ')} · ${details}`}
                            disabled={!statement.runId && !statement.error}
                            onClick={() =>
                                statement.runId ? onSelectRun(statement.runId) : onSelectError()
                            }
                        >
                            <StatementCardContent
                                statement={statement}
                                index={index}
                                details={details}
                                showHeading
                            />
                        </button>
                    );
                })}
            </div>
        </section>
    );
}

function positionMenu(menu: HTMLDivElement, trigger: HTMLButtonElement) {
    const view = menu.ownerDocument.defaultView;
    if (!view) return;
    const anchor = trigger.getBoundingClientRect();
    const header = trigger.closest('.results-header')?.getBoundingClientRect() ?? anchor;
    const below = view.innerHeight - header.bottom - 14;
    const above = header.top - 14;
    menu.style.maxHeight = `${Math.max(0, Math.min(320, Math.max(below, above)))}px`;
    const bounds = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.left, view.innerWidth - bounds.width - 8));
    const top =
        bounds.height <= below ? header.bottom + 6 : Math.max(8, header.top - bounds.height - 6);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
}

function moveMenuFocus(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
        event.currentTarget.querySelectorAll<HTMLButtonElement>(
            '[role="menuitemradio"]:not(:disabled)',
        ),
    );
    if (!items.length) return;
    const current = items.indexOf(
        event.currentTarget.ownerDocument.activeElement as HTMLButtonElement,
    );
    let next: number;
    switch (event.key) {
        case 'ArrowDown':
            next = (current + 1) % items.length;
            break;
        case 'ArrowUp':
            next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
            break;
        case 'Home':
            next = 0;
            break;
        case 'End':
            next = items.length - 1;
            break;
        default:
            return;
    }
    event.preventDefault();
    items[next]?.focus();
}

export function ScriptResultsSelector({
    statements,
    runs,
    activeRunId,
    onSelectRun,
    onSelectError,
    errorSelected,
}: StatementResultsProps) {
    const id = useId();
    const trigger = useRef<HTMLButtonElement>(null);
    const menu = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const byId = new Map(runs.map(run => [run.id, run]));
    const selectedIndex =
        statements.length === 1
            ? 0
            : statements.findIndex(statement =>
                  statement.runId
                      ? !errorSelected && statement.runId === activeRunId
                      : Boolean(statement.error && errorSelected),
              );
    const selected = statements[selectedIndex];
    const selectedSql = selected?.sql.replace(/\s+/g, ' ').trim();
    const failedCount = statements.filter(statement => statement.status === 'failed').length;

    useEffect(() => {
        const element = menu.current;
        const document = element?.ownerDocument;
        const view = document?.defaultView;
        if (!element || !document || !view) return;
        const close = () => {
            if (element.matches(':popover-open')) element.hidePopover();
        };
        const closeOnFocusOutside = (event: FocusEvent) => {
            if (
                !element.contains(event.target as Node) &&
                !trigger.current?.contains(event.target as Node)
            )
                close();
        };
        const reposition = (event: Event) => {
            if (
                element.matches(':popover-open') &&
                !element.contains(event.target as Node) &&
                trigger.current
            )
                positionMenu(element, trigger.current);
        };
        view.addEventListener('resize', close);
        document.addEventListener('focusin', closeOnFocusOutside);
        document.addEventListener('scroll', reposition, true);
        return () => {
            view.removeEventListener('resize', close);
            document.removeEventListener('focusin', closeOnFocusOutside);
            document.removeEventListener('scroll', reposition, true);
        };
    }, [statements.length]);

    if (!statements.length) return null;

    return (
        <span className="script-results-selector">
            <button
                ref={trigger}
                type="button"
                className="script-results-trigger"
                popoverTarget={id}
                aria-label={
                    selected
                        ? `Select a statement result: Statement ${selectedIndex + 1}: ${selected.status}, ${selectedSql}`
                        : 'Select a statement result'
                }
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={id}
                title={selected?.sql}
                onKeyDown={event => {
                    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                    event.preventDefault();
                    menu.current?.showPopover();
                }}
            >
                {selected ? (
                    <>
                        <span className={cx('script-statement-index', `status-${selected.status}`)}>
                            {String(selectedIndex + 1).padStart(2, '0')}
                        </span>
                        <code>{selectedSql}</code>
                    </>
                ) : (
                    <span>Select statement</span>
                )}
                <Icon name="chevron" />
            </button>
            {statements.length > 1 && failedCount > 0 && (
                <span className="script-results-failure" role="status">
                    {failedCount} failed
                </span>
            )}
            <div
                ref={menu}
                id={id}
                className="script-results-menu"
                popover="auto"
                role="menu"
                tabIndex={-1}
                aria-label="Statement results"
                onKeyDown={moveMenuFocus}
                onToggle={event => {
                    const isOpen = event.newState === 'open';
                    setOpen(isOpen);
                    if (!isOpen || !trigger.current) return;
                    positionMenu(event.currentTarget, trigger.current);
                    const items = event.currentTarget.querySelectorAll<HTMLButtonElement>(
                        '[role="menuitemradio"]:not(:disabled)',
                    );
                    const selectedItem = event.currentTarget.querySelector<HTMLButtonElement>(
                        '[aria-checked="true"]:not(:disabled)',
                    );
                    const focusedItem = selectedItem ?? items[0];
                    (focusedItem ?? event.currentTarget).focus({ preventScroll: true });
                    focusedItem?.scrollIntoView({ block: 'nearest' });
                }}
            >
                {statements.map((statement, index) => {
                    const active = index === selectedIndex;
                    const run = statement.runId ? byId.get(statement.runId) : undefined;
                    const details = statementDetails(statement, run);
                    return (
                        <button
                            key={index}
                            type="button"
                            role="menuitemradio"
                            tabIndex={-1}
                            className={cx('script-statement', active && 'is-active')}
                            aria-label={`Statement ${index + 1}: ${statement.status}`}
                            aria-checked={active}
                            title={`${statement.sql.replace(/\s+/g, ' ')} · ${details}`}
                            disabled={!statement.runId && !statement.error}
                            onClick={() => {
                                if (statement.runId) onSelectRun(statement.runId);
                                else onSelectError();
                                menu.current?.hidePopover();
                                trigger.current?.focus();
                            }}
                        >
                            <StatementCardContent
                                statement={statement}
                                index={index}
                                details={details}
                            />
                        </button>
                    );
                })}
            </div>
        </span>
    );
}

export function ScriptCancelAction({
    script,
    onCancel,
    disabled,
    afterCurrentStatement,
}: {
    script: Script;
    onCancel: () => void;
    disabled: boolean;
    afterCurrentStatement: boolean;
}) {
    if (script.status !== 'running') return null;
    if (script.cancelled)
        return (
            <span className="script-cancel-status" role="status">
                {afterCurrentStatement ? 'Stopping after this query…' : 'Cancelling script…'}
            </span>
        );
    return (
        <Button
            variant="danger"
            className="script-cancel-button"
            onClick={onCancel}
            disabled={disabled}
        >
            {afterCurrentStatement ? 'Stop after current statement' : 'Cancel script'}
        </Button>
    );
}
