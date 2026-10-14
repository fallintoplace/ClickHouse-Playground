import { test, expect } from '@playwright/test';
import { trust, openWorkspacePanel, runButton } from './helpers.js';
import { jsonRecord, stringValue } from '../helpers/type-guards.js';

test('Materialized views have selectable dependency edges and refresh details', async ({
    page,
}, info) => {
    await trust(page);
    await page.getByRole('button', { name: 'View dependencies', exact: true }).click();
    const dialog = page.getByRole('dialog', {
        name: 'Materialized view dependencies',
        exact: true,
    });
    await expect(dialog).toContainText('SAMPLE DATA');
    await expect(dialog).toHaveCSS('border-radius', '4px');
    await expect(dialog.locator('.native-lineage-node rect').first()).toHaveCSS('rx', '4px');
    await dialog
        .getByRole('button', { name: 'demo.monthly_report_mv: Refreshable MV', exact: true })
        .click();
    await expect(dialog.getByLabel('Selected object')).toContainText('EVERY 10 MINUTE');
    await expect(dialog.getByLabel('Selected object')).toContainText('8,400 ms');
    await expect(dialog.locator('.native-edge.edge-catalog-dependency')).toHaveCount(1);
    await expect(dialog.getByRole('button', { name: /^Reset zoom/ })).toBeInViewport();
    await page.screenshot({ path: info.outputPath('clickstudio-materialized-views.png') });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(
        page.getByRole('button', { name: 'View dependencies', exact: true }),
    ).toBeFocused();
});

for (const theme of ['Dark', 'Light']) {
    for (const width of [1280, 760]) {
        test(`Empty dependency map explains the database in ${theme} at ${width}px`, async ({
            page,
        }, info) => {
            await page.setViewportSize({ width, height: 900 });
            await trust(page);
            await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
            await page.route('**/api/connections/demo/native-explorer', route =>
                route.fulfill({
                    json: {
                        kind: 'lineage',
                        database: 'demo',
                        observedAt: '2026-10-13T21:27:00.000Z',
                        source: 'clickhouse',
                        nodes: [],
                        edges: [],
                        truncated: false,
                        notes: [
                            'Metadata from the connected server. This map does not show complete SELECT lineage.',
                        ],
                    },
                }),
            );
            if (width < 850) {
                const objects = page
                    .getByRole('complementary', { name: 'Workspace tools' })
                    .getByRole('button', { name: 'Objects', exact: true });
                if ((await objects.getAttribute('aria-pressed')) !== 'true') await objects.click();
            }
            await page.getByRole('button', { name: 'View dependencies', exact: true }).click();
            const dialog = page.getByRole('dialog', {
                name: 'Materialized view dependencies',
                exact: true,
            });
            const empty = dialog.getByRole('status');
            await expect(empty).toContainText('No dependencies yet');
            await expect(empty).toContainText('demo');
            await expect(dialog.getByLabel('Map guide')).toBeVisible();
            await expect(dialog.getByLabel('Relationship types')).toBeInViewport();
            await expect(dialog).not.toContainText('SAMPLE DATA');
            await expect(dialog.locator('.native-lineage-node')).toHaveCount(0);
            await expect(dialog.getByRole('button', { name: 'Zoom in' })).toHaveCount(0);
            await dialog.getByText('About this map', { exact: true }).click();
            await expect(dialog.locator('.native-lineage-notes')).toHaveAttribute('open', '');
            expect(
                await dialog.evaluate(element => element.scrollWidth - element.clientWidth),
            ).toBeLessThanOrEqual(1);
            await page.screenshot({
                path: info.outputPath(`dependencies-empty-${theme.toLowerCase()}-${width}.png`),
            });
        });
    }
}

