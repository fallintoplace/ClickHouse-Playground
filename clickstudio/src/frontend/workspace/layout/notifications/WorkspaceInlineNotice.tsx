import { useCallback, useEffect, useRef, useState } from 'react';
import {
    WORKSPACE_NOTIFICATION_TIMEOUT_MS,
    type WorkspaceFeedback,
} from './useWorkspaceNotifications';
import { Button, cx } from '../../../ui/components/primitives';
import { Icon } from '../../../ui/components/icons';

export function WorkspaceInlineNotice({
    feedback,
    onRetry,
    onDismiss,
    active = true,
}: {
    feedback?: WorkspaceFeedback;
    onRetry?: () => void;
    onDismiss?: () => void;
    active?: boolean;
}) {
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const [dismissedKey, setDismissedKey] = useState<string>();
    const noticeKey = feedback
        ? `${feedback.tone}\u0000${feedback.message}\u0000${feedback.detail ?? ''}`
        : undefined;
    const timerState = useRef<{ noticeKey?: string; remainingMs: number }>({
        noticeKey,
        remainingMs: WORKSPACE_NOTIFICATION_TIMEOUT_MS,
    });
    if (timerState.current.noticeKey !== noticeKey) {
        timerState.current = {
            noticeKey,
            remainingMs: WORKSPACE_NOTIFICATION_TIMEOUT_MS,
        };
    }

    const dismiss = useCallback(() => {
        if (noticeKey) setDismissedKey(noticeKey);
        onDismiss?.();
    }, [noticeKey, onDismiss]);

    useEffect(() => {
        if (!noticeKey || !active || hovered || focused || dismissedKey === noticeKey) return;

        const state = timerState.current;
        const started = performance.now();
        const timer = window.setTimeout(dismiss, state.remainingMs);
        return () => {
            window.clearTimeout(timer);
            state.remainingMs = Math.max(0, state.remainingMs - (performance.now() - started));
        };
    }, [noticeKey, active, hovered, focused, dismissedKey, dismiss]);

    useEffect(() => {
        setDismissedKey(current => (current === noticeKey ? current : undefined));
    }, [noticeKey]);

    if (!feedback) return null;
    if (dismissedKey === noticeKey) return null;
    return (
        <div
            className={cx('workspace-inline-notice', `is-${feedback.tone}`)}
            role={feedback.tone === 'info' ? 'status' : 'alert'}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocusCapture={() => setFocused(true)}
            onBlurCapture={event => {
                if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
            }}
        >
            <div className="workspace-inline-notice-content">
                <p>{feedback.message}</p>
                {feedback.detail && (
                    <details>
                        <summary>Details</summary>
                        <pre>{feedback.detail}</pre>
                    </details>
                )}
            </div>
            {(onRetry || feedback.retry) && (
                <Button
                    variant="secondary"
                    className="toolbar-small"
                    onClick={onRetry ?? feedback.retry}
                >
                    Retry
                </Button>
            )}
            <button
                type="button"
                className="workspace-inline-dismiss"
                onClick={dismiss}
                aria-label={
                    {
                        error: 'Dismiss error',
                        warning: 'Dismiss warning',
                        info: 'Dismiss message',
                    }[feedback.tone]
                }
            >
                <Icon name="close" />
            </button>
        </div>
    );
}
