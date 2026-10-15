import { test, expect } from '@playwright/test';
import { openSqlExamples, trust } from './helpers.js';

for (const mode of ['Standard', 'Experimental'])
    test(`${mode} Help opens SQL examples by default on every visit`, async ({ page }) => {
        let runRequests = 0;
        page.on('request', request => {
            if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs')
                runRequests++;
        });
        await trust(page, mode);
        const originalSql = await page.locator('.cm-content').textContent();
        const trigger = page.getByRole('button', { name: 'Help', exact: true });
        const dialog = await openSqlExamples(page);
        await expect(dialog.getByRole('searchbox')).toHaveCount(0);
        await expect(dialog.locator('button:focus, input:focus')).toHaveCount(0);
        await expect(dialog.locator('#workspace-help-panel-examples')).toBeVisible();

        for (const section of ['tour', 'workflows', 'assistant']) {
            await dialog.getByTestId(`help-section-${section}`).click();
            await expect(dialog.locator(`#workspace-help-panel-${section}`)).toBeVisible();
            await dialog.getByRole('button', { name: 'Close help', exact: true }).click();
            await expect(dialog).toHaveCount(0);
            await expect(trigger).toBeFocused();
            await openSqlExamples(page);
            await expect(dialog.getByRole('searchbox')).toHaveCount(0);
            await expect(dialog.locator('button:focus, input:focus')).toHaveCount(0);
        }

        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(trigger).toBeFocused();
        await expect.poll(() => page.locator('.cm-content').textContent()).toBe(originalSql);
        expect(runRequests).toBe(0);
    });

test('SQL examples open in a new tab without changing or running the current query', async ({
    page,
}) => {
    let runRequests = 0;
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs')
            runRequests++;
    });

    await trust(page);
    const tabs = page.getByRole('tablist', { name: 'SQL documents', exact: true }).getByRole('tab');
    const originalTab = tabs.first();
    const originalName = await originalTab.getAttribute('aria-label');
    const originalSql = await page.locator('.cm-content').textContent();
    const collapseButton = page.getByRole('button', { name: 'Collapse SQL query', exact: true });
    const collapseButtonRight = await collapseButton.evaluate(
        element => element.getBoundingClientRect().right,
    );
    expect(collapseButtonRight).toBeLessThanOrEqual(page.viewportSize()!.width);
    await collapseButton.click();
    await expect(page.locator('#sql-editor-content')).toBeHidden();

    const dialog = await openSqlExamples(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Sample data', { exact: true })).toBeVisible();
    await dialog.getByTestId('sql-example-category-all').click();
    const example = dialog.getByTestId('sql-example-preview-starter-top-countries');
    await expect(example).toBeVisible();
    await example.click();
    await expect(dialog.locator('.sql-example-preview code')).toContainText('FROM events');
    await dialog.getByTestId('open-sql-example').click();

    await expect(tabs.last()).toHaveAttribute('aria-label', 'Top countries.sql');
    await expect(page.locator('.cm-content')).toContainText('FROM events');
    await expect(page.locator('#sql-editor-content')).toBeVisible();
    await expect(page.locator('.cm-content')).toBeFocused();
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'ready');
    await expect(page.locator('.execution-bar')).not.toHaveAttribute('data-query-id');
    expect(originalName).not.toBeNull();
    await page.getByRole('tab', { name: originalName!, exact: true }).click();
    await expect.poll(() => page.locator('.cm-content').textContent()).toBe(originalSql);
    await expect(page.locator('#sql-editor-content')).toBeHidden();
    expect(runRequests).toBe(0);
    await expect(dialog).toHaveCount(0);
});

test('SQL examples support keyboard browsing and Escape restores focus', async ({ page }) => {
    await trust(page);
    const trigger = page.getByRole('button', { name: 'Help', exact: true });
    const dialog = await openSqlExamples(page);
    const options = dialog.getByRole('option');
    await options.first().focus();
    await options.first().press('End');
    await expect(options.last()).toBeFocused();
    await expect(options.last()).toHaveAttribute('aria-selected', 'true');
    await options.last().press('Home');
    await expect(options.first()).toBeFocused();
    await options.first().press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
});

