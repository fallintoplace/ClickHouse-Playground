import { useState } from 'react';
import {
    PYTHON_SCALAR_TYPES,
    pythonArgumentSchema,
    type ExecutableFunction,
    type PythonScalar,
} from '../../../shared/database/functions/python-functions';
import type { OpenSqlDraft } from '../../queries/execution/sql-draft-observer';
import { quoteIdentifier } from '../../../shared/sql/sql';
import { Icon } from '../../ui/components/icons';
import { SqlFunctionDetails, type FunctionTestEvidence } from './SqlFunctionDetails';
import { PythonDeploymentPanel } from './PythonDeploymentPanel';

export function PythonFunctionDetails({
    fn,
    trusted,
    deployAllowed,
    evidence,
    onRun,
    onCopy,
    onRefresh,
}: {
    fn: ExecutableFunction;
    trusted: boolean;
    deployAllowed: boolean;
    evidence?: FunctionTestEvidence;
    onRun: OpenSqlDraft;
    onCopy: (value: string, id: string) => void;
    onRefresh: () => void;
}) {
    const [arguments_, setArguments] = useState<Array<{ name: string; type: PythonScalar }>>([
        { name: 'arg1', type: 'String' },
    ]);
    return (
        <SqlFunctionDetails
            fn={{
                name: fn.name,
                createQuery:
                    fn.createQuery ||
                    'Source is unavailable for this installed executable function.',
                parameters: arguments_.map(argument => argument.name),
            }}
            pythonTypes={arguments_.map(argument => argument.type)}
            evidence={evidence}
            trusted={trusted}
            onRun={onRun}
            onCopy={onCopy}
            canDelete={false}
            deleteReason=""
            onDelete={() => {}}
            testSetup={
                <div className="python-function-signature">
                    <h4>Test signature</h4>
                    {arguments_.map((argument, index) => (
                        <label key={index} className="creation-dialog-field">
                            <span>{argument.name}</span>
                            <select
                                aria-label={`Test argument ${index + 1} type`}
                                value={argument.type}
                                onChange={event =>
                                    setArguments(current =>
                                        current.map((value, at) =>
                                            at === index
                                                ? {
                                                      ...value,
                                                      type: PYTHON_SCALAR_TYPES.find(
                                                          type => type === event.target.value,
                                                      )!,
                                                  }
                                                : value,
                                        ),
                                    )
                                }
                            >
                                {PYTHON_SCALAR_TYPES.map(type => (
                                    <option key={type}>{type}</option>
                                ))}
                            </select>
                        </label>
                    ))}
                    <div className="python-deployment-actions">
                        <button
                            type="button"
                            className="creation-dialog-button"
                            disabled={arguments_.length >= 16}
                            onClick={() =>
                                setArguments(current => [
                                    ...current,
                                    { name: `arg${current.length + 1}`, type: 'String' },
                                ])
                            }
                        >
                            <Icon name="plus" />
                            Add argument
                        </button>
                        <button
                            type="button"
                            className="creation-dialog-button"
                            disabled={arguments_.length <= 1}
                            onClick={() => setArguments(current => current.slice(0, -1))}
                        >
                            <Icon name="trash" />
                            Remove argument
                        </button>
                    </div>
                </div>
            }
            deployment={
                <>
                    <PythonDeploymentPanel
                        name={fn.name}
                        allowed={deployAllowed}
                        onChanged={onRefresh}
                        onSignature={value => {
                            const parsed = pythonArgumentSchema.array().safeParse(value);
                            if (parsed.success && parsed.data.length) setArguments(parsed.data);
                        }}
                    />
                    <button
                        type="button"
                        className="creation-dialog-button"
                        disabled={!trusted}
                        onClick={() =>
                            onRun(
                                `Reload ${fn.name}.sql`,
                                `SYSTEM RELOAD FUNCTION ON CLUSTER default ${quoteIdentifier(fn.name)};`,
                                false,
                                false,
                            )
                        }
                        title="Reload long-lived processes after attaching a new version"
                    >
                        <Icon name="refresh" />
                        Reload pool SQL
                    </button>
                </>
            }
        />
    );
}
