import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Run } from '../../../shared/queries/execution/types';
import { Button, cx } from '../../ui/components/primitives';
import { formatBytes, formatCount } from '../../browser/metric-formatters';
import { Icon } from '../../ui/components/icons';
import { Status, terminal } from '../../queries/execution/status';
import type { IconName } from '../../ui/components/icons';
import type { RunEventState } from '../workspace-types';
import type { Copy } from '../../ui/copy';

export type RunAction = {
    id: string;
    label: string;
    disabled?: boolean;
    title?: string;
    description?: string;
    onSelect: () => void;
};

const footerHintTargetSelector =
    '[data-footer-help], button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="menuitem"], [tabindex]:not([tabindex="-1"])';

function readFooterActionHint(element: HTMLElement): string | undefined {
    const describedBy = element
        .getAttribute('aria-describedby')
        ?.split(/\s+/)
        .map(id => document.getElementById(id)?.textContent ?? '')
        .filter(Boolean)
        .join(' ');
    const labelledBy = element
        .getAttribute('aria-labelledby')
        ?.split(/\s+/)
        .map(id => document.getElementById(id)?.textContent ?? '')
        .filter(Boolean)
        .join(' ');
    const visibleLabel = element.matches(
        'button, a[href], [role="button"], [role="tab"], [role="menuitem"]',
    )
        ? element.innerText
        : undefined;
    const hint = [
        element.dataset.footerHelp,
        describedBy,
        element.title,
        labelledBy,
        element.getAttribute('aria-label'),
        element.getAttribute('placeholder'),
        visibleLabel,
    ]
        .find(value => value?.trim())
        ?.replace(/\s+/g, ' ')
        .trim();

    if (!hint) return undefined;
    return hint.length > 360 ? `${hint.slice(0, 357).trimEnd()}…` : hint;
}

function isFooterHintScope(target: EventTarget | null, workspaceRoot: HTMLElement): boolean {
    if (!(target instanceof Element)) return false;
    return (
        workspaceRoot.contains(target) ||
        Boolean(target.closest('[data-footer-hint-scope="workspace"]'))
    );
}

function DisabledRunAction({
    action,
    label,
    descriptionId,
}: {
    action: RunAction;
    label: string;
    descriptionId?: string;
}) {
    return (
        <span
            className="run-option-disabled-anchor"
            role="group"
            tabIndex={0}
            data-footer-help={action.description ?? action.title ?? action.label}
            title={action.title}
            aria-label={`${action.label}: ${action.title}`}
        >
            <Button
                data-testid={`run-action-${action.id}`}
                aria-label={action.label}
                variant="secondary"
                className="run-option-button"
                data-footer-help={action.description ?? action.title ?? action.label}
                disabled
                title={undefined}
                aria-describedby={descriptionId}
                onClick={action.onSelect}
            >
                <RunActionLabel action={action} label={label} descriptionId={descriptionId} />
            </Button>
        </span>
    );
}

function RunActionLabel({
    action,
    label,
    descriptionId,
}: {
    action: RunAction;
    label: string;
    descriptionId?: string;
}) {
    if (!action.description) return label;

    return (
        <span className="run-option-content">
            <span className="run-option-title">{label}</span>
            <span id={descriptionId} className="sr-only">
                {action.description}
            </span>
        </span>
    );
}

export function RunActionGroup({ actions, copy }: { actions: RunAction[]; copy: Copy['common'] }) {
    const descriptionId = useId();
    const explainActions = actions.filter(
        action => action.id === 'explain' || action.id.startsWith('explain-'),
    );
    const otherActions = actions.filter(
        action => action.id !== 'explain' && !action.id.startsWith('explain-'),
    );
    const explainGroupLabel = explainActions[0]?.label.split(/\s+/)[0] ?? '';
    const renderAction = (action: RunAction) => {
        const isExplainAction = action.id === 'explain' || action.id.startsWith('explain-');
        const label = isExplainAction
            ? action.label.replace(/^[^\s]+\s+/, '').toLowerCase()
            : action.label;
        const actionDescriptionId = action.description
            ? `${descriptionId}-${action.id}-description`
            : undefined;
        const content = (
            <RunActionLabel action={action} label={label} descriptionId={actionDescriptionId} />
        );
        if (!action.disabled || !action.title)
            return (
                <Button
                    key={action.id}
                    data-testid={`run-action-${action.id}`}
                    aria-label={action.label}
                    variant="secondary"
                    className="run-option-button"
                    data-footer-help={action.description ?? action.title ?? action.label}
                    disabled={action.disabled}
                    title={action.title ?? action.label}
                    aria-describedby={actionDescriptionId}
                    onClick={action.onSelect}
                >
                    {content}
                </Button>
            );
        return (
            <DisabledRunAction
                key={action.id}
                action={action}
                label={label}
                descriptionId={actionDescriptionId}
            />
        );
    };
    return (
        <div className="run-action-group" role="group" aria-label={copy.runActions}>
            {explainActions.length > 0 && (
                <div className="run-explain-actions" role="group" aria-label={explainGroupLabel}>
                    <span className="run-explain-label" aria-hidden="true">
                        {explainGroupLabel.toLowerCase()}
                    </span>
                    {explainActions.map(renderAction)}
                </div>
            )}
            {otherActions.map(renderAction)}
        </div>
    );
}

