import { test, expect } from '@playwright/test';
import {
    currentQueryId,
    openBlankSql,
    replaceSql,
    runButton,
    trustCurrentConnection,
} from './helpers.js';

for (const path of [
    '/',
    '/?mode=experimental',
    '/experimental-old',
    '/experimental/nested',
    '/experimental',
    '/experimental/',
]) {
    const experimental = path === '/experimental' || path === '/experimental/';
    test(`${path} opens ${experimental ? 'Experimental' : 'Standard'}`, async ({ page }) => {
        await page.addInitScript(experimental => {
            localStorage.setItem('clickstudio:experience', experimental ? 'beginner' : 'expert');
        }, experimental);
        await page.goto(path);
        await expect(page.locator('.application')).toHaveAttribute(
            'data-experience',
            experimental ? 'expert' : 'beginner',
        );
        await expect(page.locator('.navbar-mode-control')).toHaveCount(0);
        await expect(page.getByRole('radio', { name: 'Standard', exact: true })).toHaveCount(0);
        await expect(page.getByRole('radio', { name: 'Experimental', exact: true })).toHaveCount(0);
        const status = page.locator('.experimental-workspace-status');
        if (experimental) {
            await expect(status).toContainText('Experimental');
            await expect(
                status.getByRole('link', { name: 'Back to workspace', exact: true }),
            ).toBeVisible();
            await expect(page.getByTestId('save-query')).toBeVisible();
        } else {
            await expect(status).toHaveCount(0);
            await expect(page.locator('a[href*="experimental"]')).toHaveCount(0);
            await expect(page.getByTestId('save-query')).toHaveCount(0);
        }
        await page.reload();
        await expect(page.locator('.application')).toHaveAttribute(
            'data-experience',
            experimental ? 'expert' : 'beginner',
        );
    });
}

test('Experimental return and browser history preserve the connection, SQL tabs and run without reloading', async ({
    page,
}) => {
    let submissions = 0;
    page.on('request', request => {
        if (
            request.method() === 'POST' &&
            ['/api/runs', '/api/scripts'].includes(new URL(request.url()).pathname)
        )
            submissions++;
    });
    await page.goto('/experimental?connection=demo#sql');
    await trustCurrentConnection(page);
    await openBlankSql(page);
    await replaceSql(page, 'SELECT 42 AS keep_my_work');
    await runButton(page).click();
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'succeeded');
    const queryId = await currentQueryId(page);
    const tabs = page.getByRole('tablist', { name: 'SQL documents', exact: true }).getByRole('tab');
    const tabCount = await tabs.count();
    const pageMarker = await page.evaluate(() => {
        const marker = crypto.randomUUID();
        document.body.dataset.routeMarker = marker;
        return marker;
    });
    const returnLink = page.getByRole('link', { name: 'Back to workspace', exact: true });
    await expect(returnLink).toHaveAttribute('href', '/?connection=demo#sql');
    await returnLink.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/\?connection=demo#sql$/);
    await expect(page.locator('.application')).toHaveAttribute('data-experience', 'beginner');
    await expect(page.locator('body')).toHaveAttribute('data-route-marker', pageMarker);
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', queryId);
    await expect(page.locator('.cm-content')).toContainText('SELECT 42 AS keep_my_work');
    await expect(tabs).toHaveCount(tabCount);
    await page.goBack();
    await expect(page).toHaveURL(/\/experimental\?connection=demo#sql$/);
    await expect(page.locator('.application')).toHaveAttribute('data-experience', 'expert');
    await expect(page.locator('body')).toHaveAttribute('data-route-marker', pageMarker);
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', queryId);
    await page.goForward();
    await expect(page.locator('.application')).toHaveAttribute('data-experience', 'beginner');
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', queryId);
    expect(submissions).toBe(1);
    await page.reload();
    await expect(page.locator('.cm-content')).toContainText('SELECT 42 AS keep_my_work');
    await expect(tabs).toHaveCount(tabCount);
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', queryId);
    await page.goto('/experimental?connection=demo');
    await expect(page.locator('.application')).toHaveAttribute('data-experience', 'expert');
    await expect(page.locator('.cm-content')).toContainText('SELECT 42 AS keep_my_work');
    await expect(tabs).toHaveCount(tabCount);
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', queryId);
    expect(submissions).toBe(1);
});

test('A fresh workspace does not save a mode preference', async ({ page }) => {
    await page.goto('/experimental');
    await expect(page.locator('.application')).toHaveAttribute('data-experience', 'expert');
    expect(await page.evaluate(() => localStorage.getItem('clickstudio:experience'))).toBeNull();
    await page.getByRole('link', { name: 'Back to workspace', exact: true }).click();
    await expect(page.locator('.application')).toHaveAttribute('data-experience', 'beginner');
    expect(await page.evaluate(() => localStorage.getItem('clickstudio:experience'))).toBeNull();
});

test('Browser history restores the data source selected in each workspace URL', async ({
    page,
}) => {
    await page.route('**/api/connections', async route => {
        const response = await route.fetch();
        const profiles = await response.json();
        await route.fulfill({
            response,
            json: [...profiles, { ...profiles[0], id: 'playground', name: 'Another sample' }],
        });
    });
    await page.route('**/api/connections/playground/schema', route =>
        route.fulfill({
            json: {
                connectionId: 'playground',
                fetchedAt: '2026-10-12T00:00:00Z',
                tables: [],
                columns: [],
                warnings: [],
                truncated: false,
            },
        }),
    );
    await page.goto('/experimental?connection=demo');
    await expect(page.locator('.connection-trigger')).toContainText('Sample data');
    await page.getByRole('link', { name: 'Back to workspace', exact: true }).click();
    await page.locator('.connection-trigger').click();
    await page
        .getByRole('dialog', { name: 'Data source options', exact: true })
        .getByRole('button', { name: /Another sample/ })
        .click();
    await expect(page).toHaveURL(/\/\?connection=playground$/);
    await expect(page.locator('.connection-trigger')).toContainText('ClickHouse');
    await page.goBack();
    await expect(page).toHaveURL(/\/experimental\?connection=demo$/);
    await expect(page.locator('.application')).toHaveAttribute('data-experience', 'expert');
    await expect(page.locator('.connection-trigger')).toContainText('Sample data');
    await page.goForward();
    await expect(page).toHaveURL(/\/\?connection=playground$/);
    await expect(page.locator('.application')).toHaveAttribute('data-experience', 'beginner');
    await expect(page.locator('.connection-trigger')).toContainText('ClickHouse');
});