test('Dependency search keeps connected objects and recovers from no matches', async ({ page }) => {
    await trust(page);
    await page.getByRole('button', { name: 'View dependencies', exact: true }).click();
    const dialog = page.getByRole('dialog', {
        name: 'Materialized view dependencies',
        exact: true,
    });
    const nodes = dialog.locator('.native-lineage-node');
    await expect(nodes).toHaveCount(5);
    const search = dialog.getByRole('searchbox', { name: 'Find an object', exact: true });
    await search.fill('  MONTHLY_REPORT_MV  ');
    await expect(nodes).toHaveCount(3);
    await expect(dialog.getByLabel('Selected object')).toContainText('monthly_report_mv');
    await search.fill('unmatched_object');
    await expect(dialog.getByRole('status')).toContainText('No matching objects');
    await expect(dialog.getByRole('status')).toContainText('unmatched_object');
    await expect(dialog.getByLabel('Selected object')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Clear search', exact: true }).click();
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    await expect(nodes).toHaveCount(5);
    await search.fill('   ');
    await expect(nodes).toHaveCount(5);
});

test('Dependency zoom is bounded and keyboard selection updates the inspector', async ({
    page,
}) => {
    await trust(page);
    await page.getByRole('button', { name: 'View dependencies', exact: true }).click();
    const dialog = page.getByRole('dialog', {
        name: 'Materialized view dependencies',
        exact: true,
    });
    const graph = dialog.getByRole('group', { name: 'Dependency graph', exact: true });
    const originalWidth = await graph.getAttribute('width');
    const zoomIn = dialog.getByRole('button', { name: 'Zoom in', exact: true });
    const zoomOut = dialog.getByRole('button', { name: 'Zoom out', exact: true });
    const reset = dialog.getByRole('button', { name: /^Reset zoom/ });
    await zoomIn.click();
    await expect(reset).toHaveText('125%');
    await zoomIn.click();
    await expect(reset).toHaveText('150%');
    await expect(zoomIn).toBeDisabled();
    expect(Number(await graph.getAttribute('width'))).toBe(Number(originalWidth) * 1.5);
    for (let index = 0; index < 4; index++) await zoomOut.click();
    await expect(reset).toHaveText('50%');
    await expect(zoomOut).toBeDisabled();
    await reset.click();
    await expect(graph).toHaveAttribute('width', originalWidth ?? '');
    const monthly = dialog.getByRole('button', {
        name: 'demo.monthly_report_mv: Refreshable MV',
        exact: true,
    });
    await monthly.focus();
    await page.keyboard.press('Space');
    await expect(monthly).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByLabel('Selected object')).toContainText('EVERY 10 MINUTE');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(
        page.getByRole('button', { name: 'View dependencies', exact: true }),
    ).toBeFocused();
});

