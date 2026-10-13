import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../../../ui/components/icons';
import type { ObjectExplorerProps } from './tree/object-explorer-types';
import type { SchemaTable } from '../../../../shared/database/schema/types';

type ObjectActionsMenuProps = {
    trusted: boolean;
    copy: ObjectExplorerProps['copy'];
} & (
    | {
          kind: 'database';
          database: string;
          onCreateTable: () => void;
      }
    | {
          kind: 'table';
          table: SchemaTable;
          canInsertRow: boolean;
          canDeleteTable: boolean;
          onInsertRow: () => void;
          onDeleteTable: () => void;
      }
);

export function ObjectActionsMenu(props: ObjectActionsMenuProps) {
    const id = useId();
    const trigger = useRef<HTMLButtonElement>(null);
    const menu = useRef<HTMLDivElement>(null);
    const restoreFocusOnClose = useRef(false);
    const [open, setOpen] = useState(false);
    const { trusted, copy } = props;
    const qualifiedName =
        props.kind === 'database'
            ? props.database
            : `${props.table.database}.${props.table.name}`;

    const close = (restoreFocus: boolean) => {
        restoreFocusOnClose.current = restoreFocus;
        const element = menu.current;
        if (element?.matches(':popover-open')) element.hidePopover();
        else setOpen(false);
        if (!element?.matches(':popover-open') && restoreFocus)
            trigger.current?.focus({ preventScroll: true });
    };

    const show = () => {
        const element = menu.current;
        if (!element) return;
        if (element.matches(':popover-open')) {
            close(true);
            return;
        }
        restoreFocusOnClose.current = false;
        element.showPopover();
    };

    useEffect(() => {
        const element = menu.current;
        const document = element?.ownerDocument;
        const view = document?.defaultView;
        if (!element || !document || !view) return;
        const dismiss = () => {
            if (!element.matches(':popover-open')) return;
            restoreFocusOnClose.current = false;
            element.hidePopover();
        };
        const dismissOnFocusOutside = (event: FocusEvent) => {
            if (
                !event.composedPath().includes(element) &&
                (!trigger.current || !event.composedPath().includes(trigger.current))
            )
                dismiss();
        };
        const avoidRestoreAfterOutsidePointer = (event: PointerEvent) => {
            if (
                !event.composedPath().includes(element) &&
                (!trigger.current || !event.composedPath().includes(trigger.current))
            )
                restoreFocusOnClose.current = false;
        };
        view.addEventListener('resize', dismiss);
        document.addEventListener('scroll', dismiss, true);
        document.addEventListener('focusin', dismissOnFocusOutside);
        document.addEventListener('pointerdown', avoidRestoreAfterOutsidePointer, true);
        return () => {
            view.removeEventListener('resize', dismiss);
            document.removeEventListener('scroll', dismiss, true);
            document.removeEventListener('focusin', dismissOnFocusOutside);
            document.removeEventListener('pointerdown', avoidRestoreAfterOutsidePointer, true);
        };
    }, []);

    const moveMenuFocus = (event: KeyboardEvent<HTMLDivElement>) => {
        const items = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role="menuitem"]:not(:disabled)',
            ),
        );
        if (!items.length) return;
        const active = event.currentTarget.ownerDocument.activeElement;
        const current = active instanceof HTMLButtonElement ? items.indexOf(active) : -1;
        let next: number | undefined;
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
            case 'Escape':
                event.preventDefault();
                event.stopPropagation();
                close(true);
                return;
        }
        if (next === undefined) return;
        event.preventDefault();
        items[next]?.focus();
    };

    const runAction = (action: () => void) => {
        close(false);
        action();
    };

    return (
        <div className="object-actions">
            <button
                ref={trigger}
                type="button"
                className="object-actions-trigger"
                aria-label={`Actions for ${qualifiedName}`}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={id}
                popoverTarget={id}
                title={`Actions for ${qualifiedName}`}
                onPointerDown={() => {
                    if (menu.current?.matches(':popover-open'))
                        restoreFocusOnClose.current = true;
                }}
                onKeyDown={event => {
                    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                    event.preventDefault();
                    show();
                }}
            >
                <Icon name="more" />
            </button>
            <div
                ref={menu}
                id={id}
                className="object-actions-menu"
                popover="auto"
                role="menu"
                aria-label={`Actions for ${qualifiedName}`}
                onKeyDown={moveMenuFocus}
                onToggle={event => {
                    const isOpen = event.newState === 'open';
                    setOpen(isOpen);
                    if (isOpen && trigger.current) {
                        const openedMenu = event.currentTarget;
                        positionMenu(openedMenu, trigger.current);
                        const view = openedMenu.ownerDocument.defaultView;
                        view?.requestAnimationFrame(() => {
                            if (!openedMenu.matches(':popover-open')) return;
                            openedMenu
                                .querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
                                ?.focus({ preventScroll: true });
                        });
                    } else if (!isOpen && restoreFocusOnClose.current) {
                        trigger.current?.focus({ preventScroll: true });
                    }
                    if (!isOpen) restoreFocusOnClose.current = false;
                }}
            >
                {props.kind === 'database' && (
                    <button
                        type="button"
                        role="menuitem"
                        tabIndex={-1}
                        disabled={!trusted}
                        title={!trusted ? copy.runActionTrustRequired : undefined}
                        onClick={() => runAction(props.onCreateTable)}
                    >
                        <Icon name="plus" />
                        {copy.newTable}
                    </button>
                )}
                {props.kind === 'table' && props.canInsertRow && (
                    <button
                        type="button"
                        role="menuitem"
                        tabIndex={-1}
                        disabled={!trusted}
                        title={!trusted ? copy.runActionTrustRequired : undefined}
                        onClick={() => runAction(props.onInsertRow)}
                    >
                        <Icon name="plus" />
                        {copy.insertRow}
                    </button>
                )}
                {props.kind === 'table' && props.canDeleteTable && (
                    <button
                        type="button"
                        role="menuitem"
                        tabIndex={-1}
                        className="is-danger"
                        disabled={!trusted}
                        title={!trusted ? copy.runActionTrustRequired : undefined}
                        onClick={() => runAction(props.onDeleteTable)}
                    >
                        <Icon name="trash" />
                        {copy.deleteTable}
                    </button>
                )}
            </div>
        </div>
    );
}

function positionMenu(menu: HTMLDivElement, trigger: HTMLButtonElement) {
    const view = menu.ownerDocument.defaultView;
    if (!view) return;
    const anchor = trigger.getBoundingClientRect();
    const bounds = menu.getBoundingClientRect();
    const left = Math.max(
        8,
        Math.min(anchor.right - bounds.width, view.innerWidth - bounds.width - 8),
    );
    const below = view.innerHeight - anchor.bottom - 8;
    const top =
        bounds.height <= below ? anchor.bottom + 4 : Math.max(8, anchor.top - bounds.height - 4);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
}
