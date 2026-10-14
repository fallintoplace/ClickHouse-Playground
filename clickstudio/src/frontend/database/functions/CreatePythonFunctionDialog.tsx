import { useRef, useState } from 'react';
import {
    PYTHON_FUNCTION_CUSTOM_DRAFT,
    PYTHON_FUNCTION_TEMPLATES,
    PYTHON_SCALAR_TYPES,
    pythonDraftSchema,
    pythonSourceIssue,
    type PythonFunctionDraft,
} from '../../../shared/database/functions/python-functions';
import { pythonUdfArtifact } from '../../../shared/database/functions/python-udf-package';
import { SelectControl } from '../../ui/components/SelectControl';
import { Icon } from '../../ui/components/icons';
import { message } from '../../api/client';
import { FunctionCreationDialog } from './FunctionCreationDialog';
import { FunctionCodeEditor } from './FunctionCodeEditor';
import { PythonDeploymentPanel } from './PythonDeploymentPanel';

export function CreatePythonFunctionDialog({
    onClose,
    onPublished,
    deployAllowed,
}: {
    onClose: () => void;
    onPublished: () => void;
    deployAllowed: boolean;
}) {
    const nameInput = useRef<HTMLInputElement>(null);
    const [template, setTemplate] = useState('custom');
    const [draft, setDraft] = useState<PythonFunctionDraft>(() =>
        structuredClone(PYTHON_FUNCTION_CUSTOM_DRAFT),
    );
    const [error, setError] = useState('');
    const [showValidation, setShowValidation] = useState(false);
    const [busy, setBusy] = useState(false);
    const validation = pythonDraftSchema.safeParse(draft);
    const sourceIssue = validation.success ? pythonSourceIssue(validation.data) : '';
    const update = (patch: Partial<PythonFunctionDraft>) => {
        setDraft(current => ({ ...current, ...patch }));
        setError('');
        setShowValidation(true);
    };
    const applyTemplate = (value: string) => {
        const selected = value === 'custom' ? undefined : PYTHON_FUNCTION_TEMPLATES[Number(value)];
        setTemplate(selected ? value : 'custom');
        setDraft(structuredClone(selected ?? PYTHON_FUNCTION_CUSTOM_DRAFT));
        setError('');
        setShowValidation(false);
    };
    const download = async () => {
        if (!validation.success || sourceIssue || busy) return;
        setBusy(true);
        try {
            const url = URL.createObjectURL(
                new Blob([await pythonUdfArtifact(validation.data)], { type: 'application/zip' }),
            );
            const link = document.createElement('a');
            link.href = url;
            link.download = `${draft.name}.zip`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) {
            setError(message(error));
        } finally {
            setBusy(false);
        }
    };
    return (
        <FunctionCreationDialog
            className="python-function-dialog"
            title="Create Python UDF"
            description="Python 3.11 · executable_pool · JSONEachRow"
            closeLabel="Close Create Python UDF"
            busy={busy}
            initialFocus={nameInput}
            onClose={onClose}
            onSubmit={event => {
                event.preventDefault();
                void download();
            }}
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
                        disabled={!validation.success || Boolean(sourceIssue) || busy}
                    >
                        <Icon name="exportFile" />
                        Export ZIP
                    </button>
                </>
            }
        >
            <div className="function-creation-fields has-return-type">
                <label className="creation-dialog-field">
                    <span>Function name</span>
                    <input
                        ref={nameInput}
                        className="creation-dialog-control"
                        value={draft.name}
                        onChange={event => update({ name: event.target.value })}
                        maxLength={128}
                        placeholder="e.g. py_semver_compare"
                    />
                </label>
                <div className="creation-dialog-field">
                    <span>Template</span>
                    <SelectControl
                        className="select-control-field"
                        label="Template"
                        value={template}
                        disabled={busy}
                        options={[
                            { value: 'custom', label: 'Custom' },
                            ...PYTHON_FUNCTION_TEMPLATES.map((item, index) => ({
                                value: String(index),
                                label: item.label,
                            })),
                        ]}
                        onChange={applyTemplate}
                    />
                </div>
                <div className="creation-dialog-field">
                    <span>Returns</span>
                    <SelectControl
                        className="select-control-field"
                        label="Return type"
                        value={draft.returnType}
                        disabled={busy}
                        options={PYTHON_SCALAR_TYPES.map(type => ({
                            value: type,
                            label: type,
                        }))}
                        onChange={value =>
                            update({
                                returnType: PYTHON_SCALAR_TYPES.find(type => type === value)!,
                            })
                        }
                    />
                </div>
            </div>
            <div className="function-creation-workspace">
                <div className="python-function-settings">
                    <section className="python-function-arguments" aria-label="Arguments">
                        <div className="function-creation-section-heading">
                            <h3>Arguments</h3>
                            <button
                                type="button"
                                className="creation-dialog-button function-creation-icon-button"
                                aria-label="Add argument"
                                title="Add argument"
                                disabled={draft.arguments.length >= 16}
                                onClick={() =>
                                    update({
                                        arguments: [
                                            ...draft.arguments,
                                            {
                                                name: `arg${draft.arguments.length + 1}`,
                                                type: 'String',
                                            },
                                        ],
                                    })
                                }
                            >
                                <Icon name="plus" />
                            </button>
                        </div>
                        {draft.arguments.map((argument, index) => (
                            <div className="python-function-argument-row" key={index}>
                                <input
                                    className="creation-dialog-control"
                                    aria-label={`Argument ${index + 1} name`}
                                    value={argument.name}
                                    onChange={event =>
                                        update({
                                            arguments: draft.arguments.map((item, at) =>
                                                at === index
                                                    ? { ...item, name: event.target.value }
                                                    : item,
                                            ),
                                        })
                                    }
                                />
                                <SelectControl
                                    className="select-control-field"
                                    label={`Argument ${index + 1} type`}
                                    value={argument.type}
                                    disabled={busy}
                                    options={PYTHON_SCALAR_TYPES.map(type => ({
                                        value: type,
                                        label: type,
                                    }))}
                                    onChange={value =>
                                        update({
                                            arguments: draft.arguments.map((item, at) =>
                                                at === index
                                                    ? {
                                                          ...item,
                                                          type: PYTHON_SCALAR_TYPES.find(
                                                              type => type === value,
                                                          )!,
                                                      }
                                                    : item,
                                            ),
                                        })
                                    }
                                />
                                <button
                                    type="button"
                                    className="creation-dialog-button function-creation-icon-button"
                                    aria-label={`Remove argument ${index + 1}`}
                                    title="Remove argument"
                                    disabled={draft.arguments.length === 1}
                                    onClick={() =>
                                        update({
                                            arguments: draft.arguments.filter(
                                                (_, at) => at !== index,
                                            ),
                                        })
                                    }
                                >
                                    <Icon name="trash" />
                                </button>
                            </div>
                        ))}
                    </section>
                    <label className="creation-dialog-field python-function-dependencies">
                        <span className="function-creation-section-heading">
                            <span>requirements.txt</span>
                            <span className="function-creation-meta">Optional</span>
                        </span>
                        <textarea
                            className="creation-dialog-control"
                            aria-label="Python dependencies"
                            value={draft.requirements}
                            onChange={event => update({ requirements: event.target.value })}
                            placeholder="No dependencies"
                            rows={4}
                            maxLength={16000}
                            spellCheck={false}
                        />
                    </label>
                </div>
                <div className="creation-dialog-field function-creation-source">
                    <span className="function-creation-section-heading">
                        <span>Python source</span>
                        <span className="function-creation-meta is-code">main.py</span>
                    </span>
                    <FunctionCodeEditor
                        language="python"
                        label="Python source"
                        disabled={busy}
                        value={draft.source}
                        onChange={source => update({ source })}
                    />
                </div>
            </div>
            {showValidation && sourceIssue && (
                <p className="sql-function-error" role="status">
                    {sourceIssue}
                </p>
            )}
            {showValidation && !validation.success && (
                <p className="sql-function-error" role="status">
                    {validation.error.issues[0]?.message}
                </p>
            )}
            {error && (
                <p className="sql-function-error" role="alert">
                    {error}
                </p>
            )}
            <PythonDeploymentPanel
                name={draft.name}
                draft={validation.success && !sourceIssue ? validation.data : undefined}
                allowed={deployAllowed}
                onChanged={onPublished}
                onBusy={setBusy}
            />
        </FunctionCreationDialog>
    );
}
