import { setWorkspaceMode, openBlankSql, runButton, trust } from './helpers.js';
import { test, expect, type Page } from '@playwright/test';
import { arrayValue, jsonRecord, numberValue, stringValue } from '../helpers/type-guards.js';

async function replaceSql(page: Page, sql: string) {
    await page.locator('.cm-content').focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(sql);
    await expect.poll(async () => (await editorState(page)).sql).toBe(sql);
}

async function editorState(page: Page) {
    return page.locator('.cm-editor').evaluate(async root => {
        // Detached CodeMirror nodes retain the opener's realm after adoption into the popup.
        const source: typeof window = window.opener ?? window;
        const url = source.performance
            .getEntriesByType('resource')
            .find((entry: PerformanceEntry) => entry.name.includes('/@codemirror_view.js'))?.name;
        if (!url) throw new Error('Editor module was not loaded');
        const { EditorView }: typeof import('@codemirror/view') = await import(url);
        if (!(root instanceof source.HTMLElement))
            throw new Error('Editor root is not an HTML element');
        const editor = EditorView.findFromDOM(root);
        if (!editor) throw new Error('Editor view is not attached to its root');
        return {
            sql: editor.state.doc.toString(),
            ranges: editor.state.selection.ranges.map(range => ({
                anchor: range.anchor,
                head: range.head,
            })),
            scrollTop: editor.scrollDOM.scrollTop,
            scrollLeft: editor.scrollDOM.scrollLeft,
        };
    });
}
async function editorDiagnostics(page: Page) {
    return page.locator('.cm-editor').evaluate(async root => {
        const source: typeof window = window.opener ?? window;
        const resources = source.performance.getEntriesByType('resource');
        const moduleUrl = (name: string) => {
            const url = resources.find(entry => entry.name.includes(name))?.name;
            if (!url) throw new Error(`${name} was not loaded`);
            return url;
        };
        const { EditorView }: typeof import('@codemirror/view') = await import(
            moduleUrl('/@codemirror_view.js')
        );
        const { forEachDiagnostic }: typeof import('@codemirror/lint') = await import(
            moduleUrl('/@codemirror_lint.js')
        );
        if (!(root instanceof source.HTMLElement))
            throw new Error('Editor root is not an HTML element');
        const editor = EditorView.findFromDOM(root);
        if (!editor) throw new Error('Editor view is not attached to its root');
        const diagnostics: Array<{ from: number; source: string | undefined }> = [];
        forEachDiagnostic(editor.state, (diagnostic, from) =>
            diagnostics.push({ from, source: diagnostic.source }),
        );
        return diagnostics;
    });
}
async function selectRange(page: Page, anchor: number, head = anchor) {
    await page.locator('.cm-editor').evaluate(
        async (root, selection) => {
            const source: typeof window = window.opener ?? window;
            const url = source.performance
                .getEntriesByType('resource')
                .find((entry: PerformanceEntry) =>
                    entry.name.includes('/@codemirror_view.js'),
                )?.name;
            if (!url) throw new Error('Editor module was not loaded');
            const { EditorView }: typeof import('@codemirror/view') = await import(url);
            if (!(root instanceof source.HTMLElement))
                throw new Error('Editor root is not an HTML element');
            const editor = EditorView.findFromDOM(root);
            if (!editor) throw new Error('Editor view is not attached to its root');
            editor.dispatch({ selection, scrollIntoView: true });
            editor.focus();
        },
        { anchor, head },
    );
    await expect.poll(async () => (await editorState(page)).ranges).toEqual([{ anchor, head }]);
}
async function hoverToken(page: Page, token: string) {
    await page.mouse.move(0, 0);
    const point = await page.locator('.cm-content').evaluate((root, value) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
            const start = (node.textContent ?? '').indexOf(value);
            if (start < 0) continue;
            const range = document.createRange();
            range.setStart(node, start);
            range.setEnd(node, start + value.length);
            const bounds = range.getBoundingClientRect();
            return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
        }
        throw new Error(`Missing SQL token ${value}`);
    }, token);
    await page.mouse.move(point.x, point.y);
}
async function mockSchema(page: Page) {
    await page.route('**/api/connections/*/schema', route =>
        route.fulfill({
            json: {
                connectionId: route.request().url().split('/').at(-2),
                fetchedAt: new Date().toISOString(),
                warnings: [],
                truncated: false,
                tables: [
                    { database: 'demo', name: 'first_table', engine: 'MergeTree' },
                    { database: 'demo', name: 'second_table', engine: 'Memory' },
                ],
                columns: [
                    {
                        database: 'demo',
                        table: 'first_table',
                        name: 'id',
                        type: 'UInt64',
                        defaultKind: '',
                        comment: '',
                    },
                    {
                        database: 'demo',
                        table: 'second_table',
                        name: 'id',
                        type: 'String',
                        defaultKind: '',
                        comment: '',
                    },
                ],
            },
        }),
    );
}

