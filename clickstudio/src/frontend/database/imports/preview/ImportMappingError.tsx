import { useEffect, useRef } from 'react';
import { Icon } from '../../../ui/components/icons';

export function ImportMappingError({
    id,
    source,
    message,
}: {
    id: string;
    source: string;
    message: string;
}) {
    const trigger = useRef<HTMLButtonElement>(null);
    const tooltip = useRef<HTMLDivElement>(null);
    const hide = () => {
        if (tooltip.current?.matches(':popover-open')) tooltip.current.hidePopover();
    };
    const show = () => {
        const button = trigger.current;
        const panel = tooltip.current;
        const view = panel?.ownerDocument.defaultView;
        if (!button || !panel || !view) return;
        if (!panel.matches(':popover-open')) panel.showPopover();
        const anchor = button.getBoundingClientRect();
        const bounds = panel.getBoundingClientRect();
        panel.style.left = `${Math.max(8, Math.min(anchor.right - bounds.width, view.innerWidth - bounds.width - 8))}px`;
        const top =
            anchor.bottom + 6 + bounds.height <= view.innerHeight - 8
                ? anchor.bottom + 6
                : anchor.top - bounds.height - 6;
        panel.style.top = `${Math.max(8, top)}px`;
    };

    useEffect(() => {
        const panel = tooltip.current;
        const document = panel?.ownerDocument;
        const view = document?.defaultView;
        if (!panel || !document || !view) return;
        const close = () => {
            if (panel.matches(':popover-open')) panel.hidePopover();
        };
        view.addEventListener('resize', close);
        document.addEventListener('scroll', close, true);
        return () => {
            view.removeEventListener('resize', close);
            document.removeEventListener('scroll', close, true);
        };
    }, []);

    return (
        <>
            <button
                ref={trigger}
                type="button"
                className="import-mapping-error-trigger"
                aria-label={`Mapping error for ${source}`}
                aria-describedby={id}
                onMouseEnter={show}
                onMouseLeave={() => {
                    if (trigger.current?.ownerDocument.activeElement !== trigger.current) hide();
                }}
                onFocus={show}
                onBlur={hide}
                onClick={show}
                onKeyDown={event => {
                    if (event.key !== 'Escape' || !tooltip.current?.matches(':popover-open'))
                        return;
                    event.preventDefault();
                    event.stopPropagation();
                    hide();
                }}
            >
                <Icon name="warning" />
            </button>
            <span id={id} role="alert" className="sr-only">
                {message}
            </span>
            <div
                ref={tooltip}
                className="import-mapping-error-tooltip"
                popover="manual"
                role="tooltip"
            >
                {message}
            </div>
        </>
    );
}
