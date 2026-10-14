import { isRecord } from '../../../shared/common/values.js';
import type { Connection } from '../../../shared/database/connections/types.js';

export function metadataConnectionKey(connection: Connection) {
    return JSON.stringify([
        connection.id,
        connection.host,
        connection.database,
        connection.username,
        connection.manifest?.testedAt,
    ]);
}

export function metadataAccessDenied(error: unknown) {
    if (!isRecord(error)) return false;
    return error.status === 401 || error.status === 403;
}
