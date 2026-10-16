import { useEffect, useRef, useState } from 'react';
import type { Json } from '../../../shared/common/values';
import { download } from '../../api/client';
import { useDialogFocus } from '../../ui/focus/useDialogFocus';
import { Icon } from '../../ui/components/icons';
import { Button } from '../../ui/components/primitives';

export interface InspectedCell {
    columnName: string;
    columnType: string;
    columnIndex: number;
    rowNumber: number;
    value: Json | undefined;
}

function cellText(value: Json | undefined): string {
    if (value === undefined) return 'null';
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
    const [copyMessage, setCopyMessage] = useState('');
    const value = cellText(cell.value);
    const isString = typeof cell.value === 'string';
    const copyValue = async () => {
        try {
            await navigator.clipboard.writeText(value);
            setCopyMessage('Copied full value.');
        } catch {
            setCopyMessage('Copy is unavailable in this browser.');
        }
    };

    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        element.showModal();
        return () => element.close();
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
            <header className="transfer-dialog-header">
                <div>
                    <h2 id="result-cell-inspector-title" className="transfer-dialog-title">
                        {cell.columnName}
                    </h2>
                    <p
                        id="result-cell-inspector-description"
                        className="transfer-dialog-description"
                    >
                        Column {cell.columnIndex + 1} · Row {cell.rowNumber} · {cell.columnType}
                    </p>
                </div>
                <button
                    type="button"
                    ref={closeButton}
                    className="button-base button-ghost"
                    aria-label="Close cell inspector"
                    onClick={onClose}
                >
                    <Icon name="close" />
                </button>
            </header>
            <div className="result-cell-inspector-actions">
                <Button variant="secondary" onClick={() => void copyValue()}>
                    <Icon name="copy" />
                    Copy value
                </Button>
                <Button
                    variant="secondary"
                    onClick={() =>
                        download(
                            downloadName(
                                cell.columnName,
                                cell.columnIndex,
                                cell.rowNumber,
                                isString,
                            ),
                            value,
                            isString
                                ? 'text/plain;charset=utf-8'
                                : 'application/json;charset=utf-8',
                        )
                    }
                >
                    <Icon name="exportFile" />
                    Download full value
                </Button>
            </div>
            <pre className="result-cell-inspector-value" aria-label="Full retained cell value">
                {value}
            </pre>
            <span className="result-cell-inspector-status" role="status" aria-live="polite">
                {copyMessage}
            </span>
        </dialog>
    );
}