export function RailButton({
    icon,
    label,
    active,
    accent,
    disabled,
    testId,
    helpText,
    onClick,
}: {
    icon: IconName;
    label: string;
    active?: boolean;
    accent?: boolean;
    disabled?: boolean;
    testId?: string;
    helpText?: string;
    onClick: () => void;
}) {
    return (
        <button
            className={cx('rail-icon-button', active && 'is-active', accent && 'is-accent')}
            type="button"
            title={label}
            aria-label={label}
            data-footer-help={helpText}
            aria-pressed={active}
            disabled={disabled}
            data-testid={testId}
            onClick={onClick}
        >
            <Icon name={icon} />
            <span className="rail-tooltip">{label}</span>
        </button>
    );
}

export function ExecutionBar({
    run,
    failedAttempt,
    failureInToolbar,
    eventState,
    onOpenDetails,
    scriptRunning,
    serverLabel,
    helpHint,
    helpButton,
    copy,
}: {
    run?: Run;
    failedAttempt?: boolean;
    failureInToolbar?: boolean;
    eventState: RunEventState;
    onOpenDetails?: () => void;
    scriptRunning: boolean;
    serverLabel: string;
    helpHint?: string;
    helpButton: ReactNode;
    copy: Copy['common'];
}) {
    const footerRef = useRef<HTMLElement | null>(null);
    const helpHintRef = useRef<HTMLParagraphElement | null>(null);
    const [actionHelpHint, setActionHelpHint] = useState<string>();
    const currentRun = failedAttempt ? undefined : run;
    const progress = currentRun?.progress;
    const executionInProgress = Boolean(currentRun && (!terminal(currentRun) || scriptRunning));
    let elapsedMs: number | undefined;

    if (currentRun) {
        if (terminal(currentRun)) {
            elapsedMs = Math.round(currentRun.elapsedMs);
        } else {
            elapsedMs = Math.max(0, Math.round(progress?.elapsedMs ?? currentRun.elapsedMs));
        }
    } else {
        elapsedMs = undefined;
    }

    const hasTelemetry = Boolean(
        progress &&
        (progress.readRows !== '' || progress.readBytes !== '' || progress.memory !== undefined),
    );

    const renderCurrentStatus = () => {
        if (failedAttempt) {
            return (
                <span className="execution-ready-state" role="status">
                    <span className="status-light is-error" />
                    {copy.queryFailed}
                </span>
            );
        }

        if (currentRun) {
            return <Status run={currentRun} copy={copy} />;
        }

        return (
            <span className="execution-ready-state">
                <span className="status-light is-trusted" />
                {copy.statusReady}
            </span>
        );
    };
    useEffect(() => {
        if (!helpHint) {
            setActionHelpHint(undefined);
            return;
        }
        const workspaceRoot = footerRef.current?.closest<HTMLElement>('.workspace-root');
        if (!workspaceRoot) return;

        const updateHint = (event: Event) => {
            if (!isFooterHintScope(event.target, workspaceRoot)) return;
            const eventTarget = event.target;
            if (!(eventTarget instanceof Element)) return;
            const action = eventTarget.closest<HTMLElement>(footerHintTargetSelector);
            if (!action || action.closest('.execution-bar')) return;
            const hint = readFooterActionHint(action);
            if (hint) setActionHelpHint(hint);
        };
        const clearHintWhenLeaving = (
            target: EventTarget | null,
            relatedTarget: EventTarget | null,
        ) => {
            if (
                isFooterHintScope(target, workspaceRoot) &&
                !isFooterHintScope(relatedTarget, workspaceRoot)
            ) {
                setActionHelpHint(undefined);
            }
        };
        const clearHintOnPointerOut = (event: PointerEvent) =>
            clearHintWhenLeaving(event.target, event.relatedTarget);
        const clearHintOnFocusOut = (event: FocusEvent) =>
            clearHintWhenLeaving(event.target, event.relatedTarget);

        document.addEventListener('pointerover', updateHint, true);
        document.addEventListener('focusin', updateHint, true);
        document.addEventListener('click', updateHint, true);
        document.addEventListener('pointerout', clearHintOnPointerOut, true);
        document.addEventListener('focusout', clearHintOnFocusOut, true);
        return () => {
            document.removeEventListener('pointerover', updateHint, true);
            document.removeEventListener('focusin', updateHint, true);
            document.removeEventListener('click', updateHint, true);
            document.removeEventListener('pointerout', clearHintOnPointerOut, true);
            document.removeEventListener('focusout', clearHintOnFocusOut, true);
        };
    }, [helpHint]);
    const visibleHelpHint = helpHint ? (actionHelpHint ?? helpHint) : undefined;

    useEffect(() => {
        const element = helpHintRef.current;
        if (!element || !visibleHelpHint) return;

        const minFontSize = 9;
        let measuredWidth = -1;
        const fitHint = (force = false) => {
            const width = element.clientWidth;
            if (!width || (!force && Math.abs(width - measuredWidth) < 0.5)) return;
            measuredWidth = width;

            element.style.removeProperty('font-size');
            let fontSize = Number.parseFloat(getComputedStyle(element).fontSize);
            element.style.fontSize = `${fontSize}px`;
            while (fontSize > minFontSize && element.scrollWidth > width) {
                fontSize = Math.max(minFontSize, fontSize - 0.5);
                element.style.fontSize = `${fontSize}px`;
            }
        };

        const handleWindowResize = () => fitHint(true);
        fitHint(true);
        window.addEventListener('resize', handleWindowResize);

        if (typeof ResizeObserver === 'undefined') {
            return () => window.removeEventListener('resize', handleWindowResize);
        }

        const observer = new ResizeObserver(() => fitHint());
        observer.observe(element);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', handleWindowResize);
        };
    }, [visibleHelpHint]);

    return (
        <footer
            ref={footerRef}
            className={cx('execution-bar', executionInProgress && 'is-running')}
            data-run-status={failedAttempt ? 'failed' : (currentRun?.status ?? 'ready')}
            data-query-id={currentRun?.queryId}
        >
            <div className="execution-state">
                <div className="execution-summary">
                    {!failureInToolbar && renderCurrentStatus()}
                    {currentRun && scriptRunning && (
                        <span className="execution-kind">{copy.runScript.toUpperCase()}</span>
                    )}
                    {currentRun && (
                        <>
                            {!failureInToolbar && <span className="execution-separator" />}
                            <strong>{elapsedMs?.toLocaleString()} ms</strong>
                            {onOpenDetails && (
                                <Button
                                    variant="ghost"
                                    className="execution-details-button"
                                    data-testid="execution-details"
                                    aria-label="Execution details"
                                    title="Open execution details"
                                    onClick={onOpenDetails}
                                >
                                    Details
                                </Button>
                            )}
                        </>
                    )}
                </div>
                <span className="execution-server-version" data-testid="server-version">
                    {serverLabel}
                </span>
                {currentRun && eventState !== 'idle' && (
                    <span className="execution-link-state">
                        <span
                            className={cx(
                                'status-light',
                                eventState === 'live' ? 'is-trusted' : 'is-warning',
                            )}
                        />
                        {eventState === 'live' ? copy.statusLiveUpdates : copy.statusReconnecting}
                    </span>
                )}
            </div>
            {currentRun && hasTelemetry && (
                <div className="execution-telemetry">
                    {progress?.readRows !== undefined && progress.readRows !== '' && (
                        <span>
                            <strong>{formatCount(progress.readRows)}</strong> {copy.rowsRead}
                        </span>
                    )}
                    {progress?.readBytes !== undefined && progress.readBytes !== '' && (
                        <span>
                            <strong>{formatBytes(progress.readBytes)}</strong> {copy.bytesRead}
                        </span>
                    )}
                    {progress?.memory !== undefined && progress.memory !== '' && (
                        <span>
                            <strong>{formatBytes(progress.memory)}</strong> {copy.memory}
                        </span>
                    )}
                </div>
            )}
            <div className="execution-right">
                {visibleHelpHint && (
                    <p
                        ref={helpHintRef}
                        className="execution-help-hint"
                        title={visibleHelpHint}
                    >
                        {visibleHelpHint}
                    </p>
                )}
                {helpButton}
            </div>
            {executionInProgress && <span className="execution-progress-line" />}
        </footer>
    );
}
