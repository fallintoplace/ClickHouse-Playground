import { test, expect, type Locator } from '@playwright/test';
import { functionsWorkspace } from './sql-functions-helpers.js';
import { workspacePath } from './helpers.js';

async function design(dialog: Locator) {
    return dialog.evaluate(element => {
        const view = element.ownerDocument.defaultView!;
        const styles = (selector: string, properties: string[]) => {
            const css = view.getComputedStyle(element.querySelector(selector)!);
            return properties.map(property => css.getPropertyValue(property));
        };
        return {
            width: element.getBoundingClientRect().width,
            height: element.getBoundingClientRect().height,
            title: styles('.creation-dialog-title', ['font-size', 'font-weight', 'letter-spacing']),
            header: styles('.creation-dialog-header', ['padding', 'background-color']),
            footer: styles('.creation-dialog-footer', ['padding', 'background-color']),
            input: styles('.creation-dialog-control', [
                'height',
                'padding',
                'font-size',
                'border-radius',
            ]),
            editor: styles('.function-code-editor', ['height', 'border-color', 'border-radius']),
        };
    });
}

async function expectDialogFits(dialog: Locator) {
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const bounds = await dialog.boundingBox();
    for (const button of await dialog.locator('.creation-dialog-footer button').all()) {
        const action = await button.boundingBox();
        if (!action) continue;
        expect(action.x).toBeGreaterThanOrEqual(bounds!.x + 1);
        expect(action.x + action.width).toBeLessThanOrEqual(bounds!.x + bounds!.width - 1);
    }
    const editor = dialog.locator('.function-code-editor');
    await editor.scrollIntoViewIfNeeded();
    const source = await editor.boundingBox();
    const footer = await dialog.locator('.creation-dialog-footer').boundingBox();
    expect(source!.y + source!.height).toBeLessThanOrEqual(footer!.y + 1);
}

for (const theme of ['Dark', 'Light']) {
    for (const viewport of [
        { width: 1280, height: 900 },
        { width: 390, height: 844 },
        { width: 360, height: 800 },
        { width: 320, height: 720 },
    ]) {
        test(`${theme} function creators share the same design at ${viewport.width}px`, async ({
            page,
        }, info) => {
            await page.setViewportSize(viewport);
            await functionsWorkspace(page);
            await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
            await page.getByRole('button', { name: 'Create SQL UDF', exact: true }).click();
            const sql = page.getByRole('dialog', { name: 'Create SQL Function', exact: true });
            await sql.getByLabel('Function name', { exact: true }).fill('add_tax');
            await sql.getByLabel('Parameter 1 name', { exact: true }).fill('price');
            await sql.getByRole('button', { name: 'Add parameter', exact: true }).click();
            await sql.getByLabel('Parameter 2 name', { exact: true }).fill('rate');
            const expression = sql.getByRole('textbox', { name: 'Expression', exact: true });
            await expression.fill('price * (1 + rate)');
            await expect(sql.getByRole('region', { name: 'SQL preview', exact: true })).toHaveCount(
                0,
            );
            await expect(
                sql.getByRole('button', { name: 'Create UDF', exact: true }),
            ).toBeEnabled();
            const sqlDesign = await design(sql);
            await expectDialogFits(sql);
            await sql.getByLabel('Function name', { exact: true }).scrollIntoViewIfNeeded();
            await sql.screenshot({ path: info.outputPath('sql-creator.png') });
            await sql.getByRole('button', { name: 'Cancel', exact: true }).click();
            await page.getByRole('button', { name: 'Create Python UDF', exact: true }).click();
            const python = page.getByRole('dialog', { name: 'Create Python UDF', exact: true });
            await expect(python.getByLabel('Function name', { exact: true })).toBeFocused();
            expect(await design(python)).toEqual(sqlDesign);
            await expectDialogFits(python);
            await python.getByLabel('Function name', { exact: true }).scrollIntoViewIfNeeded();
            await python.screenshot({ path: info.outputPath('python-creator.png') });
            await expect(
                python.getByRole('button', { name: 'Export ZIP', exact: true }),
            ).toBeEnabled();
            await python.getByRole('button', { name: 'Cancel', exact: true }).click();
            await expect(
                page.getByRole('button', { name: 'Create Python UDF', exact: true }),
            ).toBeFocused();
        });
    }
}

