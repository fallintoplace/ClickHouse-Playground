import type { ComponentProps } from 'react';
import { CreationDialog } from '../../ui/components/CreationDialog';
import { cx } from '../../ui/components/primitives';

export function FunctionCreationDialog({
    children,
    className,
    ...props
}: ComponentProps<typeof CreationDialog>) {
    return (
        <CreationDialog {...props} className={cx('function-creation-dialog', className)}>
            <div className="function-creation-scroll">{children}</div>
        </CreationDialog>
    );
}
