import {
    setWorkspaceMode,
    openBlankSql,
    openResultFilter,
    openStatementResults,
    replaceSql,
    runButton,
    trust,
} from './helpers.js';
import { test, expect, type Locator, type Page } from '@playwright/test';

function countRuns(page: Page) {
    let count = 0;
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs') count++;
    });
    return () => count;
}

async function mockPaginatedResult(page: Page, totalRows = 450, completeness = 'complete') {
    if (completeness === 'truncated') await mockTruncatedRun(page);
    await page.route(
        url => /\/(result|snapshot)$/.test(url.pathname),
        async route => {
            const response = await route.fetch();
            const result = await response.json();
            const url = new URL(route.request().url());
            const offset = Number(url.searchParams.get('offset') ?? 0);
            const count = url.pathname.endsWith('/snapshot') ? totalRows : 200;
            const rows = Array.from({ length: Math.min(count, totalRows - offset) }, (_, index) => [
                `row-${offset + index}`,
            ]);
            await route.fulfill({
                response,
                json: {
                    ...result,
                    columns: [{ name: 'label', type: 'String' }],
                    rows,
                    offset,
                    totalRows,
                    completeness,
                    nextOffset: offset + rows.length < totalRows ? offset + rows.length : null,
                },
            });
        },
    );
}

async function mockTruncatedRun(page: Page) {
    await page.route(
        url => url.pathname === '/api/runs',
        async route => {
            if (route.request().method() !== 'POST') return route.continue();
            const input = route.request().postDataJSON();
            await route.continue({
                postData: JSON.stringify({ ...input, limits: { ...input.limits, rows: 1 } }),
            });
        },
    );
}

async function expectResultsToolbarFits(header: Locator) {
    await expect
        .poll(() =>
            header.evaluate(element => {
                const header = element.getBoundingClientRect();
                const tools = [
                    ...element.querySelectorAll(
                        '.result-row-count, .script-results-trigger, .result-table-controls, .result-table-controls > button, .results-tabs, .panel-collapse-button',
                    ),
                ];
                return tools.every(tool => {
                    if (!tool.getClientRects().length) return true;
                    const rect = tool.getBoundingClientRect();
                    const icon = tool.matches('.result-pagination button')
                        ? tool.querySelector('svg')?.getBoundingClientRect()
                        : undefined;
                    return (
                        rect.left >= header.left &&
                        rect.right <= header.right &&
                        rect.top >= header.top &&
                        rect.bottom <= header.bottom &&
                        (!icon ||
                            (icon.width >= 15 &&
                                icon.height >= 15 &&
                                icon.left >= rect.left &&
                                icon.right <= rect.right))
                    );
                });
            }),
        )
        .toBe(true);
}

async function expectHeaderFocusFits(header: Locator) {
    for (const control of await header.locator('button:not(.result-controls-panel *)').all()) {
        if (!(await control.isVisible()) || (await control.isDisabled())) continue;
        await control.focus();
        await header.page().keyboard.press('Tab');
        await header.page().keyboard.press('Shift+Tab');
        await expect(control).toBeFocused();
        const focus = await control.evaluate(element => {
            const bounds = element.getBoundingClientRect();
            const header = element
                .closest('.editor-heading, .results-header')!
                .getBoundingClientRect();
            const style = getComputedStyle(element);
            const ring =
                style.outlineStyle === 'none'
                    ? 0
                    : Number.parseFloat(style.outlineWidth) +
                      Number.parseFloat(style.outlineOffset);
            return {
                name: element.getAttribute('aria-label') ?? element.textContent,
                style: style.outlineStyle,
                width: bounds.width,
                height: bounds.height,
                edges: [
                    bounds.left - ring - header.left,
                    header.right - bounds.right - ring,
                    bounds.top - ring - header.top,
                    header.bottom - bounds.bottom - ring,
                ],
            };
        });
        expect(focus.style, `${focus.name}: keyboard focus`).toBe(
            (await control.getAttribute('type')) === 'search' ? 'none' : 'solid',
        );
        if ((await control.getAttribute('type')) === 'search') {
            const color = await control.evaluate(element => {
                const probe = document.createElement('span');
                probe.style.color = 'var(--focus-color)';
                element.parentElement!.append(probe);
                const color = getComputedStyle(probe).color;
                probe.remove();
                return color;
            });
            await expect(control).toHaveCSS('border-color', color);
        }
        expect(focus.width, `${focus.name}: target width`).toBeGreaterThanOrEqual(24);
        expect(focus.height, `${focus.name}: target height`).toBeGreaterThanOrEqual(24);
        for (const edge of focus.edges)
            expect(edge, `${focus.name}: focus stays in the header`).toBeGreaterThanOrEqual(0);
    }
}

