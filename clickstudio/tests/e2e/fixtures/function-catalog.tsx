import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getClickHouseCloudConnection } from '../../../src/frontend/database/connections/cloud-connection';
import { useSqlFunctionCatalog } from '../../../src/frontend/database/functions/useSqlFunctionCatalog';

function Harness() {
    const [connection, setConnection] = useState(() => {
        const current = getClickHouseCloudConnection();
        if (!current) throw new Error('Connect before mounting the catalog harness.');
        return current;
    });
    const [trusted, setTrusted] = useState(true);
    const catalog = useSqlFunctionCatalog(connection, trusted, true);
    return (
        <>
            <output aria-label="Cached functions">
                {catalog.catalog?.functions.map(fn => fn.name).join(',')}
            </output>
            <output aria-label="Catalog status">{catalog.loading ? 'loading' : 'idle'}</output>
            <button onClick={() => setTrusted(value => !value)}>Toggle catalog trust</button>
            <button
                onClick={() =>
                    setConnection(current => ({ ...current, host: `${current.host}-next` }))
                }
            >
                Change catalog host
            </button>
            <button
                onClick={() =>
                    setConnection(current => ({ ...current, username: `${current.username}-next` }))
                }
            >
                Change catalog username
            </button>
            <button
                onClick={() =>
                    setConnection(current => ({
                        ...current,
                        manifest: current.manifest && {
                            ...current.manifest,
                            testedAt: `${current.manifest.testedAt}-next`,
                        },
                    }))
                }
            >
                Change catalog testedAt
            </button>
        </>
    );
}

createRoot(document.getElementById('function-catalog-harness')!).render(
    <StrictMode>
        <Harness />
    </StrictMode>,
);
