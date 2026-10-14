import type express from 'express';
import type { DatabaseDeletionService } from './delete-database.js';
import { body, id, principal } from '../../system/requests/request-accessors.js';
import { text } from '../../system/requests/validation.js';
import type { Driver } from '../../app/types.js';
import type { RunService } from '../../queries/execution/runs.js';

export function registerDatabaseRoutes({
    app,
    databaseDeletion,
    driver,
    runs,
}: {
    app: ReturnType<typeof express>;
    databaseDeletion: DatabaseDeletionService;
    driver: Driver;
    runs: RunService;
}) {
    app.delete('/api/connections/:id/databases', async (req, res) => {
        const value = body(req);
        const p = principal(res);
        const connectionId = id(req);
        const previous = driver.connection(p, connectionId);
        const result = await databaseDeletion.drop(
            p,
            connectionId,
            text(value.database, 'database', 128),
            text(value.confirmation, 'confirmation', 128),
        );
        if (previous.database === result.database && driver.database(connectionId) === 'default')
            runs.refreshTrustAfterDatabaseDeleted(p, previous);
        res.json(result);
    });
}