test('A local search can be cleared, closed and reopened without rerunning SQL', async ({
    page,
}) => {
    const runs = countRuns(page);
    await trust(page);
    await runButton(page).click();
    const results = page.getByRole('region', { name: 'Query results' });
    const dock = results.getByRole('dialog', { name: 'Search & pages', exact: true });
    const toggle = results.getByRole('button', { name: 'Search rows', exact: true });
    await expect(results.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
    await expect(dock).toBeHidden();
    const filter = await openResultFilter(results);
    await expect(filter).toBeFocused();
    await expect(filter).toHaveAttribute('placeholder', 'Find a value…');
    await expect(results.locator('.results-row-summary')).toHaveText('7 rows');
    await expect(results.locator('.result-pages-toggle')).toHaveCount(0);
    await filter.fill('no-row-can-match-this');
    await expect(dock.locator('.result-match-count')).toHaveText('0 of 7 rows on this page');
    await expect(results.getByText('No rows match on this page.')).toBeVisible();
    await expect(results.getByText('This query returned zero rows.')).toHaveCount(0);
    await dock.getByRole('button', { name: 'Clear row filter', exact: true }).click();
    await expect(filter).toBeFocused();
    await expect(filter).toHaveValue('');
    await expect(results.locator('tbody tr')).toHaveCount(7);
    await filter.fill('2026-01-02');
    await expect(dock.locator('.result-match-count')).toHaveText('1 of 7 rows on this page');
    const closeButton = dock.getByRole('button', { name: 'Close search and pages', exact: true });
    await closeButton.focus();
    await closeButton.press('Escape');
    await expect(dock).toBeVisible();
    await expect(filter).toHaveValue('2026-01-02');
    await expect(results.locator('tbody tr')).toHaveCount(1);
    await closeButton.click();
    await expect(dock).toBeHidden();
    await expect(toggle).toBeFocused();
    await expect(toggle.locator('.result-search-active')).toBeVisible();
    await openResultFilter(results);
    await expect(filter).toHaveValue('2026-01-02');
    await results.getByRole('button', { name: 'Collapse Query results', exact: true }).click();
    await expect(dock).toBeHidden();
    await results.getByRole('button', { name: 'Expand Query results', exact: true }).click();
    await expect(dock).toBeHidden();
    await openResultFilter(results);
    await expect(filter).toHaveValue('2026-01-02');
    expect(runs()).toBe(1);
    await runButton(page).click();
    await expect(dock).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle.locator('.result-search-active')).toHaveCount(0);
    await expect(results.locator('tbody tr')).toHaveCount(7);
    expect(runs()).toBe(2);
});

test('SQL document tabs support arrow and Home/End keyboard navigation', async ({ page }) => {
    await trust(page);
    await openBlankSql(page);
    await openBlankSql(page);
    const tabs = page.getByRole('tablist', { name: 'SQL documents' }).getByRole('tab');
    await expect(tabs).toHaveCount(3);
    await tabs.first().focus();
    await tabs.first().press('End');
    await expect(tabs.last()).toBeFocused();
    await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
    await tabs.last().press('Home');
    await expect(tabs.first()).toBeFocused();
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
    await tabs.first().press('ArrowLeft');
    await expect(tabs.last()).toBeFocused();
    await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
});

async function expectDockFits(dock: Locator) {
    await expect
        .poll(() =>
            dock.evaluate(element => {
                const bounds = element.getBoundingClientRect();
                return (
                    bounds.left >= 8 &&
                    bounds.top >= 8 &&
                    bounds.right <= innerWidth - 8 &&
                    bounds.bottom <= innerHeight - 8 &&
                    element.scrollWidth <= element.clientWidth
                );
            }),
        )
        .toBe(true);
}

