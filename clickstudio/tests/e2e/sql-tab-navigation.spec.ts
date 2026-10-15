import { test, expect, type Page } from '@playwright/test';
import { openBlankSql, trust } from './helpers.js';
import { expectReferenceStyles } from './style-reference.js';

async function expectActiveTabFullyVisible(page: Page) {
    const tabList = page.getByRole('tablist', { name: 'SQL documents', exact: true });
    await expect
        .poll(() =>
            tabList.evaluate(node => {
                const active = node.querySelector('[role="tab"][aria-selected="true"]');
                const close = active?.querySelector('button');
                if (!active || !close) throw new Error('Active SQL tab or close button not found');
                const bounds = node.getBoundingClientRect();
                const tabBounds = active.getBoundingClientRect();
                const closeBounds = close.getBoundingClientRect();
                return Math.max(
                    bounds.left - tabBounds.left,
                    tabBounds.right - bounds.right,
                    bounds.left - closeBounds.left,
                    closeBounds.right - bounds.right,
                );
            }),
        )
        .toBeLessThanOrEqual(1);
}

for (const mode of ['Standard', 'Experimental']) {
    for (const reducedMotion of ['reduce', 'no-preference'] as const) {
        test(`${mode} fully reveals new SQL tabs with ${reducedMotion} motion`, async ({
            page,
        }, info) => {
            await page.emulateMedia({ reducedMotion });
            await page.setViewportSize({ width: 900, height: 800 });
            await trust(page, mode);

            const tabList = page.getByRole('tablist', { name: 'SQL documents', exact: true });
            const scrollRight = page.getByTestId('scroll-sql-tabs-right');
            const actions = page.locator('.document-tab-actions');
            await expect(scrollRight).toHaveCount(0);

            // Check the first overflow before opening another tab can correct its scroll position.
            for (let index = 0; index < 12; index++) {
                await openBlankSql(page);
                await expectActiveTabFullyVisible(page);
                if (await scrollRight.count()) break;
            }
            await expect(scrollRight).toBeDisabled();
            await expectActiveTabFullyVisible(page);

            await openBlankSql(page);
            await expectActiveTabFullyVisible(page);
            await expect(scrollRight).toBeDisabled();

            const tabCount = await tabList.getByRole('tab').count();
            await page.getByTestId('new-sql').click({ clickCount: 3 });
            await expect(tabList.getByRole('tab')).toHaveCount(tabCount + 3);
            await expectActiveTabFullyVisible(page);
            await expect(scrollRight).toBeDisabled();

            for (const theme of ['Dark', 'Light']) {
                await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
                await expect(actions).toHaveCSS('box-shadow', 'none');
                await expectReferenceStyles(page, info, `new-tab-${theme.toLowerCase()}`, tabList);
                await page.getByTestId('scroll-sql-tabs-left').click();
                await expect(scrollRight).toBeEnabled();
                await expect(actions).not.toHaveCSS('box-shadow', 'none');
                await expect(tabList.getByRole('tab').last()).toHaveAttribute(
                    'aria-selected',
                    'true',
                );
                await openBlankSql(page);
                await expectActiveTabFullyVisible(page);
                await expect(scrollRight).toBeDisabled();
            }

            await page.setViewportSize({ width: 760, height: 800 });
            await expectActiveTabFullyVisible(page);
            await tabList
                .getByRole('tab', { selected: true })
                .getByRole('button', { name: /^Close / })
                .click();
            await expectActiveTabFullyVisible(page);
            await expect(scrollRight).toBeDisabled();
        });

        test(`${mode} points toward the hidden active SQL tab with ${reducedMotion} motion`, async ({
            page,
        }, info) => {
            await page.emulateMedia({ reducedMotion });
            await page.setViewportSize({ width: 900, height: 800 });
            await trust(page, mode);
            await expect(page.locator('.has-hidden-active-tab')).toHaveCount(0);
            await expect(page.getByTestId('scroll-sql-tabs-right')).toHaveCount(0);

            for (let index = 0; index < 8; index++) await openBlankSql(page);

            const tabList = page.getByRole('tablist', { name: 'SQL documents', exact: true });
            const firstTab = tabList.getByRole('tab').first();
            const lastTab = tabList.getByRole('tab').last();
            const scrollLeft = page.getByTestId('scroll-sql-tabs-left');
            const scrollRight = page.getByTestId('scroll-sql-tabs-right');
            const hint = page.locator('.document-tabs-scroll-button.has-hidden-active-tab');

            await expect(lastTab).toHaveAttribute('aria-selected', 'true');
            await expect(scrollRight).toBeDisabled();
            await expect(hint).toHaveCount(0);

            for (const theme of ['Dark', 'Light']) {
                await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
                const accent = theme === 'Dark' ? 'rgb(250, 255, 105)' : 'rgb(166, 95, 45)';
                const border = theme === 'Dark' ? 'rgb(41, 67, 78)' : 'rgb(188, 203, 224)';

                await tabList.evaluate(node => {
                    node.scrollLeft = 0;
                });
                await expect(scrollRight).toHaveClass(/has-hidden-active-tab/);
                await expect(scrollRight).toBeEnabled();
                await expect(scrollLeft).toBeDisabled();
                await expect(hint).toHaveCount(1);
                await expect(scrollRight).toHaveAttribute(
                    'title',
                    'Active SQL tab is to the right',
                );
                await expect(scrollRight).toHaveAccessibleDescription(
                    'Active SQL tab is to the right',
                );
                await expect(scrollRight).toHaveCSS('color', accent);
                await expect(scrollRight).toHaveCSS('border-top-color', border);
                await scrollRight.hover();
                await expectReferenceStyles(
                    page,
                    info,
                    `hidden-active-tab-${theme.toLowerCase()}-right`,
                    scrollRight,
                    false,
                );
                await expect(scrollRight).toHaveCSS('color', accent);
                await expect(scrollRight).toHaveCSS('border-top-color', border);
                await expect(lastTab).toHaveAttribute('aria-selected', 'true');

                await tabList.evaluate(node => {
                    const active = node.querySelector('[aria-selected="true"]');
                    if (!active) throw new Error('Active SQL tab not found');
                    node.scrollLeft +=
                        active.getBoundingClientRect().left -
                        node.getBoundingClientRect().right +
                        12;
                });
                await expect(scrollRight).toBeEnabled();
                await expect(hint).toHaveCount(0);
                await expect(scrollRight).toHaveAttribute('title', 'More SQL tabs to the right');
                await scrollRight.click();
                await expect(scrollRight).toBeDisabled();
                await expect(lastTab).toHaveAttribute('aria-selected', 'true');
                await expect(hint).toHaveCount(0);

                await firstTab.click();
                await expect(firstTab).toHaveAttribute('aria-selected', 'true');
                await expect(scrollLeft).toBeDisabled();
                await tabList.evaluate(node => {
                    node.scrollLeft = node.scrollWidth;
                });
                await expect(scrollLeft).toHaveClass(/has-hidden-active-tab/);
                await expect(scrollLeft).toBeEnabled();
                await expect(scrollRight).toBeDisabled();
                await expect(hint).toHaveCount(1);
                await expect(scrollLeft).toHaveAttribute('title', 'Active SQL tab is to the left');
                await expect(scrollLeft).toHaveAccessibleDescription(
                    'Active SQL tab is to the left',
                );
                await expect(scrollLeft).toHaveCSS('color', accent);
                await expect(scrollLeft).toHaveCSS('border-top-color', border);
                await expectReferenceStyles(
                    page,
                    info,
                    `hidden-active-tab-${theme.toLowerCase()}-left`,
                    scrollLeft,
                );

                await tabList.evaluate(node => {
                    const active = node.querySelector('[aria-selected="true"]');
                    if (!active) throw new Error('Active SQL tab not found');
                    node.scrollLeft +=
                        active.getBoundingClientRect().right -
                        node.getBoundingClientRect().left -
                        12;
                });
                await expect(scrollLeft).toBeEnabled();
                await expect(hint).toHaveCount(0);
                await expect(scrollLeft).toHaveAttribute('title', 'More SQL tabs to the left');
                await scrollLeft.click();
                await expect(scrollLeft).toBeDisabled();
                await expect(firstTab).toHaveAttribute('aria-selected', 'true');

                await lastTab.click();
                await expect(lastTab).toHaveAttribute('aria-selected', 'true');
                await expect(scrollRight).toBeDisabled();
                await expect(hint).toHaveCount(0);
            }

            await tabList.evaluate(node => {
                node.scrollLeft = 0;
            });
            await expect(scrollRight).toHaveClass(/has-hidden-active-tab/);
            await page.setViewportSize({ width: 1600, height: 800 });
            await expect(hint).toHaveCount(0);
            await expect(lastTab).toHaveAttribute('aria-selected', 'true');
            await page.setViewportSize({ width: 900, height: 800 });
            await page.evaluate(
                () =>
                    new Promise<void>(resolve =>
                        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
                    ),
            );
            await expect(scrollRight).toBeDisabled();
            await tabList.evaluate(node => {
                node.scrollLeft = 0;
            });
            await expect(scrollRight).toHaveClass(/has-hidden-active-tab/);
            await lastTab.getByRole('button', { name: /^Close / }).evaluate(node => {
                if (!(node instanceof HTMLButtonElement)) throw new Error('Close button not found');
                node.click();
            });
            await expect(tabList.getByRole('tab').last()).toHaveAttribute('aria-selected', 'true');
            await expect(hint).toHaveCount(0);
        });
    }
}
