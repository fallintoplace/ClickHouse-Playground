import { THEMES, DEFAULT_ACCENT } from '../ui/styles/appearance-types';
import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type Dispatch,
    type SetStateAction,
} from 'react';
import { api, apiResponses, message, post } from '../api/client';
import { Button, cx, Spinner } from '../ui/components/primitives';
import { Icon } from '../ui/components/icons';
import { CloudConnectionDialog } from '../database/connections/CloudConnectionDialog';
import {
    CLICKHOUSE_CLOUD_CONNECTION_ID,
    disconnectClickHouseCloud,
    restoreClickHouseCloudSession,
    type SavedCloudConnectionProfile,
} from '../database/connections/cloud-connection';
import { Workspace } from '../workspace/Workspace';
import { copy, type Copy, themeOptions, type Theme } from '../ui/copy';
import { useWorkspaceRoute } from './useWorkspaceRoute';
import type { Connected, Session } from '../workspace/workspace-types';
import { resolveConnectionSelection } from '../database/connections/selection';

const connectionLabel = (connection: Connected, demo: boolean) => {
    if (demo && connection.dataSource === 'fixture') {
        if (connection.id === 'demo') {
            return 'Sample data';
        }

        return 'Another sample';
    }

    return connection.name;
};
const storedPreference = (key: string): string | null => {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};
const pref = <T extends string>(key: string, values: readonly T[], fallback: T): T => {
    const value = storedPreference(key);
    return values.find(candidate => candidate === value) ?? fallback;
};
function writeConnectionToUrl(id: string) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('connection', id);
    else url.searchParams.delete('connection');
    window.history.replaceState(window.history.state, '', url);
}

function connectionStatusFor(
    connection: Connected | undefined,
    isCloudConnection: boolean,
    connectionNeedsTest: boolean,
): 'Connected · read/write' | 'Retest needed' | 'Read-only' | 'Review needed' | 'Test needed' {
    if (isCloudConnection) return 'Connected · read/write';
    if (connection?.trusted) return connectionNeedsTest ? 'Retest needed' : 'Read-only';
    if (connection?.manifest) return 'Review needed';
    return 'Test needed';
}

function cloudProfileDefaults(connection?: Connected): SavedCloudConnectionProfile | undefined {
    if (!connection) return undefined;
    try {
        const host = new URL(connection.host);
        if (!host.hostname.toLowerCase().endsWith('.clickhouse.cloud')) return undefined;
        return { host: host.origin, database: connection.database, username: connection.username };
    } catch {
        return undefined;
    }
}

function databaseDeletionHandler(
    setConnections: Dispatch<SetStateAction<Connected[]>>,
    source: Connected,
) {
    return (database: string) =>
        setConnections(current =>
            current.map(item =>
                item.id === source.id &&
                item.host === source.host &&
                item.username === source.username &&
                item.manifest?.testedAt === source.manifest?.testedAt &&
                item.database === database
                    ? { ...item, database: 'default' }
                    : item,
            ),
        );
}