for (const mode of ['Standard', 'Experimental']) {
    test(`${mode} shared dock paginates and searches without rerunning SQL`, async ({
        page,
    }, info) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const runs = countRuns(page);
        await mockPaginatedResult(page);
        await trust(page);
        await setWorkspaceMode(page, mode);
        await runButton(page).click();
        const results = page.getByRole('region', { name: 'Query results', exact: true });
        const header = results.locator('.results-header');
        const dock = results.getByRole('dialog', { name: 'Search & pages', exact: true });
        const pagination = dock.getByRole('navigation', { name: 'Result pagination', exact: true });
        const pages = header.locator('.result-pages-toggle');
        const total = header.locator('.result-row-count');
        await expect(results.locator('tbody tr')).toHaveCount(200);
        await expect(header.locator('.results-row-summary')).toBeVisible();
        await expect(total).toHaveText('450 rows');
        await expect(pages).toHaveText('1/3');
        await expect(dock).toBeHidden();
        await pages.click();
        const jump = dock.getByRole('spinbutton', { name: 'Go to page', exact: true });
        await expect(jump).toBeFocused();
        await expect(pagination.getByRole('button')).toHaveCount(4);
        await expect(
            pagination.getByRole('button', { name: 'First page', exact: true }),
        ).toBeDisabled();
        await expect(
            pagination.getByRole('button', { name: 'Previous page', exact: true }),
        ).toBeDisabled();
        await pagination.getByRole('button', { name: 'Last page', exact: true }).press('Enter');
        await expect(pagination.getByRole('status')).toHaveText('Page 3 of 3');
        await expect(results.locator('tbody tr')).toHaveCount(50);
        await expect(dock.locator('.result-retained-range')).toHaveText(
            '401–450 of 450 retained rows',
        );
        await expect(pages).toHaveText('3/3');
        await expect(total).toHaveText('450 rows');
        await expect(
            pagination.getByRole('button', { name: 'Last page', exact: true }),
        ).toBeDisabled();
        await expect(
            pagination.getByRole('button', { name: 'Next page', exact: true }),
        ).toBeDisabled();
        const position = await dock.boundingBox();
        const filter = await openResultFilter(header);
        await expect(filter).toBeFocused();
        await expect(dock).toHaveCount(1);
        expect(await dock.boundingBox()).toEqual(position);
        await filter.fill('ROW-449');
        await expect(dock.locator('.result-match-count')).toHaveText('1 of 50 rows on this page');
        await expect(results.locator('tbody .row-number')).toHaveText('450');
        await expect(total).toHaveText('450 rows');
        await pagination.getByRole('button', { name: 'First page', exact: true }).click();
        await expect(pagination.getByRole('status')).toHaveText('Page 1 of 3');
        await expect(dock.locator('.result-match-count')).toHaveText('0 of 200 rows on this page');
        await expect(results.getByText('No rows match on this page.')).toBeVisible();
        await dock.getByRole('button', { name: 'Clear row filter', exact: true }).click();
        await expect(filter).toBeFocused();
        await pagination.getByRole('button', { name: 'Next page', exact: true }).click();
        await expect(pagination.getByRole('status')).toHaveText('Page 2 of 3');
        await expect(dock.locator('.result-retained-range')).toHaveText(
            '201–400 of 450 retained rows',
        );
        await jump.fill('4');
        await dock.getByRole('button', { name: 'Go', exact: true }).click();
        expect(await jump.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false);
        await expect(pages).toHaveText('2/3');
        await jump.fill('1');
        await jump.press('Enter');
        await expect(pages).toHaveText('1/3');
        await expect(jump).toHaveValue('1');
        const closeButton = dock.getByRole('button', {
            name: 'Close search and pages',
            exact: true,
        });
        await closeButton.focus();
        await closeButton.press('Escape');
        await expect(dock).toBeVisible();
        await expect(pages).toHaveText('1/3');
        await closeButton.click();
        await expect(dock).toBeHidden();
        for (const theme of ['Dark', 'Light']) {
            await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
            for (const width of [1440, 900, 761]) {
                await page.setViewportSize({ width, height: 900 });
                await expectResultsToolbarFits(header);
                await expect(total).toBeVisible();
                await expect(total).toHaveText('450 rows');
                await expect(header).toHaveCSS('height', '34px');
                await openResultFilter(header);
                await filter.fill('row-199'.repeat(60));
                await expectDockFits(dock);
                await expectResultsToolbarFits(header);
                await filter.fill('row-199');
                await expect(dock.locator('.result-match-count')).toHaveText(
                    '1 of 200 rows on this page',
                );
                await closeButton.focus();
                await closeButton.press('Escape');
                await expect(dock).toBeVisible();
                await expect(filter).toHaveValue('row-199');
                await closeButton.click();
                await expect(dock).toBeHidden();
                await expect(header.locator('.result-search-active')).toBeVisible();
                await openResultFilter(header);
                await dock.getByRole('button', { name: 'Clear row filter', exact: true }).click();
                if (theme === 'Light' && width === 1440)
                    await page.screenshot({ path: info.outputPath('shared-dock.png') });
                await dock
                    .getByRole('button', { name: 'Close search and pages', exact: true })
                    .click();
            }
        }
        expect(runs()).toBe(1);
    });

    test(`Single-page search stays outside the compact ${mode} header in both themes`, async ({
        page,
    }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await trust(page);
        await setWorkspaceMode(page, mode);
        await runButton(page).click();
        const results = page.getByRole('region', { name: 'Query results', exact: true });
        const header = results.locator('.results-header');
        const dock = results.getByRole('dialog', { name: 'Search & pages', exact: true });
        const toggle = header.getByRole('button', { name: 'Search rows', exact: true });
        for (const theme of ['Dark', 'Light']) {
            await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
            for (const width of [1440, 900, 761]) {
                await page.setViewportSize({ width, height: 900 });
                await expect(page.locator('.editor-heading')).toHaveCSS('height', '34px');
                await expect(header).toHaveCSS('height', '34px');
                await expectResultsToolbarFits(header);
                await page.keyboard.press('Tab');
                await expectHeaderFocusFits(header);
                await expect(toggle).toHaveAttribute('aria-expanded', 'false');
                const filter = await openResultFilter(header);
                await expect(filter).toBeFocused();
                await expect(toggle).toBeVisible();
                await expectDockFits(dock);
                await expect(header.locator('.result-row-count')).toHaveText('7 rows');
                await expect(results.locator('.result-pagination')).toHaveCount(0);
                await filter.fill('2026-01-02');
                await expect(dock.locator('.result-match-count')).toHaveText(
                    '1 of 7 rows on this page',
                );
                await expect(results.locator('tbody tr')).toHaveCount(1);
                const closeButton = dock.getByRole('button', {
                    name: 'Close search and pages',
                    exact: true,
                });
                await closeButton.focus();
                await closeButton.press('Escape');
                await expect(dock).toBeVisible();
                await expect(filter).toHaveValue('2026-01-02');
                await closeButton.click();
                await expect(dock).toBeHidden();
                await expect(toggle).toBeFocused();
                await openResultFilter(header);
                await expect(filter).toHaveValue('2026-01-02');
                await dock.getByRole('button', { name: 'Clear row filter', exact: true }).click();
                await expect(filter).toBeFocused();
                await expect(header.locator('.result-row-count')).toHaveText('7 rows');
                await expect(results.locator('tbody tr')).toHaveCount(7);
                await dock
                    .getByRole('button', { name: 'Close search and pages', exact: true })
                    .click();
                await expect(toggle).toBeFocused();
            }
        }
    });
}