test('switching tabs and detaching preserves independent undo and redo histories', async ({
    page,
}) => {
    await trust(page);
    await replaceSql(page, 'SELECT 1');
    const first = page.locator('[role="tab"][aria-selected="true"]');
    const firstId = await first.getAttribute('id');
    await page.waitForTimeout(600);
    await page.keyboard.insertText(' + 2');
    await openBlankSql(page);
    await replaceSql(page, 'SELECT 99');
    await page.locator(`[id="${firstId}"]`).click();
    await expect.poll(async () => (await editorState(page)).sql).toBe('SELECT 1 + 2');
    await page.locator('.cm-content').focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => (await editorState(page)).sql).toBe('SELECT 1');
    const opened = page.waitForEvent('popup');
    await page
        .getByRole('button', { name: 'Open editor in a separate window', exact: true })
        .click();
    const popup = await opened;
    await popup.locator('.cm-content').focus();
    await popup.keyboard.press('ControlOrMeta+Shift+Z');
    await expect.poll(async () => (await editorState(popup)).sql).toBe('SELECT 1 + 2');
    await page.getByRole('button', { name: 'Dock editor here', exact: true }).click();
    await page.locator('.cm-content').focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => (await editorState(page)).sql).toBe('SELECT 1');
    await page.getByRole('tab').last().click();
    await expect.poll(async () => (await editorState(page)).sql).toBe('SELECT 99');
});

test('tab sessions retain folds, horizontal and vertical scroll, and backward selections', async ({
    page,
}) => {
    await trust(page);
    const sql = [
        'SELECT (',
        '    1',
        ');',
        ...Array.from({ length: 200 }, (_, i) => `SELECT ${i}; -- ${'long text '.repeat(30)}`),
    ].join('\n');
    await replaceSql(page, sql);
    const firstId = await page.locator('[role="tab"][aria-selected="true"]').getAttribute('id');
    await selectRange(page, 0);
    await page.locator('.cm-foldGutter .cm-gutterElement').filter({ hasText: '⌄' }).first().click();
    await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(1);
    await selectRange(page, 6, 2);
    await page.locator('.cm-scroller').evaluate(element => {
        element.scrollTop = 600;
        element.scrollLeft = 300;
    });
    await expect.poll(async () => (await editorState(page)).scrollTop).toBeGreaterThan(550);
    const before = await editorState(page);
    await openBlankSql(page);
    await page.locator(`[id="${firstId}"]`).click();
    await expect.poll(async () => (await editorState(page)).ranges).toEqual(before.ranges);
    await expect
        .poll(async () => (await editorState(page)).scrollTop)
        .toBeCloseTo(before.scrollTop, 0);
    await expect
        .poll(async () => (await editorState(page)).scrollLeft)
        .toBeCloseTo(before.scrollLeft, 0);
    await page.locator('.cm-scroller').evaluate(element => {
        element.scrollTop = 0;
    });
    await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(1);
});

