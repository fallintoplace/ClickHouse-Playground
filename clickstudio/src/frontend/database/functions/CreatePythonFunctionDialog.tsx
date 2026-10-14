import { useRef, useState } from 'react';
import {
    PYTHON_FUNCTION_TEMPLATES,
    PYTHON_SCALAR_TYPES,
    pythonDraftSchema,
    pythonSourceIssue,
    type PythonFunctionDraft,
} from '../../../shared/database/functions/python-functions';
import { pythonUdfArtifact } from '../../../shared/database/functions/python-udf-package';
import { CreationDialog } from '../../ui/components/CreationDialog';
import { Icon } from '../../ui/components/icons';
import { message } from '../../api/client';
import { PythonFunctionEditor } from './PythonFunctionEditor';
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
    const [draft, setDraft] = useState<PythonFunctionDraft>(() =>
        structuredClone(PYTHON_FUNCTION_TEMPLATES[0]!),
    );
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const validation = pythonDraftSchema.safeParse(draft);
    const sourceIssue = validation.success ? pythonSourceIssue(validation.data) : '';
    const update = (patch: Partial<PythonFunctionDraft>) => {
        setDraft(current => ({ ...current, ...patch }));
        setError('');
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
        <CreationDialog
            className="sql-function-dialog python-function-dialog"
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
                        Close
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
            <div className="python-function-scroll">
                <div className="sql-function-fields">
                    <label className="creation-dialog-field">
                        <span>Template</span>
                        <select
                            defaultValue="0"
                            onChange={event =>
                                setDraft(
                                    structuredClone(
                                        PYTHON_FUNCTION_TEMPLATES[Number(event.target.value)]!,
                                    ),
                                )
                            }
                        >
                            {PYTHON_FUNCTION_TEMPLATES.map((template, index) => (
                                <option key={template.name} value={index}>
                                    {template.label}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="creation-dialog-field">
                        <span>Function name</span>
                        <input
                            ref={nameInput}
                            value={draft.name}
                            onChange={event => update({ name: event.target.value })}
                            maxLength={128}
                        />
                    </label>
                    <div className="creation-dialog-field sql-function-expression">
                        <span>Arguments</span>
                        {draft.arguments.map((argument, index) => (
                            <div className="python-function-argument-row" key={index}>
                                <input
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
                                <select
                                    aria-label={`Argument ${index + 1} type`}
                                    value={argument.type}
                                    onChange={event =>
                                        update({
                                            arguments: draft.arguments.map((item, at) =>
                                                at === index
                                                    ? {
                                                          ...item,
                                                          type: PYTHON_SCALAR_TYPES.find(
                                                              type => type === event.target.value,
                                                          )!,
                                                      }
                                                    : item,
                                            ),
                                        })
                                    }
                                >
                                    {PYTHON_SCALAR_TYPES.map(type => (
                                        <option key={type}>{type}</option>
                                    ))}
                                </select>
                                <button
                                    type="button"
                                    className="creation-dialog-button"
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
                        <button
                            type="button"
                            className="creation-dialog-button"
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
                            Add argument
                        </button>
                    </div>
                    <label className="creation-dialog-field">
                        <span>Returns</span>
                        <select
                            value={draft.returnType}
                            onChange={event =>
                                update({
                                    returnType: PYTHON_SCALAR_TYPES.find(
                                        type => type === event.target.value,
                                    )!,
                                })
                            }
                        >
                            {PYTHON_SCALAR_TYPES.map(type => (
                                <option key={type}>{type}</option>
                            ))}
                        </select>
                    </label>
                    <label className="creation-dialog-field">
                        <span>requirements.txt</span>
                        <textarea
                            aria-label="Python dependencies"
                            value={draft.requirements}
                            onChange={event => update({ requirements: event.target.value })}
                            rows={2}
                            maxLength={16000}
                            spellCheck={false}
                        />
                    </label>
                    <div className="creation-dialog-field sql-function-expression">
                        <span>Python source</span>
                        <PythonFunctionEditor
                            disabled={busy}
                            value={draft.source}
                            onChange={source => update({ source })}
                        />
                    </div>
                </div>
                {sourceIssue && (
                    <p className="sql-function-error" role="status">
                        {sourceIssue}
                    </p>
                )}
                {!validation.success && (
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
            </div>
        </CreationDialog>
    );
}
