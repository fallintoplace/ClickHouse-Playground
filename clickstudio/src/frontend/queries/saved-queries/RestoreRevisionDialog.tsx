import { useEffect, useRef } from 'react';
import { Button } from '../../ui/components/primitives';
import { Icon } from '../../ui/components/icons';

export function RestoreRevisionDialog({
    revision,
    onClose,
    onConfirm,
}: {
    revision?: number;
    onClose: () => void;
    onConfirm: () => void;
}) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const copy = {
        eyebrow: 'VERSION RESTORE',
        version: (value: number) => `Version ${value}`,
        title: (version: number) => `Replace your draft with Version ${version}?`,
        description:
            'This replaces your current unsaved SQL draft. The restored SQL is saved as a new version.',
        selectedVersion: 'Selected version',
        history: 'Your saved versions remain in version history.',
        cancel: 'Keep draft',
        confirm: (version: number) => `Restore Version ${version}`,
        close: 'Close restore confirmation',
    };

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (revision !== undefined && !dialog.open) {
            dialog.showModal();
            dialog
                .querySelector<HTMLButtonElement>('.restore-revision-actions .button-secondary')
                ?.focus();
        } else if (revision === undefined && dialog.open) {
            dialog.close();
        }
    }, [revision]);

    return (
        <dialog
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="restore-revision-title"
            aria-describedby="restore-revision-description"
            className="restore-revision-dialog"
            onCancel={event => {
                event.preventDefault();
                onClose();
            }}
            onClick={event => {
                if (event.target === dialogRef.current) onClose();
            }}
        >
            {revision !== undefined && (
                <div className="restore-revision-content">
                    <div className="restore-revision-topline">
                        <span>{copy.eyebrow}</span>
                        <Button
                            variant="ghost"
                            className="restore-revision-close"
                            aria-label={copy.close}
                            onClick={onClose}
                        >
                            <Icon name="close" />
                        </Button>
                    </div>
                    <div className="restore-revision-title-row">
                        <span className="restore-revision-icon">
                            <Icon name="history" />
                        </span>
                        <div>
                            <h2 id="restore-revision-title">{copy.title(revision)}</h2>
                            <p id="restore-revision-description">{copy.description}</p>
                        </div>
                    </div>
                    <div className="restore-revision-summary">
                        <span>{copy.selectedVersion}</span>
                        <strong>{copy.version(revision)}</strong>
                    </div>
                    <p className="restore-revision-history-note">{copy.history}</p>
                    <div className="restore-revision-actions">
                        <Button variant="secondary" onClick={onClose}>
                            {copy.cancel}
                        </Button>
                        <Button variant="primary" onClick={onConfirm}>
                            {copy.confirm(revision)}
                        </Button>
                    </div>
                </div>
            )}
        </dialog>
    );
}
