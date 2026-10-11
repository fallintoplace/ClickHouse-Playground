import { useEffect, useRef, type RefObject } from 'react';

type DialogFocusOptions = {
    open?: boolean;
    onClose: () => void;
    canClose?: boolean;
    restoreFocus?: boolean;
    initialFocus?: (root: HTMLElement) => HTMLElement | null | undefined;
};

const dialogs: HTMLElement[] = [];
const controlSelector =
    'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex], [contenteditable="true"]';

function dialogControls(root: HTMLElement) {
    const controls = [...root.querySelectorAll<HTMLElement>(controlSelector)].filter(
        element =>
            !(
                element.tabIndex < 0 ||
                element.matches(':disabled') ||
                element.closest('[hidden], [inert]') ||
                !element.getClientRects().length ||
                element.ownerDocument.defaultView?.getComputedStyle(element).visibility === 'hidden'
            ),
    );
    return controls.filter(element => {
        if (!element.matches('input[type="radio"][name]')) return true;
        const radio = element as HTMLInputElement;
        if (!radio.name) return true;
        const group = controls.filter(
            (candidate): candidate is HTMLInputElement =>
                candidate.matches('input[type="radio"]') &&
                (candidate as HTMLInputElement).name === radio.name &&
                (candidate as HTMLInputElement).form === radio.form,
        );
        return radio === (group.find(candidate => candidate.checked) ?? group[0]);
    });
}

export function useDialogFocus(
    rootRef: RefObject<HTMLElement | null>,
    options: DialogFocusOptions,
) {
    const latest = useRef(options);
    latest.current = options;
    const open = options.open ?? true;

    useEffect(() => {
        const root = rootRef.current;
        if (!open || !root) return;
        const document = root.ownerDocument;
        const previous = document.activeElement;
        dialogs.push(root);
        (latest.current.initialFocus?.(root) ?? root).focus({ preventScroll: true });

        const keydown = (event: KeyboardEvent) => {
            if (
                event.defaultPrevented ||
                dialogs.filter(dialog => dialog.ownerDocument === document).at(-1) !== root
            )
                return;
            if (event.key === 'Escape' && latest.current.canClose !== false) {
                event.preventDefault();
                event.stopPropagation();
                latest.current.onClose();
                return;
            }
            if (event.key !== 'Tab') return;
            const controls = dialogControls(root);
            const first = controls[0];
            const last = controls.at(-1);
            const active = document.activeElement;
            if (!first || !last) {
                event.preventDefault();
                root.focus({ preventScroll: true });
            } else if (!controls.some(control => control === active)) {
                event.preventDefault();
                (event.shiftKey ? last : first).focus({ preventScroll: true });
            } else if (event.shiftKey && active === first) {
                event.preventDefault();
                last.focus({ preventScroll: true });
            } else if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus({ preventScroll: true });
            }
        };
        document.addEventListener('keydown', keydown);
        return () => {
            document.removeEventListener('keydown', keydown);
            dialogs.splice(dialogs.indexOf(root), 1);
            if (
                latest.current.restoreFocus !== false &&
                previous?.isConnected &&
                'focus' in previous &&
                typeof previous.focus === 'function'
            )
                previous.focus({ preventScroll: true });
        };
    }, [open, rootRef]);
}