test('Help section navigation preserves the example selection until the panel is reopened', async ({
    page,
}) => {
    await trust(page);
    const trigger = page.getByRole('button', { name: 'Help', exact: true });
    const dialog = await openSqlExamples(page);
    const defaultExample = dialog.getByRole('option', { selected: true });
    const defaultId = await defaultExample.getAttribute('data-testid');
    await dialog.getByTestId('sql-example-category-all').click();
    await dialog.getByTestId('sql-example-preview-starter-top-countries').click();
    const examplesTab = dialog.getByTestId('help-section-examples');
    await examplesTab.click();
    await examplesTab.press('End');
    const compareTab = dialog.getByTestId('help-section-compare');
    await expect(compareTab).toBeFocused();
    await expect(compareTab).toHaveAttribute('aria-selected', 'true');
    await compareTab.press('Home');
    const tourTab = dialog.getByTestId('help-section-tour');
    await expect(tourTab).toBeFocused();
    await tourTab.press('ArrowRight');
    await expect(examplesTab).toBeFocused();
    await expect(dialog.getByTestId('sql-example-category-all')).toHaveAttribute(
        'aria-pressed',
        'true',
    );
    await expect(dialog.getByTestId('sql-example-preview-starter-top-countries')).toHaveAttribute(
        'aria-selected',
        'true',
    );
    await expect(page.locator('#root')).toHaveJSProperty('inert', true);
    await examplesTab.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.locator('#root')).toHaveJSProperty('inert', false);
    await openSqlExamples(page);
    await expect(dialog.getByRole('option', { selected: true })).toHaveAttribute(
        'data-testid',
        defaultId!,
    );
});

test('Help tour exposes ClickStudio native workflows from one place', async ({ page }) => {
    await trust(page);
    await expect(page.getByRole('button', { name: 'Open observability' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Explore ClickStudio', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('help-section-tour').click();

    for (const section of [
        'tour',
        'examples',
        'workflows',
        'query',
        'explain',
        'storage',
        'dependencies',
        'compare',
        'reference',
    ])
        await expect(dialog.getByTestId('help-section-' + section)).toBeVisible();

    const tabs = dialog
        .getByRole('tablist', { name: 'Explore ClickStudio sections' })
        .getByRole('tab');
    await expect(tabs.first()).toHaveAttribute('data-testid', 'help-section-tour');
    await expect(dialog.getByTestId('help-section-tour')).toHaveAttribute('aria-selected', 'true');
    for (const section of ['monitoring', 'geo']) {
        await expect(dialog.getByTestId('help-section-' + section)).toHaveCount(0);
        await expect(dialog.locator('#workspace-help-panel-' + section)).toHaveCount(0);
    }
    await expect(
        dialog.locator('.workspace-help-feature-card').filter({ hasText: /Monitoring|Geo/ }),
    ).toHaveCount(0);
    await dialog.getByTestId('help-section-reference').focus();
    await dialog.getByTestId('help-section-reference').press('ArrowDown');
    await expect(dialog.getByTestId('help-section-query')).toBeFocused();
    await dialog.getByTestId('help-section-query').press('ArrowDown');
    await expect(dialog.getByTestId('help-section-explain')).toBeFocused();
    await dialog.getByTestId('help-section-workflows').click();
    await expect(dialog.getByText('Bind typed values', { exact: true })).toBeVisible();
    await expect(
        dialog.getByText(/executes all SQL in the editor and stops after the first error/),
    ).toBeVisible();

    await dialog.getByTestId('help-section-storage').click();
    await expect(dialog.getByRole('button', { name: 'Parts', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Merges', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Mutations', exact: true })).toBeVisible();

    await dialog.getByTestId('help-section-explain').click();
    await expect(dialog.getByRole('button', { name: /Explain plan/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Explain pipeline/ })).toBeVisible();
});
