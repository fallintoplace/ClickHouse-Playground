import type { OpenSqlDraft } from '../../queries/execution/sql-draft-observer';
import { terminal } from '../../queries/execution/status';
import { useFunctionTestResult } from './useFunctionTestResult';
import { useState } from 'react';
import {
    SQL_FUNCTION_TEMPLATES,
    testSqlFunctionQuery,
    type FunctionArgument,
    type SqlFunction,
} from '../../../shared/database/functions/sql-functions';
import type { Json } from '../../../shared/common/values';
import { message } from '../../api/client';
import { Button } from '../../ui/components/primitives';
import { Icon } from '../../ui/components/icons';

export type FunctionTestEvidence = { busy: boolean };
type TestAttempt = { id: string; sql: string; submitting: boolean; runId?: string; error?: string };

function functionTestBusy(
    attempt: TestAttempt | undefined,
    evidence: ReturnType<typeof useFunctionTestResult>,
    workspaceBusy = false,
) {
    if (workspaceBusy || attempt?.submitting) return true;
    if (!attempt?.runId || evidence?.error) return false;
    return !evidence?.run || !terminal(evidence.run);
}

function FunctionOutput({ value, type, rawJson }: { value: Json; type?: string; rawJson?: Json }) {
    if (type?.includes('Map(') && typeof rawJson === 'string') return <pre>{rawJson}</pre>;
    if (Array.isArray(value) && !value.length) return <pre>[]</pre>;
    if (Array.isArray(value))
        return (
            <div className="sql-function-output-items">
                {value.map((item, index) => (
                    <code key={index}>{JSON.stringify(item)}</code>
                ))}
            </div>
        );
    if (value !== null && typeof value === 'object')
        return (
            <dl className="sql-function-output-map">
                {Object.entries(value).map(([key, item]) => (
                    <div key={key}>
                        <dt>{key}</dt>
                        <dd>{JSON.stringify(item)}</dd>
                    </div>
                ))}
            </dl>
        );
    return <pre>{JSON.stringify(value)}</pre>;
}

function FunctionInputs({
    parameters,
    arguments_,
    onChange,
}: {
    parameters: string[];
    arguments_: FunctionArgument[];
    onChange: (index: number, argument: FunctionArgument) => void;
}) {
    return (
        <>
            {parameters.map((parameter, index) => (
                <div key={parameter} className="sql-function-argument">
                    <label htmlFor={`function-argument-${index}`}>{parameter}</label>
                    <textarea
                        id={`function-argument-${index}`}
                        rows={
                            arguments_[index]!.kind === 'map' ||
                            arguments_[index]!.value.trim().startsWith('[')
                                ? 2
                                : 1
                        }
                        spellCheck={false}
                        value={arguments_[index]!.value}
                        onChange={event =>
                            onChange(index, { ...arguments_[index]!, value: event.target.value })
                        }
                    />
                </div>
            ))}
            <small className="sql-function-input-hint">
                Strings use double quotes. Arrays use [1, 2, 3].
            </small>
            <details className="sql-function-input-options">
                <summary>Input options</summary>
                <div>
                    {parameters.map((parameter, index) => (
                        <label key={parameter}>
                            <span>{parameter}</span>
                            <select
                                aria-label={`${parameter} input format`}
                                value={arguments_[index]!.kind}
                                onChange={event =>
                                    onChange(index, {
                                        ...arguments_[index]!,
                                        kind: event.target.value === 'map' ? 'map' : 'json',
                                    })
                                }
                            >
                                <option value="json">Value</option>
                                <option value="map">Map entries</option>
                            </select>
                        </label>
                    ))}
                    <small className="sql-function-input-hint">
                        Map entries use [[key, value], …].
                    </small>
                </div>
            </details>
        </>
    );
}

