import { test, expect, type Page, type Locator } from '@playwright/test';
import { workspacePath } from './helpers.js';
import { mockWritableWorkspace } from './import-helpers.js';
import { functionsWorkspace } from './sql-functions-helpers.js';
import { jsonRecord } from '../helpers/type-guards.js';

type CreationKind = 'function' | 'table';

async function creationDialog(
    page: Page,
    kind: CreationKind,
    mode = 'Experimental',
    theme?: string,
) {
    if (kind === 'function') {
        await functionsWorkspace(page, { path: workspacePath(mode) });
    } else {
        await page.route('**/api/connections/live/table-permissions', route =>
            route.fulfill({ json: { create: true, insert: true, drop: true } }),
        );
        await mockWritableWorkspace(page, undefined, undefined, mode);
        await page
            .locator('.icon-rail')
            .getByRole('button', { name: 'Objects', exact: true })
            .click();
    }
    if (theme) await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
    const trigger = page.getByRole('button', {
        name: kind === 'function' ? 'Create SQL UDF' : 'New table in demo',
        exact: true,
    });
    await trigger.click();
    const dialog = page.getByRole('dialog', {
        name: kind === 'function' ? 'Create SQL Function' : 'New table',
        exact: true,
    });
    await expect(dialog).toBeVisible();
    const field = dialog.getByLabel(kind === 'function' ? 'Function name' : 'Table name', {
        exact: true,
    });
    const fill = async () => {
        await field.fill(kind === 'function' ? 'add_tax' : 'events_corporate');
        if (kind === 'function') {
            await dialog.getByLabel('Parameters', { exact: true }).fill('price, rate');
            await dialog.getByLabel('Expression', { exact: true }).fill('price * (1 + rate)');
        }
    };
    return { trigger, dialog, field, fill };
}

async function outsidePoint(dialog: Locator) {
    const bounds = await dialog.boundingBox();
    if (!bounds) throw new Error('The creation dialog has no bounds.');
    return { x: bounds.x - 10, y: bounds.y + bounds.height / 2 };
}

for (const mode of ['Standard', 'Experimental']) {
    for (const kind of ['function', 'table'] as const) {
        test(`${mode} ${kind} closes on outside clicks and Escape and restores focus`, async ({
            page,
        }) => {
            const { dialog, trigger, field, fill } = await creationDialog(page, kind, mode);
            await expect(field).toBeFocused();
            await fill();
            const close = dialog.getByRole('button', { name: /^Close / });
            await close.focus();
            await page.keyboard.press('Shift+Tab');
            await expect(
                dialog.getByRole('button', {
                    name: kind === 'function' ? 'Create UDF' : 'Create table',
                    exact: true,
                }),
            ).toBeFocused();
            await page.keyboard.press('Tab');
            await expect(close).toBeFocused();
            await dialog.getByRole('heading', { level: 2 }).click();
            await expect(dialog).toBeVisible();
            const outside = await outsidePoint(dialog);
            await page.mouse.click(outside.x, outside.y);
            await expect(dialog).toHaveCount(0);
            await expect(trigger).toBeFocused();
            await trigger.click();
            await close.click();
            await expect(dialog).toHaveCount(0);
            await expect(trigger).toBeFocused();
            await trigger.click();
            await expect(field).toHaveValue('');
            await page.keyboard.press('Escape');
            await expect(dialog).toHaveCount(0);
            await expect(trigger).toBeFocused();
            await trigger.click();
            await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
            await expect(dialog).toHaveCount(0);
            await expect(trigger).toBeFocused();
        });

        test(`${mode} ${kind} ignores dialog borders and drags across the backdrop`, async ({
            page,
        }) => {
            const { dialog, field } = await creationDialog(page, kind, mode);
            const bounds = await dialog.boundingBox();
            if (!bounds) throw new Error('The creation dialog has no bounds.');
            await page.mouse.click(bounds.x + 1, bounds.y + 1);
            await expect(dialog).toBeVisible();
            const input = await field.boundingBox();
            if (!input) throw new Error('The creation field has no bounds.');
            const outside = await outsidePoint(dialog);
            await page.mouse.move(input.x + input.width / 2, input.y + input.height / 2);
            await page.mouse.down();
            await page.mouse.move(outside.x, outside.y);
            await page.mouse.up();
            await expect(dialog).toBeVisible();
            await page.mouse.move(outside.x, outside.y);
            await page.mouse.down();
            await page.mouse.move(bounds.x + 30, bounds.y + 30);
            await page.mouse.up();
            await expect(dialog).toBeVisible();
            await page.mouse.click(outside.x, outside.y);
            await expect(dialog).toHaveCount(0);
        });

        test(`${mode} ${kind} cannot dismiss or submit again while creation is pending`, async ({
            page,
        }) => {
            const { dialog, field, fill } = await creationDialog(page, kind, mode);
            let release: () => void = () => {};
            const pending = new Promise<void>(resolve => {
                release = resolve;
            });
            let creationRequests = 0;
            await page.route(
                kind === 'function' ? '**/api/cloud' : '**/api/connections/live/tables',
                async route => {
                    if (
                        kind === 'function' &&
                        jsonRecord(route.request().postDataJSON()).action !== 'create-function'
                    )
                        return route.fallback();
                    creationRequests++;
                    await pending;
                    await route.fulfill({
                        status: 403,
                        json: {
                            error: {
                                code: 'PERMISSION',
                                message: 'Creation permission was revoked.',
                            },
                        },
                    });
                },
            );
            try {
                await fill();
                await dialog
                    .getByRole('button', {
                        name: kind === 'function' ? 'Create UDF' : 'Create table',
                        exact: true,
                    })
                    .click();
                await expect.poll(() => creationRequests).toBe(1);
                await expect(field).toBeDisabled();
                const outside = await outsidePoint(dialog);
                await page.mouse.click(outside.x, outside.y);
                await page.keyboard.press('Escape');
                await expect(dialog).toBeVisible();
                await expect(dialog.getByRole('button', { name: /^Close / })).toBeDisabled();
                await expect(
                    dialog.getByRole('button', { name: 'Creating…', exact: true }),
                ).toBeDisabled();
                await expect(
                    dialog.getByRole('button', { name: 'Cancel', exact: true }),
                ).toBeDisabled();
                release();
                await expect(dialog.getByRole('alert')).toContainText(
                    'Creation permission was revoked.',
                );
                await expect(field).toBeEnabled();
                expect(creationRequests).toBe(1);
                await page.mouse.click(outside.x, outside.y);
                await expect(dialog).toHaveCount(0);
            } finally {
                release();
            }
        });
    }
}

