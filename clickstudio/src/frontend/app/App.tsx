import { THEMES, DEFAULT_ACCENT } from '../ui/styles/appearance-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, apiResponses, message, post } from '../api/client';
import { Button } from '../ui/components/primitives';
import { Icon } from '../ui/components/icons';
import { CloudConnectionDialog } from '../database/connections/CloudConnectionDialog';
import {
    CLICKHOUSE_CLOUD_CONNECTION_ID,
    disconnectClickHouseCloud,
    restoreClickHouseCloudSession,
} from '../database/connections/cloud-connection';
import { Workspace } from '../workspace/Workspace';
import { copy, type Theme } from '../ui/copy';
import { useWorkspaceRoute } from './useWorkspaceRoute';
import type { Connected, Session } from '../workspace/workspace-types';
import { resolveConnectionSelection } from '../database/connections/selection';
import { Brand, LoginScreen, SessionLoadingScreen } from './components/AuthScreens';
import { ConnectionPicker } from './components/ConnectionPicker';
import { renderAppearanceControls } from './components/AppearanceControls';
import {
    cloudProfileDefaults,
    connectionLabel,
    connectionStatusFor,
    databaseDeletionHandler,
    writeConnectionToUrl,
} from './connection-helpers';

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

export default App;
