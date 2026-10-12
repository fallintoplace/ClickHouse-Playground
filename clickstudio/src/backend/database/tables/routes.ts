import type express from 'express';
import type { TableCreationService } from './create-table.js';
import { CREATE_TABLE_COLUMN_TYPES, type CreateTableColumn } from './create-table.js';
import type { TableDeletionService } from './delete-table.js';
import { requireThat } from '../../system/requests/errors.js';
import { choice, record, text } from '../../system/requests/validation.js';
import type { Driver } from '../../app/types.js';
import { body, principal, id } from '../../system/requests/request-accessors.js';
import type { Principal } from '../../../shared/common/identity.js';
import { NO_TABLE_PERMISSIONS } from '../../../shared/database/tables/permissions.js';

export function registerTableRoutes({
    app,
    tableCreation,
    tableDeletion,
    driver,
    authorized,
}: {
    app: ReturnType<typeof express>;
    tableCreation: TableCreationService;
    tableDeletion: TableDeletionService;
    driver: Driver;
    authorized: (p: Principal, c: string) => boolean;
}) {
    app.post('/api/connections/:id/table-permissions', async (req, res) => {
        const p = principal(res),
            connectionId = id(req),
            v = body(req);
        requireThat(
            authorized(p, connectionId),
            403,
            'WORKSPACE_UNTRUSTED',
            'Trust this connection before checking table permissions',
        );
        res.setHeader('Cache-Control', 'no-store');
        res.json(
            p.role === 'viewer'
                ? NO_TABLE_PERMISSIONS
                : await driver.tablePermissions(
                      connectionId,
                      text(v.database, 'database', 128),
                      v.table === undefined ? undefined : text(v.table, 'table', 128),
                  ),
        );
    });
    app.post('/api/connections/:id/tables', async (req, res) => {
        const v = body(req),
            columnsValue = v.columns;
        requireThat(
            Array.isArray(columnsValue) && columnsValue.length <= 50,
            400,
            'TABLE_COLUMNS',
            'A table needs 1–50 columns',
        );
        const columns: CreateTableColumn[] = columnsValue.map((value: unknown) => {
            const column = record(value, 'column');
            requireThat(
                column.generatedId === undefined || typeof column.generatedId === 'boolean',
                400,
                'TABLE_COLUMNS',
                'Check the generated ID option',
            );
            return {
                name: text(column.name, 'column name', 128),
                type: choice(
                    column.type,
                    CREATE_TABLE_COLUMN_TYPES,
                    400,
                    'TABLE_COLUMN_TYPE',
                    'Choose a supported column type',
                ),
                ...(column.generatedId === true ? { generatedId: true } : {}),
            };
        });
        res.status(201).json(
            await tableCreation.create(
                principal(res),
                id(req),
                text(v.database, 'database', 128),
                text(v.table, 'table', 128),
                columns,
                text(v.orderBy, 'sorting key', 128),
            ),
        );
    });
    app.delete('/api/connections/:id/tables', async (req, res) => {
        const v = body(req);
        res.json(
            await tableDeletion.drop(
                principal(res),
                id(req),
                text(v.database, 'database', 128),
                text(v.table, 'table', 128),
                text(v.confirmation, 'confirmation', 300),
            ),
        );
    });
    app.get('/api/connections/:id/import-targets', async (req, res) => {
        driver.connection(principal(res), id(req));
        res.json(await driver.targets(id(req)));
    });
}
