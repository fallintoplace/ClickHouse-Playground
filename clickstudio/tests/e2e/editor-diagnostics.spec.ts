import { test, expect, type Page } from '@playwright/test';
import { openBlankSql, replaceSql, runButton, trust, useAdvancedMode } from './helpers.js';
import type { QueryDocument } from '../../src/shared/queries/saved-queries/types.js';

const issueButton = (page: Page) => page.getByRole('button', { name: /^\d+ SQL issues?$/ });

async function runSuccessfully(page: Page) {
    const response = page.waitForResponse(
        response =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === '/api/runs',
    );
    await runButton(page).click();
    const created = (await (await response).json()) as { queryId: string };
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', created.queryId);
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'succeeded');
    await expect(runButton(page)).toBeEnabled();
}

async function selectRange(page: Page, from: number, to: number) {
    await page.locator('.cm-editor').evaluate(
        async (root, selection) => {
            const source = window.opener ?? window;
            const url = source.performance
                .getEntriesByType('resource')
                .find((entry: PerformanceEntry) =>
                    entry.name.includes('/@codemirror_view.js'),
                )!.name;
            const { EditorView } = (await import(url)) as typeof import('@codemirror/view');
            const view = EditorView.findFromDOM(root as HTMLElement)!;
            view.dispatch({ selection: { anchor: selection.from, head: selection.to } });
            view.focus();
        },
        { from, to },
    );
}

for (const mode of ['beginner', 'expert']) {
    for (const [sql, message] of [
        ["SELECT 'unfinished", 'Unclosed quoted value or identifier'],
        ['SELECT "unfinished', 'Unclosed quoted value or identifier'],
        ['SELECT `unfinished', 'Unclosed quoted value or identifier'],
        ['SELECT /* unfinished', 'Unclosed block comment'],
        ['SELECT $tag$unfinished', 'Unclosed heredoc'],
        ['SELECT §', 'Unrecognized SQL token'],
    ]) {
        test(`${mode} clears ${JSON.stringify(sql)} diagnostics after correction and Run`, async ({
            page,
        }, testInfo) => {
            await page.addInitScript(
                mode => localStorage.setItem('clickstudio:experience', mode),
                mode,
            );
            await trust(page);
            let submissions = 0;
            const errors: string[] = [];
            page.on('pageerror', error => errors.push(error.message));
            page.on('request', request => {
                if (
                    request.method() === 'POST' &&
                    ['/api/runs', '/api/scripts'].includes(new URL(request.url()).pathname)
                )
                    submissions++;
            });
            await replaceSql(page, sql!);
            await expect(issueButton(page)).toHaveText('1 SQL issue');
            await expect(page.locator('.cm-lint-marker-error')).toHaveCount(1);
            await expect(page.locator('.editor-surface > .workspace-inline-notice')).toHaveCount(0);
            const capture = mode === 'expert' && sql === "SELECT 'unfinished";
            if (capture) {
                const path = testInfo.outputPath('sql-editing.png');
                await page.screenshot({ path });
                await testInfo.attach('SQL editing', { path, contentType: 'image/png' });
            }
            await issueButton(page).click();
            await expect(page.locator('.cm-panel-lint')).toContainText(message!);
            await runButton(page).click();
            await runButton(page).click();
            await expect(page.getByTestId('query-failure')).toContainText(message!);
            await expect(
                page.getByTestId('query-failure').locator('.result-execution-sql.is-full'),
            ).toContainText(sql!);
            await expect(issueButton(page)).toHaveText('1 SQL issue');
            if (capture) {
                await page.locator('.cm-panel-lint [name="close"]').click();
                const path = testInfo.outputPath('sql-run-failed.png');
                await page.screenshot({ path });
                await testInfo.attach('Failed Run', { path, contentType: 'image/png' });
            }
            expect(submissions).toBe(0);
            await replaceSql(page, "SELECT 'unfinished'");
            await expect(issueButton(page)).toHaveCount(0);
            await expect(page.locator('.cm-panel-lint')).toHaveCount(0);
            await expect(page.getByTestId('query-failure')).toContainText(message!);
            await runSuccessfully(page);
            await expect(issueButton(page)).toHaveCount(0);
            await expect(page.getByTestId('query-failure')).toHaveCount(0);
            expect(submissions).toBe(1);
            expect(errors).toEqual([]);
        });
    }
}

test('lexical diagnostics work with the native parser unavailable and recover through undo and redo', async ({
    page,
}) => {
    await page.route('**/api/editor/clickhouse-parser*', route => route.abort('failed'));
    await trust(page);
    await replaceSql(page, "SELECT 'unfinished");
    await expect(issueButton(page)).toHaveText('1 SQL issue');
    await page.waitForTimeout(600); // Separate edits into distinct undo history groups.
    await page.locator('.cm-content').focus();
    await page.keyboard.insertText("'");
    await expect(issueButton(page)).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(issueButton(page)).toHaveText('1 SQL issue');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(issueButton(page)).toHaveCount(0);
});

