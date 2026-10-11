import { test, expect, type Page } from '@playwright/test';
import type { Proposal } from '../../src/shared/assistant/types.js';
import { jsonRecord, openBlankSql, replaceSql, trust } from './helpers.js';

type PendingReply = {
    body: Record<string, unknown>;
    reply: (sql?: string | null, status?: number) => void;
};

function proposalFor(body: Record<string, unknown>, sql: string | null): Proposal {
    return {
        id: String(body.question),
        owner: 'local-owner',
        connectionId: 'demo',
        action: 'ask',
        createdAt: '2026-10-11T00:00:00.000Z',
        baseSql: String(body.sql),
        responseId: 'background-response',
        model: 'fixture',
        promptVersion: 'test',
        contextSummary: [],
        decision: 'pending',
        sql,
        summary: `Reply to ${body.question}`,
        assumptions: [],
        tables: [],
        caveats: [],
        clarification: null,
        findings: [],
    };
}

async function deferredReplies(page: Page) {
    const requests: PendingReply[] = [];
    await page.route('**/api/assistant/sql', async route => {
        const body = jsonRecord(route.request().postDataJSON());
        const response = await new Promise<{ sql: string | null; status: number }>(resolve => {
            requests.push({ body, reply: (sql = null, status = 200) => resolve({ sql, status }) });
        });
        const json =
            response.status === 200
                ? proposalFor(body, response.sql)
                : { error: { code: 'AI_UNAVAILABLE', message: 'Try again later.' } };
        await route.fulfill({ status: response.status, json }).catch(() => undefined);
    });
    return requests;
}

async function ask(page: Page, question: string) {
    await page.getByRole('textbox', { name: 'Ask AI', exact: true }).fill(question);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
}

async function selectChat(page: Page, title: string) {
    await page.getByRole('button', { name: /^Chat history:/ }).click();
    await page.locator('.assistant-chat-history-select').filter({ hasText: title }).click();
}

async function deleteChat(page: Page, title: string) {
    const history = page.getByRole('button', { name: /^Chat history:/ });
    if ((await history.getAttribute('aria-expanded')) !== 'true') await history.click();
    await page.locator('.assistant-chat-history-item').filter({ hasText: title }).hover();
    await page.getByRole('button', { name: `Delete ${title}`, exact: true }).click();
    await expect(page.getByRole('alertdialog', { name: 'Delete this conversation?' })).toHaveCount(
        0,
    );
    await expect(
        page.locator('.assistant-chat-history-select').filter({ hasText: title }),
    ).toHaveCount(0);
}

