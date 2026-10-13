import { useRef, useState, type FormEvent } from 'react';
import { dropClickHouseCloudFunction } from '../connections/cloud-connection';
import { message } from '../../api/client';
import { CreationDialog } from '../../ui/components/CreationDialog';
import { Icon } from '../../ui/components/icons';

export function DeleteSqlFunctionDialog({
    name,
    onClose,
    onDeleted,
}: {
    name: string;
    onClose: () => void;
    onDeleted: (name: string) => void;
}) {
    const input = useRef<HTMLInputElement>(null);
    const [confirmation, setConfirmation] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (busy || confirmation !== name) return;
        setBusy(true);
        setError('');
        try {
            await dropClickHouseCloudFunction(name, confirmation);
            onDeleted(name);
        } catch (error) {
            setError(
                `${message(error)} Refresh Functions to check whether deletion succeeded before retrying.`,
            );
        } finally {
            setBusy(false);
        }
    };
    return (
        <CreationDialog
            className="sql-function-delete-dialog"
            title="Delete function"
            description={
                <>
                    Delete <code>{name}</code> across all databases. This cannot be undone.
                </>
            }
            closeLabel="Close Delete function"
            busy={busy}
            initialFocus={input}
            onClose={onClose}
            onSubmit={event => void submit(event)}
            footer={
                <>
                    <button
                        type="button"
                        className="creation-dialog-button"
                        disabled={busy}
                        onClick={onClose}
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        className="creation-dialog-button is-danger"
                        disabled={busy || confirmation !== name}
                    >
                        <Icon name="trash" />
                        {busy ? 'Deleting…' : 'Delete function'}
                    </button>
                </>
            }
        >
            <label className="creation-dialog-field">
                <span>
                    Type <code>{name}</code> to confirm
                </span>
                <input
                    ref={input}
                    className="creation-dialog-control"
                    aria-label={`Type ${name} to confirm`}
                    autoComplete="off"
                    spellCheck={false}
                    value={confirmation}
                    onChange={event => {
                        setConfirmation(event.target.value);
                        setError('');
                    }}
                />
            </label>
            {error && (
                <p className="sql-function-error" role="alert">
                    {error}
                </p>
            )}
        </CreationDialog>
    );
}
