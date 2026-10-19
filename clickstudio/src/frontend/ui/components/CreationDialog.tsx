import { useEffect, useId, useRef, type FormEvent, type ReactNode, type RefObject } from 'react';
import { useDialogFocus } from '../focus/useDialogFocus';
import { DialogFooter, DialogHeader } from './DialogChrome';
import { cx } from './primitives';

function outsideDialog(dialog: HTMLDialogElement, x: number, y: number) {
    const bounds = dialog.getBoundingClientRect();
    return x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom;
}

export function CreationDialog({
    title,
    description,
    closeLabel,
    className,
    busy,
    initialFocus,
    onClose,
    onSubmit,
    children,
    footer,
}: {
    title: string;
    description: ReactNode;
    closeLabel: string;
    className: string;
    busy: boolean;
    initialFocus: RefObject<HTMLElement | null>;
    onClose: () => void;
    onSubmit: (event: FormEvent<HTMLFormElement>) => void;
    children: ReactNode;
    footer: ReactNode;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const backdropPress = useRef(false);
    const id = useId();
    useDialogFocus(dialog, { onClose, canClose: !busy });

    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        element.showModal();
        initialFocus.current?.focus({ preventScroll: true });
        return () => element.close();
    }, [initialFocus]);

    return (
        <dialog
            ref={dialog}
            className={cx('creation-dialog', className)}
            aria-labelledby={`${id}-title`}
            aria-describedby={`${id}-description`}
            onCancel={event => {
                if (event.target !== event.currentTarget) return;
                event.preventDefault();
                if (!busy) onClose();
            }}
            onPointerDown={event => {
                backdropPress.current =
                    !busy &&
                    event.button === 0 &&
                    event.target === event.currentTarget &&
                    outsideDialog(event.currentTarget, event.clientX, event.clientY);
            }}
            onPointerCancel={() => {
                backdropPress.current = false;
            }}
            onClick={event => {
                const dismiss =
                    backdropPress.current &&
                    event.target === event.currentTarget &&
                    outsideDialog(event.currentTarget, event.clientX, event.clientY);
                backdropPress.current = false;
                if (dismiss && !busy) onClose();
            }}
        >
            <form className="creation-dialog-layout" onSubmit={onSubmit} aria-busy={busy}>
                <DialogHeader
                    className="creation-dialog-header"
                    closeLabel={closeLabel}
                    closeDisabled={busy}
                    closeClassName="creation-dialog-close"
                    onClose={onClose}
                >
                    <div className="creation-dialog-heading">
                        <h2
                            id={`${id}-title`}
                            className="creation-dialog-title dialog-chrome-title"
                        >
                            {title}
                        </h2>
                        <p
                            id={`${id}-description`}
                            className="creation-dialog-description dialog-chrome-description"
                        >
                            {description}
                        </p>
                    </div>
                </DialogHeader>
                <fieldset className="creation-dialog-content" disabled={busy}>
                    {children}
                </fieldset>
                <DialogFooter className="creation-dialog-footer">{footer}</DialogFooter>
            </form>
        </dialog>
    );
}
