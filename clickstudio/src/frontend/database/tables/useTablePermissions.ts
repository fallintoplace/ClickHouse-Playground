import { useEffect, useState } from 'react';
import {
    NO_TABLE_PERMISSIONS,
    type TablePermissions,
} from '../../../shared/database/tables/permissions';
import { PLAYGROUND_CONNECTION_ID } from '../../../shared/database/connections/playground';
import { apiResponses, post } from '../../api/client';
import type { Connected } from '../../workspace/workspace-types';

export function useTablePermissions(
    connection: Connected,
    trusted: boolean,
    database: string,
    table?: string,
) {
    const { id, host, username, dataSource } = connection;
    const testedAt = connection.manifest?.testedAt;
    const key = JSON.stringify([id, host, username, testedAt, database, table]);
    const [loaded, setLoaded] = useState<{ key: string; permissions: TablePermissions }>();
    const readOnlySource = id === PLAYGROUND_CONNECTION_ID || dataSource === 'fixture';

    useEffect(() => {
        if (!trusted || readOnlySource) return;
        const controller = new AbortController();
        void post(
            `/connections/${encodeURIComponent(id)}/table-permissions`,
            { database, ...(table === undefined ? {} : { table }) },
            apiResponses.isTablePermissions,
            { signal: controller.signal },
        )
            .then(permissions => {
                if (!controller.signal.aborted) setLoaded({ key, permissions });
            })
            .catch(() => {});
        return () => controller.abort();
    }, [id, database, table, key, trusted, readOnlySource]);

    if (readOnlySource) return NO_TABLE_PERMISSIONS;
    return trusted && loaded?.key === key ? loaded.permissions : {};
}
