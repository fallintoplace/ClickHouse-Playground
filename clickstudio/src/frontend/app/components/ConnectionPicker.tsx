import { useEffect, useRef } from 'react';
import { Button, cx } from '../../ui/components/primitives';
import { Icon } from '../../ui/components/icons';
import type { Copy } from '../../ui/copy';
import type { Connected, Session } from '../../workspace/workspace-types';
import { connectionLabel, type ConnectionStatus } from '../connection-helpers';

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
    connectionStatus: ConnectionStatus;
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
            return 'CLOUD';
        }

        return 'LIVE CONNECTION';
    };
    const getConnectionLabel = () => {
        if (connection) {
            if (isPlayground) {
                return 'ClickHouse';
            }

            if (isCloudConnection) {
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
