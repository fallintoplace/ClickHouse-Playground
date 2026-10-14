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
    onSelect: () => void;
};

function DisabledRunAction({ action, label }: { action: RunAction; label: string }) {
    return (
        <span
            className="run-option-disabled-anchor"
            role="group"
            tabIndex={0}
            title={action.title}
            aria-label={`${action.label}: ${action.title}`}
        >
            <Button
                data-testid={`run-action-${action.id}`}
                aria-label={action.label}
                variant="secondary"
                className="run-option-button"
                disabled
                title={undefined}
                onClick={action.onSelect}
            >
                {label}
            </Button>
        </span>
    );
}

export function RunActionGroup({ actions, copy }: { actions: RunAction[]; copy: Copy['common'] }) {
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
        if (!action.disabled || !action.title)
            return (
                <Button
                    key={action.id}
                    data-testid={`run-action-${action.id}`}
                    aria-label={action.label}
                    variant="secondary"
                    className="run-option-button"
                    disabled={action.disabled}
                    title={action.title ?? action.label}
                    onClick={action.onSelect}
                >
                    {label}
                </Button>
            );
        return <DisabledRunAction key={action.id} action={action} label={label} />;
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
    onClick,
}: {
    icon: IconName;
    label: string;
    active?: boolean;
    accent?: boolean;
    disabled?: boolean;
    testId?: string;
    onClick: () => void;
}) {
    return (
        <button
            className={cx('rail-icon-button', active && 'is-active', accent && 'is-accent')}
            type="button"
            title={label}
            aria-label={label}
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
    helpButton: ReactNode;
    copy: Copy['common'];
}) {
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
    return (
        <footer
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
            {currentRun && (hasTelemetry || currentRun.kind !== 'query') && (
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
                    {currentRun.kind !== 'query' && (
                        <span className="execution-kind">{currentRun.kind.toUpperCase()}</span>
                    )}
                </div>
            )}
            <div className="execution-right">{helpButton}</div>
            {executionInProgress && <span className="execution-progress-line" />}
        </footer>
    );
}
