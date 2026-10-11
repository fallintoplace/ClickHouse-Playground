import { test, expect } from '@playwright/test';
import type { Run, Script } from '../../src/shared/queries/execution/types.js';
import { currentQueryId, openStatementResults, replaceSql, runScript, trust } from './helpers.js';

test('Statement results use a compact header dropdown and switch without executing SQL', async ({
    page,
}, testInfo) => {
    await trust(page);
    await replaceSql(page, 'SELECT 1; SELECT 2; SELECT 3;');
    await runScript(page);
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    const trigger = results.getByRole('button', { name: /^Select a statement result/ });
    await expect(results.getByRole('heading', { name: 'Results', exact: true })).toHaveCount(0);
    await expect(trigger).toContainText('03');
    await expect(trigger).toContainText('SELECT 3');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(results.locator('.script-statement-list')).toHaveCount(0);
    await expect(results.getByRole('menu')).toHaveCount(0);
    await expect(results.getByRole('table')).toBeVisible();
    for (const theme of ['Dark', 'Light']) {
        await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
        for (const mode of ['Standard', 'Experimental']) {
            await page.getByText(mode, { exact: true }).click();
            for (const width of [1440, 900]) {
                await page.setViewportSize({ width, height: 900 });
                if (width === 1440)
                    await expect(results.locator('.results-header')).toHaveCSS('height', '34px');
                await page.keyboard.press('Tab');
                const focus = await trigger.evaluate(element => {
                    element.focus();
                    const bounds = element.getBoundingClientRect();
                    const header = element.closest('.results-header')!.getBoundingClientRect();
                    const style = getComputedStyle(element);
                    const ring =
                        Number.parseFloat(style.outlineWidth) +
                        Number.parseFloat(style.outlineOffset);
                    return {
                        outline: style.outlineWidth,
                        edges: [
                            bounds.left - ring - header.left,
                            header.right - bounds.right - ring,
                            bounds.top - ring - header.top,
                            header.bottom - bounds.bottom - ring,
                        ],
                    };
                });
                expect(focus.outline, `${theme} ${mode} ${width}: immediate focus`).toBe('2px');
                for (const edge of focus.edges)
                    expect(
                        edge,
                        `${theme} ${mode} ${width}: focus stays in the header`,
                    ).toBeGreaterThanOrEqual(0);
            }
        }
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    const thirdQueryId = await currentQueryId(page);
    const header = await results.locator('.results-header').boundingBox();
    const control = await trigger.boundingBox();
    expect(header).not.toBeNull();
    expect(control).not.toBeNull();
    expect(control!.y + control!.height).toBeLessThanOrEqual(header!.y + header!.height);
    await results.screenshot({ path: testInfo.outputPath('results-dropdown-closed.png') });

    let executions = 0;
    page.on('request', request => {
        if (
            request.method() === 'POST' &&
            ['/api/runs', '/api/scripts'].includes(new URL(request.url()).pathname)
        )
            executions++;
    });
    const menu = await openStatementResults(results);
    await expect(menu.getByRole('menuitemradio')).toHaveCount(3);
    await expect(menu.getByRole('menuitemradio', { name: 'Statement 3: succeeded' })).toBeChecked();
    await page.screenshot({ path: testInfo.outputPath('results-dropdown-open.png') });
    await menu.getByRole('menuitemradio', { name: 'Statement 1: succeeded' }).click();
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(trigger).toContainText('01');
    await expect(trigger).toHaveAccessibleName(/Statement 1: succeeded, SELECT 1/);
    await expect(page.locator('.execution-bar')).not.toHaveAttribute('data-query-id', thirdQueryId);
    const firstQueryId = await currentQueryId(page);
    await expect(results.getByRole('table')).toBeVisible();

    await trigger.press('ArrowDown');
    await expect(menu.getByRole('menuitemradio', { name: 'Statement 1: succeeded' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitemradio', { name: 'Statement 2: succeeded' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(menu).toBeHidden();
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', /.+/);
    await expect(page.locator('.execution-bar')).not.toHaveAttribute('data-query-id', firstQueryId);
    expect(await currentQueryId(page)).not.toBe(thirdQueryId);
    await expect(results.getByRole('table')).toBeVisible();
    await trigger.press('ArrowUp');
    await expect(menu.getByRole('menuitemradio', { name: 'Statement 2: succeeded' })).toBeFocused();
    await page.keyboard.press('End');
    await expect(menu.getByRole('menuitemradio', { name: 'Statement 3: succeeded' })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(menu.getByRole('menuitemradio', { name: 'Statement 1: succeeded' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.press('ArrowDown');
    await expect(menu.getByRole('menuitemradio', { name: 'Statement 2: succeeded' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(menu).toBeHidden();
    await openStatementResults(results);
    await results.locator('.results-mark').click();
    await expect(menu).toBeHidden();
    await openStatementResults(results);
    await page.getByTestId('format-sql').focus();
    await expect(menu).toBeHidden();
    expect(executions).toBe(0);
});

test('A single query uses the same clickable dropdown through view and draft changes', async ({
    page,
}, testInfo) => {
    await trust(page);
    const sql = 'SELECT 1 AS a_long_column_name_that_should_not_expand_the_output_header';
    await replaceSql(page, sql);
    await runScript(page);
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    const card = results.getByRole('button', { name: /^Select a statement result/ });
    await expect(results.getByRole('table')).toBeVisible();
    await expect(card).toHaveAttribute('title', sql);
    await expect(card.locator('.script-statement-index')).toHaveText('01');
    await expect(card.locator('svg')).toHaveCount(1);
    await expect(results.getByRole('heading', { name: 'Results', exact: true })).toHaveCount(0);
    await expect(card).toHaveAttribute('aria-haspopup', 'menu');
    await expect(card).toHaveAttribute('aria-expanded', 'false');
    let executions = 0;
    page.on('request', request => {
        if (
            request.method() === 'POST' &&
            ['/api/runs', '/api/scripts'].includes(new URL(request.url()).pathname)
        )
            executions++;
    });
    const queryId = await currentQueryId(page);
    const menu = results.getByRole('menu', { name: 'Statement results', exact: true });
    for (const mode of ['Standard', 'Experimental']) {
        await page.getByText(mode, { exact: true }).click();
        for (const theme of ['Dark', 'Light']) {
            await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
            for (const width of [1440, 900]) {
                await page.setViewportSize({ width, height: 900 });
                await expect(card).toBeVisible();
                expect(
                    await card
                        .locator('code')
                        .evaluate(element => element.scrollWidth > element.clientWidth),
                ).toBe(true);
                const bounds = (await card.boundingBox())!;
                const header = (await results.locator('.results-header').boundingBox())!;
                expect(bounds.x).toBeGreaterThanOrEqual(header.x);
                expect(bounds.x + bounds.width).toBeLessThanOrEqual(header.x + header.width);
                expect(bounds.y + bounds.height).toBeLessThanOrEqual(header.y + header.height);
                if (width === 1440)
                    await results.locator('.results-header').screenshot({
                        path: testInfo.outputPath(`single-query-${mode}-${theme}.png`),
                    });
            }
            await card.locator('.script-statement-index').click();
            await expect(menu).toBeVisible();
            await expect(menu.getByRole('menuitemradio')).toHaveCount(1);
            const selected = menu.getByRole('menuitemradio', { name: 'Statement 1: succeeded' });
            await expect(selected).toBeChecked();
            await expect(selected).toBeFocused();
            await expect(card.locator('.script-statement-index')).toHaveClass(/status-succeeded/);
            await expect(card.locator('.script-statement-index')).toHaveCSS(
                'color',
                await selected
                    .locator('.script-status')
                    .evaluate(element => getComputedStyle(element).color),
            );
            await expect(card).toHaveAttribute('aria-expanded', 'true');
            await page.screenshot({
                path: testInfo.outputPath(`single-query-menu-${mode}-${theme}.png`),
            });
            await card.click();
            await expect(menu).toBeHidden();
            await expect(card).toHaveAttribute('aria-expanded', 'false');
            await card.press('ArrowDown');
            await expect(selected).toBeFocused();
            await page.keyboard.press('Escape');
            await expect(menu).toBeHidden();
            await expect(card).toBeFocused();
            await openStatementResults(results);
            await results.locator('.results-mark').click();
            await expect(menu).toBeHidden();
        }
    }
    await results.getByRole('tab', { name: 'Chart', exact: true }).click();
    await expect(card).toHaveAttribute('title', sql);
    await openStatementResults(results);
    await menu.getByRole('menuitemradio', { name: 'Statement 1: succeeded' }).click();
    await expect(menu).toBeHidden();
    await expect(card).toBeFocused();
    await expect(results.getByRole('tab', { name: 'Chart', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
    );
    expect(await currentQueryId(page)).toBe(queryId);
    await results.getByRole('tab', { name: 'Table', exact: true }).click();
    await replaceSql(page, 'SELECT 2');
    await expect(card).toHaveAttribute('title', sql);
    expect(executions).toBe(0);
});

test('A single failed query shows the submitted SQL card and replaces it after a successful Run', async ({
    page,
}) => {
    await trust(page);
    await replaceSql(page, 'SELECT 1');
    await runScript(page);
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    const card = results.getByRole('button', { name: /^Select a statement result/ });
    await expect(card).toHaveAttribute('title', 'SELECT 1');
    await expect(results.getByRole('table')).toBeVisible();
    await replaceSql(page, "SELECT 'unfinished");
    await page.getByTestId('run-button').click();
    await expect(results.getByTestId('query-failure')).toBeVisible();
    await expect(results.locator('.script-running-results')).toHaveCount(0);
    await expect(card).toHaveAttribute('title', "SELECT 'unfinished");
    await expect(card.locator('.script-statement-index')).toHaveClass(/status-failed/);
    await expect(results.locator('.script-results-failure')).toHaveCount(0);
    const menu = await openStatementResults(results);
    const failed = menu.getByRole('menuitemradio', { name: 'Statement 1: failed' });
    await expect(failed).toBeChecked();
    await expect(failed).toContainText('Unclosed quoted value or identifier');
    await failed.click();
    await expect(menu).toBeHidden();
    await expect(card).toBeFocused();
    await expect(results.getByTestId('query-failure')).toBeVisible();
    await replaceSql(page, 'SELECT 2');
    await expect(card).toHaveAttribute('title', "SELECT 'unfinished");
    await runScript(page);
    await expect(results.getByTestId('query-failure')).toHaveCount(0);
    await expect(card).toHaveAttribute('title', 'SELECT 2');
});

test('A repeated query keeps its pending dropdown and enables the new result when it arrives', async ({
    page,
}) => {
    await trust(page);
    await replaceSql(page, 'SELECT 1');
    await runScript(page);
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await expect(results.getByRole('table')).toBeVisible();
    const previousQueryId = await currentQueryId(page);
    let release!: () => void;
    const submission = new Promise<void>(resolve => {
        release = resolve;
    });
    await page.route('**/api/runs', async route => {
        if (route.request().method() === 'POST') await submission;
        await route.continue();
    });
    await runScript(page);
    const card = results.getByRole('button', { name: /^Select a statement result/ });
    await expect(card).toContainText('01');
    await expect(card.locator('.script-statement-index')).toHaveClass(/status-running/);
    const menu = await openStatementResults(results);
    await expect(menu.getByRole('menuitemradio', { name: 'Statement 1: running' })).toBeDisabled();
    await expect(
        menu.getByRole('menuitemradio', { name: 'Statement 1: running' }).locator('small'),
    ).toHaveText('Running');
    await expect(menu).toBeFocused();
    release();
    await expect(menu.getByRole('menuitemradio', { name: 'Statement 1: succeeded' })).toBeEnabled();
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', /.+/);
    expect(await currentQueryId(page)).not.toBe(previousQueryId);
    await expect(card.locator('.script-statement-index')).toHaveClass(/status-succeeded/);
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitemradio', { name: 'Statement 1: succeeded' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(card).toBeFocused();
});

test('Failures stay visible while browsing successful results and skipped statements stay disabled', async ({
    page,
}) => {
    await trust(page);
    await replaceSql(page, 'SELECT 1; SELECT fixture_error; SELECT 3;');
    await runScript(page);
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await expect(results.getByTestId('query-failure')).toBeVisible();
    await expect(results.locator('.script-results-failure')).toHaveText('1 failed');
    const menu = await openStatementResults(results);
    const skipped = menu.getByRole('menuitemradio', { name: 'Statement 3: skipped' });
    await expect(skipped).toBeDisabled();
    await page.keyboard.press('End');
    await expect(menu.getByRole('menuitemradio', { name: 'Statement 2: failed' })).toBeFocused();
    await menu.getByRole('menuitemradio', { name: 'Statement 1: succeeded' }).click();
    await expect(results.getByRole('table')).toBeVisible();
    await expect(results.getByTestId('query-failure')).toHaveCount(0);
    await expect(results.locator('.script-results-failure')).toBeVisible();
    await openStatementResults(results);
    await menu.getByRole('menuitemradio', { name: 'Statement 2: failed' }).click();
    await expect(results.getByTestId('query-failure')).toContainText('FIXTURE_ERROR');
});

test('Long statement previews and menus fit a narrow viewport and work with collapsed results', async ({
    page,
}) => {
    await trust(page);
    const alias = 'a_long_column_name_that_should_not_expand_the_results_header';
    await replaceSql(page, `SELECT 1 AS ${alias}; SELECT 2 AS ${alias}; SELECT 3 AS ${alias};`);
    await runScript(page);
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    const trigger = results.getByRole('button', { name: /^Select a statement result/ });
    await expect(trigger).toContainText('03');
    await page.setViewportSize({ width: 640, height: 720 });
    const preview = trigger.locator('code');
    expect(await preview.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    const menu = await openStatementResults(results);
    const bounds = await menu.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(640);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(720);
    await page.keyboard.press('Escape');
    await results.getByRole('button', { name: 'Collapse Query results', exact: true }).click();
    await expect(results.locator('#query-results-content')).toBeHidden();
    await openStatementResults(results);
    await menu.getByRole('menuitemradio', { name: 'Statement 1: succeeded' }).click();
    await expect(trigger).toContainText('01');
    await results.getByRole('button', { name: 'Expand Query results', exact: true }).click();
    await expect(results.getByRole('table')).toBeVisible();
});

test('Opening a long script menu scrolls the selected statement into view', async ({ page }) => {
    await trust(page);
    await replaceSql(
        page,
        Array.from({ length: 12 }, (_, index) => `SELECT ${index + 1}`).join('; '),
    );
    await runScript(page);
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    const trigger = results.getByRole('button', { name: /^Select a statement result/ });
    await expect(trigger).toHaveAccessibleName(/Statement 12: succeeded, SELECT 12/);
    const menu = await openStatementResults(results);
    const selected = menu.getByRole('menuitemradio', { name: 'Statement 12: succeeded' });
    await expect(selected).toBeFocused();
    await expect(selected).toBeInViewport();
    expect(await menu.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
});

test('Pending statements stay disabled and cancellation remains available in the header', async ({
    page,
}) => {
    await trust(page);
    await page.setViewportSize({ width: 520, height: 720 });
    await replaceSql(page, 'SELECT fixture_slow; SELECT 2; SELECT 3;');
    await runScript(page);
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    const cancel = results.getByRole('button', { name: 'Cancel script', exact: true });
    await expect(cancel).toBeVisible();
    const cards = results.getByRole('group', { name: 'Select a statement result', exact: true });
    await expect(cards.getByRole('button')).toHaveCount(3);
    await expect(cards.getByRole('button', { name: 'Statement 1: running' })).toBeEnabled();
    await expect(cards.getByRole('button', { name: 'Statement 2: pending' })).toBeDisabled();
    await expect(cards.getByRole('button', { name: 'Statement 3: pending' })).toBeDisabled();
    const menu = await openStatementResults(results);
    await expect(menu.getByRole('menuitemradio', { name: 'Statement 1: running' })).toBeEnabled();
    await expect(
        menu.getByRole('menuitemradio', { name: 'Statement 1: running' }).locator('small'),
    ).toHaveText('Running');
    await expect(menu.getByRole('menuitemradio', { name: 'Statement 2: pending' })).toBeDisabled();
    await expect(menu.getByRole('menuitemradio', { name: 'Statement 3: pending' })).toBeDisabled();
    await page.keyboard.press('End');
    await expect(menu.getByRole('menuitemradio', { name: 'Statement 1: running' })).toBeFocused();
    await cancel.click();
    await expect(cancel).toHaveCount(0);
    await expect(results.locator('.script-running-results')).toHaveCount(0);
    await expect(results.getByRole('button', { name: /^Select a statement result/ })).toContainText(
        '01',
    );
    await openStatementResults(results);
    await expect(menu.getByRole('menuitemradio', { name: 'Statement 1: cancelled' })).toBeVisible();
    await expect(menu.getByRole('menuitemradio', { name: 'Statement 2: skipped' })).toBeDisabled();
});

test('Running cards track progress and return to the existing dropdown after completion', async ({
    page,
}, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await trust(page);
    await replaceSql(page, 'SELECT 1');
    const runResponse = page.waitForResponse(
        response =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === '/api/runs',
    );
    await runScript(page);
    const run: Run = await (await runResponse).json();
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await expect(results.getByRole('table')).toBeVisible();
    const sql = 'SELECT 1; SELECT 2; SELECT 3';
    const script: Script = {
        id: 'all-pending-script',
        owner: run.owner,
        connectionId: 'demo',
        sql,
        createdAt: run.createdAt,
        status: 'running',
        stopOnError: true,
        cancelled: false,
        statements: [
            { sql: 'SELECT 1', from: 0, to: 8, status: 'pending' },
            { sql: 'SELECT 2', from: 10, to: 18, status: 'pending' },
            { sql: 'SELECT 3', from: 20, to: sql.length, status: 'pending' },
        ],
    };
    let available = false;
    let finished = false;
    await page.route('**/api/scripts', route => route.fulfill({ status: 202, json: script }));
    await page.route('**/api/scripts/all-pending-script', route => {
        let response = script;
        if (finished)
            response = {
                ...script,
                status: 'succeeded',
                statements: script.statements.map((statement, index) => ({
                    ...statement,
                    runId: `pending-run-${['a', 'b', 'c'][index]}`,
                    status: 'succeeded',
                })),
            };
        else if (available)
            response = {
                ...script,
                statements: script.statements.map((statement, index) => {
                    if (index > 1) return statement;
                    return {
                        ...statement,
                        runId: index === 0 ? 'pending-run-a' : 'pending-run-b',
                        status: index === 0 ? 'succeeded' : 'running',
                    };
                }),
            };
        return route.fulfill({ json: response });
    });
    for (const id of ['pending-run-a', 'pending-run-b', 'pending-run-c'])
        await page.route(`**/api/runs/${id}`, route =>
            route.fulfill({
                json: { ...run, id, queryId: id, resultState: 'unavailable', status: 'succeeded' },
            }),
        );
    await replaceSql(page, sql);
    await runScript(page);
    const cards = results.getByRole('group', { name: 'Select a statement result', exact: true });
    await expect(cards.getByRole('button')).toHaveCount(3);
    await expect(cards.getByRole('button', { name: 'Statement 1: pending' })).toBeDisabled();
    await expect(results.locator('.result-execution-progress')).toHaveCount(0);
    for (const theme of ['Light', 'Dark']) {
        await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
        for (const mode of ['Standard', 'Experimental']) {
            await page.getByText(mode, { exact: true }).click();
            await page.setViewportSize({ width: 761, height: 720 });
            const header = (await results.locator('.results-header').boundingBox())!;
            const strip = (await results.locator('.script-running-results').boundingBox())!;
            expect(strip.y).toBeCloseTo(header.y + header.height, 0);
            expect(strip.x + strip.width).toBeLessThanOrEqual(761);
            expect(await cards.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(
                true,
            );
        }
    }
    await results.getByRole('button', { name: 'Collapse Query results', exact: true }).click();
    await expect(cards).toHaveCount(0);
    await results.getByRole('button', { name: 'Expand Query results', exact: true }).click();
    await expect(cards.getByRole('button')).toHaveCount(3);
    const menu = await openStatementResults(results);
    await expect(menu.getByRole('menuitemradio', { name: 'Statement 1: pending' })).toBeDisabled();
    await expect(menu).toBeFocused();
    available = true;
    const first = menu.getByRole('menuitemradio', { name: 'Statement 1: succeeded' });
    const second = menu.getByRole('menuitemradio', { name: 'Statement 2: running' });
    await expect(second).toBeEnabled();
    await expect(cards.getByRole('button', { name: 'Statement 1: succeeded' })).toBeEnabled();
    await expect(cards.getByRole('button', { name: 'Statement 2: running' })).toBeEnabled();
    await expect(
        cards.getByRole('button', { name: 'Statement 2: running' }).locator('small'),
    ).toHaveText('Running');
    await expect(cards.getByRole('button', { name: 'Statement 3: pending' })).toBeDisabled();
    await expect(menu).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(second).toBeFocused();
    await page.keyboard.press('Home');
    await expect(first).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(menu).toBeHidden();
    await expect(results.getByRole('button', { name: /^Select a statement result/ })).toContainText(
        '01',
    );
    await cards.getByRole('button', { name: 'Statement 1: succeeded' }).click();
    await expect(cards.getByRole('button', { name: 'Statement 1: succeeded' })).toHaveAttribute(
        'aria-pressed',
        'true',
    );
    await page.screenshot({ path: info.outputPath('running-statement-cards.png') });
    finished = true;
    await expect(cards).toHaveCount(0);
    const trigger = results.getByRole('button', { name: /^Select a statement result/ });
    await expect(trigger).toContainText('01');
    await expect(trigger).toBeFocused();
    await openStatementResults(results);
    await expect(menu.getByRole('menuitemradio')).toHaveCount(3);
    await expect(menu.getByRole('menuitemradio', { name: 'Statement 1: succeeded' })).toBeChecked();
});
