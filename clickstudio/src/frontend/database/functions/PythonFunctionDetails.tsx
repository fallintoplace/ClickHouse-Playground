import { useState } from 'react';
import {
    pythonArgumentSchema,
    type ExecutableFunction,
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
    const [manual, setManual] = useState({
        name: fn.name,
        arguments: [{ name: 'arg1', type: 'String' }],
    });
    const detected = fn.arguments !== undefined;
    const arguments_ =
        fn.arguments ??
        (manual.name === fn.name ? manual.arguments : [{ name: 'arg1', type: 'String' }]);
    const changeSignature = (arguments_: Array<{ name: string; type: string }>) =>
        setManual({ name: fn.name, arguments: arguments_ });
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
            showDefinition={Boolean(fn.createQuery.trim())}
            evidence={evidence}
            trusted={trusted}
            onRun={onRun}
            onCopy={onCopy}
            canDelete={false}
            deleteReason=""
            onDelete={() => {}}
            manualSignature={!detected}
            onRefreshSignature={onRefresh}
            onPythonTypeChange={
                detected
                    ? undefined
                    : (index, type) =>
                          changeSignature(
                              arguments_.map((argument, at) =>
                                  at === index ? { ...argument, type } : argument,
                              ),
                          )
            }
            argumentActions={
                !detected && (
                    <div className="sql-function-signature-actions">
                        <button
                            type="button"
                            className="creation-dialog-button"
                            disabled={arguments_.length >= 16}
                            onClick={() =>
                                changeSignature([
                                    ...arguments_,
                                    { name: `arg${arguments_.length + 1}`, type: 'String' },
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
                            onClick={() => changeSignature(arguments_.slice(0, -1))}
                        >
                            <Icon name="trash" />
                            Remove argument
                        </button>
                    </div>
                )
            }
            deployment={
                <>
                    <PythonDeploymentPanel
                        name={fn.name}
                        allowed={deployAllowed}
                        onChanged={onRefresh}
                        onSignature={value => {
                            const parsed = pythonArgumentSchema.array().safeParse(value);
                            if (!detected && parsed.success && parsed.data.length)
                                changeSignature(parsed.data);
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
