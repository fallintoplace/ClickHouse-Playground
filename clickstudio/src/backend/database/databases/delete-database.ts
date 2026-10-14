import { randomUUID } from 'node:crypto';
import type { Principal } from '../../../shared/common/identity.js';
import { canDropDatabase } from '../../../shared/database/databases/delete-database.js';
import { canWrite } from '../../system/login/permissions.js';
import { requireThat } from '../../system/requests/errors.js';
import { audit, type Store } from '../../system/store.js';

export interface DatabaseDeletionDriver {
    dropDatabase(connectionId: string, database: string, queryId: string): Promise<void>;
}

export class DatabaseDeletionService {
    constructor(
        private readonly store: Store,
        private readonly driver: DatabaseDeletionDriver,
        private readonly trusted: (principal: Principal, connectionId: string) => boolean,
    ) {}

    async drop(principal: Principal, connectionId: string, database: string, confirmation: string) {
        canWrite(principal);
        requireThat(
            this.trusted(principal, connectionId),
            403,
            'WORKSPACE_UNTRUSTED',
            'Trust the destination connection first',
        );
        requireThat(
            canDropDatabase(database),
            400,
            'DATABASE_DROP_TARGET',
            'Choose a database other than default or a system database',
        );
        requireThat(
            confirmation === database,
            400,
            'DATABASE_DROP_CONFIRMATION',
            'Type the exact database name to confirm deletion',
        );
        const queryId = `clickstudio-drop-database-${randomUUID()}`;
        audit(this.store, principal, 'database.drop', database);
        await this.driver.dropDatabase(connectionId, database, queryId);
        return { database, queryId };
    }
}