for (const { rows, completeness } of [
    { rows: 7, completeness: 'truncated' },
    { rows: 0, completeness: 'truncated' },
    { rows: 0, completeness: 'complete' },
    { rows: 1, completeness: 'complete' },
]) {
    test(`Results toolbar reports ${rows} rows with ${completeness} retention without a pagination footer`, async ({
        page,
    }) => {
        if (completeness === 'truncated') await mockTruncatedRun(page);
        await page.route(
            url => url.pathname.endsWith('/result'),
            async route => {
                const response = await route.fetch();
                const result = await response.json();
                await route.fulfill({
                    response,
                    json: {
                        ...result,
                        columns: [{ name: 'label', type: 'String' }],
                        rows: Array.from({ length: rows }, (_, index) => [`row-${index}`]),
                        totalRows: rows,
                        offset: 0,
                        nextOffset: null,
                        completeness,
                    },
                });
            },
        );
        await trust(page);
        await runButton(page).click();
        const results = page.getByRole('region', { name: 'Query results', exact: true });
        await expect(results.locator('.result-row-count')).toHaveText(
            `${rows} ${rows === 1 ? 'row' : 'rows'}`,
        );
        await expect(results.locator('.table-pagination, .result-pagination')).toHaveCount(0);
        await expect(results.locator('.result-completeness')).toHaveCount(0);
        if (completeness === 'truncated') {
            await expect(page.locator('.execution-bar')).toHaveAttribute(
                'data-run-status',
                'truncated',
            );
            await expect(page.locator('.execution-bar')).toContainText('Truncated');
            if (rows === 0)
                await expect(results.getByText(/No rows fit in the retained result/)).toBeVisible();
        } else {
            if (rows === 0)
                await expect(results.getByText('This query returned zero rows.')).toBeVisible();
        }
    });
}

