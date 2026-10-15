import { test, expect, type Page } from '@playwright/test';
import { runScript, trust, openStatementResults, openBlankSql } from './helpers.js';

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

for (const mode of ['Standard', 'Experimental']) {
    for (const parser of ['native', 'fallback']) {
        test(`${mode} ${parser} editor never shows autocomplete while typing or using shortcuts`, async ({
            page,
        }) => {
            if (parser === 'fallback')
                await page.addInitScript(() => {
                    WebAssembly.instantiate = (): Promise<never> =>
                        Promise.reject(new Error('WASM blocked in test'));
                });
            await trust(page, mode);
            const suggestions = page.locator('.cm-tooltip-autocomplete');
            for (const sql of [
                'SEL',
                'SELECT cou',
                'SELECT e.',
                'FROM analytics.ev',
                'ch_time_series',
            ]) {
                await replaceSql(page, '');
                await page.keyboard.type(sql);
                // Wait beyond CodeMirror's typing debounce to catch delayed popups.
                await page.waitForTimeout(200);
                await expect(suggestions).toHaveCount(0);
                for (const shortcut of ['Control+Space', 'Alt+i', 'Alt+Backquote']) {
                    await page.keyboard.press(shortcut);
                    await page.waitForTimeout(200);
                    await expect(suggestions).toHaveCount(0);
                }
                await expect.poll(() => readSql(page)).toBe(sql);
            }
            await replaceSql(page, 'SEL');
            await page.keyboard.press('Control+Space');
            await page.keyboard.press('Enter');
            await expect.poll(() => readSql(page)).toBe('SEL\n');
            await page.keyboard.press('Tab');
            await expect.poll(() => readSql(page)).toBe('SEL\n  ');

            const tabs = page.getByRole('tablist', { name: 'SQL documents', exact: true });
            const document = await tabs.getByRole('tab', { selected: true }).getAttribute('id');
            await openBlankSql(page);
            await tabs.locator(`[id="${document}"]`).click();
            await page.locator('.cm-content').focus();
            await page.keyboard.press('Control+Space');
            await page.waitForTimeout(200);
            await expect(suggestions).toHaveCount(0);
            await expect.poll(() => readSql(page)).toBe('SEL\n  ');
        });
    }
}

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
