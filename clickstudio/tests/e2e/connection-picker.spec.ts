import { test, expect } from '@playwright/test';
import { PLAYGROUND_CONNECTION } from '../../src/shared/database/connections/playground.js';
import { expectReferenceStyles } from './style-reference.js';

test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/api/connections', async route => {
        const response = await route.fetch();
        await route.fulfill({
            response,
            json: [...(await response.json()), PLAYGROUND_CONNECTION],
        });
    });
    await page.goto('/?connection=demo');
});

for (const mode of ['Standard', 'Experimental']) {
    test(`${mode} closes the source picker on an outside editor click`, async ({ page }) => {
        await page.getByText(mode, { exact: true }).click();
        const trigger = page.locator('.connection-trigger');
        const menu = page.getByRole('dialog', { name: 'Data source options' });
        await trigger.click();
        await expect(menu).toBeVisible();
        await page.locator('.cm-content').click({ position: { x: 10, y: 10 } });
        await expect(menu).toBeHidden();
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('.cm-content')).toBeFocused();
        await trigger.click();
        await expect(menu).toBeVisible();
    });
}

test('Outside clicks close the picker even when the target stops propagation', async ({ page }) => {
    const editor = page.locator('.cm-content');
    await editor.evaluate(element => {
        element.addEventListener('pointerdown', event => event.stopPropagation(), { once: true });
    });
    await page.locator('.connection-trigger').click();
    await editor.click({ position: { x: 10, y: 10 } });
    await expect(page.getByRole('dialog', { name: 'Data source options' })).toBeHidden();
});

test('Inside clicks keep the picker open and the trigger closes it without reopening', async ({
    page,
}) => {
    const trigger = page.locator('.connection-trigger');
    const menu = page.getByRole('dialog', { name: 'Data source options' });
    for (let attempt = 0; attempt < 3; attempt++) {
        await trigger.click();
        await expect(menu).toBeVisible();
        await menu.getByText('Current data source', { exact: true }).click();
        await expect(menu).toBeVisible();
        await trigger.click();
        await expect(menu).toBeHidden();
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    }
});

test('Escape closes the picker and returns keyboard focus to its trigger', async ({ page }) => {
    const trigger = page.locator('.connection-trigger');
    const menu = page.getByRole('dialog', { name: 'Data source options' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    await menu.getByRole('button', { name: /ClickHouse Playground/ }).focus();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
});

test('Selecting a source closes the picker and preserves the selected source on reopen', async ({
    page,
}) => {
    const trigger = page.locator('.connection-trigger');
    const menu = page.getByRole('dialog', { name: 'Data source options' });
    await trigger.click();
    await menu.getByRole('button', { name: /ClickHouse Playground/ }).click();
    await expect(menu).toBeHidden();
    await expect(page).toHaveURL(/connection=playground/);
    await expect(trigger).toContainText('PLAYGROUND');
    await trigger.click();
    const current = menu.getByRole('button', { name: /ClickHouse Playground/ });
    await expect(current).toHaveAttribute('aria-pressed', 'true');
    await current.click();
    await expect(menu).toBeHidden();
    await expect(page).toHaveURL(/connection=playground/);
});

test('An outside control still performs its action when it dismisses the picker', async ({
    page,
}) => {
    await page.locator('.connection-trigger').click();
    await page.getByRole('radio', { name: 'Light theme', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Data source options' })).toBeHidden();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'click-light');
});

for (const theme of ['Dark', 'Light']) {
    test(`${theme} source picker uses flat surfaces and a clear selection marker`, async ({
        page,
    }, info) => {
        await page.goto('/?connection=playground');
        await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
        await page.locator('.connection-trigger').click();
        const menu = page.getByRole('dialog', { name: 'Data source options' });
        await expect(menu).toBeVisible();
        for (const element of [
            menu,
            menu.locator('.connection-menu-current'),
            menu.locator('.connection-menu-note'),
            menu.getByRole('button', { name: /ClickHouse Playground/ }),
        ]) {
            await expect(element).toHaveCSS('background-image', 'none');
        }
        const current = menu.getByRole('button', { name: /ClickHouse Playground/ });
        await expect(current).toHaveAttribute('aria-pressed', 'true');
        await expect(current.locator('.connection-choice-check svg')).toBeVisible();
        await expect(current).toHaveCSS('box-shadow', 'none');
        await page.keyboard.press('Tab');
        await current.focus();
        await expect(current).toHaveCSS('outline-style', 'solid');
        await expectReferenceStyles(page, info, 'source-picker', menu);
        await menu.getByText('Current data source', { exact: true }).click();
        await menu.screenshot({ path: info.outputPath(`source-picker-${theme}.png`) });
    });
}
