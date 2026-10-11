import { test, expect, type Page } from '@playwright/test';
import { runScript, trust, openStatementResults } from './helpers.js';

function readSql(page: Page) {
    return page.locator('.cm-content').evaluate(editor =>
        Array.from(editor.querySelectorAll('.cm-line'))
            .map(line => line.textContent ?? '')
            .join('\n'),
    );
}

async function replaceSql(page: Page, sql: string) {
    const editor = page.locator('.cm-content');
    await editor.focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(sql);
    await expect.poll(() => readSql(page)).toBe(sql);
}

test('statement navigation stays keyboard-accessible without executing SQL', async ({ page }) => {
    await trust(page);
    let runs = 0;
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs') runs++;
    });
    const sql = "SELECT 'a;b';\nSELECT 2;\nSELECT 3;";
    await replaceSql(page, sql);
    await expect(page.getByTestId('sql-editor-tools')).toHaveCount(0);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Alt+PageUp');
    await page.keyboard.press('Alt+PageDown');
    await expect.poll(() => readSql(page)).toBe(sql);
    expect(runs).toBe(0);
});

test('keyword completion is available outside strings and comments', async ({ page }) => {
    await trust(page);
    await replaceSql(page, 'SEL');
    await page.keyboard.press('Control+Space');
    await expect(page.getByRole('option', { name: 'SELECT', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await replaceSql(page, '-- SEL');
    await page.keyboard.press('Control+Space');
    await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(0);
    await replaceSql(page, "SELECT 'SEL");
    await page.keyboard.press('Control+Space');
    await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(0);
});

for (const engine of ['native', 'fallback'] as const) {
    test(`${engine} lexer preserves Unicode heredocs through script execution`, async ({
        page,
    }) => {
        if (engine === 'fallback') {
            await page.addInitScript(() => {
                WebAssembly.instantiate = (): Promise<never> =>
                    Promise.reject(new Error('WASM blocked in test'));
            });
        }
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await trust(page);
        const first = 'SELECT $123$😀; DROP TABLE events$123$ AS note';
        const second = 'SELECT ‘hello;world’ AS note';
        const sql = `${first};\n${second}`;
        await replaceSql(page, sql);
        const submitted = page.waitForResponse(
            response =>
                response.request().method() === 'POST' &&
                new URL(response.url()).pathname === '/api/scripts',
        );
        await runScript(page);
        const script: { statements: Array<{ sql: string; from: number; to: number }> } = await (
            await submitted
        ).json();
        expect(script.statements.map(statement => statement.sql)).toEqual([first, second]);
        for (const statement of script.statements)
            expect(sql.slice(statement.from, statement.to)).toBe(statement.sql);
        const results = page.getByRole('region', { name: 'Query results', exact: true });
        await openStatementResults(results);
        await expect(
            results.getByRole('menuitemradio', { name: 'Statement 1: succeeded', exact: true }),
        ).toBeVisible();
        await expect(
            results.getByRole('menuitemradio', { name: 'Statement 2: succeeded', exact: true }),
        ).toBeVisible();
        await expect(results.getByRole('menuitemradio', { name: /^Statement 3:/ })).toHaveCount(0);
        expect(errors).toEqual([]);
    });
}
