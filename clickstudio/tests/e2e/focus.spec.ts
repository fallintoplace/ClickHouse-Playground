import { setWorkspaceMode, openSqlExamples, replaceSql, runButton, trust } from './helpers.js';
import { fileURLToPath } from 'node:url';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { mockWritableWorkspace } from './import-helpers.js';

async function expectFieldFocus(field: Locator) {
    await expect(field).toBeFocused();
    await expect(field).toHaveCSS('outline-style', 'none');
    await expect(field).toHaveCSS('box-shadow', 'none');
}

async function resolvedFocusColor(control: Locator) {
    return control.evaluate(element => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--focus-color)';
        element.parentElement!.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
    });
}

for (const theme of ['Dark', 'Light']) {
    test(`${theme} uses the system highlight for keyboard focus in forced colors`, async ({
        page,
    }) => {
        await page.emulateMedia({ forcedColors: 'active' });
        await page.goto('/experimental');
        const radio = page.getByRole('radio', { name: `${theme} theme`, exact: true });
        await radio.click();
        await page.keyboard.press('Tab');
        await page.keyboard.press('Shift+Tab');
        await expect(page.locator('.theme-mode-option').filter({ has: radio })).toHaveCSS(
            'outline-style',
            'solid',
        );
        await expect(page.locator('html')).toHaveCSS('--focus-color', 'Highlight');
    });
    for (const mode of [theme === 'Dark' ? 'Standard' : 'Experimental']) {
        test(`${theme} ${mode} uses one keyboard ring and quiet pointer selection`, async ({
            page,
        }, info) => {
            await page.goto('/experimental');
            await setWorkspaceMode(page, mode);
            const radio = page.getByRole('radio', { name: `${theme} theme`, exact: true });
            const wrapper = page.locator('.theme-mode-option').filter({ has: radio });
            await radio.click();
            await expect(wrapper).toHaveCSS('outline-style', 'none');
            await expect(wrapper).toHaveCSS('box-shadow', 'none');
            await page.keyboard.press('Tab');
            await page.keyboard.press('Shift+Tab');
            await expect(radio).toBeFocused();
            await expect(wrapper).toHaveCSS('outline-style', 'solid');
            await expect(wrapper).toHaveCSS('outline-width', '2px');
            await expect(wrapper).toHaveCSS('outline-offset', '1px');
            await expect(wrapper).toHaveCSS('box-shadow', 'none');
            await expect(radio).toHaveCSS('outline-style', 'none');
            await page.screenshot({ path: info.outputPath('keyboard-theme-focus.png') });
            await page.keyboard.press(theme === 'Dark' ? 'ArrowRight' : 'ArrowLeft');
            const next = page.getByRole('radio', {
                name: `${theme === 'Dark' ? 'Light' : 'Dark'} theme`,
                exact: true,
            });
            await expect(next).toBeChecked();
            await expect(next).toBeFocused();
        });

        test(`${theme} ${mode} keeps table and wrapped search focus border-only`, async ({
            page,
        }, info) => {
            await mockWritableWorkspace(page);
            await setWorkspaceMode(page, mode);
            await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
            await page.getByRole('button', { name: 'New table', exact: true }).click();
            const dialog = page.getByRole('dialog', { name: 'New table', exact: true });
            const name = dialog.getByRole('textbox', { name: 'Table name', exact: true });
            await expectFieldFocus(name);
            await name.fill('events_focus');
            await expect(name).toHaveCSS('border-color', await resolvedFocusColor(name));
            await dialog.screenshot({ path: info.outputPath('table-field-focus.png') });
            await name.fill('bad-name');
            await page.keyboard.press('Tab');
            await expect(name).toHaveAttribute('aria-invalid', 'true');
            await page.keyboard.press('Shift+Tab');
            await expectFieldFocus(name);
            await expect(name).toHaveCSS(
                'border-color',
                theme === 'Dark' ? 'rgb(255, 107, 117)' : 'rgb(179, 48, 67)',
            );
            await page.keyboard.press('Escape');
            const help = await openSqlExamples(page);
            const search = help.getByTestId('sql-example-search');
            await search.click();
            await expectFieldFocus(search);
            await expect(help.locator('.sql-example-search')).toHaveCSS('box-shadow', 'none');
            await help.getByTestId('blank-sql').click();
            await expect(help).toBeHidden();
            await expect(page.locator('.cm-content')).toBeFocused();
        });
    }

    test(`${theme} keeps editor, splitter, table and graph keyboard cues consistent`, async ({
        page,
    }) => {
        await trust(page);
        await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
        await runButton(page).click();
        await expect(page.locator('.execution-bar')).toHaveAttribute(
            'data-run-status',
            'succeeded',
        );
        await page.locator('.cm-content').click();
        await expect(page.locator('.sql-editor .cm-focused')).toHaveCSS('outline-style', 'none');
        await page.keyboard.press('Tab');
        const splitter = page.locator('.workspace-panel-splitter').first();
        await splitter.focus();
        await expect(splitter).toBeFocused();
        await expect(splitter).toHaveCSS('outline-style', 'none');
        const table = page.locator('.data-table-scroll').first();
        await table.focus();
        await expect(table).toBeFocused();
        await expect(table).toHaveCSS('outline-style', 'solid');
        await expect(table).toHaveCSS('outline-offset', '-2px');
        await page.getByRole('button', { name: 'View dependencies', exact: true }).click();
        const dialog = page.getByRole('dialog', {
            name: 'Materialized view dependencies',
            exact: true,
        });
        const node = dialog.locator('.native-lineage-node').first();
        await page.keyboard.press('Tab');
        await node.focus();
        await expect(node).toBeFocused();
        await expect(node).toHaveCSS('outline-style', 'none');
        await expect(node.locator('rect').first()).toHaveCSS('stroke-width', '2px');
    });
}

