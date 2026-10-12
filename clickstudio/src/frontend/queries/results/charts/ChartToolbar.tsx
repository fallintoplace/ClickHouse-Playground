import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from '../../../ui/components/primitives';
import { Icon } from '../../../ui/components/icons';

function positionPopover(element: HTMLDivElement, button: HTMLButtonElement) {
    const view = element.ownerDocument.defaultView;
    if (!view) return;
    const anchor = button.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.left, view.innerWidth - bounds.width - 8));
    const top =
        anchor.bottom + 6 + bounds.height <= view.innerHeight - 8
            ? anchor.bottom + 6
            : Math.max(8, anchor.top - bounds.height - 6);
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
}

export function ChartPopover({
    label,
    closeLabel,
    trigger,
    children,
    controlLabel,
}: {
    label: string;
    closeLabel: string;
    trigger: ReactNode;
    children: ReactNode;
    controlLabel?: string;
}) {
    const id = useId();
    const button = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const element = panel.current;
        const document = element?.ownerDocument;
        const view = document?.defaultView;
        if (!element || !document || !view) return;
        const close = () => {
            if (element.matches(':popover-open')) element.hidePopover();
        };
        const positionOnScroll = (event: Event) => {
            if (
                element.matches(':popover-open') &&
                button.current &&
                !event.composedPath().includes(element)
            )
                positionPopover(element, button.current);
        };
        const closeOnFocusOutside = (event: FocusEvent) => {
            if (
                !event.composedPath().includes(element) &&
                (!button.current || !event.composedPath().includes(button.current))
            )
                close();
        };
        view.addEventListener('resize', close);
        document.addEventListener('scroll', positionOnScroll, true);
        document.addEventListener('focusin', closeOnFocusOutside);
        return () => {
            view.removeEventListener('resize', close);
            document.removeEventListener('scroll', positionOnScroll, true);
            document.removeEventListener('focusin', closeOnFocusOutside);
        };
    }, []);

    return (
        <span className="chart-popover-control">
            {controlLabel && (
                <span className="chart-control-label" aria-hidden="true">
                    {controlLabel}
                </span>
            )}
            <button
                ref={button}
                type="button"
                className="button-base button-secondary chart-popover-trigger"
                popoverTarget={id}
                aria-label={label}
                aria-haspopup="dialog"
                title={label}
            >
                {trigger}
                <Icon name="chevron" />
            </button>
            <div
                ref={panel}
                id={id}
                className="chart-popover"
                popover="auto"
                role="dialog"
                aria-label={label}
                tabIndex={-1}
                onToggle={event => {
                    if (event.newState !== 'open' || !button.current) return;
                    const element = event.currentTarget;
                    positionPopover(element, button.current);
                    (
                        element.querySelector<HTMLElement>(
                            '[role="combobox"]:not([aria-disabled="true"]), input:not(:disabled, [type="search"]), select:not(:disabled)',
                        ) ?? element
                    ).focus({ preventScroll: true });
                }}
            >
                <div className="chart-popover-heading">
                    <strong>{label}</strong>
                    <Button
                        variant="ghost"
                        aria-label={`${closeLabel} ${label}`}
                        popoverTarget={id}
                        popoverTargetAction="hide"
                    >
                        <Icon name="close" />
                    </Button>
                </div>
                {children}
            </div>
        </span>
    );
}

export function ChartToolbar({ children }: { children: ReactNode }) {
    return (
        <div className="chart-toolbar">
            <div className="chart-controls">{children}</div>
        </div>
    );
}
