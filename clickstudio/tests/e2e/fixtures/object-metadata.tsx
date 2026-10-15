import { Fragment, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getClickHouseCloudConnection } from '../../../src/frontend/database/connections/cloud-connection';
import { useSqlFunctionCatalog } from '../../../src/frontend/database/functions/useSqlFunctionCatalog';
import { usePythonFunctionCatalog } from '../../../src/frontend/database/functions/usePythonFunctionCatalog';
import {
    useTablePermissionCatalog,
    type TablePermissionCatalogState,
} from '../../../src/frontend/database/tables/useTablePermissionCatalog';
import { useTablePermissions } from '../../../src/frontend/database/tables/useTablePermissions';

function PermissionConsumer({
    catalog,
    name,
}: {
    catalog: TablePermissionCatalogState;
    name: string;
}) {
    const permissions = useTablePermissions(catalog, 'default');
    let status = 'denied';
    if (permissions.loading) status = 'loading';
    else if (permissions.create && permissions.dropDatabase) status = 'allowed';
    return <output aria-label={`${name} database actions`}>{status}</output>;
}

function Harness() {
    const [connection, setConnection] = useState(() => {
        const connection = getClickHouseCloudConnection();
        if (!connection) throw new Error('Connect before mounting the metadata harness.');
        return connection;
    });
    const [trusted, setTrusted] = useState(true);
    const [visible, setVisible] = useState(true);
    const sql = useSqlFunctionCatalog(connection, trusted, visible);
    const python = usePythonFunctionCatalog(connection, trusted, visible);
    const permissions = useTablePermissionCatalog(connection, trusted);
    const catalogs = [
        {
            ...sql,
            name: 'SQL',
            functions: sql.catalog?.functions ?? [],
            available: sql.catalog !== undefined,
        },
        { ...python, name: 'Python' },
    ];
    return (
        <>
            {catalogs.map(catalog => (
                <Fragment key={catalog.name}>
                    <output aria-label={`Cached ${catalog.name} UDFs`}>
                        {catalog.functions.map(fn => fn.name).join(',')}
                    </output>
                    <output aria-label={`${catalog.name} catalog status`}>
                        {catalog.loading ? 'loading' : 'idle'}
                    </output>
                    <output aria-label={`${catalog.name} catalog availability`}>
                        {catalog.available ? 'available' : 'unavailable'}
                    </output>
                    <output aria-label={`${catalog.name} catalog error`}>{catalog.error}</output>
                    <output aria-label={`${catalog.name} catalog refresh error`}>
                        {catalog.refreshError}
                    </output>
                </Fragment>
            ))}
            {visible && <PermissionConsumer catalog={permissions} name="First" />}
            {visible && <PermissionConsumer catalog={permissions} name="Second" />}
            <button onClick={() => setVisible(value => !value)}>Toggle metadata visibility</button>
            <button onClick={() => setTrusted(value => !value)}>Toggle metadata trust</button>
            <button
                onClick={() => {
                    sql.refresh();
                    python.refresh();
                    permissions.refresh();
                }}
            >
                Refresh metadata
            </button>
            <button
                onClick={() => setConnection(value => ({ ...value, host: `${value.host}-next` }))}
            >
                Change metadata host
            </button>
            <button
                onClick={() =>
                    setConnection(value => ({ ...value, database: `${value.database}-next` }))
                }
            >
                Change metadata database
            </button>
            <button
                onClick={() =>
                    setConnection(value => ({ ...value, username: `${value.username}-next` }))
                }
            >
                Change metadata username
            </button>
            <button
                onClick={() =>
                    setConnection(value => ({
                        ...value,
                        manifest: value.manifest && {
                            ...value.manifest,
                            testedAt: `${value.manifest.testedAt}-next`,
                        },
                    }))
                }
            >
                Change metadata testedAt
            </button>
        </>
    );
}

createRoot(document.getElementById('object-metadata-harness')!).render(
    <StrictMode>
        <Harness />
    </StrictMode>,
);