function App() {
    const [theme, setTheme] = useState<Theme>(() =>
        pref('clickstudio:theme', THEMES, 'click-dark'),
    );
    const { experience, standardHref, returnToWorkspace } = useWorkspaceRoute();
    const [session, setSession] = useState<Session>();
    const [connections, setConnections] = useState<Connected[]>([]);
    const [connectionId, setConnectionId] = useState(
        () => new URLSearchParams(location.search).get('connection') ?? '',
    );
    const [sessionError, setSessionError] = useState('');
    const [token, setToken] = useState('');
    const [busy, setBusy] = useState(false);
    const [connectionPicker, setConnectionPicker] = useState(false);
    const [cloudDialogOpen, setCloudDialogOpen] = useState(false);
    const [connectionActionBusy, setConnectionActionBusy] = useState(false);
    const [cloudConnectionError, setCloudConnectionError] = useState('');
    const trustActionRef = useRef<() => Promise<void>>(async () => undefined);
    const testConnectionActionRef = useRef<() => Promise<void>>(async () => undefined);
    const connection = connections.find(item => item.id === connectionId) ?? connections[0];
    const hasPreviewSourceSwitcher = Boolean(
        session?.demo && connections.some(item => item.id === 'playground'),
    );
    const hasCloudConnection = connections.some(item => item.id === CLICKHOUSE_CLOUD_CONNECTION_ID);
    const persistCloudInLocalServer = session?.cloudConnectionPersistence === 'local-server';
    const isSampleData = Boolean(session?.demo && connection?.dataSource === 'fixture');
    const isPlayground = Boolean(connection?.id === 'playground');
    const isCloudConnection = connection?.id === CLICKHOUSE_CLOUD_CONNECTION_ID;
    const otherConnections = connection
        ? connections.filter(
              item =>
                  item.id !== connection.id &&
                  (hasPreviewSourceSwitcher || !session?.demo || experience === 'expert'),
          )
        : [];
    const sourceChoices = hasPreviewSourceSwitcher
        ? connections
              .filter(
                  item => item.id === 'playground' || item.id === CLICKHOUSE_CLOUD_CONNECTION_ID,
              )
              .sort((left, right) => {
                  const rank = (id: string) => (id === 'playground' ? 0 : 1);
                  return rank(left.id) - rank(right.id);
              })
        : otherConnections;
    const dark = theme === 'click-dark';
    const selectConnection = useCallback((id: string) => {
        setConnectionId(id);
        writeConnectionToUrl(id);
    }, []);

    useEffect(() => {
        const update = () =>
            setConnectionId(
                resolveConnectionSelection(
                    connections,
                    new URLSearchParams(window.location.search).get('connection') ?? '',
                ),
            );
        window.addEventListener('popstate', update);
        return () => window.removeEventListener('popstate', update);
    }, [connections]);

    const disconnectCloud = async () => {
        setCloudConnectionError('');
        try {
            await disconnectClickHouseCloud();
        } catch (error) {
            setCloudConnectionError(`Could not disconnect Cloud: ${message(error)}`);
            return;
        }
        setConnections(current =>
            current.filter(item => item.id !== CLICKHOUSE_CLOUD_CONNECTION_ID),
        );
        if (isCloudConnection) {
            const fallback = connections.find(item => item.id === 'playground') ?? connections[0];
            if (fallback) selectConnection(fallback.id);
        }
        setConnectionPicker(false);
    };

    const connectCloud = (connected: Connected) => {
        setConnections(current => [...current.filter(item => item.id !== connected.id), connected]);
        setCloudConnectionError('');
        selectConnection(connected.id);
        setConnectionPicker(false);
        setCloudDialogOpen(false);
    };

    useEffect(() => {
        document.documentElement.dataset.accent = DEFAULT_ACCENT;
    }, []);

    useEffect(() => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.lang = 'en';
        document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
        document
            .querySelector('meta[name="theme-color"]')
            ?.setAttribute(
                'content',
                getComputedStyle(document.documentElement)
                    .getPropertyValue('--browser-chrome')
                    .trim(),
            );
        try {
            localStorage.setItem('clickstudio:theme', theme);
        } catch {}
    }, [dark, theme]);

    const loadSession = useCallback(async () => {
        const next = await api('/session', apiResponses.isSession);
        setSession(next);
        if (next.principal) {
            let profiles = await api(
                '/connections',
                apiResponses.arrayOf(apiResponses.isConnected),
            );
            if (next.cloudConnectionPersistence === 'local-server') {
                try {
                    const cloud = await restoreClickHouseCloudSession();
                    if (cloud)
                        profiles = [
                            ...profiles.filter(item => item.id !== CLICKHOUSE_CLOUD_CONNECTION_ID),
                            cloud,
                        ];
                    else
                        profiles = profiles.filter(
                            item => item.id !== CLICKHOUSE_CLOUD_CONNECTION_ID,
                        );
                    setCloudConnectionError('');
                } catch (error) {
                    setCloudConnectionError(
                        `Could not restore Cloud connection: ${message(error)}`,
                    );
                }
            }
            setConnections(profiles);
            const selected = resolveConnectionSelection(
                profiles,
                new URLSearchParams(location.search).get('connection') ?? '',
            );
            setConnectionId(selected);
            writeConnectionToUrl(selected);
        }
    }, []);

    useEffect(() => {
        void loadSession().catch(error => setSessionError(message(error)));
    }, [loadSession]);

    const login = async () => {
        if (!token || busy) return;
        setBusy(true);
        setSessionError('');
        try {
            await post('/session', { token }, apiResponses.isUnknown);
            setToken('');
            await loadSession();
        } catch (error) {
            setSessionError(message(error));
        } finally {
            setBusy(false);
        }
    };

    const runConnectionAction = async (testConnection: boolean) => {
        if (connectionActionBusy) return;
        setConnectionActionBusy(true);
        try {
            await (testConnection ? testConnectionActionRef.current : trustActionRef.current)();
        } finally {
            setConnectionActionBusy(false);
        }
    };

    if (!session)
        return (
            <SessionLoadingScreen
                sessionError={sessionError}
                onRetry={() => {
                    setSessionError('');
                    void loadSession().catch(error => setSessionError(message(error)));
                }}
            />
        );
    if (!session.principal)
        return (
            <LoginScreen
                sessionError={sessionError}
                token={token}
                busy={busy}
                onTokenChange={setToken}
                onLogin={() => void login()}
            />
        );

    const connectionNeedsTest = Boolean(connection && !session.demo && !connection.manifest);
    const connectionStatus = connectionStatusFor(
        connection,
        isCloudConnection,
        connectionNeedsTest,
    );

    return (
        <div className="application" data-experience={experience}>
            <header className="topbar">
                <Brand />
                <div className="topbar-divider" />
                <ConnectionPicker
                    connectionPicker={connectionPicker}
                    setConnectionPicker={setConnectionPicker}
                    isSampleData={isSampleData}
                    isPlayground={isPlayground}
                    isCloudConnection={isCloudConnection}
                    connection={connection}
                    copy={copy}
                    session={session}
                    connectionNeedsTest={connectionNeedsTest}
                    connectionStatus={connectionStatus}
                    hasPreviewSourceSwitcher={hasPreviewSourceSwitcher}
                    persistCloudInLocalServer={persistCloudInLocalServer}
                    connectionActionBusy={connectionActionBusy}
                    runConnectionAction={runConnectionAction}
                    sourceChoices={sourceChoices}
                    selectConnection={selectConnection}
                    hasCloudConnection={hasCloudConnection}
                    setCloudDialogOpen={setCloudDialogOpen}
                />
                {hasCloudConnection ? (
                    <div className="cloud-connection-actions">
                        <Button
                            variant="danger"
                            className="cloud-topbar-action cloud-topbar-disconnect"
                            onClick={() => void disconnectCloud()}
                        >
                            Disconnect Cloud
                        </Button>
                    </div>
                ) : (
                    (!session.demo || hasPreviewSourceSwitcher) && (
                        <div className="cloud-connection-actions">
                            <Button
                                variant="secondary"
                                className="cloud-topbar-action cloud-topbar-connect"
                                onClick={() => {
                                    setConnectionPicker(false);
                                    setCloudDialogOpen(true);
                                }}
                            >
                                Connect Cloud
                            </Button>
                        </div>
                    )
                )}
                <div className="topbar-spacer" />
                {renderAppearanceControls({
                    copy,
                    experience,
                    standardHref,
                    returnToWorkspace,
                    theme,
                    setTheme,
                })}
            </header>
            {cloudConnectionError && (
                <div className="callout callout-error cloud-session-error" role="alert">
                    {cloudConnectionError}
                </div>
            )}
            {connection ? (
                <Workspace
                    key={connection.id}
                    connection={connection}
                    connectionLabel={connectionLabel(connection, session.demo)}
                    connections={connections}
                    onSelectConnection={selectConnection}
                    onDatabaseDeleted={databaseDeletionHandler(setConnections, connection)}
                    onRefreshConnections={async () => {
                        const latest = await api(
                            '/connections',
                            apiResponses.arrayOf(apiResponses.isConnected),
                        );
                        setConnections(latest);
                    }}
                    trustActionRef={trustActionRef}
                    testConnectionActionRef={testConnectionActionRef}
                    demoMode={session.demo}
                    experience={experience}
                    dark={dark}
                    copy={copy}
                />
            ) : (
                <div className="empty-connection">
                    <Icon name="schema" />
                    <h1>{copy.app.name}</h1>
                    <p>No connection profiles are configured for this workspace.</p>
                </div>
            )}
            {cloudDialogOpen && (
                <CloudConnectionDialog
                    initialProfile={cloudProfileDefaults(connection)}
                    persistInLocalServer={persistCloudInLocalServer}
                    onClose={() => setCloudDialogOpen(false)}
                    onConnect={connectCloud}
                />
            )}
        </div>
    );
}

