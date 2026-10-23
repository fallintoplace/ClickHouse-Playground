import type { Dispatch, SetStateAction } from 'react';
import type { Connected } from '../workspace/workspace-types';
import type { SavedCloudConnectionProfile } from '../database/connections/cloud-connection';

export const connectionLabel = (connection: Connected, demo: boolean) => {
    if (demo && connection.dataSource === 'fixture') {
        if (connection.id === 'demo') {
            return 'Sample data';
        }

        return 'Another sample';
    }

    return connection.name;
};
export function writeConnectionToUrl(id: string) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('connection', id);
    else url.searchParams.delete('connection');
    window.history.replaceState(window.history.state, '', url);
}

export function connectionStatusFor(
    connection: Connected | undefined,
    isCloudConnection: boolean,
    connectionNeedsTest: boolean,
): 'Connected · read/write' | 'Retest needed' | 'Read-only' | 'Review needed' | 'Test needed' {
    if (isCloudConnection) return 'Connected · read/write';
    if (connection?.trusted) return connectionNeedsTest ? 'Retest needed' : 'Read-only';
    if (connection?.manifest) return 'Review needed';
    return 'Test needed';
}

export function cloudProfileDefaults(connection?: Connected): SavedCloudConnectionProfile | undefined {
    if (!connection) return undefined;
    try {
        const host = new URL(connection.host);
        if (!host.hostname.toLowerCase().endsWith('.clickhouse.cloud')) return undefined;
        return { host: host.origin, database: connection.database, username: connection.username };
    } catch {
        return undefined;
    }
}

export function databaseDeletionHandler(
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

export type ConnectionStatus = ReturnType<typeof connectionStatusFor>;
