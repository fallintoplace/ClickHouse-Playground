import { test, expect, type Locator } from '@playwright/test';
import { functionsWorkspace } from './sql-functions-helpers.js';
import { workspacePath } from './helpers.js';

async function detailStyles(details: Locator) {
    return details.evaluate(element => {
        const card = getComputedStyle(element);
        const title = getComputedStyle(
            element.querySelector('.object-details-title > :is(strong, h3)')!,
        );
        const primary = getComputedStyle(element.querySelector('.object-preview-action')!);
        const secondary = getComputedStyle(
            element.querySelector('.object-copy-name-action, .sql-function-delete-action')!,
        );
        return {
            background: card.backgroundColor,
            padding: card.padding,
            radius: card.borderRadius,
            titleFont: title.fontFamily,
            titleSize: title.fontSize,
            titleWeight: title.fontWeight,
            primaryBackground: primary.backgroundColor,
            primaryHeight: primary.minHeight,
            secondaryBackground: secondary.backgroundColor,
            secondaryHeight: secondary.minHeight,
        };
    });
}

for (const mode of ['Standard', 'Experimental']) {
    for (const theme of ['Dark', 'Light']) {
        test(`${mode} ${theme} function details match table styling and preserve the tester across tabs`, async ({
            page,
        }, info) => {
            await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
            await page.setViewportSize({ width: 1280, height: 900 });
            const { requests, state } = await functionsWorkspace(page, {
                path: workspacePath(mode),
                existing: true,
            });
            await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
            await page
                .getByRole('button', { name: 'udf_array_remove_at SQL UDF', exact: true })
                .click();
            const details = page.locator('.sql-function-details');
            const tabs = details.getByRole('tablist', { name: 'Function details', exact: true });
            await expect(tabs.getByRole('tab', { name: 'Test', exact: true })).toHaveAttribute(
                'aria-selected',
                'true',
            );
            await page.mouse.move(0, 0);
            const functionStyles = await detailStyles(details);
            await page.getByLabel('index', { exact: true }).fill('2.0');
            await details.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
            await expect(details.locator('.sql-function-output')).toHaveText('[10, 30, 40]');
            await expect(
                details.getByRole('button', { name: 'Run on ClickHouse', exact: true }),
            ).toBeEnabled();
            await page.setViewportSize({ width: 1280, height: 720 });
            await expect(details.locator('.sql-function-output')).toBeInViewport();
            await page.setViewportSize({ width: 1280, height: 900 });
            await expect(details.locator('.sql-function-result .result-type-badge')).toHaveText(
                'Array(UInt8)',
            );
            await details.screenshot({ path: info.outputPath('function-test.png') });
            await tabs.getByRole('tab', { name: 'Definition', exact: true }).click();
            const definition = details.getByRole('tabpanel', { name: 'Definition', exact: true });
            const fn = state.functions.find(fn => fn.name === 'udf_array_remove_at');
            if (!fn) throw new Error('The function fixture is missing.');
            await expect(definition.locator('pre')).toHaveText(fn.createQuery);
            await definition.getByRole('button', { name: 'Copy definition', exact: true }).click();
            await expect(
                definition.getByRole('button', { name: 'Copied', exact: true }),
            ).toBeVisible();
            expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(fn.createQuery);
            await details.screenshot({ path: info.outputPath('function-definition.png') });
            await tabs.getByRole('tab', { name: 'Test', exact: true }).click();
            await expect(page.getByLabel('index', { exact: true })).toHaveValue('2.0');
            await expect(details.locator('.sql-function-output')).toHaveText('[10, 30, 40]');
            expect(requests.filter(body => body.action === 'run')).toHaveLength(1);
            await page.locator('.object-back-button').click();
            await page.getByRole('button', { name: 'events MergeTree', exact: true }).click();
            await page.mouse.move(0, 0);
            await expect(page.locator('.object-details[data-kind="table"]')).toBeVisible();
            expect(await detailStyles(page.locator('.object-details[data-kind="table"]'))).toEqual(
                functionStyles,
            );
        });
    }

    test(`${mode} function tabs support keyboard navigation while a test completes`, async ({
        page,
    }) => {
        const { state, requests } = await functionsWorkspace(page, {
            path: workspacePath(mode),
            existing: true,
        });
        state.runDelay = 1200;
        await page
            .getByRole('button', { name: 'udf_array_remove_at SQL UDF', exact: true })
            .click();
        const details = page.locator('.sql-function-details');
        const tester = details.getByRole('tab', { name: 'Test', exact: true });
        const definition = details.getByRole('tab', { name: 'Definition', exact: true });
        await details.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
        await expect(details.getByRole('button', { name: 'Running…', exact: true })).toBeDisabled();
        await tester.focus();
        await page.keyboard.press('ArrowRight');
        await expect(definition).toBeFocused();
        await expect(definition).toHaveAttribute('aria-selected', 'true');
        await expect(
            details.getByRole('button', { name: 'Run on ClickHouse', exact: true }),
        ).toBeEnabled();
        await page.keyboard.press('Home');
        await expect(tester).toBeFocused();
        await expect(tester).toHaveAttribute('aria-selected', 'true');
        await expect(details.locator('.sql-function-output')).toHaveText('[10, 30, 40]');
        await page.keyboard.press('End');
        await expect(definition).toBeFocused();
        await page.keyboard.press('ArrowLeft');
        await expect(tester).toBeFocused();
        expect(requests.filter(body => body.action === 'run')).toHaveLength(1);
    });
}