function SessionLoadingScreen({
    sessionError,
    onRetry,
}: {
    sessionError: string;
    onRetry: () => void;
}) {
    return (
        <main className="auth-screen">
            <section className="auth-card animate-enter">
                <Brand />
                <span className="eyebrow mt-8">{copy.auth.privateWorkspace}</span>
                <h1>{sessionError ? copy.auth.unavailable : copy.auth.opening}</h1>
                {sessionError ? (
                    <>
                        <p>{sessionError}</p>
                        <Button variant="primary" onClick={onRetry}>
                            {copy.auth.retry}
                        </Button>
                    </>
                ) : (
                    <div className="splash-status">
                        <Spinner />
                        <p>{copy.auth.opening}</p>
                    </div>
                )}
            </section>
        </main>
    );
}

function LoginScreen({
    sessionError,
    token,
    busy,
    onTokenChange,
    onLogin,
}: {
    sessionError: string;
    token: string;
    busy: boolean;
    onTokenChange: (token: string) => void;
    onLogin: () => void;
}) {
    return (
        <main className="auth-screen">
            <form
                className="auth-card animate-enter"
                onSubmit={event => {
                    event.preventDefault();
                    onLogin();
                }}
            >
                <Brand />
                <span className="eyebrow mt-8">{copy.auth.privateWorkspace}</span>
                <h1>{copy.auth.title}</h1>
                <p>{copy.auth.description}</p>
                <label className="field-label">
                    {copy.auth.token}
                    <input
                        className="field-input mt-2"
                        type="password"
                        autoComplete="current-password"
                        value={token}
                        onChange={event => onTokenChange(event.target.value)}
                        autoFocus
                    />
                </label>
                {sessionError && <div className="callout callout-error">{sessionError}</div>}
                <Button
                    variant="primary"
                    type="submit"
                    disabled={busy || !token}
                    className="mt-4 w-full"
                >
                    {busy ? copy.auth.opening : copy.auth.open}
                    <span className="button-arrow">↗</span>
                </Button>
                <div className="auth-footnote">
                    <Icon name="lock" /> {copy.auth.credentialsNotice}
                </div>
            </form>
        </main>
    );
}

