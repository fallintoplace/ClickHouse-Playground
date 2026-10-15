import { test, expect, type Page } from '@playwright/test';
import { openBlankSql, replaceSql, trust } from './helpers.js';

const panel = (page: Page) => page.locator('.revision-history-section');

async function openVersions(page: Page) {
    await page.getByRole('button', { name: 'More workspace panels', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Version history', exact: true }).click();
}

function gate() {
    let release = () => {};
    const promise = new Promise<void>(resolve => {
        release = resolve;
    });
    return { promise, release };
}

test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'wait' });
});

test('Unsaved queries can create their first version without duplicate saves', async ({ page }) => {
    await trust(page);
    const sql = 'SELECT 42 AS first_saved_version;';
    await replaceSql(page, sql);
    await openVersions(page);
    await expect(panel(page).getByRole('alert')).toHaveCount(0);
    await expect(panel(page).getByText('Save your first version', { exact: true })).toBeVisible();
    await expect(panel(page).getByRole('button', { name: 'Refresh versions' })).toHaveCount(0);
    const pending = gate();
    let saves = 0;
    await page.route(
        url => url.pathname === '/api/documents',
        async route => {
            if (route.request().method() !== 'POST') return route.continue();
            saves++;
            await pending.promise;
            await route.continue();
        },
    );
    const action = panel(page).locator('.revision-empty-action');
    try {
        await action.click();
        await expect(action).toHaveText('Saving…');
        await expect(action).toBeDisabled();
        await expect(action).toHaveAttribute('aria-busy', 'true');
        await action.evaluate(button => {
            if (button instanceof HTMLButtonElement) {
                button.click();
                button.click();
            }
        });
        await expect.poll(() => saves).toBe(1);
    } finally {
        pending.release();
    }
    await expect(panel(page).getByRole('button', { name: /Version 1/ })).toBeVisible();
    await expect(panel(page).locator('.revision-preview pre')).toHaveText(sql);
    await expect(panel(page).locator('.revision-empty-state')).toHaveCount(0);
    expect(saves).toBe(1);
    await openBlankSql(page);
    await expect(
        panel(page).getByRole('button', { name: 'Save query', exact: true }),
    ).toBeEnabled();
    await expect(panel(page).getByRole('alert')).toHaveCount(0);
    await expect(panel(page).locator('.revision-list')).toHaveCount(0);
});

test('A failed first save leaves the draft available for retry', async ({ page }) => {
    await trust(page);
    const sql = 'SELECT 43 AS retried_version;';
    await replaceSql(page, sql);
    await openVersions(page);
    let saves = 0;
    await page.route(
        url => url.pathname === '/api/documents',
        route => {
            if (route.request().method() !== 'POST') return route.continue();
            saves++;
            return saves === 1
                ? route.fulfill({
                      status: 503,
                      json: { error: { code: 'SAVE_FAILED', message: 'Temporary save failure.' } },
                  })
                : route.continue();
        },
    );
    const failedSave = page.waitForResponse(
        response =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === '/api/documents',
    );
    await panel(page).getByRole('button', { name: 'Save query', exact: true }).click();
    expect((await failedSave).status()).toBe(503);
    const retry = panel(page).getByRole('button', { name: 'Save query', exact: true });
    await expect(retry).toBeEnabled();
    await expect(page.locator('.cm-content')).toContainText(sql);
    await expect(panel(page).getByRole('alert')).toHaveCount(0);
    await retry.click();
    await expect(panel(page).getByRole('button', { name: /Version 1/ })).toBeVisible();
    await expect(panel(page).locator('.revision-preview pre')).toHaveText(sql);
    expect(saves).toBe(2);
});

test('Real revision errors remain alerts and cannot leak into an unsaved tab', async ({ page }) => {
    await trust(page);
    const saved = page.waitForResponse(
        response =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === '/api/documents',
    );
    await page.getByTestId('save-query').click();
    await saved;
    const pending = gate();
    let hold = false;
    await page.route(
        url => /^\/api\/documents\/[^/]+\/revisions$/.test(url.pathname),
        async route => {
            if (hold) await pending.promise;
            await route.fulfill({
                status: 503,
                json: { error: { code: 'REVISION_READ_FAILED', message: 'Versions unavailable.' } },
            });
        },
    );
    await openVersions(page);
    await expect(panel(page).getByRole('alert')).toContainText('Versions unavailable.');
    await expect(panel(page).getByRole('button', { name: 'Save query', exact: true })).toHaveCount(
        0,
    );
    const lateFailure = page.waitForResponse(response =>
        /^\/api\/documents\/[^/]+\/revisions$/.test(new URL(response.url()).pathname),
    );
    try {
        hold = true;
        await panel(page).getByRole('button', { name: 'Refresh versions', exact: true }).click();
        await expect(
            panel(page).getByRole('button', { name: 'Refreshing versions' }),
        ).toBeDisabled();
        await openBlankSql(page);
        await expect(
            panel(page).getByText('Save your first version', { exact: true }),
        ).toBeVisible();
        await expect(panel(page).getByRole('alert')).toHaveCount(0);
    } finally {
        pending.release();
    }
    await lateFailure;
    await expect(panel(page).getByRole('alert')).toHaveCount(0);
    await expect(
        panel(page).getByRole('button', { name: 'Save query', exact: true }),
    ).toBeEnabled();
});
