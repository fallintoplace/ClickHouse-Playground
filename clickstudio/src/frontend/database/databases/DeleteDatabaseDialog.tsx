import { useEffect, useRef, useState, type FormEvent } from 'react';
import { isDatabaseDrop } from '../../../shared/database/databases/delete-database';
import { api, message } from '../../api/client';
import { CreationDialog } from '../../ui/components/CreationDialog';
import { Icon } from '../../ui/components/icons';
import type { Connected } from '../../workspace/workspace-types';
import {
    CLICKHOUSE_CLOUD_CONNECTION_ID,
    dropClickHouseCloudDatabase,
} from '../connections/cloud-connection';

export function DeleteDatabaseDialog({
    connection,
    database,
    onClose,
    onDeleted,
}: {
    connection: Connected;
    database: string;
    onClose: () => void;
    onDeleted: (database: string) => void;
}) {
    const input = useRef<HTMLInputElement>(null);
    const mounted = useRef(false);
    const pending = useRef(false);
    const [confirmation, setConfirmation] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (pending.current || confirmation !== database) return;
        pending.current = true;
        setBusy(true);
        setError('');
        try {
            if (connection.id === CLICKHOUSE_CLOUD_CONNECTION_ID) {
                await dropClickHouseCloudDatabase(database, confirmation);
            } else {
                await api(
                    `/connections/${encodeURIComponent(connection.id)}/databases`,
                    isDatabaseDrop,
                    {
                        method: 'DELETE',
                        body: { database, confirmation },
                    },
                );
            }
            onDeleted(database);
        } catch (error) {
            if (mounted.current) setError(`${message(error)} Refresh Objects before retrying.`);
        } finally {
            pending.current = false;
            if (mounted.current) setBusy(false);
        }
    };
    return (
        <CreationDialog
            className="database-delete-dialog"
            title="Delete database"
            description={
                <>
                    Delete <code>{database}</code> and all tables and data inside it on{' '}
                    <code>{connection.host}</code>?
                    {connection.database === database && ' The connection will switch to default.'}
                </>
            }
            closeLabel="Close Delete database"
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
                        disabled={busy || confirmation !== database}
                    >
                        <Icon name="trash" />
                        {busy ? 'Deleting…' : 'Delete database'}
                    </button>
                </>
            }
        >
            <label className="creation-dialog-field">
                <span>
                    Type <code>{database}</code> to confirm
                </span>
                <input
                    ref={input}
                    className="creation-dialog-control"
                    aria-label={`Type ${database} to confirm`}
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
                <p className="text-sm text-[var(--red)]" role="alert">
                    {error}
                </p>
            )}
        </CreationDialog>
    );
}