test('Dependency refresh keeps the previous graph on error and can recover', async ({ page }) => {
    await trust(page);
    await page.getByRole('button', { name: 'View dependencies', exact: true }).click();
    const dialog = page.getByRole('dialog', {
        name: 'Materialized view dependencies',
        exact: true,
    });
    await expect(dialog.locator('.native-lineage-node')).toHaveCount(5);
    let fail = true;
    await page.route('**/api/connections/demo/native-explorer', route =>
        fail
            ? route.fulfill({
                  status: 403,
                  json: {
                      error: {
                          code: 'CLICKHOUSE_PERMISSION',
                          message: 'Not enough privileges to read system.tables',
                      },
                  },
              })
            : route.continue(),
    );
    await dialog.getByRole('button', { name: 'Refresh metadata', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('The previous snapshot is shown below.');
    await expect(dialog.locator('.native-lineage-node')).toHaveCount(5);
    fail = false;
    await dialog.getByRole('button', { name: 'Refresh metadata', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(dialog.locator('.native-lineage-node')).toHaveCount(5);
});

test('Storage tabs show merge flow and honest mutation completion', async ({ page }, info) => {
    await trust(page);
    await page.getByRole('button', { name: 'events MergeTree', exact: true }).click();
    await page.getByRole('button', { name: 'Visualize parts', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'MergeTree parts', exact: true });
    await dialog.getByRole('button', { name: 'Merges', exact: true }).click();
    await expect(dialog.getByRole('region', { name: 'Merge activity' })).toContainText('67%');
    await expect(dialog).toContainText('202609_101_105_1');
    await expect(dialog.getByRole('checkbox', { name: /Auto-refresh/ })).toBeDisabled();
    await page.screenshot({ path: info.outputPath('clickstudio-merges.png') });
    await dialog.getByRole('button', { name: 'Mutations', exact: true }).click();
    await expect(dialog).toContainText('Parts remaining');
    await expect(dialog).toContainText('Incomplete · last attempt failed');
    await expect(dialog.getByRole('progressbar')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('clickstudio-mutations.png') });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toHaveCount(0);
});

test('Run comparison searches full SQL and swaps retained runs without executing another query', async ({
    page,
}, info) => {
    await trust(page);
    for (const sql of [
        'SELECT 1 AS value /* hidden text unique_before_marker */',
        'SELECT 2 AS value /* hidden text unique_after_marker */',
    ]) {
        await page.locator('.cm-content').click();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.insertText(sql);
        const submitted = page.waitForResponse(
            response =>
                response.request().method() === 'POST' &&
                new URL(response.url()).pathname === '/api/runs',
        );
        await runButton(page).click();
        const next = jsonRecord(await (await submitted).json(), 'Run response');
        await expect(page.locator('.execution-bar')).toHaveAttribute(
            'data-query-id',
            stringValue(next.queryId, 'Query ID'),
        );
        await expect(page.locator('.execution-bar')).toHaveAttribute(
            'data-run-status',
            'succeeded',
        );
    }
    let submissions = 0;
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs')
            submissions++;
    });
    await openWorkspacePanel(page, 'history');
    await page.getByRole('button', { name: 'Compare runs', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Compare query runs', exact: true });
    const beforePicker = dialog.getByRole('combobox', { name: 'Before run', exact: true });
    await expect(beforePicker).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'After run', exact: true })).toBeVisible();
    await beforePicker.click();
    const search = dialog.getByRole('searchbox', {
        name: 'Search before run',
        exact: true,
    });
    await search.fill('unique_after_marker');
    const option = dialog.getByRole('option');
    await expect(option).toHaveCount(1);
    await expect(option).toHaveAttribute('title', /unique_after_marker/);
    await search.fill('no_matching_query_marker');
    await expect(option).toHaveCount(0);
    await expect(dialog.getByRole('status')).toContainText('No matches');
    await search.press('Escape');
    await expect(search).toBeHidden();
    await expect(dialog.locator('.native-comparison-table')).toContainText(
        'Client-observed elapsed time',
    );
    await dialog.getByRole('button', { name: 'Swap ⇄', exact: true }).click();
    await expect(dialog.locator('.native-comparison-table')).toContainText('Retained result rows');
    await expect(
        dialog.getByRole('rowheader', { name: /Client-observed elapsed time/ }),
    ).toBeInViewport();
    expect(
        (await dialog.locator('.native-comparison-table-scroll').boundingBox())?.height,
    ).toBeGreaterThan(200);
    await page.screenshot({ path: info.outputPath('clickstudio-run-comparison.png') });
    expect(submissions).toBe(0);
});

test('Denied metadata shows an actionable error, never substitute sample data', async ({
    page,
}) => {
    await trust(page);
    await page.route('**/api/connections/demo/native-explorer', route =>
        route.fulfill({
            status: 403,
            json: {
                error: {
                    code: 'CLICKHOUSE_PERMISSION',
                    message: 'Not enough privileges to read system.tables',
                },
            },
        }),
    );
    await page.getByRole('button', { name: 'View dependencies', exact: true }).click();
    const dialog = page.getByRole('dialog', {
        name: 'Materialized view dependencies',
        exact: true,
    });
    await expect(dialog.getByRole('alert')).toContainText('Not enough privileges');
    await expect(dialog.locator('.native-lineage-node')).toHaveCount(0);
    await expect(dialog).not.toContainText('SAMPLE DATA');
});