test('SQL editor preserves multiline text, normal Tab navigation, and the expression size limit', async ({
    page,
}) => {
    const { requests } = await functionsWorkspace(page);
    await page.getByRole('button', { name: 'Create SQL UDF', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create SQL Function', exact: true });
    await dialog.getByLabel('Function name', { exact: true }).fill('unicode_label');
    await dialog.getByLabel('Parameter 1 name', { exact: true }).fill('value');
    const editor = dialog.getByRole('textbox', { name: 'Expression', exact: true });
    const expression = "concat(value,\n    '日本語 \\n')";
    await editor.fill(expression);
    await expect(dialog.getByRole('region', { name: 'SQL preview', exact: true })).toHaveCount(0);
    await editor.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await editor.fill('x'.repeat(8193));
    await expect(editor).toContainText('日本語');
    await dialog.getByRole('button', { name: 'Create UDF', exact: true }).click();
    expect(requests.find(request => request.action === 'create-function')).toMatchObject({
        expression,
    });
});

for (const mode of ['Standard', 'Experimental']) {
    test(`${mode} explicit SQL parameters preserve order and values after deleting a middle row`, async ({
        page,
    }) => {
        const { requests } = await functionsWorkspace(page, { path: workspacePath(mode) });
        await page.getByRole('button', { name: 'Create SQL UDF', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Create SQL Function', exact: true });
        await expect(dialog.getByRole('button', { name: 'Copy SQL', exact: true })).toHaveCount(0);
        await expect(dialog.locator('.creation-dialog-footer button')).toHaveCount(2);
        await expect(
            dialog.getByRole('button', { name: 'Remove parameter 1', exact: true }),
        ).toBeDisabled();
        await dialog.getByLabel('Function name', { exact: true }).fill('explicit_parameters');
        await dialog.getByLabel('Parameter 1 name', { exact: true }).fill(' price ');
        await dialog.getByRole('button', { name: 'Add parameter', exact: true }).click();
        await dialog.getByLabel('Parameter 2 name', { exact: true }).fill('unused');
        await dialog.getByRole('button', { name: 'Add parameter', exact: true }).click();
        await dialog.getByLabel('Parameter 3 name', { exact: true }).fill('rate');
        await dialog.getByLabel('Expression', { exact: true }).fill('price * (1 + rate)');
        await dialog.getByRole('button', { name: 'Remove parameter 2', exact: true }).focus();
        await page.keyboard.press('Enter');
        await expect(dialog.getByLabel('Parameter 2 name', { exact: true })).toBeFocused();
        await expect(dialog.getByLabel('Parameter 1 name', { exact: true })).toHaveValue(' price ');
        await expect(dialog.getByLabel('Parameter 2 name', { exact: true })).toHaveValue('rate');
        await expect(dialog.getByRole('region', { name: 'SQL preview', exact: true })).toHaveCount(
            0,
        );
        await dialog.getByRole('button', { name: 'Add parameter', exact: true }).click();
        const third = dialog.getByLabel('Parameter 3 name', { exact: true });
        await expect(third).toHaveValue('');
        const create = dialog.getByRole('button', { name: 'Create UDF', exact: true });
        await expect(create).toBeDisabled();
        for (const invalid of [' rate ', 'x, y', 'bad-name']) {
            await third.fill(invalid);
            await expect(create).toBeDisabled();
            await expect(dialog.getByRole('status')).toHaveText(
                'Enter 1–16 unique parameter names.',
            );
        }
        expect(requests.filter(request => request.action === 'create-function')).toHaveLength(0);
        await third.fill('scale');
        await dialog.getByLabel('Expression', { exact: true }).fill('price * (1 + rate) * scale');
        await create.click();
        await expect(dialog).toHaveCount(0);
        expect(requests.find(request => request.action === 'create-function')).toMatchObject({
            parameters: ['price', 'rate', 'scale'],
            expression: 'price * (1 + rate) * scale',
        });
    });

    test(`${mode} SQL parameter rows respect the limit and reset when the dialog reopens`, async ({
        page,
    }) => {
        await functionsWorkspace(page, { path: workspacePath(mode) });
        const open = page.getByRole('button', { name: 'Create SQL UDF', exact: true });
        await open.click();
        const dialog = page.getByRole('dialog', { name: 'Create SQL Function', exact: true });
        const add = dialog.getByRole('button', { name: 'Add parameter', exact: true });
        await dialog.getByLabel('Function name', { exact: true }).fill('many_parameters');
        await dialog.getByLabel('Expression', { exact: true }).fill('p1');
        await dialog.getByLabel('Parameter 1 name', { exact: true }).fill('p1');
        for (let at = 2; at <= 16; at++) {
            await add.click();
            await dialog.getByLabel(`Parameter ${at} name`, { exact: true }).fill(`p${at}`);
        }
        await expect(add).toBeDisabled();
        await expect(dialog.locator('.sql-function-parameter-row')).toHaveCount(16);
        await expect(dialog.getByRole('button', { name: 'Create UDF', exact: true })).toBeEnabled();
        await dialog.getByRole('button', { name: 'Remove parameter 8', exact: true }).click();
        await expect(dialog.getByLabel('Parameter 8 name', { exact: true })).toHaveValue('p9');
        await expect(add).toBeEnabled();
        await add.click();
        await expect(dialog.getByLabel('Parameter 16 name', { exact: true })).toHaveValue('');
        await expect(
            dialog.getByRole('button', { name: 'Create UDF', exact: true }),
        ).toBeDisabled();
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await open.click();
        await expect(dialog.getByLabel('Function name', { exact: true })).toHaveValue('');
        await expect(dialog.locator('.sql-function-parameter-row')).toHaveCount(1);
        await expect(dialog.getByLabel('Parameter 1 name', { exact: true })).toHaveValue('');
        await expect(
            dialog.getByRole('button', { name: 'Remove parameter 1', exact: true }),
        ).toBeDisabled();
    });
}
