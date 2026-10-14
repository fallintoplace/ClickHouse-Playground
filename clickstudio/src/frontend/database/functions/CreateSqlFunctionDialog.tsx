import { useId, useRef, useState, type FormEvent } from 'react';
import {
    SQL_FUNCTION_CREATION_TEMPLATES,
    createSqlFunctionQuery,
    sqlFunctionNameIssue,
    type SqlFunction,
} from '../../../shared/database/functions/sql-functions';
import { createClickHouseCloudFunction } from '../connections/cloud-connection';
import { message } from '../../api/client';
import { Icon } from '../../ui/components/icons';
import { SelectControl } from '../../ui/components/SelectControl';
import { FunctionCreationDialog } from './FunctionCreationDialog';
import { FunctionCodeEditor } from './FunctionCodeEditor';

type Parameter = { id: number; name: string };

function SqlFunctionParameters({
    parameters,
    busy,
    onAdd,
    onChange,
    onRemove,
}: {
    parameters: Parameter[];
    busy: boolean;
    onAdd: () => void;
    onChange: (id: number, name: string) => void;
    onRemove: (id: number) => void;
}) {
    return (
        <section className="sql-function-parameters" aria-label="Parameters">
            <div className="function-creation-section-heading">
                <h3>Parameters</h3>
                <button
                    type="button"
                    className="creation-dialog-button function-creation-icon-button"
                    aria-label="Add parameter"
                    title="Add parameter"
                    disabled={busy || parameters.length >= 16}
                    onClick={onAdd}
                >
                    <Icon name="plus" />
                </button>
            </div>
            {parameters.map((parameter, index) => (
                <div key={parameter.id} className="sql-function-parameter-row">
                    <span className="function-creation-meta" aria-hidden="true">
                        {index + 1}
                    </span>
                    <input
                        className="creation-dialog-control"
                        aria-label={`Parameter ${index + 1} name`}
                        value={parameter.name}
                        disabled={busy}
                        maxLength={128}
                        placeholder={index === 0 ? 'e.g. value' : 'e.g. other_value'}
                        onChange={event => onChange(parameter.id, event.target.value)}
                    />
                    <button
                        type="button"
                        className="creation-dialog-button function-creation-icon-button"
                        aria-label={`Remove parameter ${index + 1}`}
                        title="Remove parameter"
                        disabled={busy || parameters.length === 1}
                        onClick={event => {
                            if (event.currentTarget.matches(':focus-visible')) {
                                const row = event.currentTarget.closest(
                                    '.sql-function-parameter-row',
                                );
                                const neighbor =
                                    row?.nextElementSibling ?? row?.previousElementSibling;
                                neighbor
                                    ?.querySelector<HTMLInputElement>('input')
                                    ?.focus({ preventScroll: true });
                            }
                            onRemove(parameter.id);
                        }}
                    >
                        <Icon name="trash" />
                    </button>
                </div>
            ))}
        </section>
    );
}

