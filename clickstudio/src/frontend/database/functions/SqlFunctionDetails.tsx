import type { OpenSqlDraft } from '../../queries/execution/sql-draft-observer';
import { terminal } from '../../queries/execution/status';
import { useFunctionTestResult } from './useFunctionTestResult';
import { useId, useState } from 'react';
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
import { resultTypeGroup } from '../../queries/results/result-type-group';

export type FunctionTestEvidence = { busy: boolean };
type TestAttempt = { id: string; sql: string; submitting: boolean; runId?: string; error?: string };
type FunctionDetailsTab = 'test' | 'definition';

function FunctionDeleteAction({
    allowed,
    busy,
    trusted,
    reason,
    onDelete,
}: {
    allowed: boolean;
    busy: boolean;
    trusted: boolean;
    reason: string;
    onDelete: () => void;
}) {
    return (
        <div className="object-utility-actions">
            <Button
                variant="danger"
                className="toolbar-small"
                disabled={!allowed || busy || !trusted}
                title={!allowed ? reason : undefined}
                onClick={onDelete}
            >
                <Icon name="trash" />
                Delete function
            </Button>
        </div>
    );
}

function FunctionDetailsTabs({
    id,
    active,
    onChange,
}: {
    id: string;
    active: FunctionDetailsTab;
    onChange: (tab: FunctionDetailsTab) => void;
}) {
    const tabs = [
        { key: 'test', label: 'Test' },
        { key: 'definition', label: 'Definition' },
    ] as const;
    return (
        <div className="object-detail-tabs" role="tablist" aria-label="Function details">
            {tabs.map((tab, index) => (
                <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    id={`${id}-${tab.key}-tab`}
                    aria-controls={`${id}-${tab.key}-panel`}
                    aria-selected={active === tab.key}
                    tabIndex={active === tab.key ? 0 : -1}
                    onClick={() => onChange(tab.key)}
                    onKeyDown={event => {
                        let next: number;
                        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft')
                            next = 1 - index;
                        else if (event.key === 'Home') next = 0;
                        else if (event.key === 'End') next = 1;
                        else return;
                        event.preventDefault();
                        onChange(tabs[next]!.key);
                        const buttons =
                            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                                '[role="tab"]',
                            );
                        buttons?.[next]?.focus();
                    }}
                >
                    {tab.label}
                </button>
            ))}
        </div>
    );
}

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
    if (Array.isArray(value))
        return (
            <pre className="sql-function-output-items">
                {`[${value.map(item => JSON.stringify(item)).join(', ')}]`}
            </pre>
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
                    <div className="sql-function-argument-heading">
                        <label htmlFor={`function-argument-${index}`}>{parameter}</label>
                        <select
                            className="sql-function-format"
                            aria-label={`${parameter} input format`}
                            value={arguments_[index]!.kind}
                            onChange={event =>
                                onChange(index, {
                                    ...arguments_[index]!,
                                    kind: event.target.value === 'map' ? 'map' : 'json',
                                })
                            }
                        >
                            <option value="json">JSON</option>
                            <option value="map">Map entries</option>
                        </select>
                    </div>
                    <textarea
                        id={`function-argument-${index}`}
                        aria-describedby={
                            arguments_[index]!.kind === 'map'
                                ? `function-map-hint-${index}`
                                : 'function-input-hint'
                        }
                        rows={Math.min(6, arguments_[index]!.value.split('\n').length)}
                        spellCheck={false}
                        value={arguments_[index]!.value}
                        onChange={event =>
                            onChange(index, { ...arguments_[index]!, value: event.target.value })
                        }
                    />
                    {arguments_[index]!.kind === 'map' && (
                        <small
                            id={`function-map-hint-${index}`}
                            className="sql-function-input-hint"
                        >
                            Key / value pairs: [[key, value], …].
                        </small>
                    )}
                </div>
            ))}
            <small id="function-input-hint" className="sql-function-input-hint">
                JSON values: "text", [1, 2, 3], true or null.
            </small>
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
    canDelete,
    deleteReason,
    onDelete,
}: {
    fn: SqlFunction;
    evidence?: FunctionTestEvidence;
    trusted: boolean;
    onRun: OpenSqlDraft;
    onCopy: (sql: string, id: string) => void;
    copiedId?: string;
    canDelete: boolean;
    deleteReason: string;
    onDelete: () => void;
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
    const [activeTab, setActiveTab] = useState<FunctionDetailsTab>('test');
    const tabsId = useId();
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
    const testError = startError || failure || (attempt?.sql === sql && run?.error?.message);
    let resultHint = 'Run the function to see its result.';
    if (attempt && attempt.sql !== sql)
        resultHint = 'Arguments changed. Run again to update the result.';
    if (!trusted) resultHint = 'Trust this connection to run the function.';
    if (busy) resultHint = 'Waiting for ClickHouse…';
    const changeArgument = (index: number, next: FunctionArgument) => {
        setArguments(current => current.map((argument, at) => (at === index ? next : argument)));
        setStartError('');
    };
    const test = () => {
        if (!sql || busy || !trusted) return;
        setActiveTab('test');
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
        <section
            className="object-details sql-function-details"
            data-kind="function"
            aria-label="Selected function"
        >
            <header className="object-details-hero">
                <div className="object-details-title">
                    <span className="object-kind-badge">SQL UDF</span>
                    <h3>{fn.name}</h3>
                </div>
                <small>
                    Server-wide · {fn.parameters.length}{' '}
                    {fn.parameters.length === 1 ? 'argument' : 'arguments'}
                </small>
            </header>
            <div className="object-relation-actions">
                <div className="object-action-grid sql-function-actions">
                    <Button
                        variant="primary"
                        className="toolbar-small object-preview-action"
                        disabled={!sql || busy || !trusted}
                        onClick={test}
                    >
                        <Icon name="play" />
                        {busy && attempt ? 'Running…' : 'Run on ClickHouse'}
                    </Button>
                    <Button
                        variant="ghost"
                        className="toolbar-small object-copy-name-action"
                        disabled={!sql}
                        onClick={() => onCopy(sql, `function-test:${sql}`)}
                    >
                        <Icon name="copy" />
                        {copiedId === `function-test:${sql}` ? 'Copied' : 'Copy SQL'}
                    </Button>
                </div>
                <FunctionDeleteAction
                    allowed={canDelete}
                    busy={busy}
                    trusted={trusted}
                    reason={deleteReason}
                    onDelete={onDelete}
                />
            </div>
            <FunctionDetailsTabs id={tabsId} active={activeTab} onChange={setActiveTab} />
            <div
                className="sql-function-panel"
                role="tabpanel"
                hidden={activeTab !== 'test'}
                id={`${tabsId}-test-panel`}
                aria-labelledby={`${tabsId}-test-tab`}
            >
                <section aria-label="Function tester" className="sql-function-tester">
                    <div className="sql-function-arguments">
                        <h4>Arguments</h4>
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
                    </div>
                    <section
                        aria-label="Function result"
                        className="sql-function-result"
                        aria-live="polite"
                    >
                        <div className="sql-function-result-heading">
                            <h4>Result</h4>
                            {!testError && output !== undefined && (
                                <div className="sql-function-result-meta">
                                    {result?.columns[0]?.type && (
                                        <code
                                            className="result-type-badge"
                                            title={result.columns[0].type}
                                            data-type-group={resultTypeGroup(
                                                result.columns[0].type,
                                            )}
                                        >
                                            {result.columns[0].type}
                                        </code>
                                    )}
                                    <small>{Math.round(run?.elapsedMs ?? 0)} ms</small>
                                </div>
                            )}
                        </div>
                        {testError && (
                            <p className="sql-function-error" role="alert">
                                {testError}
                            </p>
                        )}
                        {!testError && output !== undefined && (
                            <div className="sql-function-output">
                                <FunctionOutput
                                    value={output}
                                    type={result?.columns[0]?.type}
                                    rawJson={result?.rows[0]?.[1]}
                                />
                            </div>
                        )}
                        {!testError && output === undefined && (
                            <p className="sql-function-result-empty">{resultHint}</p>
                        )}
                    </section>
                    <div className="sql-function-preview">
                        <h4>Test query</h4>
                        <pre>{sql || 'Enter valid arguments to preview SQL.'}</pre>
                    </div>
                </section>
            </div>
            <div
                className="sql-function-panel"
                role="tabpanel"
                hidden={activeTab !== 'definition'}
                id={`${tabsId}-definition-panel`}
                aria-labelledby={`${tabsId}-definition-tab`}
            >
                <div className="sql-function-definition">
                    <h4>Function definition</h4>
                    <pre>{fn.createQuery}</pre>
                    <Button
                        variant="secondary"
                        className="toolbar-small"
                        onClick={() =>
                            onCopy(fn.createQuery, `function-definition:${fn.createQuery}`)
                        }
                    >
                        {copiedId === `function-definition:${fn.createQuery}`
                            ? 'Copied'
                            : 'Copy definition'}
                    </Button>
                </div>
            </div>
        </section>
    );
}