for (const mode of ['beginner', 'expert']) {
    for (const theme of ['Dark', 'Light']) {
        test(`${theme} ${mode} composer grows, restores drafts and sends with the keyboard`, async ({
            page,
        }, info) => {
            const requests = await deferredReplies(page);
            try {
                await page.addInitScript(
                    mode => localStorage.setItem('clickstudio:experience', mode),
                    mode,
                );
                await page.setViewportSize({ width: 1440, height: 900 });
                await trust(page);
                await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
                await page.getByTestId('open-ai').click();
                const input = page.getByRole('textbox', { name: 'Ask AI', exact: true });
                const composer = page.locator('.assistant-chat-composer');
                const send = page.getByRole('button', { name: 'Send', exact: true });
                const height = () => input.evaluate(element => element.clientHeight);
                const emptyHeight = await height();
                expect(emptyHeight).toBe(32);
                expect(await composer.evaluate(element => element.clientHeight)).toBe(48);
                const idleBorder = await composer.evaluate(
                    element => getComputedStyle(element).borderColor,
                );
                const disabledBackground = await send.evaluate(
                    element => getComputedStyle(element).backgroundColor,
                );
                await expect(send).toBeDisabled();
                await expect(input).toHaveAttribute('placeholder', 'Ask about your SQL…');
                await expect(input).toHaveCSS('font-size', '12px');
                await expect(input).toHaveCSS('resize', 'none');
                await expect(input).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
                await expect(composer.locator('details')).toHaveCount(0);
                await expect(input).toHaveAccessibleDescription(
                    'Enter to send. Shift+Enter for a new line.',
                );
                await expect(send).toHaveAttribute('title', 'Send (Enter)');
                await expect(send).toHaveText('');
                await composer.screenshot({ path: info.outputPath('composer-empty.png') });

                await input.pressSequentially('Explain this query.');
                await expect.poll(height).toBe(emptyHeight);
                await input.press('Shift+Enter');
                await input.pressSequentially('Keep the answer concise.');
                await expect.poll(height).toBeGreaterThan(emptyHeight);
                await input.press('Tab');
                await expect(send).toBeFocused();
                await expect(send).toHaveCSS('outline-style', 'solid');
                await page.keyboard.press('Shift+Tab');
                await expect(input).toBeFocused();

                const draft =
                    'Explain this query.\nCompare its alternatives.\nKeep the answer concise.';
                await input.fill(draft);
                await expect(send).toBeEnabled();
                await expect(send).not.toHaveCSS('background-color', disabledBackground);
                await expect(composer).not.toHaveCSS('border-color', idleBorder);
                await expect(input).toHaveCSS('border-width', '0px');
                await expect(input).toHaveCSS('outline-style', 'none');
                await expect.poll(height).toBeGreaterThan(emptyHeight);
                await composer.screenshot({ path: info.outputPath('composer-focused.png') });
                await page.getByRole('button', { name: 'New chat', exact: true }).click();
                await expect(input).toHaveValue('');
                await expect.poll(height).toBe(emptyHeight);
                await page.getByRole('button', { name: /^Chat history:/ }).click();
                await page.locator('.assistant-chat-history-select:not([aria-current])').click();
                await expect(input).toHaveValue(draft);
                await expect.poll(height).toBeGreaterThan(emptyHeight);
                await input.focus();
                await input.dispatchEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    isComposing: true,
                });
                await expect(input).toHaveValue(draft);
                expect(requests).toHaveLength(0);
                await input.press('End');
                await input.press('Shift+Enter');
                await expect(input).toHaveValue(`${draft}\n`);
                await input.press('Enter');
                await expect.poll(() => requests.length).toBe(1);
                expect(requests[0]!.body.question).toBe(draft);
                await expect(input).toHaveValue('');
                await expect.poll(height).toBe(emptyHeight);
                const stop = page.getByRole('button', {
                    name: 'Stop assistant response',
                    exact: true,
                });
                await expect(stop).toHaveCSS('width', '32px');
                await expect(stop).toHaveCSS('height', '32px');
                await input.fill('Pending follow-up');
                await input.press('Enter');
                await expect(input).toHaveValue('Pending follow-up');
                expect(requests).toHaveLength(1);
                await stop.click();
                await expect(page.locator('.assistant-turn-error')).toHaveText(
                    'Request cancelled.',
                );
                await expect(send).toHaveCSS('width', '32px');
                await expect(send).toHaveCSS('height', '32px');

                await input.fill(
                    Array.from({ length: 20 }, (_, index) => `Pasted line ${index}`).join('\n'),
                );
                await expect.poll(height).toBe(122);
                expect(await input.evaluate(element => element.scrollHeight)).toBeGreaterThan(122);
                await expect(input).toBeInViewport();
                await input.press('End');
                await input.pressSequentially(' More text at the caret.');
                expect(
                    await input.evaluate(
                        element => element.scrollHeight - element.clientHeight - element.scrollTop,
                    ),
                ).toBeLessThanOrEqual(1);
                await composer.screenshot({ path: info.outputPath('composer-capped.png') });
                await input.fill('Explain how these ClickHouse queries work together. '.repeat(2));
                const wideHeight = await height();
                await page.setViewportSize({ width: 900, height: 900 });
                await expect.poll(height).toBeGreaterThan(wideHeight);
                await page.setViewportSize({ width: 1440, height: 900 });
                await expect.poll(height).toBe(wideHeight);
                await input.fill('');
                await expect.poll(height).toBe(emptyHeight);
                await expect(send).toBeDisabled();
                await input.press('Enter');
                expect(requests).toHaveLength(1);

                await page.getByRole('button', { name: 'Help', exact: true }).click();
                await page.getByTestId('help-section-assistant').click();
                const explanation = page.locator('.workspace-help-assistant-data');
                await expect(explanation).toContainText('sent to OpenAI');
                await expect(explanation).toContainText('Chats are saved in this browser.');
            } finally {
                for (const request of requests) request.reply();
            }
        });
    }
}

