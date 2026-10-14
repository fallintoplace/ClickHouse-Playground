import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getClickHouseCloudConnection } from '../../../src/frontend/database/connections/cloud-connection';
import { useWorkspaceSchema } from '../../../src/frontend/database/schema/useWorkspaceSchema';

function Harness() {
    const [connection, setConnection] = useState(() => {
        const current = getClickHouseCloudConnection();
        if (!current) throw new Error('Connect before mounting the schema harness.');
        return current;
    });
    const [trusted, setTrusted] = useState(true);
    const state = useWorkspaceSchema(connection, trusted);
    useEffect(() => {
        void state.loadSchema();
    }, [state.loadSchema]);
    return (
        <>
            <output aria-label="Schema names">
                {state.schema?.tables.map(table => table.name).join(',')}
            </output>
            <output aria-label="Schema status">{state.schemaLoading ? 'loading' : 'idle'}</output>
            <button
                onClick={() => {
                    void state.loadSchema(true);
                }}
            >
                Refresh schema
            </button>
            <button onClick={() => setTrusted(value => !value)}>Toggle schema trust</button>
            <button
                onClick={() =>
                    setConnection(current => ({ ...current, host: `${current.host}-next` }))
                }
            >
                Change schema host
            </button>
        </>
    );
}

createRoot(document.getElementById('schema-refresh-harness')!).render(
    <StrictMode>
        <Harness />
    </StrictMode>,
);
