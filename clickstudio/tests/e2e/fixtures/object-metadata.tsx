import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getClickHouseCloudConnection } from '../../../src/frontend/database/connections/cloud-connection';
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
    const python = usePythonFunctionCatalog(connection, trusted, visible);
    const permissions = useTablePermissionCatalog(connection, trusted);
    return (
        <>
            <output aria-label="Cached Python UDFs">
                {python.functions.map(fn => fn.name).join(',')}
            </output>
            <output aria-label="Python catalog status">
                {python.loading ? 'loading' : 'idle'}
            </output>
            {visible && <PermissionConsumer catalog={permissions} name="First" />}
            {visible && <PermissionConsumer catalog={permissions} name="Second" />}
            <button onClick={() => setVisible(value => !value)}>Toggle metadata visibility</button>
            <button onClick={() => setTrusted(value => !value)}>Toggle metadata trust</button>
            <button
                onClick={() => {
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