test('Import errors announce themselves without moving focus from the chosen control', async ({
    page,
}) => {
    await mockWritableWorkspace(page);
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => {
        release = resolve;
    });
    await page.route('**/api/imports/preview', async route => {
        await gate;
        await route.fulfill({
            status: 400,
            json: { error: { code: 'INVALID_FILE', message: 'Choose another file.' } },
        });
    });
    try {
        await page.getByRole('button', { name: 'Import', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
        const picker = dialog.getByLabel('Choose a CSV, JSON, or NDJSON file');
        await picker.setInputFiles({
            name: 'events.csv',
            mimeType: 'text/csv',
            buffer: Buffer.from('events\n10\n'),
        });
        const submitted = page.waitForRequest('**/api/imports/preview');
        await dialog.getByRole('button', { name: 'Read file and continue', exact: true }).click();
        await submitted;
        await picker.focus();
        release();
        const alert = dialog.getByRole('alert');
        await expect(alert).toContainText('Choose another file.');
        await expect(picker).toBeFocused();
        await expect(alert).not.toHaveAttribute('tabindex');
    } finally {
        release();
    }
});

test('Cloud dialog keeps typing focus across busy changes and restores its opener', async ({
    page,
}) => {
    let release: () => void = () => {};
    const responseGate = new Promise<void>(resolve => {
        release = resolve;
    });
    await page.route('**/api/session', route =>
        route.fulfill({
            json: {
                principal: { id: 'test-owner', role: 'owner' },
                requiresLogin: false,
                demo: false,
                cloudConnectionPersistence: 'local-server',
            },
        }),
    );
    await page.route('**/api/cloud/session', async route => {
        if (route.request().method() !== 'POST') {
            await route.fulfill({ json: { session: null } });
            return;
        }
        await responseGate;
        await route.fulfill({
            status: 400,
            json: { error: { code: 'CONNECTION_FAILED', message: 'Try another host.' } },
        });
    });
    await page.goto('/experimental');
    const opener = page.getByRole('button', { name: 'Connect Cloud', exact: true });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Connect to your service' });
    await expectFieldFocus(dialog.getByLabel('HTTPS host'));
    await dialog.getByLabel('HTTPS host').fill('example.clickhouse.cloud');
    await dialog.getByLabel('Password').fill('test-password');
    const pending = page.waitForRequest(
        request => request.method() === 'POST' && request.url().endsWith('/api/cloud/session'),
    );
    await dialog.getByRole('button', { name: 'Connect service', exact: true }).click();
    await pending;
    const username = dialog.getByLabel('Username');
    await username.click();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    release();
    await expect(dialog.getByRole('alert')).toContainText('Try another host.');
    await expectFieldFocus(username);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
});

test('A delayed run response keeps focus on the field the user chose', async ({ page }) => {
    let release: () => void = () => {};
    const responseGate = new Promise<void>(resolve => {
        release = resolve;
    });
    await page.route('**/api/runs', async route => {
        if (route.request().method() !== 'POST') {
            await route.continue();
            return;
        }
        const response = await route.fetch();
        await responseGate;
        await route.fulfill({ response });
    });
    await trust(page);
    await replaceSql(page, 'SELECT 1');
    const submitted = page.waitForRequest(
        request => request.method() === 'POST' && request.url().endsWith('/api/runs'),
    );
    await runButton(page).click();
    await submitted;
    const help = await openSqlExamples(page);
    const search = help.getByTestId('sql-example-search');
    await search.fill('events');
    release();
    await expect(runButton(page)).toBeEnabled();
    await expect(search).toBeFocused();
    await expect(search).toHaveValue('events');
});

async function loadFocusHarness(page: Page) {
    await page.goto('/experimental');
    await page.evaluate(() => {
        const container = document.createElement('div');
        container.id = 'focus-harness';
        container.style.cssText = 'position:fixed;inset:0;background:white;z-index:100';
        document.body.append(container);
    });
    const fixture = fileURLToPath(new URL('./fixtures/dialog-focus.tsx', import.meta.url));
    await page.addScriptTag({ type: 'module', url: `/@fs${fixture}` });
}

async function openFocusHarness(page: Page) {
    await loadFocusHarness(page);
    await page.getByRole('button', { name: 'Open focus dialog', exact: true }).click();
    return page.getByRole('dialog', { name: 'Focus dialog', exact: true });
}

for (const theme of ['Dark', 'Light']) {
    test(`${theme} chat history exposes direct row actions and restores focus after immediate deletion`, async ({
        page,
    }, info) => {
        await loadFocusHarness(page);
        await page.evaluate(theme => {
            document.documentElement.dataset.theme =
                theme === 'Dark' ? 'click-dark' : 'click-light';
        }, theme);
        await page
            .getByRole('button', { name: 'Chat history: Conversation 0', exact: true })
            .click();
        const search = page.getByRole('searchbox', { name: 'Search conversations', exact: true });
        await search.click();
        await expectFieldFocus(search);
        const wrapper = page.locator('#focus-harness .assistant-chat-search');
        await expect(wrapper).toHaveCSS('box-shadow', 'none');
        await expect(wrapper).toHaveCSS('border-color', await resolvedFocusColor(wrapper));
        await expect(page.locator('.assistant-chat-history-actions-trigger')).toHaveCount(0);
        const row = page
            .locator('.assistant-chat-history-item')
            .filter({ hasText: 'Conversation 2' });
        const title = row.locator('.assistant-chat-history-select > span:first-child');
        await expect(row.locator('.assistant-chat-row-actions')).toHaveCSS('opacity', '0');
        const bounds = await title.boundingBox();
        await row.hover();
        await expect(row.locator('.assistant-chat-row-actions')).toHaveCSS('opacity', '1');
        expect(await title.boundingBox()).toEqual(bounds);
        await page.locator('.assistant-chat-history-popover').screenshot({
            path: info.outputPath('direct-chat-actions.png'),
        });
        await page.getByRole('button', { name: 'Rename Conversation 2', exact: true }).click();
        const name = page.getByRole('textbox', {
            name: 'New name for Conversation 2',
            exact: true,
        });
        await expect(name).toBeFocused();
        expect(
            await name.evaluate((input: HTMLInputElement) => ({
                start: input.selectionStart,
                end: input.selectionEnd,
            })),
        ).toEqual({ start: 0, end: 'Conversation 2'.length });
        await name.fill('Cancelled name');
        await page.keyboard.press('Escape');
        await expect(
            row.getByRole('button', { name: 'Conversation 2', exact: true }),
        ).toBeFocused();
        await page.keyboard.press('Tab');
        const rename = page.getByRole('button', { name: 'Rename Conversation 2', exact: true });
        await expect(rename).toBeFocused();
        await expect(row.locator('.assistant-chat-row-actions')).toHaveCSS('opacity', '1');
        await page.keyboard.press('Enter');
        await name.fill('   ');
        await expect(
            page.getByRole('button', { name: 'Save conversation name', exact: true }),
        ).toBeDisabled();
        await name.fill('Renamed chat');
        await page.keyboard.press('Enter');
        await expect(page.getByRole('button', { name: 'Renamed chat', exact: true })).toBeFocused();
        await expect(
            page.getByRole('button', { name: 'Chat history: Conversation 0', exact: true }),
        ).toBeVisible();
        const opener = page.getByRole('button', { name: 'Delete Conversation 0', exact: true });
        await opener.focus();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('alertdialog', {
            name: 'Delete this conversation?',
            exact: true,
        });
        await expect(dialog).toHaveCount(0);
        await expect(
            page.locator('.assistant-chat-history-select').filter({ hasText: 'Conversation 0' }),
        ).toHaveCount(0);
        await expect(page.getByRole('button', { name: /^Chat history:/ })).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('region', { name: 'Chat history', exact: true })).toBeHidden();
    });
}

