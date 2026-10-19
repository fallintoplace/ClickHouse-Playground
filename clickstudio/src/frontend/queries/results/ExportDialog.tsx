import { useEffect, useRef } from 'react';
import { DialogHeader } from '../../ui/components/DialogChrome';
import { Icon } from '../../ui/components/icons';

export function ExportDialog({
    open,
    queryAvailable,
    rowsAvailable,
    fullResultAvailable,
    fullResultDisabledReason,
    onClose,
    onExportQuery,
    onExportRows,
    onDownloadFullResult,
}: {
    open: boolean;
    queryAvailable: boolean;
    rowsAvailable: boolean;
    fullResultAvailable: boolean;
    fullResultDisabledReason: string;
    onClose: () => void;
    onExportQuery: () => void;
    onExportRows: () => void;
    onDownloadFullResult: () => void;
}) {
    const dialogRef = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (open && !dialog.open) dialog.showModal();
        if (!open && dialog.open) dialog.close();
    }, [open]);

    return (
        <dialog
            ref={dialogRef}
            aria-labelledby="export-dialog-title"
            data-footer-hint-scope="workspace"
            onCancel={event => {
                event.preventDefault();
                onClose();
            }}
            onClick={event => {
                if (event.target === dialogRef.current) onClose();
            }}
            className="transfer-dialog"
        >
            <DialogHeader
                className="transfer-dialog-header"
                closeLabel="Close export options"
                onClose={onClose}
            >
                <div>
                    <h2
                        id="export-dialog-title"
                        className="transfer-dialog-title dialog-chrome-title"
                    >
                        Export
                    </h2>
                    <p className="transfer-dialog-description dialog-chrome-description">
                        Choose the query or its result rows.
                    </p>
                </div>
            </DialogHeader>
            <div className="transfer-dialog-body grid gap-2 overflow-y-auto">
                <button
                    type="button"
                    data-footer-help="Download the active SQL draft. It is not run."
                    disabled={!queryAvailable}
                    onClick={onExportQuery}
                    className="export-option transfer-dialog-option"
                >
                    <Icon name="documents" className="mt-0.5 shrink-0 text-[var(--accent)]" />
                    <span className="grid gap-1">
                        <strong className="text-sm">Export query (.sql)</strong>
                        <small className="text-xs text-[var(--muted)]">
                            Download the active SQL draft. It is not run.
                        </small>
                    </span>
                </button>
                <span
                    className="block w-full"
                    title={!rowsAvailable ? 'Run a query to export its rows.' : undefined}
                >
                    <button
                        type="button"
                        data-footer-help="Download the rows retained from the latest query result."
                        disabled={!rowsAvailable}
                        onClick={onExportRows}
                        className="export-option transfer-dialog-option w-full"
                    >
                        <Icon name="table" className="mt-0.5 shrink-0 text-[var(--accent)]" />
                        <span className="grid gap-1">
                            <strong className="text-sm">Export retained rows (.csv)</strong>
                            <small className="text-xs text-[var(--muted)]">
                                Download rows from the latest query result.
                            </small>
                        </span>
                    </button>
                </span>
                <span
                    className="block w-full"
                    title={!fullResultAvailable ? fullResultDisabledReason : undefined}
                >
                    <button
                        type="button"
                        data-footer-help="Rerun the query and download its full result."
                        disabled={!fullResultAvailable}
                        aria-describedby={
                            !fullResultAvailable
                                ? 'full-result-download-disabled-reason'
                                : undefined
                        }
                        onClick={onDownloadFullResult}
                        className="export-option transfer-dialog-option w-full"
                    >
                        <Icon name="refresh" className="mt-0.5 shrink-0 text-[var(--accent)]" />
                        <span className="grid gap-1">
                            <strong className="text-sm">Download full result (.csv)</strong>
                            <small className="text-xs text-[var(--muted)]">
                                Reruns the query and downloads all rows.
                            </small>
                        </span>
                    </button>
                </span>
                {!fullResultAvailable && (
                    <span id="full-result-download-disabled-reason" className="sr-only">
                        {fullResultDisabledReason}
                    </span>
                )}
            </div>
        </dialog>
    );
}
