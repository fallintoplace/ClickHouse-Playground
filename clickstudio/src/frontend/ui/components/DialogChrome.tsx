import type { ComponentPropsWithRef, ReactNode, Ref } from 'react';
import { Icon } from './icons';
import { cx } from './primitives';

type DialogCloseButtonProps = Omit<ComponentPropsWithRef<'button'>, 'children' | 'type'> & {
    'aria-label': string;
};

export function DialogCloseButton({ className = '', ...props }: DialogCloseButtonProps) {
    return (
        <button {...props} type="button" className={cx('dialog-chrome-close', className)}>
            <Icon name="close" />
        </button>
    );
}

export function DialogHeader({
    children,
    className = '',
    closeLabel,
    onClose,
    closeDisabled = false,
    closeClassName = '',
    closeRef,
}: {
    children: ReactNode;
    className?: string;
    closeLabel: string;
    onClose: () => void;
    closeDisabled?: boolean;
    closeClassName?: string;
    closeRef?: Ref<HTMLButtonElement>;
}) {
    return (
        <header className={cx('dialog-chrome-header', className)}>
            {children}
            <DialogCloseButton
                ref={closeRef}
                className={closeClassName}
                aria-label={closeLabel}
                title={closeLabel}
                disabled={closeDisabled}
                onClick={onClose}
            />
        </header>
    );
}

export function DialogFooter({
    children,
    className = '',
}: {
    children: ReactNode;
    className?: string;
}) {
    return <footer className={cx('dialog-chrome-footer', className)}>{children}</footer>;
}
