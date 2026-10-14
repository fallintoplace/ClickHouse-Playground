import type { NativeParseSnapshot, NativeParserStatus } from '../../../../shared/sql/parser';
import { nativeHighlightRanges } from '../../../../shared/sql/parser';
import { sqlLexer } from '../../../../shared/sql/lexer';
import { asNativeAstObject } from './native-ast';
import { Button, cx, Spinner } from '../../../ui/components/primitives';
import { Icon } from '../../../ui/components/icons';

type Props = {
    status: NativeParserStatus;
    snapshot?: NativeParseSnapshot;
    onRetry: () => void;
};

const MAX_AST_PREVIEW_LENGTH = 100_000;

export function NativeParserInspector({ status, snapshot, onRetry }: Props) {
    const getParserTone = () => {
        switch (status) {
            case 'ready':
                return 'is-trusted';

            case 'unavailable':
                return 'is-warning';

            default:
                return 'is-running';
        }
    };
    const getParserStatusLabel = () => {
        switch (status) {
            case 'ready':
                return 'Ready';
            case 'loading':
                return 'Loading';
            default:
                return 'Unavailable';
        }
    };
    const nativeLexerReady = sqlLexer.engine === 'clickhouse';
    return (
        <section
            className="inspector-section parser-inspector"
            aria-label="ClickHouse parser details"
        >
            <div className={cx('parser-status-card', `parser-status-${status}`)}>
                <div
                    className="parser-status-main"
                    role="status"
                    aria-label={`ClickHouse native parser: ${getParserStatusLabel()}`}
                >
                    <div className="parser-status-copy">
                        <strong>ClickHouse native parser</strong>
                        <small>Local WebAssembly</small>
                    </div>
                    <div className="parser-status-meta">
                        <span className={cx('parser-status-state', getParserTone())}>
                            <span
                                className={cx('status-light', getParserTone())}
                                aria-hidden="true"
                            />
                            {getParserStatusLabel()}
                        </span>
                        {snapshot && (
                            <span
                                className="parser-duration"
                                aria-label={`Native parser time: ${snapshot.elapsedMs.toFixed(1)} ms`}
                            >
                                {snapshot.elapsedMs.toFixed(1)} ms
                            </span>
                        )}
                        {status === 'unavailable' && (
                            <Button variant="ghost" className="toolbar-small" onClick={onRetry}>
                                Retry
                            </Button>
                        )}
                    </div>
                </div>
                <div
                    className="parser-lexer-status"
                    role="status"
                    aria-label={`SQL lexer: ${nativeLexerReady ? 'ClickHouse ready' : 'fallback active'}`}
                >
                    <div className="parser-status-copy">
                        <strong>SQL lexer</strong>
                        <small>{nativeLexerReady ? 'ClickHouse' : 'Fallback'}</small>
                    </div>
                    <span
                        className={cx(
                            'parser-status-state',
                            nativeLexerReady ? 'is-trusted' : 'is-warning',
                        )}
                    >
                        <span
                            className={cx(
                                'status-light',
                                nativeLexerReady ? 'is-trusted' : 'is-warning',
                            )}
                            aria-hidden="true"
                        />
                        {nativeLexerReady ? 'Ready' : 'Fallback active'}
                    </span>
                </div>
            </div>

            {status === 'loading' && (
                <div className="inspector-empty">
                    <Spinner />
                    <strong>Loading parser</strong>
                    <p>SQL stays available while the native parser starts.</p>
                </div>
            )}
            {status === 'unavailable' && (
                <div className="inspector-empty">
                    <Icon name="parser" />
                    <strong>Parser unavailable</strong>
                    <p>
                        The SQL editor stays available when parser loading fails. Retry here to
                        check the parser artifact again.
                    </p>
                </div>
            )}
            {status === 'ready' && !snapshot && (
                <div className="inspector-empty">
                    <Icon name="parser" />
                    <strong>Waiting for SQL</strong>
                    <p>Native parse results appear here after the current SQL is checked.</p>
                </div>
            )}
            {status === 'ready' &&
                snapshot?.statements.map((statement, index) => {
                    const { result } = statement;
                    const nodeType = asNativeAstObject(result.ast)?.type;
                    const astType = typeof nodeType === 'string' ? nodeType : undefined;
                    const functions = [
                        ...new Set(
                            nativeHighlightRanges(statement.sql, 0, result.highlights)
                                .filter(range => range.type === 'function')
                                .map(range => statement.sql.slice(range.from, range.to)),
                        ),
                    ];
                    const astJson =
                        result.ast === undefined || result.ast === null
                            ? undefined
                            : JSON.stringify(result.ast, null, 2);
                    const astPreview =
                        astJson && astJson.length > MAX_AST_PREVIEW_LENGTH
                            ? `${astJson.slice(0, MAX_AST_PREVIEW_LENGTH)}\n… AST preview truncated …`
                            : astJson;
                    return (
                        <article
                            className="parser-statement-card"
                            key={`${statement.from}-${index}`}
                        >
                            <header className="parser-statement-heading">
                                <span>Statement {index + 1}</span>
                                <span
                                    className={cx(
                                        'parser-validity',
                                        result.error ? 'is-invalid' : 'is-valid',
                                    )}
                                >
                                    <span className="status-light" />
                                    {result.error ? 'Syntax error' : 'Syntax valid'}
                                </span>
                            </header>
                            {result.error ? (
                                <div className="parser-error" role="alert">
                                    <strong>{result.error.message}</strong>
                                    {result.error.expected?.length ? (
                                        <div className="parser-expected">
                                            <span>Expected</span>
                                            <div>
                                                {result.error.expected.slice(0, 12).map(token => (
                                                    <code key={token}>{token}</code>
                                                ))}
                                                {result.error.expected.length > 12 && (
                                                    <small>
                                                        +{result.error.expected.length - 12} more
                                                    </small>
                                                )}
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            ) : (
                                <dl className="parser-facts">
                                    <div>
                                        <dt>AST type</dt>
                                        <dd>{astType ?? 'Parsed successfully'}</dd>
                                    </div>
                                    <div>
                                        <dt>Syntax highlights</dt>
                                        <dd>{result.highlights?.length ?? 0}</dd>
                                    </div>
                                    <div>
                                        <dt>AST data</dt>
                                        <dd>
                                            {astJson
                                                ? 'Available'
                                                : (result.ast_error ??
                                                  'Not available in this build')}
                                        </dd>
                                    </div>
                                </dl>
                            )}
                            {functions.length > 0 && (
                                <div className="parser-functions">
                                    <span>Functions</span>
                                    <div>
                                        {functions.slice(0, 20).map(name => (
                                            <code key={name}>{name}</code>
                                        ))}
                                        {functions.length > 20 && (
                                            <small>+{functions.length - 20} more</small>
                                        )}
                                    </div>
                                </div>
                            )}
                            {astPreview && (
                                <details className="parser-ast">
                                    <summary>
                                        <span>View AST</span>
                                        <code>JSON</code>
                                    </summary>
                                    <pre>{astPreview}</pre>
                                    {astJson && astJson.length > MAX_AST_PREVIEW_LENGTH && (
                                        <small>
                                            AST preview is limited to{' '}
                                            {MAX_AST_PREVIEW_LENGTH.toLocaleString()} characters.
                                        </small>
                                    )}
                                </details>
                            )}
                        </article>
                    );
                })}
        </section>
    );
}
