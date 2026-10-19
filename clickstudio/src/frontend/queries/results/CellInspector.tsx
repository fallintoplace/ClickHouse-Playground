import { useEffect, useRef, useState } from 'react';
import type { Json } from '../../../shared/common/values';
import { download } from '../../api/client';
import { useDialogFocus } from '../../ui/focus/useDialogFocus';
import { Icon } from '../../ui/components/icons';
import { Button } from '../../ui/components/primitives';
import { DialogHeader } from '../../ui/components/DialogChrome';
import { copy } from '../../ui/copy';
import { isLargeCellReference } from '../../../shared/queries/results/large-cells';
import { downloadLargeCell, fetchLargeCellText } from './large-cell-actions';

export interface InspectedCell {
    columnName: string;
    columnType: string;
    columnIndex: number;
    rowNumber: number;
    value: Json | undefined;
    largeCellToken?: string;
    largeCellUrl?: string;
}

function cellText(value: Json | undefined, largeCellToken?: string): string {
    if (value === undefined) return 'null';
    if (isLargeCellReference(value, largeCellToken)) return value.preview;
    if (typeof value === 'string') return value;
    return JSON.stringify(value, null, 2);
}

function downloadName(
    columnName: string,
    columnIndex: number,
    rowNumber: number,
    isString: boolean,
): string {
    const safeName = columnName.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    return `${safeName || 'cell'}-column-${columnIndex + 1}-row-${rowNumber}.${isString ? 'txt' : 'json'}`;
}

export function CellInspector({ cell, onClose }: { cell: InspectedCell; onClose: () => void }) {
    const dialog = useRef<HTMLDialogElement>(null);
    const closeButton = useRef<HTMLButtonElement>(null);
    const copyTimer = useRef<number | undefined>(undefined);
    const [copyMessage, setCopyMessage] = useState('');
    const [copied, setCopied] = useState(false);
    const value = cellText(cell.value, cell.largeCellToken);
    const largeCell = isLargeCellReference(cell.value, cell.largeCellToken)
        ? cell.value
        : undefined;
    const isString = typeof cell.value === 'string';
    const copyValue = async () => {
        try {
            const fullValue = largeCell ? await fetchLargeCellText(cell.largeCellUrl ?? '') : value;
            await navigator.clipboard.writeText(fullValue);
            setCopyMessage('');
            setCopied(true);
            if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current);
            copyTimer.current = window.setTimeout(() => {
                setCopied(false);
                copyTimer.current = undefined;
            }, 1200);
        } catch {
            if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current);
            copyTimer.current = undefined;
            setCopied(false);
            setCopyMessage('Couldn’t copy this value.');
        }
    };
    const downloadValue = async () => {
        if (largeCell) {
            if (!cell.largeCellUrl) {
                setCopyMessage('This large cell value is unavailable.');
                return;
            }
            try {
                await downloadLargeCell(cell.largeCellUrl);
                setCopyMessage('Downloaded full value.');
            } catch {
                setCopyMessage('Couldn’t download this value.');
            }
            return;
        }
        download(
            downloadName(cell.columnName, cell.columnIndex, cell.rowNumber, isString),
            value,
            isString ? 'text/plain;charset=utf-8' : 'application/json;charset=utf-8',
        );
    };

    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        element.showModal();
        return () => {
            element.close();
            if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current);
        };
    }, []);
    useDialogFocus(dialog, {
        onClose,
        initialFocus: () => closeButton.current,
    });

    return (
        <dialog
            ref={dialog}
            className="transfer-dialog result-cell-inspector"
            aria-labelledby="result-cell-inspector-title"
            aria-describedby="result-cell-inspector-description"
            onCancel={event => {
                event.preventDefault();
                onClose();
            }}
            onClick={event => {
                if (event.target === dialog.current) onClose();
            }}
        >
            <DialogHeader
                className="transfer-dialog-header"
                closeLabel="Close cell inspector"
                closeClassName="button-base button-ghost"
                onClose={onClose}
                closeRef={closeButton}
            >
                <div>
                    <h2
                        id="result-cell-inspector-title"
                        className="transfer-dialog-title dialog-chrome-title"
                    >
                        {cell.columnName}
                    </h2>
                    <p
                        id="result-cell-inspector-description"
                        className="transfer-dialog-description dialog-chrome-description"
                    >
                        Column {cell.columnIndex + 1} · Row {cell.rowNumber} · {cell.columnType}
                        {largeCell &&
                            ` · Large value · ${(largeCell.bytes / 1_000_000).toFixed(1)} MB`}
                    </p>
                </div>
            </DialogHeader>
            <div className="result-cell-inspector-actions">
                <Button variant="secondary" onClick={() => void copyValue()}>
                    <Icon name="copy" />
                    {copied ? copy.common.copied : 'Copy value'}
                </Button>
                <Button variant="secondary" onClick={() => void downloadValue()}>
                    <Icon name="exportFile" />
                    Download full value
                </Button>
            </div>
            <pre
                className="result-cell-inspector-value"
                aria-label={largeCell ? 'Cell value preview' : 'Full retained cell value'}
            >
                {value}
            </pre>
            <span className="result-cell-inspector-status" role="status" aria-live="polite">
                {copyMessage}
            </span>
        </dialog>
    );
}
