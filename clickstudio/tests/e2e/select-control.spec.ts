import { test, expect, type Locator, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

async function loadSelector(page: Page, top: number, right: boolean, searchable = true) {
    await page.goto(`/experimental?searchable=${searchable}`);
    await page.evaluate(
        ({ top, right }) => {
            const container = document.createElement('div');
            container.id = 'select-harness';
            container.style.position = 'fixed';
            container.style.top = `${top}px`;
            container.style.width = 'min(460px, calc(100vw - 32px))';
            container.style.zIndex = '100';
            if (right) container.style.right = '16px';
            else container.style.left = '16px';
            document.body.append(container);
        },
        { top, right },
    );
    const fixture = fileURLToPath(new URL('./fixtures/select-control.tsx', import.meta.url));
    await page.addScriptTag({ type: 'module', url: `/@fs${fixture}` });
    return page.getByRole('combobox', { name: 'Map second_value to destination', exact: true });
}

async function expectMenuFits(page: Page, menu: Locator, control: Locator) {
    const viewport = page.viewportSize()!;
    const bounds = (await menu.boundingBox())!;
    const trigger = (await control.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(8);
    expect(bounds.y).toBeGreaterThanOrEqual(8);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width - 8);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height - 8);
    expect(bounds.width).toBeGreaterThanOrEqual(trigger.width);
    expect(
        bounds.y >= trigger.y + trigger.height + 3 || bounds.y + bounds.height <= trigger.y - 3,
    ).toBe(true);
    expect(
        await menu.evaluate(element => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(1);
}

for (const theme of ['Light', 'Dark']) {
    for (const layout of [
        { name: 'below', width: 960, height: 720, top: 40, right: false },
        { name: 'above', width: 960, height: 720, top: 630, right: true },
        { name: 'short', width: 760, height: 240, top: 100, right: false },
        { name: 'narrow', width: 240, height: 240, top: 100, right: true },
    ]) {
        test(`${theme} custom selector fits ${layout.name} space and keeps every option reachable`, async ({
            page,
        }, info) => {
            await page.setViewportSize({ width: layout.width, height: layout.height });
            const control = await loadSelector(page, layout.top, layout.right);
            await page.evaluate(theme => {
                document.documentElement.dataset.theme =
                    theme === 'Dark' ? 'click-dark' : 'click-light';
            }, theme);
            await control.click();
            const search = page.getByRole('searchbox', {
                name: 'Search map second_value to destination',
                exact: true,
            });
            await expect(search).toBeFocused();
            const listbox = page.getByRole('listbox', {
                name: 'Map second_value to destination',
                exact: true,
            });
            const menu = listbox.locator('..');
            await expectMenuFits(page, menu, control);
            await expect(search).toHaveAttribute('placeholder', 'Search options…');
            const selected = listbox.locator('[role="option"][data-value="59"]');
            await expect
                .poll(async () => {
                    const item = (await selected.boundingBox())!;
                    const scroll = (await listbox.boundingBox())!;
                    return (
                        item.y >= scroll.y - 1 &&
                        item.y + item.height <= scroll.y + scroll.height + 1
                    );
                })
                .toBe(true);
            expect(await listbox.evaluate(element => element.scrollHeight)).toBeGreaterThan(
                await listbox.evaluate(element => element.clientHeight),
            );
            await page.screenshot({ path: info.outputPath('selector-open.png') });
            await search.fill('no-matching-option');
            await expect(listbox.getByRole('option')).toHaveCount(0);
            await expect(menu.getByRole('status')).toHaveText('No matches');
            await expectMenuFits(page, menu, control);
            await search.fill('second_value_02_');
            await expect(listbox.getByRole('option')).toHaveCount(1);
            await expectMenuFits(page, menu, control);
            await search.press('Enter');
            await expect(control).toHaveAttribute('data-value', '2');
            await expect(control).toBeFocused();
            await control.click();
            await expect(search).toBeFocused();
            await expect(search).toHaveValue('');
            await search.press('Escape');
            await expect(listbox).toBeHidden();
            await expect(control).toBeFocused();
        });
    }
}

test('Custom selectors without search keep keyboard navigation in a short viewport', async ({
    page,
}) => {
    await page.setViewportSize({ width: 360, height: 240 });
    const control = await loadSelector(page, 100, true, false);
    await control.press('ArrowDown');
    const listbox = page.getByRole('listbox', {
        name: 'Map second_value to destination',
        exact: true,
    });
    await expect(listbox).toBeFocused();
    await expectMenuFits(page, listbox.locator('..'), control);
    await expect(page.getByRole('searchbox', { name: /Search map second_value/ })).toHaveCount(0);
    await listbox.press('Home');
    await listbox.press('Enter');
    await expect(control).toHaveAttribute('data-value', '1');
    await control.click();
    await expect(listbox).toBeFocused();
    await control.click();
    await expect(listbox).toBeHidden();
    await control.click();
    await expect(listbox).toBeFocused();
    await page.mouse.click(7, 7);
    await expect(listbox).toBeHidden();
    await control.click();
    await expect(listbox).toBeFocused();
    await page.setViewportSize({ width: 360, height: 300 });
    await expect(listbox).toBeHidden();
});