for (const mode of ['beginner', 'expert']) {
    test(`Ask AI keeps its original SQL while editing and running in ${mode} mode`, async ({
        page,
    }) => {
        const requests = await deferredReplies(page);
        await page.addInitScript(
            mode => localStorage.setItem('clickstudio:experience', mode),
            mode,
        );
        await trust(page);
        await replaceSql(page, 'SELECT 1 AS original');
        await page.getByTestId('open-ai').click();
        await ask(page, 'Improve original SQL');
        await expect.poll(() => requests.length).toBe(1);
        await replaceSql(page, 'SELECT 2 AS edited');
        await page.getByTestId('run-button').click();
        await expect(page.locator('.execution-bar')).toHaveAttribute(
            'data-run-status',
            'succeeded',
        );
        await expect(page.locator('.assistant-pending')).toBeVisible();
        requests[0]!.reply('SELECT 3 AS suggested');
        await expect(page.getByTestId('assistant-proposal-summary')).toHaveText(
            'Reply to Improve original SQL',
        );
        expect(requests[0]!.body).toMatchObject({ sql: 'SELECT 1 AS original', includeRun: false });
        await expect(page.getByRole('textbox', { name: 'SQL editor', exact: true })).toHaveText(
            'SELECT 2 AS edited',
        );
        await expect(page.getByTestId('sql-proposal-review')).toHaveCount(0);
        await expect(page.locator('.assistant-turn-error')).toHaveCount(0);
        await expect(page.getByTestId('run-button')).toBeEnabled();
    });
}

test('Switching SQL tabs preserves a pending reply and its original proposal ownership', async ({
    page,
}) => {
    const requests = await deferredReplies(page);
    await trust(page);
    await replaceSql(page, 'SELECT 1 AS original');
    const originalTitle = await page
        .getByRole('tab', { selected: true })
        .getAttribute('aria-label');
    await page.getByTestId('open-ai').click();
    await ask(page, 'Improve first tab');
    await expect.poll(() => requests.length).toBe(1);
    await openBlankSql(page);
    await replaceSql(page, 'SELECT 2 AS other_tab');
    requests[0]!.reply('SELECT 3 AS suggested');
    await expect(page.getByTestId('assistant-proposal-summary')).toHaveText(
        'Reply to Improve first tab',
    );
    await expect(page.getByTestId('sql-proposal-review')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'SQL editor', exact: true })).toHaveText(
        'SELECT 2 AS other_tab',
    );
    await page.getByRole('tab', { name: originalTitle!, exact: true }).click();
    await expect(page.getByTestId('sql-proposal-review')).toBeVisible();
    await expect(
        page.getByRole('button', { name: 'Accept SQL changes', exact: true }),
    ).toBeEnabled();
});