export function CreateSqlFunctionDialog({
    onClose,
    onCreated,
}: {
    onClose: () => void;
    onCreated: (fn: SqlFunction) => void;
}) {
    const nameIssueId = useId();
    const nameInput = useRef<HTMLInputElement>(null);
    const nextParameterId = useRef(1);
    const [template, setTemplate] = useState('custom');
    const [fields, setFields] = useState({ name: '', expression: '' });
    const [parameters, setParameters] = useState<Parameter[]>([{ id: 0, name: '' }]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const input = {
        name: fields.name.trim(),
        parameters: parameters.map(parameter => parameter.name.trim()),
        expression: fields.expression,
    };
    let sql = '',
        validation = '';
    try {
        sql = createSqlFunctionQuery(input);
    } catch (error) {
        validation = message(error);
    }
    const hasInput = Boolean(
        fields.name || fields.expression || parameters.some(parameter => parameter.name),
    );
    const visibleNameIssue = hasInput ? sqlFunctionNameIssue(input.name) : '';

    const changeField = (field: keyof typeof fields, value: string) => {
        setFields(current => ({ ...current, [field]: value }));
        setError('');
    };

    const changeParameter = (id: number, name: string) => {
        setParameters(current =>
            current.map(parameter => (parameter.id === id ? { ...parameter, name } : parameter)),
        );
        setError('');
    };
    const addParameter = () => {
        const id = nextParameterId.current++;
        setParameters(current => [...current, { id, name: '' }]);
        setError('');
    };
    const removeParameter = (id: number) => {
        setParameters(current => current.filter(parameter => parameter.id !== id));
        setError('');
    };
    const applyTemplate = (value: string) => {
        const selected =
            value === 'custom' ? undefined : SQL_FUNCTION_CREATION_TEMPLATES[Number(value)];
        setTemplate(selected ? value : 'custom');
        setFields({ name: selected?.name ?? '', expression: selected?.expression ?? '' });
        setParameters(
            (selected?.parameters ?? ['']).map(name => ({
                id: nextParameterId.current++,
                name,
            })),
        );
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
        <FunctionCreationDialog
            className="sql-function-dialog"
            title="Create SQL Function"
            description="SQL · lambda expression"
            closeLabel="Close Create SQL Function"
            busy={busy}
            initialFocus={nameInput}
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
                        className="creation-dialog-button is-primary"
                        disabled={!sql || busy}
                    >
                        <Icon name="plus" />
                        {busy ? 'Creating…' : 'Create UDF'}
                    </button>
                </>
            }
        >
            <div className="function-creation-fields">
                <label className="creation-dialog-field">
                    <span className="function-creation-section-heading">Function name</span>
                    <input
                        ref={nameInput}
                        className="creation-dialog-control"
                        value={fields.name}
                        disabled={busy}
                        aria-label="Function name"
                        aria-invalid={visibleNameIssue ? true : undefined}
                        aria-describedby={visibleNameIssue ? nameIssueId : undefined}
                        maxLength={128}
                        placeholder="e.g. udf_array_remove_at"
                        onChange={event => changeField('name', event.target.value)}
                    />
                </label>
                <div className="creation-dialog-field">
                    <span className="function-creation-section-heading">Template</span>
                    <SelectControl
                        className="select-control-field"
                        label="Template"
                        value={template}
                        disabled={busy}
                        options={[
                            { value: 'custom', label: 'Custom' },
                            ...SQL_FUNCTION_CREATION_TEMPLATES.map((item, index) => ({
                                value: String(index),
                                label: item.label,
                            })),
                        ]}
                        onChange={applyTemplate}
                    />
                </div>
            </div>
            <div className="function-creation-workspace">
                <div className="sql-function-create-sidebar">
                    <SqlFunctionParameters
                        parameters={parameters}
                        busy={busy}
                        onAdd={addParameter}
                        onChange={changeParameter}
                        onRemove={removeParameter}
                    />
                </div>
                <div className="creation-dialog-field function-creation-source">
                    <span className="function-creation-section-heading">
                        <span>Expression</span>
                        <span className="function-creation-meta is-code">expression.sql</span>
                    </span>
                    <FunctionCodeEditor
                        language="sql"
                        label="Expression"
                        value={fields.expression}
                        disabled={busy}
                        maxLength={8192}
                        placeholder="e.g. arrayFilter((x, i) -> i != n, xs, arrayEnumerate(xs))"
                        onChange={value => changeField('expression', value)}
                    />
                </div>
            </div>
            {validation && hasInput && (
                <p
                    id={visibleNameIssue ? nameIssueId : undefined}
                    className="sql-function-error"
                    role="status"
                >
                    {visibleNameIssue ? (
                        <>
                            <strong>Function name:</strong> {visibleNameIssue}
                        </>
                    ) : (
                        validation
                    )}
                </p>
            )}
            {error && (
                <p className="sql-function-error" role="alert">
                    {error}
                </p>
            )}
        </FunctionCreationDialog>
    );
}