test('A chart with no rows keeps its fallback table controls in the Results header', async ({
    page,
}) => {
    await page.route(
        url => /\/(result|snapshot)$/.test(url.pathname),
        async route => {
            const runId = new URL(route.request().url()).pathname.split('/')[3];
            await route.fulfill({
                json: {
                    runId,
                    queryId: 'empty-result-query',
                    createdAt: '2026-10-09T00:00:00.000Z',

                    columns: [{ name: 'service', type: 'String' }],
                    rows: [],
                    totalRows: 0,
                    offset: 0,
                    nextOffset: null,
                    completeness: 'complete',
                },
            });
        },
    );
    await trust(page);
    await runButton(page).click();
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await results.getByRole('tab', { name: 'Chart', exact: true }).click();
    await expect(results.locator('.chart-table-fallback')).toBeVisible();
    const filter = await openResultFilter(results.locator('.results-header'));
    await expect(results.locator('.result-row-count')).toHaveText('0 rows');
    await filter.fill('frontend');
    await expect(results.locator('tbody tr')).toHaveCount(0);
    await expect(results.locator('.result-match-count')).toHaveText('0 of 0 rows on this page');
    await expect(results.getByText('This query returned zero rows.')).toBeVisible();
    await expect(results.locator('.table-pagination, .result-pagination')).toHaveCount(0);
    await results.getByRole('tab', { name: 'Table', exact: true }).click();
    await expect(filter).toBeHidden();
    await expect(results.getByRole('button', { name: 'Search rows', exact: true })).toHaveAttribute(
        'aria-expanded',
        'false',
    );
    await expect(results.locator('.result-table-toolbar')).toHaveCount(1);
    await expect(results.locator('.result-row-count')).toHaveText('0 rows');
});

test('Paged truncated results retain compact controls when returning from Chart', async ({
    page,
}) => {
    const runs = countRuns(page);
    await mockPaginatedResult(page, 250, 'truncated');
    await trust(page);
    await runButton(page).click();
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    const header = results.locator('.results-header');
    const pages = header.locator('.result-pages-toggle');
    const dock = results.getByRole('dialog', { name: 'Search & pages', exact: true });
    await expect(pages).toHaveText('1/2');
    await expect(header.locator('.result-row-count')).toHaveText('250 rows');
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'truncated');
    await expect(page.locator('.execution-bar')).toContainText('Truncated');
    await pages.click();
    await dock.getByRole('button', { name: 'Last page', exact: true }).click();
    await expect(dock.locator('.result-retained-range')).toHaveText('201–250 of 250 retained rows');
    await (await openResultFilter(header)).fill('row-249');
    await expect(dock.locator('.result-match-count')).toHaveText('1 of 50 rows on this page');
    await expect(header.locator('.result-row-count')).toHaveText('250 rows');
    await expectResultsToolbarFits(header);
    await results.getByRole('tab', { name: 'Chart', exact: true }).click();
    await expect(dock).toHaveCount(0);
    await results.getByRole('tab', { name: 'Table', exact: true }).click();
    await expect(pages).toHaveText('2/2');
    await expect(header.locator('.result-row-count')).toHaveText('250 rows');
    await expect(dock).toBeHidden();
    await pages.click();
    await expect(dock.locator('.result-retained-range')).toHaveText('201–250 of 250 retained rows');
    await expect(page.locator('.execution-bar')).toContainText('Truncated');
    expect(runs()).toBe(1);
});