for (const parser of ['native', 'fallback'] as const) {
    test(`${parser} formatting creates a separate undo step and persists its mapped cursor`, async ({
        page,
    }) => {
        if (parser === 'fallback')
            await page.route('**/clickhouse-parser.wasm', route =>
                route.fulfill({ status: 503, body: 'unavailable' }),
            );
        await trust(page);
        const original = parser === 'native' ? 'select 1+2' : 'select 1+2 from numbers(1)';
        const typed = original.replace('1+2', '1+23');
        await replaceSql(page, original);
        if (parser === 'native') {
            await replaceSql(page, 'select count()');
            await expect(page.locator('.cm-native-function')).toBeVisible();
            await replaceSql(page, original);
        } else
            await expect(
                page.getByRole('button', { name: 'Retry parser', exact: true }),
            ).toBeVisible();
        await page.waitForTimeout(600);
        await selectRange(page, 10);
        await page.keyboard.insertText('3');
        await page.getByTestId('format-sql').click();
        await expect.poll(async () => (await editorState(page)).sql).not.toBe(typed);
        const formatted = await editorState(page);
        const firstId = await page.locator('[role="tab"][aria-selected="true"]').getAttribute('id');
        await openBlankSql(page);
        await page.locator(`[id="${firstId}"]`).click();
        await expect.poll(async () => (await editorState(page)).ranges).toEqual(formatted.ranges);
        await page.locator('.cm-content').focus();
        await page.keyboard.press('ControlOrMeta+z');
        await expect.poll(async () => (await editorState(page)).sql).toBe(typed);
        await page.keyboard.press('ControlOrMeta+z');
        await expect.poll(async () => (await editorState(page)).sql).toBe(original);
    });
    test(`${parser} completion excludes ClickHouse strings, identifiers, heredocs and comments`, async ({
        page,
    }) => {
        if (parser === 'fallback')
            await page.addInitScript(() => {
                WebAssembly.instantiate = (): Promise<never> =>
                    Promise.reject(new Error('blocked'));
            });
        await trust(page);
        for (const sql of [
            '// SEL',
            '# SEL',
            '/* nested /* x */ SEL',
            'SELECT $tag$SEL',
            "SELECT 'escaped\\\' SEL",
            'SELECT `escaped\\` SEL',
            'SELECT ‘SEL',
        ]) {
            await replaceSql(page, sql);
            await page.keyboard.press('Control+Space');
            await page.waitForTimeout(200);
            await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(0);
        }
        await replaceSql(page, 'INS');
        await page.keyboard.press('Control+Space');
        await expect(page.getByRole('option', { name: 'INSERT', exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        await replaceSql(page, 'SELECT count() OVER () FROM numbers(1)');
        await expect(page.locator('.cm-content span').filter({ hasText: /^OVER$/ })).toHaveCSS(
            'color',
            'rgb(144, 181, 246)',
        );
    });
}

test('incomplete SQL Run actions show errors in Results without editor banners or requests', async ({
    page,
}) => {
    await trust(page);
    const errors: string[] = [];
    let runs = 0;
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
        if (
            request.method() === 'POST' &&
            ['/api/runs', '/api/scripts'].includes(new URL(request.url()).pathname)
        )
            runs++;
    });
    for (const sql of ["SELECT 'unfinished", 'SELECT /* unfinished', 'SELECT $tag$unfinished']) {
        await replaceSql(page, sql);
        await runButton(page).click();
        await expect(page.getByTestId('query-failure')).toContainText('Unclosed');
        await expect(page.locator('.cm-panel-lint')).toHaveCount(0);
        await expect(page.getByRole('button', { name: /^\d+ SQL issues?$/ })).toHaveCount(0);
        await expect(page.locator('.editor-surface > .workspace-inline-notice')).toHaveCount(0);
    }
    expect(errors).toEqual([]);
    expect(runs).toBe(0);
});

test('selected repeated SQL submits exact source offsets and highlights the selected occurrence', async ({
    page,
}) => {
    await trust(page);
    const sql = 'SELECT missing();\n  SELECT missing();';
    await replaceSql(page, sql);
    await selectRange(page, sql.length, sql.indexOf('\n') + 1);
    await page.route('**/api/runs', route => {
        if (route.request().method() !== 'POST') return route.continue();
        const body = jsonRecord(route.request().postDataJSON(), 'Run request body');
        expect(body.sourceFrom).toBe(sql.lastIndexOf('SELECT'));
        expect(body.sourceTo).toBe(sql.length - 1);
        expect(body.sql).toBe('SELECT missing()');
        return route.fulfill({
            status: 400,
            json: {
                error: {
                    code: 'CLICKHOUSE_46',
                    message: 'Unknown function missing at position 8',
                    position: 8,
                },
            },
        });
    });
    await runButton(page).click();
    await expect(page.locator('.cm-server-error-line')).toHaveText('  SELECT missing();');
    await expect(page.locator('.cm-server-error-line')).toHaveCount(1);
});

test('server errors at end of input highlight the final line and clear after edits', async ({
    page,
}) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await trust(page);
    const sql = 'SELECT 1\nGROUP BY';
    await replaceSql(page, sql);
    await page.route('**/api/runs', route =>
        route.request().method() === 'POST'
            ? route.fulfill({
                  status: 400,
                  json: {
                      error: {
                          code: 'CLICKHOUSE_62',
                          message: 'Syntax error at end of query',
                          position: sql.length,
                      },
                  },
              })
            : route.continue(),
    );
    await runButton(page).click();
    await expect(page.locator('.cm-server-error-line')).toHaveText('GROUP BY');
    await expect
        .poll(async () =>
            (await editorDiagnostics(page)).some(
                diagnostic =>
                    diagnostic.source === 'ClickHouse native parser' &&
                    diagnostic.from === sql.length,
            ),
        )
        .toBe(true);
    await replaceSql(page, 'SELECT 2');
    await expect(page.locator('.cm-server-error-line')).toHaveCount(0);
    await expect.poll(() => editorDiagnostics(page)).toEqual([]);
    expect(errors).toEqual([]);
});