function ConnectionPicker({
    connectionPicker,
    setConnectionPicker,
    isSampleData,
    isPlayground,
    isCloudConnection,
    connection,
    copy,
    session,
    connectionNeedsTest,
    connectionStatus,
    hasPreviewSourceSwitcher,
    persistCloudInLocalServer,
    connectionActionBusy,
    runConnectionAction,
    sourceChoices,
    selectConnection,
    hasCloudConnection,
    setCloudDialogOpen,
}: {
    connectionPicker: boolean;
    setConnectionPicker: import('react').Dispatch<import('react').SetStateAction<boolean>>;
    isSampleData: boolean;
    isPlayground: boolean;
    isCloudConnection: boolean;
    connection: Connected | undefined;
    copy: Copy;
    session: Session;
    connectionNeedsTest: boolean;
    connectionStatus:
        'Connected · read/write' | 'Retest needed' | 'Read-only' | 'Review needed' | 'Test needed';
    hasPreviewSourceSwitcher: boolean;
    persistCloudInLocalServer: boolean;
    connectionActionBusy: boolean;
    runConnectionAction: (testConnection: boolean) => Promise<void>;
    sourceChoices: Connected[];
    selectConnection: (id: string) => void;
    hasCloudConnection: boolean;
    setCloudDialogOpen: import('react').Dispatch<import('react').SetStateAction<boolean>>;
}) {
    const root = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!connectionPicker) return;
        const closeOutside = (event: PointerEvent) => {
            if (event.target instanceof Node && !root.current?.contains(event.target)) {
                setConnectionPicker(false);
            }
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            setConnectionPicker(false);
            trigger.current?.focus();
        };
        document.addEventListener('pointerdown', closeOutside, true);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('pointerdown', closeOutside, true);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [connectionPicker, setConnectionPicker]);

    const getSourceDescription = () => {
        if (isSampleData) {
            return 'Sample rows are generated in this browser.';
        }

        if (isPlayground) {
            return 'SQL runs on the public ClickHouse Playground with read-only access.';
        }

        return undefined;
    };
    const getSourceBadge = () => {
        if (isSampleData) {
            return 'SAMPLE DATA';
        }

        if (isPlayground) {
            return 'PLAYGROUND';
        }

        if (isCloudConnection) {
            return 'CLICKHOUSE CLOUD';
        }

        return 'LIVE CONNECTION';
    };
    const getConnectionLabel = () => {
        if (connection) {
            if (isPlayground) {
                return 'ClickHouse';
            }

            return connectionLabel(connection, session.demo);
        }

        return 'Choose connection';
    };
    const getConnectionDetails = (connection: Connected) => {
        if (isSampleData) {
            return 'Generated sample data · SQL stays in this browser';
        }

        if (isPlayground) {
            return `${connection.host} · public read-only access`;
        }

        if (isCloudConnection) {
            return `${connection.host} · ${connection.database} · ${persistCloudInLocalServer ? 'local server session' : 'password held in this tab'}`;
        }

        if (session.demo) {
            return 'Local sample data';
        }

        return `Database: ${connection.database} · Server: ${connection.host}`;
    };
    const getConnectionHelp = (connection: Connected) => {
        if (isSampleData) {
            return 'Sample rows are generated for the preview. SQL is not sent to a database.';
        }

        if (isPlayground) {
            return 'Queries run against the public ClickHouse SQL Playground. Access is read only.';
        }

        if (isCloudConnection) {
            return 'Queries pass through this site to your Cloud service over HTTPS. Your Cloud user controls which reads and writes are allowed.';
        }

        if (session.demo) {
            return 'This demo uses sample data. Your SQL is not sent to a real database.';
        }

        if (connectionNeedsTest) {
            if (connection.trusted) {
                return 'Read-only access is on, but this server needs a fresh capability check.';
            }

            return 'Test this connection to discover its ClickHouse features.';
        }

        if (connection.trusted) {
            return 'Read-only access is on. Queries can read data but cannot change it.';
        }

        return 'Connection tested. Turn on read-only access when you are ready to query.';
    };
    const getConnectionActionLabel = (connection: Connected) => {
        if (connectionActionBusy) {
            if (connectionNeedsTest) {
                return 'Testing…';
            }

            return 'Saving…';
        }

        if (session.demo) {
            return 'Start exploring';
        }

        if (connectionNeedsTest) {
            if (connection.trusted) {
                return 'Retest connection';
            }

            return 'Test connection';
        }

        if (connection.trusted) {
            return 'Turn off read-only access';
        }

        return 'Trust connection';
    };
    return (
        <div className="connection-wrap" ref={root}>
            <button
                ref={trigger}
                className="connection-trigger"
                type="button"
                aria-haspopup="dialog"
                aria-expanded={connectionPicker}
                aria-controls="connection-menu"
                onClick={() => setConnectionPicker(value => !value)}
            >
                <span
                    className={cx(
                        'connection-env',
                        isSampleData && 'is-demo',
                        isPlayground && 'is-playground',
                        isCloudConnection && 'is-cloud',
                    )}
                    title={getSourceDescription()}
                >
                    <span
                        className={cx(
                            'status-light',
                            isSampleData || !connection?.trusted ? 'is-warning' : 'is-trusted',
                        )}
                    />
                    {getSourceBadge()}
                </span>
                {isPlayground && (
                    <span className="connection-quick-status is-ready">{copy.common.readOnly}</span>
                )}
                {(!session.demo || isCloudConnection) && !isPlayground && (
                    <span
                        className={cx(
                            'connection-quick-status',
                            connection?.trusted && !connectionNeedsTest ? 'is-ready' : 'is-review',
                        )}
                    >
                        {connectionStatus}
                    </span>
                )}
                <strong title={connection?.name}>{getConnectionLabel()}</strong>
                <span className="connection-database">
                    {connection?.database ?? '—'} <Icon name="chevron" />
                </span>
            </button>
            {connectionPicker && connection && (
                <div
                    className="connection-menu animate-enter"
                    id="connection-menu"
                    role="dialog"
                    aria-label={
                        hasPreviewSourceSwitcher ? 'Data source options' : 'Connection details'
                    }
                >
                    <div className="connection-menu-content">
                        <div className="connection-menu-current">
                            <span className="connection-menu-heading">
                                {hasPreviewSourceSwitcher
                                    ? 'Current data source'
                                    : 'Current connection'}
                            </span>
                            <strong>{connectionLabel(connection, session.demo)}</strong>
                            <small>{getConnectionDetails(connection)}</small>
                        </div>
                        <p className="connection-menu-note" role="status">
                            {getConnectionHelp(connection)}
                        </p>
                        {!isCloudConnection &&
                            ((!session.demo && !isPlayground) || !connection.trusted) && (
                                <Button
                                    variant={
                                        !session.demo && connection.trusted ? 'ghost' : 'primary'
                                    }
                                    className="connection-menu-action"
                                    disabled={connectionActionBusy}
                                    onClick={() => void runConnectionAction(connectionNeedsTest)}
                                >
                                    {getConnectionActionLabel(connection)}
                                </Button>
                            )}
                        {sourceChoices.length > 0 && (
                            <div className="connection-switch-list">
                                <span className="connection-menu-heading">
                                    {hasPreviewSourceSwitcher
                                        ? 'Choose data source'
                                        : 'Switch connection'}
                                </span>
                                {sourceChoices.map(item => {
                                    const getSourceDetails = () => {
                                        if (item.id === 'playground') {
                                            return 'Real ClickHouse · public read only';
                                        }

                                        if (item.dataSource === 'fixture') {
                                            return 'Generated sample rows · no database request';
                                        }

                                        return `${item.database} · ${item.host}`;
                                    };
                                    return (
                                        <button
                                            key={item.id}
                                            type="button"
                                            aria-pressed={item.id === connection.id}
                                            onClick={() => {
                                                selectConnection(item.id);
                                                setConnectionPicker(false);
                                            }}
                                        >
                                            <span>
                                                <strong>
                                                    {connectionLabel(item, session.demo)}
                                                </strong>
                                                <small>{getSourceDetails()}</small>
                                            </span>
                                            <span
                                                className="connection-choice-check"
                                                aria-hidden="true"
                                            >
                                                {item.id === connection.id && <Icon name="check" />}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                    {hasCloudConnection && (
                        <div className="connection-menu-footer">
                            <Button
                                variant="secondary"
                                className="connection-menu-action cloud-connect-trigger"
                                onClick={() => {
                                    setConnectionPicker(false);
                                    setCloudDialogOpen(true);
                                }}
                            >
                                Change Cloud service
                            </Button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function renderAppearanceControls({
    copy,
    experience,
    standardHref,
    returnToWorkspace,
    theme,
    setTheme,
}: {
    copy: Copy;
    experience: 'beginner' | 'expert';
    standardHref: string;
    returnToWorkspace: (event: import('react').MouseEvent<HTMLAnchorElement>) => void;
    theme: 'click-dark' | 'click-light';
    setTheme: import('react').Dispatch<
        import('react').SetStateAction<'click-dark' | 'click-light'>
    >;
}) {
    return (
        <div className="topbar-control-rail">
            {experience === 'expert' && (
                <div className="experimental-workspace-status">
                    <span>{copy.app.expert}</span>
                    <a href={standardHref} onClick={returnToWorkspace}>
                        Back to workspace
                    </a>
                </div>
            )}
            <div className="topbar-preferences">
                <div className="experience-switch theme-switch">
                    <div
                        className="theme-mode-control"
                        role="radiogroup"
                        aria-label={copy.app.theme}
                    >
                        {themeOptions(copy).map(option => (
                            <label
                                key={option.value}
                                className={`theme-mode-option ${theme === option.value ? 'is-active' : ''}`}
                                title={option.label}
                            >
                                <input
                                    type="radio"
                                    name="clickstudio-theme"
                                    value={option.value}
                                    checked={theme === option.value}
                                    aria-label={option.label}
                                    onChange={() => setTheme(option.value)}
                                />
                                <Icon
                                    name={option.value === 'click-dark' ? 'moon' : 'sun'}
                                    className="theme-mode-icon"
                                />
                            </label>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

function Brand() {
    return (
        <div className="brand-lockup">
            <svg
                className="brand-symbol"
                viewBox="0 0 150 150"
                role="img"
                aria-label="ClickHouse"
                fill="var(--brand-logo)"
            >
                <path d="M27,25.7c0-.6.5-1.2,1.2-1.2h8.8c.6,0,1.2.5,1.2,1.2v97.7c0,.6-.5,1.2-1.2,1.2h-8.8c-.6,0-1.2-.5-1.2-1.2V25.7Z" />
                <path d="M49.2,25.7c0-.6.5-1.2,1.2-1.2h8.8c.6,0,1.2.5,1.2,1.2v97.7c0,.6-.5,1.2-1.2,1.2h-8.8c-.6,0-1.2-.5-1.2-1.2V25.7Z" />
                <path d="M71.4,25.7c0-.6.5-1.2,1.2-1.2h8.8c.6,0,1.2.5,1.2,1.2v97.7c0,.6-.5,1.2-1.2,1.2h-8.8c-.6,0-1.2-.5-1.2-1.2V25.7Z" />
                <path d="M93.6,25.7c0-.6.5-1.2,1.2-1.2h8.8c.6,0,1.2.5,1.2,1.2v97.7c0,.6-.5,1.2-1.2,1.2h-8.8c-.6,0-1.2-.5-1.2-1.2V25.7Z" />
                <path d="M115.9,64.6c0-.6.5-1.2,1.2-1.2h8.8c.6,0,1.2.5,1.2,1.2v19.9c0,.6-.5,1.2-1.2,1.2h-8.8c-.6,0-1.2-.5-1.2-1.2V64.6Z" />
            </svg>
            <span className="brand-name">
                Click<span>Studio</span>
                <small>CLICKHOUSE WORKSPACE</small>
            </span>
        </div>
    );
}

export default App;
