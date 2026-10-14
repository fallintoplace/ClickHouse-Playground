import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getClickHouseCloudConnection } from '../../../src/frontend/database/connections/cloud-connection';
import { useSqlFunctionCatalog } from '../../../src/frontend/database/functions/useSqlFunctionCatalog';
import { useSqlFunctions } from '../../../src/frontend/database/functions/useSqlFunctions';

function Harness() {
    const [connection, setConnection] = useState(() => {
        const current = getClickHouseCloudConnection();
        if (!current) throw new Error('Connect before mounting the catalog harness.');
        return current;
    });
    const [trusted, setTrusted] = useState(true);
    const catalog = useSqlFunctionCatalog(connection, trusted, true);
    const functions = useSqlFunctions(connection, trusted, catalog);
    return (
        <>
            <output aria-label="Cached functions">
                {catalog.catalog?.functions.map(fn => fn.name).join(',')}
            </output>
            <output aria-label="Catalog status">{catalog.loading ? 'loading' : 'idle'}</output>
            <output aria-label="Selected function definition">
                {functions.selected?.createQuery}
            </output>
            <button onClick={catalog.refresh}>Refresh catalog</button>
            <button
                onClick={() => {
                    const fn = catalog.catalog?.functions[0];
                    if (fn) functions.select(fn);
                }}
            >
                Select first function
            </button>
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
                    setConnection(current => ({ ...current, database: `${current.database}-next` }))
                }
            >
                Change catalog database
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