test('Chats generate in parallel and finish out of order in their original conversations', async ({
    page,
}) => {
    const requests = await deferredReplies(page);
    await trust(page);
    await page.getByTestId('open-ai').click();
    await ask(page, 'First question');
    await expect.poll(() => requests.length).toBe(1);
    await page.getByRole('button', { name: 'New chat', exact: true }).click();
    await ask(page, 'Second question');
    await expect.poll(() => requests.length).toBe(2);
    await page.getByRole('button', { name: /^Chat history:/ }).click();
    await expect(page.getByRole('status', { name: 'Generating response' })).toHaveCount(2);
    await page.getByRole('button', { name: /^Chat history:/ }).click();
    requests[1]!.reply();
    await expect(page.getByTestId('assistant-answer-markdown')).toHaveText(
        'Reply to Second question',
    );
    await selectChat(page, 'First question');
    await expect(page.locator('.assistant-pending')).toBeVisible();
    await expect(
        page.getByRole('button', { name: 'Stop assistant response', exact: true }),
    ).toBeVisible();
    requests[0]!.reply();
    await expect(page.getByTestId('assistant-answer-markdown')).toHaveText(
        'Reply to First question',
    );
    await selectChat(page, 'Second question');
    await expect(page.getByTestId('assistant-answer-markdown')).toHaveText(
        'Reply to Second question',
    );
    await expect(page.locator('.assistant-turn-error')).toHaveCount(0);
    await page.reload();
    await page.getByTestId('open-ai').click();
    await selectChat(page, 'First question');
    await expect(page.getByTestId('assistant-answer-markdown')).toHaveText(
        'Reply to First question',
    );
});

test('Stopping one chat does not cancel another or overwrite a replacement request', async ({
    page,
}) => {
    const requests = await deferredReplies(page);
    await trust(page);
    await page.getByTestId('open-ai').click();
    await ask(page, 'First question');
    await expect.poll(() => requests.length).toBe(1);
    await page.getByRole('button', { name: 'New chat', exact: true }).click();
    await ask(page, 'Second question');
    await expect.poll(() => requests.length).toBe(2);
    await page.getByRole('button', { name: 'Stop assistant response', exact: true }).click();
    await expect(page.locator('.assistant-turn-error')).toHaveText('Request cancelled.');
    await ask(page, 'Replacement question');
    await expect.poll(() => requests.length).toBe(3);
    requests[1]!.reply('SELECT 999');
    requests[2]!.reply();
    await expect(page.getByTestId('assistant-answer-markdown')).toHaveText(
        'Reply to Replacement question',
    );
    await expect(page.getByTestId('sql-proposal-review')).toHaveCount(0);
    await selectChat(page, 'First question');
    await expect(page.locator('.assistant-pending')).toBeVisible();
    requests[0]!.reply();
    await expect(page.getByTestId('assistant-answer-markdown')).toHaveText(
        'Reply to First question',
    );
});

for (const mode of ['beginner', 'expert']) {
    test(`Deleting a background chat immediately cancels only its reply in ${mode} mode`, async ({
        page,
    }) => {
        const requests = await deferredReplies(page);
        await page.addInitScript(
            mode => localStorage.setItem('clickstudio:experience', mode),
            mode,
        );
        await trust(page);
        await page.getByTestId('open-ai').click();
        await ask(page, 'Deleted question');
        await expect.poll(() => requests.length).toBe(1);
        await page.getByRole('button', { name: 'New chat', exact: true }).click();
        await ask(page, 'Retained question');
        await expect.poll(() => requests.length).toBe(2);
        await deleteChat(page, 'Deleted question');
        requests[0]!.reply('SELECT 999');
        await expect(page.locator('.assistant-pending')).toBeVisible();
        requests[1]!.reply();
        await expect(page.getByTestId('assistant-answer-markdown')).toHaveText(
            'Reply to Retained question',
        );
        await page.getByRole('button', { name: /^Chat history:/ }).click();
        await expect(page.locator('.assistant-chat-history-select')).toHaveCount(1);
        await expect(page.locator('.assistant-chat-history-select > span:first-child')).toHaveText(
            'Retained question',
        );
        await deleteChat(page, 'Retained question');
        await expect(page.locator('.assistant-empty-chat')).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Chat history: New chat', exact: true }),
        ).toBeFocused();
        await page.reload();
        await page.getByTestId('open-ai').click();
        await expect(page.locator('.assistant-empty-chat')).toBeVisible();
        await page.getByRole('button', { name: /^Chat history:/ }).click();
        await expect(page.locator('.assistant-chat-history-select > span:first-child')).toHaveText(
            'New chat',
        );
    });
}

