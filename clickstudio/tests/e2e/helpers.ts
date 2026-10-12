import { expect, type Locator, type Page } from '@playwright/test';
import { arrayValue, jsonRecord, numberValue, stringValue } from '../helpers/type-guards.js';

export { arrayValue, jsonRecord, numberValue, stringValue };

export const runButton = (page: Page) => page.getByTestId('run-button');

export async function openStatementResults(target: Page | Locator) {
    const trigger = target.getByRole('button', { name: /^Select a statement result/ });
    await expect(trigger).toBeVisible();
    const menu = target.getByRole('menu', { name: 'Statement results', exact: true });
    if (!(await menu.isVisible())) await trigger.click();
    await expect(menu).toBeVisible();
    await expect
        .poll(() => menu.evaluate(element => element.contains(element.ownerDocument.activeElement)))
        .toBe(true);
    return menu;
}

export async function openResultFilter(target: Page | Locator) {
    const input = target.getByRole('searchbox', { name: 'Search this page', exact: true });
    if (!(await input.isVisible()))
        await target.getByRole('button', { name: 'Search rows', exact: true }).click();
    await input.focus();
    return input;
}

export function runIdentity(value: unknown): { id: string; queryId: string } {
    const record = jsonRecord(value, 'Run response');
    if (typeof record.id !== 'string' || typeof record.queryId !== 'string')
        throw new Error('Run response did not include string id and queryId fields');
    return { id: record.id, queryId: record.queryId };
}

export async function currentQueryId(page: Page) {
    const queryId = await page.locator('.execution-bar').getAttribute('data-query-id');
    if (!queryId) throw new Error('The execution bar has no active query ID');
    return queryId;
}

export async function openBlankSql(page: Page) {
    await page.getByTestId('new-sql').click();
}

export async function openSqlExamples(page: Page) {
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Explore ClickStudio', exact: true });
    await dialog.getByTestId('help-section-examples').click();
    return dialog;
}

export async function replaceSql(page: Page, sql: string) {
    const editor = page.locator('.cm-content');
    await editor.focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(sql);
    await expect
        .poll(async () => (await editor.innerText()).replace(/\s/g, ''))
        .toContain(sql.replace(/\s/g, ''));
}

type WorkspacePanel = 'history' | 'parser' | 'pipeline';

export async function openWorkspacePanel(page: Page, panel: WorkspacePanel) {
    await page.getByTestId('workspace-panels').click();
    await page.getByTestId(`workspace-panel-${panel}`).click();
}

export function workspacePath(mode: string = 'Experimental') {
    if (mode === 'Standard' || mode === 'beginner') return '/';
    if (mode === 'Experimental' || mode === 'expert') return '/experimental';
    throw new Error(`Unknown workspace mode: ${mode}`);
}

export async function setWorkspaceMode(page: Page, mode: string) {
    const path = workspacePath(mode);
    await page.evaluate(path => {
        const url = new URL(window.location.href);
        if (url.pathname === path) return;
        url.pathname = path;
        window.history.pushState(window.history.state, '', url);
        window.dispatchEvent(new PopStateEvent('popstate'));
    }, path);
    await expect(page.locator('.application')).toHaveAttribute(
        'data-experience',
        path === '/' ? 'beginner' : 'expert',
    );
}

export async function trust(page: Page, mode: string = 'Experimental') {
    await page.goto(workspacePath(mode));
    await trustCurrentConnection(page);
    await expect(runButton(page)).toBeEnabled();
}

export async function useAdvancedMode(page: Page) {
    await setWorkspaceMode(page, 'Experimental');
    await expect(page.locator('.workspace-root')).toHaveClass(/is-expert/);
}

export async function trustCurrentConnection(page: Page) {
    const trigger = page.locator('.connection-trigger');
    await expect(trigger).toBeVisible();
    await trigger.click();
    const details = page.getByRole('dialog', { name: 'Connection details', exact: true });
    await expect(details).toBeVisible();
    const start = details.getByRole('button', { name: 'Start exploring', exact: true });
    if (await start.isVisible()) await start.click();
    if ((await trigger.getAttribute('aria-expanded')) === 'true') await trigger.click();
}

export async function runScript(page: Page) {
    await page.getByTestId('run-button').click();
}
