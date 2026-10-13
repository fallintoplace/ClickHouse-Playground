import { useDialogFocus } from '../../ui/focus/useDialogFocus';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
    createSqlFunctionQuery,
    type SqlFunction,
} from '../../../shared/database/functions/sql-functions';
import { createClickHouseCloudFunction } from '../connections/cloud-connection';
import { message } from '../../api/client';
import { Button } from '../../ui/components/primitives';
import { Icon } from '../../ui/components/icons';

export function CreateSqlFunctionDialog({
    onClose,
    onCreated,
    onCopy,
    copiedId,
}: {
    onClose: () => void;
    onCreated: (fn: SqlFunction) => void;
    onCopy: (sql: string, id: string) => void;
    copiedId?: string;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const [fields, setFields] = useState({ name: '', parameters: '', expression: '' });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const input = {
        name: fields.name.trim(),
        parameters: fields.parameters.split(',').map(value => value.trim()),
        expression: fields.expression,
    };
    let sql = '',
        validation = '';
    try {
        sql = createSqlFunctionQuery(input);
    } catch (error) {
        validation = message(error);
    }

    useDialogFocus(dialog, { onClose, canClose: !busy });

    useEffect(() => {
        const element = dialog.current;
        element?.showModal();
        element?.querySelector<HTMLInputElement>('input')?.focus();
        return () => element?.close();
    }, []);

    const changeField = (field: keyof typeof fields, value: string) => {
        setFields(current => ({ ...current, [field]: value }));
        setError('');
    };

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (!sql || busy) return;
        setBusy(true);
        setError('');
        try {
            onCreated(await createClickHouseCloudFunction(input));
        } catch (error) {
            setError(
                `${message(error)} Refresh Functions to check whether creation succeeded before retrying.`,
            );
        } finally {
            setBusy(false);
        }
    };

    return (
        <dialog
            ref={dialog}
            className="sql-function-dialog"
            aria-label="Create SQL Function"
            onCancel={event => {
                event.preventDefault();
                if (!busy) onClose();
            }}
        >
            <form onSubmit={event => void submit(event)}>
                <header>
                    <div>
                        <span className="sql-function-eyebrow">OBJECTS / FUNCTIONS</span>
                        <h2 id="create-sql-function-title">Create SQL Function</h2>
                    </div>
                    <button
                        type="button"
                        aria-label="Close Create SQL Function"
                        disabled={busy}
                        onClick={onClose}
                    >
                        <Icon name="close" />
                    </button>
                </header>
                <div className="sql-function-dialog-body">
                    <fieldset disabled={busy} className="sql-function-fields">
                        <label>
                            Function name
                            <input
                                value={fields.name}
                                aria-label="Function name"
                                maxLength={128}
                                placeholder="e.g. add_tax"
                                onChange={event => changeField('name', event.target.value)}
                            />
                        </label>
                        <label>
                            Parameters
                            <input
                                value={fields.parameters}
                                aria-label="Parameters"
                                placeholder="e.g. price, rate"
                                onChange={event => changeField('parameters', event.target.value)}
                            />
                            <small>
                                Comma-separated names. SQL UDFs are available across databases.
                            </small>
                        </label>
                        <label>
                            Expression
                            <textarea
                                rows={3}
                                value={fields.expression}
                                aria-label="Expression"
                                maxLength={8192}
                                spellCheck={false}
                                placeholder="e.g. price * (1 + rate)"
                                onChange={event => changeField('expression', event.target.value)}
                            />
                        </label>
                    </fieldset>
                    <div className="sql-function-preview">
                        <span className="sql-function-eyebrow">SQL PREVIEW</span>
                        <pre>
                            {sql ||
                                (fields.name || fields.parameters || fields.expression
                                    ? validation
                                    : 'Enter a name, parameters and expression to preview your SQL.')}
                        </pre>
                    </div>
                    {error && (
                        <p className="sql-function-error" role="alert">
                            {error}
                        </p>
                    )}
                </div>
                <footer>
                    <Button
                        type="button"
                        variant="ghost"
                        disabled={!sql}
                        onClick={() => onCopy(sql, `function-create:${sql}`)}
                    >
                        <Icon name="copy" />
                        {copiedId === `function-create:${sql}` ? 'Copied' : 'Copy SQL'}
                    </Button>
                    <span />
                    <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
                        Cancel
                    </Button>
                    <Button type="submit" variant="primary" disabled={!sql || busy}>
                        {busy ? 'Creating…' : 'Create UDF'}
                    </Button>
                </footer>
            </form>
        </dialog>
    );
}
