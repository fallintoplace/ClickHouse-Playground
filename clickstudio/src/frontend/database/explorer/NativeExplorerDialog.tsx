import { useRef, type ReactNode } from 'react';
import { DialogHeader } from '../../ui/components/DialogChrome';
import { useDialogFocus } from '../../ui/focus/useDialogFocus';

export function NativeExplorerDialog({
    title,
    description,
    onClose,
    children,
    closeLabel = 'Close explorer',
    eyebrow = 'CLICKHOUSE NATIVE',
    className,
}: {
    className?: string;
    closeLabel?: string;
    eyebrow?: string;
    title: string;
    description?: string;
    onClose: () => void;
    children: ReactNode;
}) {
    const root = useRef<HTMLElement>(null);
    useDialogFocus(root, { onClose });
    return (
        <div className="parts-explorer-layer native-explorer-layer">
            <button
                type="button"
                className="parts-explorer-scrim"
                aria-label={closeLabel}
                onClick={onClose}
            />
            <section
                ref={root}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                className={`parts-explorer-dialog native-dialog${className ? ` ${className}` : ''}`}
            >
                <DialogHeader
                    className="native-heading"
                    closeLabel={closeLabel}
                    closeClassName="button-base button-ghost native-dialog-close"
                    onClose={onClose}
                >
                    <div>
                        <span className="eyebrow">{eyebrow}</span>
                        <h2 className="dialog-chrome-title">{title}</h2>
                        {description && <p className="dialog-chrome-description">{description}</p>}
                    </div>
                </DialogHeader>
                {children}
            </section>
        </div>
    );
}