test('Pinned search stays open on the grid, moves, clamps and yields to the query menu', async ({
    page,
}, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await mockPaginatedResult(page, 1000);
    await trust(page);
    await runButton(page).click();
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    const dock = results.getByRole('dialog', { name: 'Search & pages', exact: true });
    const header = results.locator('.results-header');
    const filter = await openResultFilter(results);
    await filter.fill('row-1');
    await results.locator('tbody .row-number').first().click();
    await expect(dock).toBeHidden();
    await expect(header.locator('.result-search-active')).toBeVisible();
    await openResultFilter(results);
    const pin = dock.getByRole('button', { name: 'Keep search and pages open', exact: true });
    await pin.click();
    await expect(pin).toHaveAttribute('aria-pressed', 'true');
    await results.locator('tbody .row-number').first().click();
    await expect(dock).toBeVisible();
    const handle = dock.getByRole('button', { name: 'Move search and pages', exact: true });
    const initial = (await dock.boundingBox())!;
    await handle.press('Shift+ArrowLeft');
    const keyed = (await dock.boundingBox())!;
    expect(keyed.x).toBe(initial.x - 40);
    const handleBounds = (await handle.boundingBox())!;
    await page.mouse.move(handleBounds.x + 10, handleBounds.y + 10);
    await page.mouse.down();
    await page.mouse.move(handleBounds.x - 90, handleBounds.y - 70, { steps: 4 });
    await page.mouse.up();
    const dragged = (await dock.boundingBox())!;
    expect(dragged.x).toBe(keyed.x - 100);
    expect(dragged.y).toBeLessThan(keyed.y);
    await header.locator('.result-pages-toggle').click();
    await expect(dock.getByRole('spinbutton')).toBeFocused();
    expect(await dock.boundingBox()).toEqual(dragged);
    await header.getByRole('button', { name: 'Search rows', exact: true }).click();
    await expect(filter).toBeFocused();
    expect(await dock.boundingBox()).toEqual(dragged);
    await dock.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(header.locator('.result-pages-toggle')).toHaveText('2/5');
    await expect(dock).toBeVisible();
    expect(await dock.boundingBox()).toEqual(dragged);
    await page.setViewportSize({ width: 761, height: 500 });
    await expectDockFits(dock);
    await page.screenshot({ path: info.outputPath('pinned-dock.png') });
    const menu = await openStatementResults(results);
    await expect(dock).toBeHidden();
    await expect(menu).toBeVisible();
    await openResultFilter(results);
    await expect(menu).toBeHidden();
    await expect(filter).toHaveValue('row-1');
    const closeButton = dock.getByRole('button', { name: 'Close search and pages', exact: true });
    await closeButton.focus();
    await closeButton.press('Escape');
    await expect(dock).toBeVisible();
    await expect(filter).toHaveValue('row-1');
    await closeButton.click();
    await expect(header.getByRole('button', { name: 'Search rows', exact: true })).toBeFocused();
    expect(errors).toEqual([]);
});