test('A failed background reply records its error only in the original chat', async ({ page }) => {
    const requests = await deferredReplies(page);
    await trust(page);
    await page.getByTestId('open-ai').click();
    await ask(page, 'Failed question');
    await expect.poll(() => requests.length).toBe(1);
    await page.getByRole('button', { name: 'New chat', exact: true }).click();
    await ask(page, 'Successful question');
    await expect.poll(() => requests.length).toBe(2);
    requests[0]!.reply(null, 503);
    requests[1]!.reply();
    await expect(page.getByTestId('assistant-answer-markdown')).toHaveText(
        'Reply to Successful question',
    );
    await expect(page.locator('.assistant-turn-error')).toHaveCount(0);
    await selectChat(page, 'Failed question');
    await expect(page.locator('.assistant-turn-error')).toContainText('Try again later.');
    await expect(
        page.getByRole('button', { name: 'Stop assistant response', exact: true }),
    ).toHaveCount(0);
});

test('An included run stays attached to the question while another query runs', async ({
    page,
}) => {
    const requests = await deferredReplies(page);
    await trust(page);
    await replaceSql(page, 'SELECT 1 AS original');
    await page.getByTestId('run-button').click();
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'succeeded');
    await page.getByTestId('open-ai').click();
    await ask(page, 'Explain original run');
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]!.body).toMatchObject({
        includeRun: true,
        evidenceSql: 'SELECT 1 AS original',
    });
    const originalRunId = requests[0]!.body.runId;
    const originalQueryId = await page.locator('.execution-bar').getAttribute('data-query-id');
    await replaceSql(page, 'SELECT 2 AS newer');
    await page.getByTestId('run-button').click();
    await expect(page.locator('.execution-bar')).not.toHaveAttribute(
        'data-query-id',
        originalQueryId!,
    );
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', /\S+/);
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'succeeded');
    await expect(page.locator('.assistant-pending')).toBeVisible();
    requests[0]!.reply();
    await expect(page.getByTestId('assistant-answer-markdown')).toHaveText(
        'Reply to Explain original run',
    );
    await ask(page, 'Explain newer run');
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1]!.body).toMatchObject({ includeRun: true, evidenceSql: 'SELECT 2 AS newer' });
    expect(requests[1]!.body.runId).not.toBe(originalRunId);
    requests[1]!.reply();
    await expect(page.getByTestId('assistant-answer-markdown').last()).toHaveText(
        'Reply to Explain newer run',
    );
});

test('Accepting a proposal does not cancel another chat or clear its generating state', async ({
    page,
}) => {
    const requests = await deferredReplies(page);
    let releaseDecision: (() => void) | undefined;
    const decisionGate = new Promise<void>(resolve => {
        releaseDecision = resolve;
    });
    await page.route('**/api/assistant/proposals/*/decision', async route => {
        await decisionGate;
        await route.fulfill({
            json: {
                ...proposalFor(requests[0]!.body, 'SELECT 3 AS accepted'),
                decision: 'accepted',
                decidedAt: '2026-10-11T00:00:01.000Z',
            },
        });
    });
    await trust(page);
    await replaceSql(page, 'SELECT 1 AS original');
    await page.getByTestId('open-ai').click();
    await ask(page, 'First proposal');
    await expect.poll(() => requests.length).toBe(1);
    requests[0]!.reply('SELECT 3 AS accepted');
    await expect(page.getByTestId('sql-proposal-review')).toBeVisible();
    await page.getByRole('button', { name: 'New chat', exact: true }).click();
    await ask(page, 'Background question');
    await expect.poll(() => requests.length).toBe(2);
    await selectChat(page, 'First proposal');
    await page.getByRole('button', { name: 'Accept SQL changes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Applying…', exact: true })).toBeVisible();
    await selectChat(page, 'Background question');
    await expect(
        page.getByRole('button', { name: 'Stop assistant response', exact: true }),
    ).toBeVisible();
    releaseDecision?.();
    await expect(page.getByRole('textbox', { name: 'SQL editor', exact: true })).toHaveText(
        'SELECT 3 AS accepted',
    );
    await expect(page.locator('.assistant-pending')).toBeVisible();
    requests[1]!.reply();
    await expect(page.getByTestId('assistant-answer-markdown')).toHaveText(
        'Reply to Background question',
    );
    await selectChat(page, 'First proposal');
    await expect(page.getByTestId('assistant-proposal-summary')).toHaveText(
        'Reply to First proposal',
    );
    await expect(page.getByTestId('sql-proposal-review')).toHaveCount(0);
});