for (const mode of ['Standard', 'Experimental']) {
    test(`${mode} table creates the configured columns and keeps database-picker Escape local`, async ({
        page,
    }) => {
        const { dialog, trigger, fill } = await creationDialog(page, 'table', mode);
        const database = dialog.getByRole('combobox', { name: 'Database', exact: true });
        await database.focus();
        await page.keyboard.press('ArrowDown');
        await expect(dialog.getByRole('listbox', { name: 'Databases', exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog.getByRole('listbox', { name: 'Databases', exact: true })).toBeHidden();
        await expect(dialog).toBeVisible();
        const requests: Record<string, unknown>[] = [];
        await page.route('**/api/connections/live/tables', async route => {
            requests.push(jsonRecord(route.request().postDataJSON()));
            await route.fulfill({ json: {} });
        });
        await fill();
        await dialog.getByRole('button', { name: 'Add column', exact: true }).click();
        await dialog.getByLabel('Column 2 name', { exact: true }).fill('tenant');
        await dialog.getByRole('button', { name: 'Create table', exact: true }).click();
        await expect(dialog.getByRole('status')).toContainText('Created demo.events_corporate.');
        expect(requests).toEqual([
            {
                database: 'demo',
                table: 'events_corporate',
                orderBy: 'id',
                columns: [
                    { name: 'id', type: 'UInt64', generatedId: true },
                    { name: 'tenant', type: 'String' },
                ],
            },
        ]);
        await dialog.getByRole('button', { name: 'Done', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await expect(trigger).toBeEnabled();
    });
}

for (const theme of ['Dark', 'Light']) {
    for (const kind of ['function', 'table'] as const) {
        test(`${theme} ${kind} uses the shared corporate creation layout`, async ({
            page,
        }, info) => {
            await page.setViewportSize({ width: 1280, height: 900 });
            const { dialog, fill } = await creationDialog(page, kind, 'Experimental', theme);
            await fill();
            await expect(dialog).toHaveClass(/creation-dialog/);
            await expect(dialog).toHaveCSS('border-radius', '4px');
            await expect(dialog.locator('.creation-dialog-title')).toHaveCSS('font-size', '18px');
            await expect(dialog.locator('.creation-dialog-close')).toHaveCSS('width', '32px');
            await expect(dialog.locator('.creation-dialog-footer')).toHaveCSS(
                'padding',
                '16px 24px',
            );
            await expect(dialog.locator('.creation-dialog-control').first()).toHaveCSS(
                'border-radius',
                '4px',
            );
            expect(
                await dialog.evaluate(element => element.scrollWidth - element.clientWidth),
            ).toBeLessThanOrEqual(1);
            await dialog.screenshot({
                path: info.outputPath(`${kind}-${theme.toLowerCase()}.png`),
            });
        });
    }
}
