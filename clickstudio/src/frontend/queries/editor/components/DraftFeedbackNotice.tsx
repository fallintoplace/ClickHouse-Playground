import { useEffect, useId, useRef, useState } from 'react';
import { WorkspaceInlineNotice } from '../../../workspace/layout/notifications/WorkspaceInlineNotice';
import type { DraftFeedback } from '../../../workspace/layout/notifications/useDraftFeedback';

function positionPanel(element: HTMLDivElement, trigger: HTMLButtonElement) {
    const view = element.ownerDocument.defaultView;
    if (!view || !element.matches(':popover-open')) return;
    const anchor = trigger.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(anchor.right - bounds.width, view.innerWidth - bounds.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(anchor.bottom + 6, view.innerHeight - bounds.height - 8))}px`;
}

export function DraftFeedbackNotice({
    feedback,
    onDismiss,
}: {
    feedback: DraftFeedback;
    onDismiss: () => void;
}) {
    const id = useId();
    const trigger = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const operation = feedback.source === 'save' ? 'Save' : 'Restore';
    let label = `Check ${feedback.source}`;
    if (feedback.tone === 'info') label = 'Version restored';
    if (feedback.tone === 'error') label = `${operation} failed`;
    useEffect(() => {
        const element = panel.current;
        const view = element?.ownerDocument.defaultView;
        if (!element || !view) return;
        const close = () => {
            if (element.matches(':popover-open')) element.hidePopover();
        };
        const observer = new ResizeObserver(() => {
            if (trigger.current) positionPanel(element, trigger.current);
        });
        observer.observe(element);
        view.addEventListener('resize', close);
        return () => {
            observer.disconnect();
            view.removeEventListener('resize', close);
        };
    }, []);
    return (
        <span className={`draft-feedback-control is-${feedback.tone}`}>
            <button
                type="button"
                className="button-base button-ghost toolbar-small draft-feedback-button"
                ref={trigger}
                popoverTarget={id}
                aria-expanded={open}
                aria-haspopup="dialog"
                aria-label={label}
                title={feedback.message}
            >
                <span role={feedback.tone === 'info' ? 'status' : 'alert'}>{label}</span>
            </button>
            <div
                id={id}
                ref={panel}
                className="draft-feedback-popover"
                popover="auto"
                role="dialog"
                aria-label={`${operation} details`}
                tabIndex={-1}
                onToggle={event => {
                    const opened = event.newState === 'open';
                    setOpen(opened);
                    if (!opened || !trigger.current) return;
                    const element = event.currentTarget;
                    positionPanel(element, trigger.current);
                    element.focus({ preventScroll: true });
                }}
            >
                <WorkspaceInlineNotice feedback={feedback} active={open} onDismiss={onDismiss} />
            </div>
        </span>
    );
}