export function SqlFunctionDetails({
    fn,
    evidence,
    trusted,
    onRun,
    onCopy,
    copiedId,
}: {
    fn: SqlFunction;
    evidence?: FunctionTestEvidence;
    trusted: boolean;
    onRun: OpenSqlDraft;
    onCopy: (sql: string, id: string) => void;
    copiedId?: string;
}) {
    const template = SQL_FUNCTION_TEMPLATES.find(
        template =>
            template.name === fn.name &&
            template.parameters.length === fn.parameters.length &&
            template.parameters.every((parameter, index) => parameter === fn.parameters[index]),
    );
    const [arguments_, setArguments] = useState<FunctionArgument[]>(() =>
        fn.parameters.map((_, index) => template?.arguments[index] ?? { value: '0', kind: 'json' }),
    );
    const [attempt, setAttempt] = useState<TestAttempt>();
    const [startError, setStartError] = useState('');
    let sql = '',
        validation = '';
    try {
        sql = testSqlFunctionQuery(fn, arguments_);
    } catch (error) {
        validation = message(error);
    }
    const evidenceForTest = useFunctionTestResult(attempt?.runId);
    const run = evidenceForTest?.run;
    const result = attempt?.sql === sql ? evidenceForTest?.result : undefined;
    const failure = attempt?.sql === sql ? attempt.error || evidenceForTest?.error : undefined;
    const output = result?.rows[0]?.[0];
    const busy = functionTestBusy(attempt, evidenceForTest, evidence?.busy);
    const changeArgument = (index: number, next: FunctionArgument) => {
        setArguments(current => current.map((argument, at) => (at === index ? next : argument)));
        setStartError('');
    };
    const test = () => {
        if (!sql || busy || !trusted) return;
        setStartError('');
        const id = crypto.randomUUID();
        setAttempt({ id, sql, submitting: true });
        const target = onRun(`Test ${fn.name}.sql`, sql, true, true, {
            submitted: run =>
                setAttempt(current =>
                    current?.id === id ? { ...current, runId: run.id, submitting: false } : current,
                ),
            failed: error =>
                setAttempt(current =>
                    current?.id === id
                        ? { ...current, error: error.message, submitting: false }
                        : current,
                ),
        });
        if (!target) {
            setAttempt(undefined);
            setStartError('The test could not start. Check the connection and try again.');
        }
    };

    return (
        <div className="sql-function-details">
            <header>
                <span className="sql-function-badge">
                    <Icon name="function" />
                    SQL UDF
                </span>
                <h3>{fn.name}</h3>
                <p>A user-defined SQL function on this ClickHouse server.</p>
            </header>
            <section aria-label="Function tester" className="sql-function-tester">
                <span className="sql-function-eyebrow">FUNCTION TESTER</span>
                <FunctionInputs
                    parameters={fn.parameters}
                    arguments_={arguments_}
                    onChange={changeArgument}
                />
                {!sql && (
                    <p className="sql-function-error" role="status">
                        {validation}
                    </p>
                )}
                <Button variant="primary" disabled={!sql || busy || !trusted} onClick={test}>
                    <Icon name="play" />
                    {busy && attempt ? 'Running…' : 'Run on ClickHouse'}
                </Button>
                {(startError || failure || (attempt?.sql === sql && run?.error)) && (
                    <p className="sql-function-error" role="alert">
                        {startError || failure || run?.error?.message}
                    </p>
                )}
                {output !== undefined ? (
                    <div className="sql-function-output" aria-live="polite">
                        <div>
                            <span className="sql-function-eyebrow">RESULT</span>
                            <small>
                                {result?.columns[0]?.type} · {Math.round(run?.elapsedMs ?? 0)} ms
                            </small>
                        </div>
                        <FunctionOutput
                            value={output}
                            type={result?.columns[0]?.type}
                            rawJson={result?.rows[0]?.[1]}
                        />
                    </div>
                ) : (
                    <p className="sql-function-input-hint">
                        Run to see the server result here and in Results.
                    </p>
                )}
            </section>
            <div className="sql-function-preview">
                <span className="sql-function-eyebrow">TEST SQL</span>
                <pre>{sql || 'Enter valid inputs to preview SQL.'}</pre>
                <Button
                    variant="ghost"
                    className="toolbar-small"
                    disabled={!sql}
                    onClick={() => onCopy(sql, `function-test:${sql}`)}
                >
                    <Icon name="copy" />
                    {copiedId === `function-test:${sql}` ? 'Copied' : 'Copy SQL'}
                </Button>
            </div>
            <details className="sql-function-definition">
                <summary>Function definition</summary>
                <pre>{fn.createQuery}</pre>
                <Button
                    variant="ghost"
                    className="toolbar-small"
                    onClick={() => onCopy(fn.createQuery, `function-definition:${fn.createQuery}`)}
                >
                    {copiedId === `function-definition:${fn.createQuery}`
                        ? 'Copied'
                        : 'Copy definition'}
                </Button>
            </details>
        </div>
    );
}