test('Save and Restore retries clear only their own feedback', async ({ page }) => {
    await trust(page);
    await useAdvancedMode(page);
    await replaceSql(page, 'SELECT 111');
    const firstSave = page.waitForResponse(
        response =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === '/api/documents',
    );
    await page.getByTestId('save-query').click();
    const saved = (await (await firstSave).json()) as QueryDocument;
    await replaceSql(page, 'SELECT 222');
    const documentPath = (url: URL) => url.pathname === `/api/documents/${saved.id}`;
    const secondSave = page.waitForResponse(
        response => response.request().method() === 'PUT' && documentPath(new URL(response.url())),
    );
    await page.getByTestId('save-query').click();
    expect((await secondSave).ok()).toBe(true);
    await page.getByRole('button', { name: 'More workspace panels', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Version history', exact: true }).click();
    await page
        .locator('.revision-list')
        .getByRole('button', { name: /Version 1/ })
        .click();
    let failSave = true;
    let failRestore = true;
    const unavailable = {
        status: 503,
        json: { error: { code: 'SERVICE_UNAVAILABLE', message: 'Response unavailable' } },
    };
    await page.route(documentPath, route =>
        failSave && route.request().method() === 'PUT'
            ? route.fulfill(unavailable)
            : route.continue(),
    );
    await page.route(`**/api/documents/${saved.id}/restore-revision`, route =>
        failRestore ? route.fulfill(unavailable) : route.continue(),
    );
    const checkSave = page.getByRole('button', { name: 'Check save', exact: true });
    const checkRestore = page.getByRole('button', { name: 'Check restore', exact: true });
    const restore = page
        .locator('.revision-preview')
        .getByRole('button', { name: 'Restore', exact: true });
    await page.getByTestId('save-query').click();
    await expect(checkSave).toBeVisible();
    await restore.click();
    await expect(checkRestore).toBeVisible();
    failSave = false;
    await page.getByTestId('save-query').click();
    await expect(checkSave).toHaveCount(0);
    await expect(checkRestore).toBeVisible();
    failRestore = false;
    await page
        .locator('.revision-list')
        .getByRole('button', { name: /Version 1/ })
        .click();
    await restore.click();
    await expect(checkRestore).toHaveCount(0);
    await expect(page.locator('.cm-content')).toHaveText('SELECT 111');
    const restored = page.getByRole('button', { name: 'Version restored', exact: true });
    await expect(restored).toBeVisible();
    failSave = true;
    await page.getByTestId('save-query').click();
    await expect(checkSave).toBeVisible();
    await expect(restored).toBeVisible();
    await replaceSql(page, 'SELECT 333');
    await expect(restored).toHaveCount(0);
    await expect(checkSave).toBeVisible();
});

test('Save details stay within a short detached desktop window and close with Escape', async ({
    page,
}, testInfo) => {
    await page.route('**/api/documents', route =>
        route.request().method() === 'POST'
            ? route.fulfill({
                  status: 503,
                  json: {
                      error: {
                          code: 'SERVICE_UNAVAILABLE',
                          message: 'Detailed server diagnostic\n'.repeat(30),
                      },
                  },
              })
            : route.continue(),
    );
    await trust(page);
    await replaceSql(page, 'SELECT 1');
    const opened = page.waitForEvent('popup');
    await page
        .getByRole('button', { name: 'Open editor in a separate window', exact: true })
        .click();
    const popup = await opened;
    await popup.setViewportSize({ width: 1200, height: 360 });
    await popup.getByTestId('save-query').click();
    const trigger = popup.getByRole('button', { name: 'Check save', exact: true });
    await trigger.click();
    const details = popup.getByRole('dialog', { name: 'Save details', exact: true });
    await expect(details).toBeFocused();
    await details.getByText('Details', { exact: true }).click();
    await expect(details.locator('pre')).toBeVisible();
    await expect
        .poll(() =>
            details.evaluate(element => {
                const bounds = element.getBoundingClientRect();
                return (
                    bounds.top >= 7 &&
                    bounds.bottom <= element.ownerDocument.defaultView!.innerHeight - 7
                );
            }),
        )
        .toBe(true);
    const path = testInfo.outputPath('save-details-detached.png');
    await popup.screenshot({ path });
    await testInfo.attach('Save details', { path, contentType: 'image/png' });
    await popup.keyboard.press('Escape');
    await expect(details).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await page.getByRole('button', { name: 'Dock editor here', exact: true }).click();
});

test('lint keyboard and panel navigation keep Run on the full draft, including a collapsed editor', async ({
    page,
}) => {
    await trust(page);
    await replaceSql(page, "SELECT 'unfinished");
    await page.locator('.cm-content').focus();
    await page.keyboard.press('F8');
    await runButton(page).click();
    await expect(page.locator('.cm-panel-lint')).toHaveCount(0);
    await issueButton(page).click();
    const diagnostics = page.getByRole('listbox', { name: 'Diagnostics', exact: true });
    await diagnostics.getByRole('option').click();
    await diagnostics.press('ArrowDown');
    await runButton(page).click();
    await expect(
        page.getByTestId('query-failure').locator('.result-execution-sql.is-full'),
    ).toContainText("SELECT 'unfinished");
    await expect(issueButton(page)).toHaveText('1 SQL issue');
    await page.getByRole('button', { name: 'Collapse SQL query', exact: true }).click();
    await expect(page.locator('.cm-content')).not.toBeVisible();
    await runButton(page).click();
    await expect(page.locator('.cm-content')).not.toBeVisible();
    await expect(page.getByTestId('query-failure')).toBeVisible();
    await expect(
        page.getByTestId('query-failure').locator('.result-execution-sql.is-full'),
    ).toContainText("SELECT 'unfinished");
});

test('a successful selected Run preserves diagnostics in the rest of the draft', async ({
    page,
}) => {
    await trust(page);
    await replaceSql(page, "SELECT 1;\nSELECT 'unfinished");
    await expect(issueButton(page)).toHaveText('1 SQL issue');
    await selectRange(page, 0, 8);
    await runSuccessfully(page);
    await expect(issueButton(page)).toHaveText('1 SQL issue');
    await expect(page.getByTestId('query-failure')).toHaveCount(0);
    await issueButton(page).click();
    await expect(page.locator('.cm-panel-lint')).toContainText(
        'Unclosed quoted value or identifier',
    );
});

test('a malformed selection in valid Unicode SQL shows its attempt in Results and clears editor marks on edit', async ({
    page,
}) => {
    await trust(page);
    const sql = "-- 你好🙂\nSELECT 'unfinished';";
    await replaceSql(page, sql);
    await expect(issueButton(page)).toHaveCount(0);
    await selectRange(page, sql.indexOf('SELECT'), sql.lastIndexOf("'"));
    await runButton(page).click();
    await expect(page.getByTestId('query-failure')).toContainText('SQL_SYNTAX');
    await expect(page.locator('.cm-server-error-line')).toHaveCount(1);
    await expect(page.locator('.result-failure-location')).toContainText('Line 2, column 8');
    await expect(page.locator('.editor-surface > .workspace-inline-notice')).toHaveCount(0);
    await replaceSql(page, 'SELECT 2');
    await expect(issueButton(page)).toHaveCount(0);
    await expect(page.locator('.cm-server-error-line')).toHaveCount(0);
    await expect(page.getByTestId('query-failure')).toContainText(
        'Unclosed quoted value or identifier',
    );
    await runSuccessfully(page);
    await expect(page.getByTestId('query-failure')).toHaveCount(0);
});

test('diagnostics follow their draft through tab switches and detached editing', async ({
    page,
}) => {
    await trust(page);
    await replaceSql(page, "SELECT 'unfinished");
    const tabId = await page
        .getByRole('tab')
        .filter({ hasText: 'Getting started.sql' })
        .getAttribute('id');
    await expect(issueButton(page)).toHaveText('1 SQL issue');
    await openBlankSql(page);
    await expect(issueButton(page)).toHaveCount(0);
    await page.locator(`[id="${tabId}"]`).click();
    await expect(issueButton(page)).toHaveText('1 SQL issue');
    const opened = page.waitForEvent('popup');
    await page
        .getByRole('button', { name: 'Open editor in a separate window', exact: true })
        .click();
    const popup = await opened;
    await expect(issueButton(popup)).toHaveText('1 SQL issue');
    await issueButton(popup).click();
    await expect(popup.locator('.cm-panel-lint')).toContainText('Unclosed');
    await replaceSql(popup, "SELECT 'finished'");
    await expect(issueButton(popup)).toHaveCount(0);
    await page.getByRole('button', { name: 'Dock editor here', exact: true }).click();
    await expect(issueButton(page)).toHaveCount(0);
});

test('SQL editing and successful Run preserve a save failure, while a successful save during edits clears only save feedback', async ({
    page,
}) => {
    let failSave = true;
    let release = () => {};
    const gate = new Promise<void>(resolve => {
        release = resolve;
    });
    await page.route('**/api/documents', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        if (failSave)
            return route.fulfill({
                status: 503,
                json: {
                    error: { code: 'SERVICE_UNAVAILABLE', message: 'Save response unavailable' },
                },
            });
        await gate;
        return route.continue();
    });
    await trust(page);
    await replaceSql(page, 'SELECT 1');
    await page.getByTestId('save-query').click();
    await expect(page.getByRole('button', { name: 'Check save', exact: true })).toBeVisible();
    await replaceSql(page, "SELECT 'unfinished");
    await runButton(page).click();
    await replaceSql(page, 'SELECT 1');
    await runSuccessfully(page);
    await expect(page.getByRole('button', { name: 'Check save', exact: true })).toBeVisible();
    failSave = false;
    const request = page.waitForRequest(
        request =>
            request.method() === 'POST' && new URL(request.url()).pathname === '/api/documents',
    );
    const response = page.waitForResponse(
        response =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === '/api/documents',
    );
    await page.getByTestId('save-query').click();
    await request;
    await replaceSql(page, 'SELECT 2');
    release();
    expect((await response).ok()).toBe(true);
    await expect(page.getByRole('button', { name: 'Check save', exact: true })).toHaveCount(0);
    await expect(page.locator('.tab-unsaved')).toHaveCount(1);
    await expect(page.locator('.cm-content')).toHaveText('SELECT 2');
});
