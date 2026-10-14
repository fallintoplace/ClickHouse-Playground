import { useEffect } from 'react';
import { NO_TABLE_PERMISSIONS } from '../../../shared/database/tables/permissions';
import type { TablePermissionCatalogState } from './useTablePermissionCatalog';

export function useTablePermissions(
    catalog: TablePermissionCatalogState,
    database: string,
    table?: string,
    enabled = true,
) {
    const { request, revision } = catalog;
    useEffect(() => {
        if (enabled) request(database, table);
    }, [request, revision, database, table, enabled]);
    return enabled ? catalog.get(database, table) : { ...NO_TABLE_PERMISSIONS, loading: false };
}