test('An apply error stays in its original chat while another chat is generating', async ({
    page,
}) => {
    const requests = await deferredReplies(page);
    let releaseDecision: (() => void) | undefined;
    const decisionGate = new Promise<void>(resolve => {
        releaseDecision = resolve;
    });
    await page.route('**/api/assistant/proposals/*/decision', async route => {
        await decisionGate;
        await route.fulfill({
            status: 503,
            json: { error: { code: 'AI_UNAVAILABLE', message: 'Could not apply this proposal.' } },
        });
    });
    await trust(page);
    await replaceSql(page, 'SELECT 1 AS original');
    await page.getByTestId('open-ai').click();
    await ask(page, 'First proposal');
    await expect.poll(() => requests.length).toBe(1);
    requests[0]!.reply('SELECT 3 AS suggested');
    await expect(page.getByTestId('sql-proposal-review')).toBeVisible();
    await page.getByRole('button', { name: 'Accept SQL changes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Applying…', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'New chat', exact: true }).click();
    await ask(page, 'Background question');
    await expect.poll(() => requests.length).toBe(2);
    releaseDecision?.();
    await expect(page.locator('.assistant-pending')).toBeVisible();
    requests[1]!.reply();
    await expect(page.getByTestId('assistant-answer-markdown')).toHaveText(
        'Reply to Background question',
    );
    await expect(page.locator('.assistant-feedback')).toHaveCount(0);
    await selectChat(page, 'First proposal');
    await expect(page.locator('.assistant-feedback')).toContainText(
        'Could not apply this proposal.',
    );
    await expect(
        page.getByRole('button', { name: 'Accept SQL changes', exact: true }),
    ).toBeEnabled();
});

test('Reloading interrupts all pending chats without mixing their history', async ({ page }) => {
    const requests = await deferredReplies(page);
    await trust(page);
    await page.getByTestId('open-ai').click();
    await ask(page, 'First interrupted question');
    await expect.poll(() => requests.length).toBe(1);
    await page.getByRole('button', { name: 'New chat', exact: true }).click();
    await ask(page, 'Second interrupted question');
    await expect.poll(() => requests.length).toBe(2);
    await page.reload();
    requests.forEach(request => request.reply());
    await page.getByTestId('open-ai').click();
    await expect(page.locator('.assistant-turn-error')).toContainText(
        'This request was interrupted when the page closed.',
    );
    await selectChat(page, 'First interrupted question');
    await expect(page.locator('.assistant-turn-error')).toContainText(
        'This request was interrupted when the page closed.',
    );
    await expect(page.locator('.assistant-pending')).toHaveCount(0);
    await expect(page.getByTestId('assistant-answer-markdown')).toHaveCount(0);
});

test('Closing the original SQL tab keeps its reply without applying to another tab', async ({
    page,
}) => {
    const requests = await deferredReplies(page);
    await trust(page);
    await replaceSql(page, 'SELECT 1 AS original');
    const originalTab = page.getByRole('tab', { selected: true });
    const originalTitle = await originalTab.getAttribute('aria-label');
    await page.getByTestId('open-ai').click();
    await ask(page, 'Explain closed tab');
    await expect.poll(() => requests.length).toBe(1);
    await openBlankSql(page);
    await replaceSql(page, 'SELECT 2 AS other_tab');
    await page.getByRole('button', { name: `Close ${originalTitle}`, exact: true }).click();
    requests[0]!.reply('SELECT 3');
    await expect(page.getByTestId('assistant-proposal-summary')).toHaveText(
        'Reply to Explain closed tab',
    );
    await expect(page.getByTestId('sql-proposal-review')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'SQL editor', exact: true })).toHaveText(
        'SELECT 2 AS other_tab',
    );
});