test('Paging keeps the dock and search through loading and a retained-page read retry', async ({
    page,
}) => {
    const runs = countRuns(page);
    await mockPaginatedResult(page);
    let release!: () => void;
    const held = new Promise<void>(resolve => {
        release = resolve;
    });
    let pageReads = 0;
    await page.route(
        url => url.pathname.endsWith('/result') && url.searchParams.get('offset') === '200',
        async route => {
            pageReads++;
            if (pageReads === 1) {
                await held;
                await route.fulfill({
                    status: 500,
                    json: { error: { code: 'READ_FAILED', message: 'Page read failed' } },
                });
            } else await route.fallback();
        },
    );
    await trust(page);
    await runButton(page).click();
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    const dock = results.getByRole('dialog', { name: 'Search & pages', exact: true });
    const filter = await openResultFilter(results);
    await filter.fill('row-249');
    await dock.getByRole('button', { name: 'Keep search and pages open', exact: true }).click();
    await dock.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(dock).toBeVisible();
    await expect(dock).toHaveAttribute('aria-busy', 'true');
    await expect(results.locator('.result-row-count')).toHaveText('450 rows');
    await expect(dock.getByRole('button', { name: 'Next page', exact: true })).toBeDisabled();
    await expect(filter).toHaveValue('row-249');
    await expect(dock.locator('.result-match-count')).toHaveText('Loading this page…');
    release();
    await expect(results.getByText('Couldn’t load the result rows. Try again.')).toBeVisible();
    const retry = results.getByRole('button', { name: 'Retry', exact: true });
    const moveHandle = dock.getByRole('button', { name: 'Move search and pages', exact: true });
    const retryBounds = await retry.boundingBox();
    let dockBounds = await dock.boundingBox();
    // The pinned top-layer dock can cover this inline action. Move it out of the way first.
    while (
        retryBounds &&
        dockBounds &&
        retryBounds.x < dockBounds.x + dockBounds.width &&
        retryBounds.x + retryBounds.width > dockBounds.x &&
        retryBounds.y < dockBounds.y + dockBounds.height &&
        retryBounds.y + retryBounds.height > dockBounds.y
    ) {
        const currentY = dockBounds.y;
        await moveHandle.press('Shift+ArrowUp');
        dockBounds = await dock.boundingBox();
        if (!dockBounds || dockBounds.y === currentY) break;
    }
    await retry.click();
    await expect(dock).not.toHaveAttribute('aria-busy', 'true');
    await expect(dock.locator('.result-match-count')).toHaveText('1 of 200 rows on this page');
    await expect(results.locator('tbody .row-number')).toHaveText('250');
    await expect(results.locator('.result-row-count')).toHaveText('450 rows');
    await expect(
        dock.getByRole('button', { name: 'Keep search and pages open', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(runs()).toBe(1);
});

test('Selecting another statement resets search and closes the pinned dock', async ({ page }) => {
    await trust(page);
    await replaceSql(page, 'SELECT 1; SELECT 2;');
    await runButton(page).click();
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'succeeded');
    const filter = await openResultFilter(results);
    await filter.fill('no match');
    const dock = results.getByRole('dialog', { name: 'Search & pages', exact: true });
    await dock.getByRole('button', { name: 'Keep search and pages open', exact: true }).click();
    const menu = await openStatementResults(results);
    await menu.getByRole('menuitemradio', { name: 'Statement 1: succeeded', exact: true }).click();
    await expect(dock).toBeHidden();
    await expect(results.locator('.result-search-active')).toHaveCount(0);
    await openResultFilter(results);
    await expect(filter).toHaveValue('');
});

test('The largest retained result keeps its range and long search out of a narrow header', async ({
    page,
}, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 761, height: 640 });
    const runs = countRuns(page);
    await mockPaginatedResult(page, 20000);
    await trust(page);
    await runButton(page).click();
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    const header = results.locator('.results-header');
    const pages = header.locator('.result-pages-toggle');
    const dock = results.getByRole('dialog', { name: 'Search & pages', exact: true });
    await expect(pages).toHaveText('1/100');
    await pages.click();
    await dock.getByRole('button', { name: 'Last page', exact: true }).click();
    await expect(pages).toHaveText('100/100');
    await expect(dock.locator('.result-retained-range')).toHaveText(
        '19,801–20,000 of 20,000 retained rows',
    );
    await expect(results.locator('tbody tr')).toHaveCount(200);
    const filter = await openResultFilter(results);
    await filter.fill('row-19999');
    await expect(results.locator('tbody .row-number')).toHaveText('20000');
    await filter.fill('A very long string to search for '.repeat(40));
    await expectDockFits(dock);
    await expectResultsToolbarFits(header);
    await expect(header).toHaveCSS('height', '34px');
    const closeButton = dock.getByRole('button', { name: 'Close search and pages', exact: true });
    await closeButton.focus();
    await closeButton.press('Escape');
    await expect(dock).toBeVisible();
    await expect(filter).toHaveValue('A very long string to search for '.repeat(40));
    await closeButton.click();
    await expect(header.locator('.result-search-active')).toBeVisible();
    await expect(header.locator('.result-row-count')).toHaveText('20,000 rows');
    await expectResultsToolbarFits(header);
    await page.screenshot({ path: info.outputPath('compact-100-pages.png') });
    expect(runs()).toBe(1);
});
