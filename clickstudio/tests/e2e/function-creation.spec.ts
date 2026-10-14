import { test, expect, type Locator } from '@playwright/test';
import { functionsWorkspace } from './sql-functions-helpers.js';

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
            await sql.getByLabel('Parameters', { exact: true }).fill('price, rate');
            const expression = sql.getByRole('textbox', { name: 'Expression', exact: true });
            await expression.fill('price * (1 + rate)');
            await expect(
                sql.getByRole('region', { name: 'SQL preview', exact: true }),
            ).toContainText(
                'CREATE FUNCTION `add_tax` AS (`price`, `rate`) -> price * (1 + rate);',
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
    await dialog.getByLabel('Parameters', { exact: true }).fill('value');
    const editor = dialog.getByRole('textbox', { name: 'Expression', exact: true });
    const expression = "concat(value,\n    '日本語 \\n')";
    await editor.fill(expression);
    await expect(dialog.getByRole('region', { name: 'SQL preview', exact: true })).toContainText(
        '日本語',
    );
    await editor.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Copy SQL', exact: true })).toBeFocused();
    await editor.fill('x'.repeat(8193));
    await expect(editor).toContainText('日本語');
    await dialog.getByRole('button', { name: 'Create UDF', exact: true }).click();
    expect(requests.find(request => request.action === 'create-function')).toMatchObject({
        expression,
    });
});
