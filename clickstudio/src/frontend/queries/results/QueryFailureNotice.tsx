import type { ApiError } from '../../../shared/common/errors';
import type { Copy } from '../../ui/copy';
import {
    queryFailureSummary,
    sqlErrorContext,
    sqlErrorLineColumn,
    type SqlErrorRange,
} from '../editor/sql-error';

const readableErrorTypes: Record<string, string> = {
    CANCELLED: 'Query cancelled',
    CLICKHOUSE_ERROR: 'Query error',
    CLICKHOUSE_PERMISSION: 'Permission denied',
    CLICKHOUSE_46: 'Unknown function',
    CLICKHOUSE_47: 'Unknown identifier',
    CLICKHOUSE_60: 'Unknown table',
    CLICKHOUSE_62: 'SQL syntax error',
    CLICKHOUSE_215: 'Invalid aggregation',
    DEADLINE_EXCEEDED: 'Query timed out',
    NETWORK_RESPONSE: 'Request failed',
    READ_ONLY_SQL: 'Read-only mode blocked this query',
    SERVER_RESOURCE_LIMIT: 'Resource limit exceeded',
    SQL_SYNTAX: 'SQL syntax error',
    SYNTAX_ERROR: 'SQL syntax error',
};
const readableErrorWords: Record<string, string> = {
    api: 'API',
    clickhouse: 'ClickHouse',
    http: 'HTTP',
    id: 'ID',
    sql: 'SQL',
    uuid: 'UUID',
};

function readableErrorType(code: string) {
    const label = Object.hasOwn(readableErrorTypes, code) ? readableErrorTypes[code] : undefined;
    if (label) return label;
    const clickHouseNumber = /^CLICKHOUSE_(\d+)$/.exec(code)?.[1];
    if (clickHouseNumber) return `ClickHouse error (${clickHouseNumber})`;
    const words = code
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean);
    return words.length
        ? words
              .map(
                  (word, index) =>
                      readableErrorWords[word.toLowerCase()] ??
                      (index === 0
                          ? word[0]!.toUpperCase() + word.slice(1).toLowerCase()
                          : word.toLowerCase()),
              )
              .join(' ')
        : 'Query error';
}

function errorSource(code: string) {
    if (code.startsWith('CLICKHOUSE_') || code === 'SERVER_RESOURCE_LIMIT') return 'ClickHouse';
    return undefined;
}

export function QueryFailureNotice({
    error,
    sql,
    copy,
    errorRange,
    location,
    runId,
    requestId,
}: {
    error: ApiError;
    sql?: string;
    copy: Copy['common'];
    errorRange?: SqlErrorRange;
    location?: { line: number; column: number };
    runId?: string;
    requestId?: string;
}) {
    const diagnostic = queryFailureSummary(error);
    const source = errorSource(error.code);
    const type = readableErrorType(error.code);
    let title: string;

    if (diagnostic.syntax) {
        if (diagnostic.token) {
            title = copy.syntaxErrorNearToken.replace('{token}', diagnostic.token);
        } else {
            title = copy.syntaxError;
        }
    } else {
        title = copy.queryFailed;
    }
    const lineOffset =
        sql && errorRange && location
            ? location.line - sqlErrorLineColumn(sql, errorRange.from).line
            : 0;
    const context = sql ? sqlErrorContext(sql, errorRange, lineOffset) : [];
    return (
        <div className="result-failure" data-testid="query-failure">
            <div className="result-failure-message" role="alert">
                <div className="result-failure-heading">
                    <div className="result-failure-title">
                        <span className="status-light is-error" aria-hidden="true" />
                        <h3>{title}</h3>
                    </div>
                </div>
                {!diagnostic.syntax && diagnostic.message && (
                    <p className="result-failure-summary">{diagnostic.message}</p>
                )}
            </div>
            <details className="result-failure-diagnostics">
                <summary>{copy.errorDetails}</summary>
                <div className="result-failure-diagnostic-container">
                    <div className="result-failure-diagnostic-meta">
                        {source && (
                            <span className="result-failure-source">
                                {copy.errorSource}: {source}
                            </span>
                        )}
                        <span className="result-failure-diagnostic-field">
                            {copy.errorType}: {type}
                        </span>
                        {location && (
                            <span className="result-failure-location">
                                {copy.errorLocation
                                    .replace('{line}', String(location.line))
                                    .replace('{column}', String(location.column))}
                            </span>
                        )}
                        <span className="result-failure-diagnostic-field">
                            {copy.errorCode}:{' '}
                            <code className="result-failure-code">{error.code}</code>
                        </span>
                        {runId && (
                            <span className="result-failure-diagnostic-field">
                                {copy.errorRunId}:{' '}
                                <code className="result-failure-code">{runId}</code>
                            </span>
                        )}
                        {requestId && (
                            <span className="result-failure-diagnostic-field">
                                {copy.errorRequestId}:{' '}
                                <code className="result-failure-code">{requestId}</code>
                            </span>
                        )}
                    </div>
                    <pre className="result-failure-detail">{error.message}</pre>
                    {sql && (
                        <>
                            <h3 className="result-failure-sql-label">{copy.failedSql}</h3>
                            <pre className="result-execution-sql is-full">{sql}</pre>
                        </>
                    )}
                </div>
            </details>
            {sql && (
                <>
                    <h3 className="result-failure-sql-label">{copy.failedSql}</h3>
                    <pre className="result-execution-sql is-context">
                        {context.map(line => (
                            <span
                                className={`result-failure-line${line.marker ? ' is-error' : ''}`}
                                key={line.number}
                            >
                                <span className="result-failure-line-number" aria-hidden="true">
                                    {line.number}
                                </span>
                                <span>
                                    {line.text}
                                    {line.marker && (
                                        <span className="result-failure-marker">
                                            {'\n'}
                                            {line.marker}
                                        </span>
                                    )}
                                </span>
                            </span>
                        ))}
                    </pre>
                </>
            )}
        </div>
    );
}