test('Cmd/Ctrl+S saves SQL typed in the Standard detached window', async ({ page }) => {
    await trust(page);
    const opened = page.waitForEvent('popup');
    await page
        .getByRole('button', { name: 'Open editor in a separate window', exact: true })
        .click();
    const popup = await opened;
    await setWorkspaceMode(page, 'Standard');
    await expect(popup.getByTestId('save-query')).toHaveCount(0);
    await replaceSql(popup, 'SELECT 42 AS detached_save');
    const submitted = page.waitForResponse(
        response =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === '/api/documents',
    );
    await popup.keyboard.press('ControlOrMeta+s');
    const response = await submitted;
    expect(response.ok()).toBe(true);
    expect(stringValue(jsonRecord(await response.json()).sql, 'Saved SQL')).toBe(
        'SELECT 42 AS detached_save',
    );
    await page.getByRole('button', { name: 'Dock editor here', exact: true }).click();
    await expect.poll(async () => (await editorState(page)).sql).toBe('SELECT 42 AS detached_save');
});

test('schema hover resolves table aliases in the active statement and excludes string/comment text', async ({
    page,
}) => {
    await mockSchema(page);
    await trust(page);
    await replaceSql(
        page,
        'SELECT b.id FROM demo.first_table a JOIN demo.second_table b ON a.id = b.id',
    );
    await hoverToken(page, 'b');
    await expect(page.locator('.sql-hover')).toHaveText('demo.second_table.id · String');
    await replaceSql(
        page,
        'SELECT a.id FROM demo.first_table a; SELECT a.id FROM demo.second_table a',
    );
    await page.locator('.cm-content').evaluate(root => {
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        root.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    });
    await hoverToken(page, 'second_table');
    await expect(page.locator('.sql-hover')).toHaveText('demo.second_table · Memory');
    for (const sql of ["SELECT 'id'", 'SELECT $tag$id$tag$', '-- id']) {
        await replaceSql(page, sql);
        await hoverToken(page, 'id');
        await page.waitForTimeout(450);
        await expect(page.locator('.sql-hover')).toHaveCount(0);
    }
});

