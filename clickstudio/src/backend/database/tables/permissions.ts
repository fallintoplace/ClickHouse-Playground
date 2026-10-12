import { lexSql, quoteIdentifier } from '../../../shared/sql/sql.js';
import { isValidTableDatabase } from '../../../shared/database/tables/create-table.js';
import {
    canDropTableTarget,
    isSystemDatabaseName,
} from '../../../shared/database/tables/delete-table.js';
import {
    NO_TABLE_PERMISSIONS,
    type TablePermissions,
} from '../../../shared/database/tables/permissions.js';
import { requireThat } from '../../system/requests/errors.js';
import type { ClickHouseClient } from '@clickhouse/client';
import { isRecord } from '../../../shared/common/values.js';

type PermissionQuery = (sql: string) => Promise<Record<string, unknown>[]>;

function grantPrivileges(sql: string): string[] | undefined {
    let tokens;
    try {
        tokens = lexSql(sql);
    } catch {
        return undefined;
    }
    if (tokens[0]?.text.toUpperCase() === 'REVOKE') return [];
    if (tokens[0]?.text.toUpperCase() !== 'GRANT') return undefined;
    const privileges: string[] = [];
    let depth = 0;
    for (const token of tokens.slice(1)) {
        if (token.text === '(') depth++;
        if (token.text === ')') depth--;
        if (depth !== 0 || (token.kind !== 'word' && token.text !== ',')) continue;
        const text = token.text.toUpperCase();
        if (text === 'ON') return privileges;
        privileges.push(text);
    }
    return undefined;
}

function narrowerGrantPossible(rows: Record<string, unknown>[], privilege: 'CREATE' | 'INSERT') {
    return rows.some(row => {
        const sql = Object.values(row)[0];
        if (typeof sql !== 'string') return true;
        const privileges = grantPrivileges(sql);
        if (!privileges) return true;
        return privileges.some((text, index) => {
            if (text === 'ALL') return true;
            if (text !== privilege) return false;
            if (privilege === 'INSERT') return true;
            const next = privileges[index + 1];
            return next === 'TABLE' || next === ',' || next === undefined;
        });
    });
}

async function checkGrant(query: PermissionQuery, privilege: string, target: string) {
    try {
        const rows = await query(`CHECK GRANT ${privilege} ON ${target}`);
        const result = rows[0]?.result;
        if (result === 1 || result === '1') return true;
        if (result === 0 || result === '0') return false;
    } catch {}
    return undefined;
}

async function preserveNarrowGrants(
    query: PermissionQuery,
    permissions: TablePermissions,
    ddlDenied: boolean,
    systemDatabase: boolean,
): Promise<TablePermissions> {
    const inspectCreate = permissions.create === false && !ddlDenied;
    const inspectInsert = permissions.insert === false && !systemDatabase;
    if (!inspectCreate && !inspectInsert) return permissions;
    const grants = await query('SHOW GRANTS FINAL').catch(() => undefined);
    return {
        ...permissions,
        create:
            inspectCreate && (!grants || narrowerGrantPossible(grants, 'CREATE'))
                ? undefined
                : permissions.create,
        insert:
            inspectInsert && (!grants || narrowerGrantPossible(grants, 'INSERT'))
                ? undefined
                : permissions.insert,
    };
}

export async function loadTablePermissions(
    query: PermissionQuery,
    database: string,
    table?: string,
): Promise<TablePermissions> {
    requireThat(
        isValidTableDatabase(database) &&
            (table === undefined || canDropTableTarget('default', table)),
        400,
        'TABLE_PERMISSION_TARGET',
        'Choose a valid database and table',
    );
    const systemDatabase = isSystemDatabaseName(database);
    const settings = await query(
        "SELECT getSetting('readonly') AS readonly, getSetting('allow_ddl') AS allow_ddl",
    ).catch(() => []);
    if (Number(settings[0]?.readonly) > 0) return { ...NO_TABLE_PERMISSIONS };
    const allowDdl = settings[0]?.allow_ddl;
    const ddlDenied = allowDdl === false || allowDdl === 0 || allowDdl === '0';
    const granted = (privilege: string, target: string) => checkGrant(query, privilege, target);
    const qualifiedDatabase = quoteIdentifier(database);
    const target =
        table === undefined ? undefined : `${qualifiedDatabase}.${quoteIdentifier(table)}`;
    const dropPermission =
        ddlDenied || systemDatabase || !target ? false : granted('DROP TABLE', target);
    const writableTarget = systemDatabase ? undefined : target;
    const insertPermission = writableTarget ? granted('INSERT', writableTarget) : undefined;
    const [create, insert, drop] = await Promise.all([
        ddlDenied || systemDatabase ? false : granted('CREATE TABLE', `${qualifiedDatabase}.*`),
        systemDatabase ? false : insertPermission,
        target ? dropPermission : undefined,
    ]);
    return preserveNarrowGrants(query, { create, insert, drop }, ddlDenied, systemDatabase);
}

export async function queryTablePermissions(
    client: Pick<ClickHouseClient, 'exec'>,
    database: string,
    table?: string,
) {
    return loadTablePermissions(
        async query => {
            const result = await client.exec({
                query,
                abort_signal: AbortSignal.timeout(5_000),
                clickhouse_settings: { default_format: 'JSONEachRow' },
            });
            let text = '';
            for await (const chunk of result.stream) text += String(chunk);
            return text
                .split('\n')
                .filter(line => line.trim())
                .map(line => {
                    const value: unknown = JSON.parse(line);
                    requireThat(
                        isRecord(value),
                        502,
                        'PERMISSIONS_RESPONSE',
                        'ClickHouse returned an invalid permission response.',
                    );
                    return value;
                });
        },
        database,
        table,
    );
}
