import { useRef, type ReactNode } from 'react';
import { Button } from '../../ui/components/primitives';
import { useDialogFocus } from '../../ui/focus/useDialogFocus';

export function NativeExplorerDialog({
    title,
    description,
    onClose,
    children,
    closeLabel = 'Close explorer',
}: {
    closeLabel?: string;
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
                className="parts-explorer-dialog native-dialog"
            >
                <header className="native-heading">
                    <div>
                        <span className="eyebrow">CLICKHOUSE NATIVE</span>
                        <h2>{title}</h2>
                        {description && <p>{description}</p>}
                    </div>
                    <Button aria-label={closeLabel} onClick={onClose}>
                        Close ×
                    </Button>
                </header>
                {children}
            </section>
        </div>
    );
}