test('active snippet fields still navigate and update together after switching tabs and detaching', async ({
    page,
}) => {
    await trust(page);
    await replaceSql(page, 'ch_time_series');
    await page.keyboard.press('Control+Space');
    await page.getByRole('option', { name: /Hourly time series/ }).click();
    await expect.poll(async () => (await editorState(page)).ranges.length).toBe(2);
    const firstId = await page.locator('[role="tab"][aria-selected="true"]').getAttribute('id');
    await openBlankSql(page);
    await page.locator(`[id="${firstId}"]`).click();
    await page.locator('.cm-content').focus();
    await page.keyboard.insertText('created_at');
    await expect.poll(async () => (await editorState(page)).sql.split('created_at').length).toBe(3);
    await page.keyboard.press('Tab');
    await expect
        .poll(async () => {
            const state = await editorState(page);
            const range = state.ranges[0]!;
            return state.sql.slice(
                Math.min(range.anchor, range.head),
                Math.max(range.anchor, range.head),
            );
        })
        .toBe('events');
    const opened = page.waitForEvent('popup');
    await page
        .getByRole('button', { name: 'Open editor in a separate window', exact: true })
        .click();
    const popup = await opened;
    await popup.locator('.cm-content').focus();
    await popup.keyboard.press('Shift+Tab');
    await expect.poll(async () => (await editorState(popup)).ranges.length).toBe(2);
    await popup.keyboard.insertText('event_date');
    await expect
        .poll(async () => (await editorState(popup)).sql.split('event_date').length)
        .toBe(3);
    await page.getByRole('button', { name: 'Dock editor here', exact: true }).click();
});

test('selected scripts preserve each run offset in the original draft', async ({ page }) => {
    await trust(page);
    const block = 'SELECT 1; SELECT 2;';
    const sql = `${block}\n  ${block}`;
    await replaceSql(page, sql);
    const sourceFrom = sql.indexOf('\n') + 1;
    await selectRange(page, sourceFrom, sql.length);
    const submitted = page.waitForResponse(
        response =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === '/api/scripts',
    );
    await runButton(page).click();
    const script = jsonRecord(await (await submitted).json(), 'Script response');
    const scriptId = stringValue(script.id, 'Script ID');
    const statements = arrayValue(script.statements, 'Script statements').map(statement =>
        jsonRecord(statement, 'Script statement'),
    );
    expect(statements.length).toBe(2);
    await expect
        .poll(async () => {
            const response = await page.request.get(`/api/scripts/${scriptId}`);
            const current = jsonRecord(await response.json(), 'Script response');
            const currentStatements = arrayValue(current.statements, 'Script statements').map(
                statement => jsonRecord(statement, 'Script statement'),
            );
            const ranges = [];
            for (const statement of currentStatements) {
                if (typeof statement.runId !== 'string') return [];
                const run = jsonRecord(
                    await (await page.request.get(`/api/runs/${statement.runId}`)).json(),
                    'Run response',
                );
                ranges.push([run.sourceFrom, run.sourceTo]);
            }
            return ranges;
        })
        .toEqual(
            statements.map(statement => [
                sourceFrom + numberValue(statement.from, 'Statement start'),
                sourceFrom + numberValue(statement.to, 'Statement end'),
            ]),
        );
});
