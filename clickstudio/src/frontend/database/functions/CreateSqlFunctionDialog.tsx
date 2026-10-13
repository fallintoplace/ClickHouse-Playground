import { useRef, useState, type FormEvent } from 'react';
import {
    createSqlFunctionQuery,
    type SqlFunction,
} from '../../../shared/database/functions/sql-functions';
import { createClickHouseCloudFunction } from '../connections/cloud-connection';
import { message } from '../../api/client';
import { CreationDialog } from '../../ui/components/CreationDialog';
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
    const nameInput = useRef<HTMLInputElement>(null);
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
        <CreationDialog
            className="sql-function-dialog"
            title="Create SQL Function"
            description="Create a SQL UDF available across databases."
            closeLabel="Close Create SQL Function"
            busy={busy}
            initialFocus={nameInput}
            onClose={onClose}
            onSubmit={event => void submit(event)}
            footer={
                <>
                    <button
                        type="button"
                        className="creation-dialog-button is-quiet"
                        disabled={!sql || busy}
                        onClick={() => onCopy(sql, `function-create:${sql}`)}
                    >
                        <Icon name="copy" />
                        {copiedId === `function-create:${sql}` ? 'Copied' : 'Copy SQL'}
                    </button>
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
                        className="creation-dialog-button is-primary"
                        disabled={!sql || busy}
                    >
                        {busy ? 'Creating…' : 'Create UDF'}
                    </button>
                </>
            }
        >
            <div className="sql-function-fields">
                <label className="creation-dialog-field">
                    <span>Function name</span>
                    <input
                        ref={nameInput}
                        className="creation-dialog-control"
                        value={fields.name}
                        aria-label="Function name"
                        maxLength={128}
                        placeholder="e.g. add_tax"
                        onChange={event => changeField('name', event.target.value)}
                    />
                </label>
                <label className="creation-dialog-field">
                    <span>Parameters</span>
                    <input
                        className="creation-dialog-control"
                        value={fields.parameters}
                        aria-label="Parameters"
                        placeholder="e.g. price, rate"
                        onChange={event => changeField('parameters', event.target.value)}
                    />
                    <small className="creation-dialog-help">Comma-separated names.</small>
                </label>
                <label className="creation-dialog-field sql-function-expression">
                    <span>Expression</span>
                    <textarea
                        className="creation-dialog-control"
                        rows={3}
                        value={fields.expression}
                        aria-label="Expression"
                        maxLength={8192}
                        spellCheck={false}
                        placeholder="e.g. price * (1 + rate)"
                        onChange={event => changeField('expression', event.target.value)}
                    />
                </label>
            </div>
            <div className="sql-function-preview sql-function-create-preview">
                <h3>SQL preview</h3>
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
        </CreationDialog>
    );
}