test('Reference consumes Escape for its search before the surrounding dialog closes', async ({
    page,
}) => {
    await page.goto('/experimental');
    const help = await openSqlExamples(page);
    await help.getByTestId('help-section-reference').click();
    const search = help.getByRole('textbox', { name: 'Search ClickHouse…', exact: true });
    await search.fill('MergeTree');
    await page.keyboard.press('Escape');
    await expect(search).toHaveValue('');
    await expect(help).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();
});

test('Shared dialogs contain Tab and ignore hidden, disabled, inert and negative-tabindex controls', async ({
    page,
}) => {
    const dialog = await openFocusHarness(page);
    await expect(dialog).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'First action' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Last action' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'First action' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('radio', { name: 'Two', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'First action' })).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(dialog.getByLabel('Keep typing')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('radio', { name: 'Ungrouped one', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('radio', { name: 'Ungrouped two', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
        dialog.getByRole('button', { name: 'Open nested dialog', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(
        page.getByRole('button', { name: 'Open focus dialog', exact: true }),
    ).toBeFocused();
});

test('Shared dialogs retain typing focus on rerender and use the latest close callback', async ({
    page,
}) => {
    const dialog = await openFocusHarness(page);
    const field = dialog.getByLabel('Keep typing');
    await field.fill('unfinished');
    await page.evaluate(() => window.dialogFocusHarness.update());
    await expect(field).toBeFocused();
    await expect(field).toHaveValue('unfinished');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'First action' }).focus();
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Closed version')).toHaveText('1');
});

test('Nested dialogs keep Escape and focus restoration within the active dialog', async ({
    page,
}) => {
    const dialog = await openFocusHarness(page);
    const opener = dialog.getByRole('button', { name: 'Open nested dialog', exact: true });
    await opener.click();
    const nested = page.getByRole('dialog', { name: 'Nested focus dialog', exact: true });
    await expect(nested).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(nested.getByRole('button')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(nested).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(opener).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
});
