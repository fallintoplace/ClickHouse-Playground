import {
    setWorkspaceMode,
    jsonRecord,
    replaceSql,
    trust,
    openStatementResults,
} from './helpers.js';
import { test, expect, type Page } from '@playwright/test';
import type { Proposal } from '../../src/shared/assistant/types.js';
import { expectReferenceStyles } from './style-reference.js';

const originalSql = 'SELECT 1 AS value';
const proposedSql = 'SELECT 2 AS value';
const liveEditor = (page: Page) => page.locator('.editor-frame .cm-content');
const review = (page: Page) => page.getByTestId('sql-proposal-review');

async function installProposal(
    page: Page,
    sql: string | null = proposedSql,
    extra: Partial<Proposal> = {},
) {
    const proposalId = extra.id ?? 'editor-review-test';
    let proposal: Proposal;
    const decisions: Record<string, unknown>[] = [];
    let failDecision = false;
    await page.route('**/api/assistant/sql', async route => {
        const body = jsonRecord(route.request().postDataJSON());
        proposal = {
            id: proposalId,
            owner: 'local-owner',
            connectionId: 'demo',
            action: 'ask',
            createdAt: '2026-10-11T00:00:00.000Z',
            baseSql: String(body.sql),
            responseId: 'editor-review-response',
            model: 'fixture',
            promptVersion: 'test',
            contextSummary: [],
            decision: 'pending',
            sql,
            summary: 'Updated query.',
            assumptions: [],
            tables: [],
            caveats: [],
            clarification: null,
            findings: [],
            ...extra,
        };
        await route.fulfill({ json: proposal });
    });
    await page.route(`**/api/assistant/proposals/${proposalId}/decision`, async route => {
        const body = jsonRecord(route.request().postDataJSON());
        decisions.push(body);
        if (failDecision) {
            await route.fulfill({
                status: 503,
                json: { error: { code: 'UNAVAILABLE', message: 'Please try again.' } },
            });
            return;
        }
        await route.fulfill({
            json: { ...proposal, decision: body.decision, decidedAt: '2026-10-11T00:00:01.000Z' },
        });
    });
    return {
        decisions,
        failDecision: (value: boolean) => {
            failDecision = value;
        },
    };
}

async function askForChanges(page: Page, summary = 'Updated query.') {
    await page.getByTestId('open-ai').click();
    await page.getByRole('textbox', { name: 'Ask AI', exact: true }).fill('Update this query');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(
        page.locator('.assistant-panel').getByText(summary, { exact: true }),
    ).toBeVisible();
}

async function storedDraft(page: Page) {
    return page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem('clickstudio:workspace:demo:v1') ?? '{}') as {
            activeId: string;
            tabs: { id: string; sql: string; checkpoints: { reason: string; sql: string }[] }[];
        };
        return state.tabs?.find(tab => tab.id === state.activeId);
    });
}

for (const mode of ['beginner', 'expert']) {
    for (const theme of ['Dark', 'Light']) {
        test(`${theme} ${mode} chat uses flat replies and compact SQL change controls`, async ({
            page,
        }, info) => {
            await page.clock.setFixedTime(new Date('2026-10-12T10:00:00Z'));
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await page.setViewportSize({ width: 1440, height: 900 });
            const firstSummary =
                'Changed the output value from 1 to 2 while keeping the query structure unchanged.';
            await installProposal(page, proposedSql, { id: 'flat-first', summary: firstSummary });
            await trust(page, mode);
            await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
            await replaceSql(page, originalSql);
            await askForChanges(page, firstSummary);
            await review(page)
                .getByRole('button', { name: 'Accept SQL changes', exact: true })
                .click();
            const secondSummary =
                'Changed the output value from 2 to 3. The column name and the rest of the query are unchanged.';
            await installProposal(page, 'SELECT 3 AS value', {
                id: 'flat-second',
                summary: secondSummary,
            });
            await askForChanges(page, secondSummary);
            await review(page)
                .getByRole('button', { name: 'Accept SQL changes', exact: true })
                .click();
            const transcript = page.getByRole('log', { name: 'Chat messages', exact: true });
            const cards = transcript.locator('.proposal-card');
            await expect(cards).toHaveCount(2);
            for (const card of await cards.all()) {
                await expect(card).toHaveCSS('border-top-width', '0px');
                await expect(card).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
                expect((await card.innerText()).match(/\bApplied\b/gi)).toHaveLength(1);
                await expect(card).not.toContainText('SQL PROPOSAL');
                await expect(card.getByTestId('assistant-proposal-summary')).toHaveCSS(
                    'font-size',
                    '12px',
                );
                await expect(card.locator('.sql-proposal-diff-toggle')).toHaveAccessibleName(
                    'SQL changes Applied 1 line added, 1 line removed',
                );
                await expect(card.locator('.sql-proposal-diff-count .is-added')).toHaveText('+1');
                await expect(card.locator('.sql-proposal-diff-count .is-removed')).toHaveText('−1');
                await expect(card.locator('.sql-proposal-diff-count .is-added')).toHaveCSS(
                    'border-top-width',
                    '0px',
                );
            }
            await expect(transcript.locator('.assistant-user-message p').first()).toHaveCSS(
                'font-size',
                '11px',
            );
            await expect(transcript.locator('.assistant-response-label')).toHaveText([
                'Assistant',
                'Assistant',
            ]);
            await expect(transcript.locator('.assistant-user-message').first()).toHaveCSS(
                'border-top-width',
                '0px',
            );
            for (const width of [1440, 900]) {
                await page.setViewportSize({ width, height: 900 });
                for (const card of await cards.all()) {
                    const toggle = card.locator('.sql-proposal-diff-toggle');
                    const [title, counts, chevron] = await Promise.all([
                        toggle.locator('.sql-proposal-diff-title').boundingBox(),
                        toggle.locator('.sql-proposal-diff-count').boundingBox(),
                        toggle.locator('.sql-proposal-diff-chevron').boundingBox(),
                    ]);
                    if (!title || !counts || !chevron)
                        throw new Error('SQL change controls should be visible');
                    expect(title.x + title.width).toBeLessThanOrEqual(counts.x);
                    expect(counts.x + counts.width).toBeLessThan(chevron.x);
                }
                await transcript.screenshot({ path: info.outputPath(`flat-chat-${width}.png`) });
            }
            const diff = cards.first().getByTestId('sql-proposal-diff');
            const toggle = diff.locator('summary');
            await toggle.click();
            await expect(diff.locator('.sql-proposal-diff-line.is-added')).toContainText(
                proposedSql,
            );
            await expect(diff.locator('.sql-proposal-diff-line.is-removed')).toContainText(
                originalSql,
            );
            await toggle.press('Enter');
            await expect(diff).not.toHaveAttribute('open', '');
            await page.setViewportSize({ width: 1440, height: 900 });
            await expectReferenceStyles(page, info, 'flat-chat', transcript);
        });
    }
}

for (const count of [5, 6, 11, 61]) {
    test(`Script plans paginate ${count} statements with Previous and Next buttons`, async ({
        page,
    }, testInfo) => {
        const script = Array.from(
            { length: count },
            (_, index) => `SELECT ${index + 1} AS value;`,
        ).join('\n');
        const runs: Record<string, unknown>[] = [];
        page.on('request', request => {
            if (
                request.method() === 'POST' &&
                ['/api/runs', '/api/scripts'].includes(new URL(request.url()).pathname)
            )
                runs.push(jsonRecord(request.postDataJSON()));
        });
        await installProposal(page, script);
        await trust(page);
        await replaceSql(page, originalSql);
        await askForChanges(page);
        const plan = page.getByTestId('assistant-execution-option');
        const steps = plan.locator('.assistant-execution-steps > li');
        const pager = plan.getByRole('navigation', { name: 'Script plan pages', exact: true });
        await expect(steps).toHaveCount(Math.min(5, count));
        await expect(plan.getByRole('button', { name: /Run|Reject|Accept/ })).toHaveCount(0);
        if (count <= 5) {
            await expect(pager).toHaveCount(0);
            return;
        }
        const previous = pager.getByRole('button', { name: 'Previous', exact: true });
        const next = pager.getByRole('button', { name: 'Next', exact: true });
        await expect(previous).toBeDisabled();
        for (let start = 0; start < count; start += 5) {
            const end = Math.min(start + 5, count);
            await expect(pager).toContainText(`${start + 1}–${end} of ${count}`);
            await expect(steps).toHaveCount(end - start);
            await expect(steps.locator('.assistant-execution-number')).toHaveText(
                Array.from({ length: end - start }, (_, index) => String(start + index + 1)),
            );
            await expect(steps.locator('details[open]')).toHaveCount(0);
            if (end < count) {
                await expect(next).toBeEnabled();
                await next.click();
            }
        }
        await expect(next).toBeDisabled();
        await expect(previous).toBeEnabled();
        await steps.last().locator('summary').click();
        await expect(steps.last().locator('code')).toContainText(`SELECT ${count} AS value`);
        await review(page).getByRole('button', { name: 'Accept SQL changes', exact: true }).click();
        await expect(plan.getByRole('button', { name: /Run/ })).toHaveCount(0);
        expect(runs).toHaveLength(0);
        if (count === 61) {
            await expect(plan).toContainText(
                'Scripts with more than 50 statements cannot run as one script.',
            );
            await expect(plan).not.toContainText('Showing the first 50');
            await page.screenshot({ path: testInfo.outputPath('script-plan-last-page.png') });
        } else if (count === 11) {
            await page.getByTestId('run-button').click();
            await expect.poll(() => runs.length).toBe(1);
            expect(runs[0]).toMatchObject({ sql: script, connectionId: 'demo' });
        }
        for (let start = Math.floor((count - 1) / 5) * 5; start > 0; start -= 5)
            await previous.click();
        await expect(pager).toContainText(`1–5 of ${count}`);
        await expect(previous).toBeDisabled();
        await expect(steps.locator('.assistant-execution-number')).toHaveText([
            '1',
            '2',
            '3',
            '4',
            '5',
        ]);
    });
}

test('Script plan pages are independent and new proposals start on the first page', async ({
    page,
}) => {
    const script = Array.from({ length: 11 }, (_, index) => `SELECT ${index + 1};`).join('\n');
    await installProposal(page, script, {
        id: 'paged-script',
        alternatives: [{ title: 'Other script', summary: 'Another script.', sql: script }],
    });
    await trust(page);
    await replaceSql(page, originalSql);
    await askForChanges(page);
    const plans = page.getByTestId('assistant-execution-option');
    await plans.first().getByRole('button', { name: 'Next', exact: true }).click();
    await expect(plans.first().getByRole('navigation')).toContainText('6–10 of 11');
    await expect(plans.last().getByRole('navigation')).toContainText('1–5 of 11');
    await review(page).getByRole('button', { name: 'Accept SQL changes', exact: true }).click();
    await installProposal(page, script, { id: 'new-paged-script', summary: 'New script.' });
    await askForChanges(page, 'New script.');
    await expect(plans.last().getByRole('navigation')).toContainText('1–5 of 11');
    await expect(plans.first().getByRole('navigation')).toContainText('6–10 of 11');
});

for (const mode of ['beginner', 'expert']) {
    test(`Opening an alternative preserves pending SQL changes without running in ${mode} mode`, async ({
        page,
    }, testInfo) => {
        const alternativeSql = 'SELECT 42 AS alternative; SELECT 43 AS next_value;';
        const { decisions } = await installProposal(page, proposedSql, {
            alternatives: [
                { title: 'Other query', summary: 'Try another value.', sql: alternativeSql },
            ],
        });
        let runs = 0;
        page.on('request', request => {
            if (
                request.method() === 'POST' &&
                ['/api/runs', '/api/scripts'].includes(new URL(request.url()).pathname)
            )
                runs++;
        });
        await trust(page, mode);
        await replaceSql(page, originalSql);
        await askForChanges(page);
        await expect(review(page)).toBeVisible();
        const alternative = page.getByRole('button', {
            name: 'Open in SQL tab: Other query',
            exact: true,
        });
        await expect(alternative).toBeEnabled();
        await alternative.scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath('pending-sql-and-alternative.png') });
        await alternative.click();
        await expect(liveEditor(page)).toHaveText(alternativeSql);
        await expect(review(page)).toHaveCount(0);
        expect(decisions).toHaveLength(0);
        expect(runs).toBe(0);
        const tabs = page.getByRole('tablist', { name: 'SQL documents', exact: true });
        await expect(tabs.getByRole('tab')).toHaveCount(2);
        await expect(tabs.getByRole('tab').last()).toContainText('Other query.sql');
        await tabs.getByRole('tab').first().click();
        await expect(review(page)).toBeVisible();
        await expect(liveEditor(page)).toHaveText(originalSql);
        await expect(page.getByTestId('sql-proposal-diff')).toContainText('Needs review');
        await review(page).getByRole('button', { name: 'Reject SQL changes', exact: true }).click();
        await expect(liveEditor(page)).toHaveText(originalSql);
        await tabs.getByRole('tab').last().click();
        await page.getByTestId('run-button').click();
        await expect.poll(() => runs).toBe(1);
        expect(decisions.map(item => item.decision)).toEqual(['rejected']);
    });
}

for (const [operation, sql] of [
    ['Read', 'SELECT 2'],
    ['Delete', 'DROP TABLE demo.events'],
    ['Empty', ''],
    ['Invalid', "SELECT 'unterminated"],
] as const) {
    test(`${operation} SQL proposals have no chat execution or decision actions`, async ({
        page,
    }) => {
        await installProposal(page, sql, {
            alternatives: [{ title: 'Other read', summary: 'Another value.', sql: 'SELECT 42' }],
        });
        let runs = 0;
        page.on('request', request => {
            if (
                request.method() === 'POST' &&
                ['/api/runs', '/api/scripts'].includes(new URL(request.url()).pathname)
            )
                runs++;
        });
        await trust(page);
        await replaceSql(page, originalSql);
        await askForChanges(page);
        const card = page.locator('.proposal-card');
        const actions = card.getByRole('button', {
            name: /Run|Reject|Accept|Use this query|Apply to draft/,
        });
        await expect(actions).toHaveCount(0);
        const recommended = page.getByTestId('assistant-execution-option').first();
        if (operation === 'Empty')
            await expect(recommended).toContainText('There are no SQL statements');
        else if (operation === 'Invalid')
            await expect(recommended).toContainText('Could not split this SQL safely');
        else await expect(recommended.locator('.assistant-operation-badge')).toHaveText(operation);
        await review(page).getByRole('button', { name: 'Accept SQL changes', exact: true }).click();
        await expect(review(page)).toHaveCount(0);
        await expect(actions).toHaveCount(0);
        expect(runs).toBe(0);
    });
}

test('Failed SQL checks block acceptance and opening alternatives while keeping rejection available', async ({
    page,
}) => {
    await installProposal(page, proposedSql, {
        alternatives: [{ title: 'Other query', summary: '', sql: 'SELECT 42' }],
        quality: {
            status: 'fail',
            score: 0,
            evaluatorVersion: 'test',
            evaluatedAt: '2026-10-11T00:00:00.000Z',
            checks: [{ id: 'safety', status: 'fail', message: 'A required check failed.' }],
        },
    });
    await trust(page);
    await replaceSql(page, originalSql);
    await askForChanges(page);
    await expect(page.getByTestId('sql-proposal-diff')).toContainText('Checks failed');
    await expect(page.locator('.sql-proposal-review-message')).toContainText(
        'A required check failed',
    );
    await expect(page.getByRole('button', { name: 'Open in SQL tab: Other query' })).toBeDisabled();
    await expect(review(page).getByRole('button', { name: 'Accept SQL changes' })).toBeDisabled();
    await review(page).getByRole('button', { name: 'Reject SQL changes' }).click();
    await expect(liveEditor(page)).toHaveText(originalSql);
});

for (const mode of ['beginner', 'expert']) {
    test(`Inline SQL review accepts the whole proposal without running it in ${mode} mode`, async ({
        page,
    }) => {
        const { decisions } = await installProposal(page, proposedSql, {
            findings: [
                {
                    severity: 'low',
                    message: 'The output value changes.',
                    evidence: 'The query selects 2 instead of 1.',
                },
            ],
            assumptions: ['The value should be 2.'],
            caveats: ['Result labels stay the same.'],
            sources: [{ title: 'SELECT reference', url: 'https://clickhouse.com/docs' }],
        });
        let runs = 0;
        let saves = 0;
        page.on('request', request => {
            if (request.method() !== 'POST') return;
            const path = new URL(request.url()).pathname;
            if (path === '/api/runs' || path === '/api/scripts') runs++;
            if (path === '/api/documents') saves++;
        });
        await trust(page, mode);
        await replaceSql(page, originalSql);
        await expect.poll(async () => (await storedDraft(page))?.sql).toBe(originalSql);
        await askForChanges(page);
        const details = page.locator('.assistant-supporting-details');
        if (mode === 'expert') {
            await expect(details).toHaveCount(2);
            await details
                .locator('summary')
                .filter({ hasText: /^Details/ })
                .click();
            await expect(
                details.getByText('The output value changes.', { exact: true }),
            ).toBeVisible();
            await details
                .locator('summary')
                .filter({ hasText: /^Assumptions, notes and sources/ })
                .click();
            await expect(
                details.getByText('The value should be 2.', { exact: true }),
            ).toBeVisible();
            await expect(
                details.getByText('Result labels stay the same.', { exact: true }),
            ).toBeVisible();
            await expect(details.getByRole('link', { name: 'SELECT reference' })).toHaveAttribute(
                'href',
                'https://clickhouse.com/docs',
            );
        } else await expect(details).toHaveCount(0);
        await expect(review(page)).toBeVisible();
        await expect(
            page
                .locator('.proposal-card')
                .getByRole('button', { name: /Run|Reject|Accept|Use this query|Apply to draft/ }),
        ).toHaveCount(0);
        await expect(liveEditor(page)).toBeHidden();
        await expect(liveEditor(page)).toHaveText(originalSql);
        const preview = review(page).getByRole('textbox', {
            name: 'Proposed SQL changes',
            exact: true,
        });
        await expect(preview).toHaveAttribute('aria-readonly', 'true');
        await expect(preview).toHaveAttribute('contenteditable', 'false');
        await expect(review(page).locator('.cm-changedLine')).toHaveText(proposedSql);
        await expect(review(page).locator('.cm-deletedChunk')).toHaveText(originalSql);
        await expect(page.getByTestId('run-button')).toBeDisabled();
        if (mode === 'expert') await expect(page.getByTestId('save-query')).toBeDisabled();
        else await expect(page.getByTestId('save-query')).toHaveCount(0);
        await expect(page.getByTestId('format-sql')).toBeDisabled();
        await page.keyboard.press('ControlOrMeta+s');
        await page.keyboard.press('ControlOrMeta+Enter');
        expect((await storedDraft(page))?.sql).toBe(originalSql);
        await review(page).getByRole('button', { name: 'Accept SQL changes', exact: true }).click();
        await expect(review(page)).toHaveCount(0);
        await expect(liveEditor(page)).toBeVisible();
        await expect(liveEditor(page)).toHaveText(proposedSql);
        await expect(page.getByTestId('sql-proposal-diff')).toContainText('Applied');
        await expect(details).toHaveCount(mode === 'expert' ? 2 : 0);
        await expect.poll(async () => (await storedDraft(page))?.sql).toBe(proposedSql);
        expect((await storedDraft(page))?.checkpoints).toContainEqual(
            expect.objectContaining({
                reason: 'Before accepted AI proposal',
                sql: originalSql,
            }),
        );
        expect(decisions).toEqual([
            { decision: 'accepted', connectionId: 'demo', currentSql: originalSql },
        ]);
        expect(runs).toBe(0);
        expect(saves).toBe(0);
        await page.reload();
        await expect(review(page)).toHaveCount(0);
        await expect(liveEditor(page)).toHaveText(proposedSql);
    });
}

for (const decision of ['accepted', 'rejected'] as const) {
    test(`Earlier script proposals stay previews after the latest proposal is ${decision}`, async ({
        page,
    }) => {
        const firstScript = 'SELECT 2 AS value;\nSELECT 3 AS value;';
        const nextScript = 'SELECT 5 AS value;\nSELECT 6 AS value;';
        const runs: Record<string, unknown>[] = [];
        page.on('request', request => {
            if (
                request.method() === 'POST' &&
                ['/api/runs', '/api/scripts'].includes(new URL(request.url()).pathname)
            )
                runs.push(jsonRecord(request.postDataJSON()));
        });
        await installProposal(page, firstScript, {
            id: 'first-script',
            summary: 'First script.',
            alternatives: [{ title: 'Another read', summary: 'Read a value.', sql: 'SELECT 4' }],
        });
        await trust(page);
        await replaceSql(page, originalSql);
        await askForChanges(page, 'First script.');
        await review(page).getByRole('button', { name: 'Accept SQL changes', exact: true }).click();
        const oldCard = page.locator('.proposal-card').first();
        const oldAlternative = oldCard.getByRole('button', {
            name: 'Open in SQL tab: Another read',
            exact: true,
        });
        await expect(oldAlternative).toBeEnabled();
        await expect(oldCard.getByRole('button', { name: /Run/ })).toHaveCount(0);
        await installProposal(page, nextScript, { id: 'next-script', summary: 'Newer script.' });
        await askForChanges(page, 'Newer script.');
        await expect(review(page)).toBeVisible();
        await expect(oldAlternative).toBeDisabled();
        await review(page)
            .getByRole('button', {
                name: decision === 'accepted' ? 'Accept SQL changes' : 'Reject SQL changes',
                exact: true,
            })
            .click();
        await expect(review(page)).toHaveCount(0);
        expect(runs).toHaveLength(0);
        await page.reload();
        await page.getByTestId('open-ai').click();
        await expect(oldAlternative).toBeDisabled();
        await expect(
            page.locator('.proposal-card').getByRole('button', { name: /Run/ }),
        ).toHaveCount(0);
        if (decision === 'accepted') {
            await page.getByTestId('run-button').click();
            await expect.poll(() => runs.length).toBe(1);
            expect(runs[0]).toMatchObject({ sql: nextScript, connectionId: 'demo' });
            await expect(
                page.getByRole('button', { name: /^Select a statement result/ }),
            ).toHaveAccessibleName(/Statement 2: succeeded/);
            await openStatementResults(page);
            await expect(
                page.getByRole('menuitemradio', { name: 'Statement 2: succeeded', exact: true }),
            ).toBeVisible();
        }
    });
}

test('Accepted query history stays informational through failed and text-only follow-ups', async ({
    page,
}) => {
    await installProposal(page, proposedSql, { id: 'first-query', summary: 'First query.' });
    await trust(page, 'beginner');
    await replaceSql(page, originalSql);
    await askForChanges(page, 'First query.');
    await review(page).getByRole('button', { name: 'Accept SQL changes', exact: true }).click();
    const oldCard = page.locator('.proposal-card').first();
    await expect(oldCard.getByTestId('sql-proposal-diff')).toContainText('Applied');
    await page.route('**/api/assistant/sql', route =>
        route.fulfill({
            status: 503,
            json: { error: { code: 'UNAVAILABLE', message: 'Please try again.' } },
        }),
    );
    await page.getByRole('textbox', { name: 'Ask AI', exact: true }).fill('Try a follow-up');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.assistant-turn-error').last()).toContainText('Please try again.');
    await installProposal(page, null, { id: 'answer', summary: 'A text-only answer.' });
    await askForChanges(page, 'A text-only answer.');
    await expect(review(page)).toHaveCount(0);
    await installProposal(page, proposedSql, { id: 'same-query', summary: 'Latest query.' });
    await askForChanges(page, 'Latest query.');
    await expect(review(page)).toHaveCount(0);
    await expect(page.getByTestId('sql-proposal-diff').last()).toContainText('No SQL changes');
    await expect(oldCard.getByTestId('sql-proposal-diff')).toContainText('Applied');
    await expect(
        page
            .locator('.proposal-card')
            .getByRole('button', { name: /Run|Reject|Accept|Use this query|Apply to draft/ }),
    ).toHaveCount(0);
    await expect(liveEditor(page)).toHaveText(proposedSql);
});

test('Rejecting SQL changes preserves the live editor and its undo history', async ({ page }) => {
    await installProposal(page);
    await trust(page);
    await replaceSql(page, originalSql);
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.insertText(' -- keep this');
    const draft = `${originalSql} -- keep this`;
    await expect(liveEditor(page)).toHaveText(draft);
    const editor = await liveEditor(page).elementHandle();
    await askForChanges(page);
    await review(page).getByRole('button', { name: 'Reject SQL changes', exact: true }).click();
    await expect(review(page)).toHaveCount(0);
    await expect(liveEditor(page)).toHaveText(draft);
    expect(
        await liveEditor(page).evaluate((element, original) => element === original, editor),
    ).toBe(true);
    await expect(page.getByTestId('sql-proposal-diff')).toContainText('Rejected');
    await liveEditor(page).focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(liveEditor(page)).toHaveText(originalSql);
});

test('Query ownership survives tab switches and reloads, including identical SQL', async ({
    page,
}) => {
    await installProposal(page);
    await trust(page);
    await replaceSql(page, originalSql);
    await askForChanges(page);
    await expect(review(page)).toBeVisible();
    const tabs = page.getByRole('tablist', { name: 'SQL documents', exact: true });
    await page.getByTestId('new-sql').click();
    await expect(review(page)).toHaveCount(0);
    await replaceSql(page, originalSql);
    await page.reload();
    await expect(review(page)).toHaveCount(0);
    await expect(liveEditor(page)).toHaveText(originalSql);
    await page.getByTestId('open-ai').click();
    await expect(
        page
            .locator('.proposal-card')
            .getByRole('button', { name: /Accept|Reject|Apply to draft/ }),
    ).toHaveCount(0);
    await expect(page.locator('.assistant-sql-review')).toContainText('Open the original SQL tab');
    await tabs.getByRole('tab').first().click();
    await expect(review(page)).toBeVisible();
    await page.reload();
    await expect(review(page)).toBeVisible();
    await expect(liveEditor(page)).toHaveText(originalSql);
    await page.getByTestId('open-ai').click();
    await review(page).getByRole('button', { name: 'Accept SQL changes', exact: true }).click();
    await expect(review(page)).toHaveCount(0);
    await expect(liveEditor(page)).toHaveText(proposedSql);
});

test('A failed decision keeps the review and draft available for retry', async ({ page }) => {
    const fixture = await installProposal(page);
    fixture.failDecision(true);
    await trust(page);
    await replaceSql(page, originalSql);
    await askForChanges(page);
    const accept = review(page).getByRole('button', { name: 'Accept SQL changes', exact: true });
    await accept.click();
    await expect(review(page).getByRole('alert')).toContainText('Please try again.');
    await expect(accept).toBeEnabled();
    await expect(liveEditor(page)).toHaveText(originalSql);
    fixture.failDecision(false);
    await accept.click();
    await expect(review(page)).toHaveCount(0);
    await expect(liveEditor(page)).toHaveText(proposedSql);
});

test('A new proposal reveals a collapsed query and still allows manual collapse', async ({
    page,
}) => {
    await installProposal(page);
    await trust(page);
    await replaceSql(page, originalSql);
    await page.getByRole('button', { name: 'Collapse SQL query', exact: true }).click();
    await askForChanges(page);
    await expect(review(page)).toBeVisible();
    await page.getByRole('button', { name: 'Collapse SQL query', exact: true }).click();
    await expect(review(page)).toBeHidden();
    await page.getByRole('button', { name: 'Expand SQL query', exact: true }).click();
    await expect(review(page)).toBeVisible();
});

test('A restored proposal cannot replace or apply to a changed draft', async ({ page }) => {
    const { decisions } = await installProposal(page);
    await trust(page);
    await replaceSql(page, originalSql);
    await askForChanges(page);
    await expect.poll(async () => (await storedDraft(page))?.sql).toBe(originalSql);
    await page.evaluate(() => {
        const key = 'clickstudio:workspace:demo:v1';
        const state = JSON.parse(localStorage.getItem(key)!) as {
            activeId: string;
            tabs: { id: string; sql: string }[];
        };
        const draft = state.tabs.find(tab => tab.id === state.activeId)!;
        draft.sql = 'SELECT 99 AS changed';
        localStorage.setItem(key, JSON.stringify(state));
    });
    await page.reload();
    await expect(review(page)).toHaveCount(0);
    await expect(liveEditor(page)).toBeVisible();
    await expect(liveEditor(page)).toHaveText('SELECT 99 AS changed');
    await page.getByTestId('open-ai').click();
    await expect(page.locator('.assistant-sql-review')).toContainText('Draft changed');
    await expect(page.locator('.assistant-sql-review')).toContainText(
        'The SQL draft changed. Ask again to review the current draft.',
    );
    await expect(
        page
            .locator('.proposal-card')
            .getByRole('button', { name: /Accept|Reject|Apply to draft/ }),
    ).toHaveCount(0);
    expect(decisions).toEqual([]);
});

test('Detached query review shares the same draft and decision with the workspace', async ({
    page,
}) => {
    await installProposal(page);
    await trust(page);
    await replaceSql(page, originalSql);
    const popup = page.waitForEvent('popup');
    await page
        .getByRole('button', { name: 'Open editor in a separate window', exact: true })
        .click();
    const editorWindow = await popup;
    await expect(liveEditor(editorWindow)).toBeVisible();
    await askForChanges(page);
    await expect(review(editorWindow)).toBeVisible();
    await expect(liveEditor(editorWindow)).toHaveText(originalSql);
    await review(editorWindow)
        .getByRole('button', { name: 'Accept SQL changes', exact: true })
        .click();
    await expect(review(editorWindow)).toHaveCount(0);
    await expect(liveEditor(editorWindow)).toHaveText(proposedSql);
    await expect(page.getByTestId('sql-proposal-diff')).toContainText('Applied');
    await editorWindow.getByRole('button', { name: 'Dock editor here', exact: true }).click();
    await expect.poll(() => editorWindow.isClosed()).toBe(true);
    await expect(liveEditor(page)).toHaveText(proposedSql);
});

test('Dark SQL review tokens stay readable on added and removed lines', async ({ page }, info) => {
    const draft =
        'SELECT count() AS reviews, 0.50, \'frontend\', true, NULL, {limit:UInt64}, "SELECT", `FROM` -- latency';
    await installProposal(page, draft.replace("'frontend'", "'backend'"));
    await trust(page);
    await replaceSql(page, draft);
    await page.getByRole('radio', { name: 'Dark theme', exact: true }).click();
    await askForChanges(page);
    const lines = review(page).locator('.cm-changedLine, .cm-deletedLine');
    await expect(lines).toHaveCount(2);
    const contrasts = await lines.evaluateAll(elements => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d')!;
        const rgba = (color: string) => {
            context.clearRect(0, 0, 1, 1);
            context.fillStyle = color;
            context.fillRect(0, 0, 1, 1);
            return [...context.getImageData(0, 0, 1, 1).data];
        };
        const blend = (foreground: number[], background: number[]) => {
            const alpha = foreground[3]! / 255;
            return background.map((value, index) =>
                index < 3 ? foreground[index]! * alpha + value * (1 - alpha) : 255,
            );
        };
        const luminance = (color: number[]) =>
            color
                .slice(0, 3)
                .map(value => {
                    const channel = value / 255;
                    return channel <= 0.04045
                        ? channel / 12.92
                        : ((channel + 0.055) / 1.055) ** 2.4;
                })
                .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
        return elements.flatMap(line => {
            const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
            const results = [];
            let node: Node | null;
            while ((node = walker.nextNode())) {
                if (!node.textContent?.trim()) continue;
                const element = node.parentElement!;
                const ancestors: Element[] = [];
                for (let parent: Element | null = element; parent; parent = parent.parentElement)
                    ancestors.unshift(parent);
                const background = ancestors.reduce(
                    (color, ancestor) =>
                        blend(rgba(getComputedStyle(ancestor).backgroundColor), color),
                    [0, 0, 0, 255],
                );
                for (const selected of [false, true]) {
                    const style = getComputedStyle(element, selected ? '::selection' : null);
                    const foreground = luminance(rgba(style.color));
                    const surface = luminance(
                        selected ? blend(rgba(style.backgroundColor), background) : background,
                    );
                    results.push({
                        token: node.textContent,
                        selected,
                        ratio:
                            (Math.max(foreground, surface) + 0.05) /
                            (Math.min(foreground, surface) + 0.05),
                    });
                }
            }
            return results;
        });
    });
    expect(contrasts.length).toBeGreaterThan(0);
    for (const { token, selected, ratio } of contrasts)
        expect(ratio, `${selected ? 'selected' : 'normal'}: ${token}`).toBeGreaterThanOrEqual(4.5);
    await review(page).screenshot({ path: info.outputPath('dark-sql-token-contrast.png') });
});

for (const theme of ['Dark', 'Light']) {
    test(`Long SQL reviews keep restrained colors and visible decisions in ${theme} theme`, async ({
        page,
    }, testInfo) => {
        const sql = Array.from({ length: 150 }, (_, index) => `SELECT ${index + 2} AS value;`).join(
            '\n',
        );
        await installProposal(page, sql);
        await trust(page);
        await replaceSql(page, originalSql);
        await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
        await askForChanges(page);
        const additions = review(page).locator('.cm-changedLine').first();
        const deletions = review(page).locator('.cm-deletedChunk').first();
        const expectedAdded = theme === 'Dark' ? 'rgb(16, 61, 53)' : 'rgb(204, 255, 240)';
        const expectedRemoved = theme === 'Dark' ? 'rgb(79, 39, 34)' : 'rgb(255, 231, 226)';
        await expect(additions).toHaveCSS('background-color', expectedAdded);
        await expect(deletions).toHaveCSS('background-color', expectedRemoved);
        await expect(review(page).locator('.cm-changedLineGutter').first()).toHaveCSS(
            'background-color',
            'rgb(33, 191, 150)',
        );
        await expect(review(page).locator('.cm-deletedLineGutter').first()).toHaveCSS(
            'background-color',
            'rgb(255, 101, 79)',
        );
        for (const { width, height } of [
            { width: 1280, height: 900 },
            { width: 1280, height: 600 },
            { width: 720, height: 900 },
        ]) {
            await page.setViewportSize({ width, height });
            const accept = review(page).getByRole('button', {
                name: 'Accept SQL changes',
                exact: true,
            });
            const surface = review(page).locator('.sql-review-surface');
            const actions = review(page).locator('.sql-review-actions');
            await expect(actions.getByText('1 pending change', { exact: true })).toBeVisible();
            await expect(accept).toBeInViewport({ ratio: 1 });
            await expect(actions).toBeInViewport({ ratio: 1 });
            const surfaceBox = await surface.boundingBox();
            const initialActionsBox = await actions.boundingBox();
            if (!surfaceBox || !initialActionsBox)
                throw new Error('The SQL review and its decisions should be visible');
            expect(initialActionsBox.width).toBeLessThan(surfaceBox.width);
            expect(
                Math.abs(
                    initialActionsBox.x +
                        initialActionsBox.width / 2 -
                        (surfaceBox.x + surfaceBox.width / 2),
                ),
            ).toBeLessThanOrEqual(1);
            await expect(review(page).locator('.cm-chunkButtons')).toHaveCount(0);
            expect(
                await review(page).evaluate(element => element.scrollWidth <= element.clientWidth),
            ).toBe(true);
            await review(page)
                .locator('.cm-scroller')
                .evaluate(element => {
                    element.scrollTop = element.scrollHeight;
                });
            await expect(accept).toBeInViewport({ ratio: 1 });
            await expect(actions).toBeInViewport({ ratio: 1 });
            const lastLine = review(page)
                .locator('.cm-line')
                .filter({ hasText: 'SELECT 151 AS value;' });
            await expect(lastLine).toBeVisible();
            const lastLineBox = await lastLine.boundingBox();
            const actionsBox = await actions.boundingBox();
            if (!lastLineBox || !actionsBox)
                throw new Error('The final SQL line and its decisions should be visible');
            expect(lastLineBox.y + lastLineBox.height).toBeLessThanOrEqual(actionsBox.y);
            expect(Math.abs(actionsBox.y - initialActionsBox.y)).toBeLessThanOrEqual(1);
            await page.screenshot({ path: testInfo.outputPath(`review-${width}x${height}.png`) });
        }
    });
}

test('Pure deletion still opens a review and accepts an empty draft', async ({ page }) => {
    await installProposal(page, '');
    await trust(page);
    await replaceSql(page, originalSql);
    await askForChanges(page);
    await expect(review(page).locator('.cm-deletedChunk')).toHaveText(originalSql);
    await review(page).getByRole('button', { name: 'Accept SQL changes', exact: true }).click();
    await expect(review(page)).toHaveCount(0);
    await expect(liveEditor(page)).toHaveText('');
});

test('Failed SQL checks block acceptance while allowing rejection', async ({ page }) => {
    await installProposal(page, proposedSql, {
        quality: {
            evaluatorVersion: 'test',
            evaluatedAt: '2026-10-11T00:00:00.000Z',
            status: 'fail',
            score: 0,
            checks: [],
        },
    });
    await trust(page);
    await replaceSql(page, originalSql);
    await askForChanges(page);
    await expect(
        review(page).getByRole('button', { name: 'Accept SQL changes', exact: true }),
    ).toBeDisabled();
    await expect(review(page).getByRole('alert')).toHaveText(
        'This proposal did not pass SQL checks.',
    );
    await review(page).getByRole('button', { name: 'Reject SQL changes', exact: true }).click();
    await expect(review(page)).toHaveCount(0);
    await expect(liveEditor(page)).toHaveText(originalSql);
});

for (const [status, score, token] of [
    ['pass', 100, '--green'],
    ['warn', 50, '--amber'],
    ['fail', 0, '--red'],
] as const)
    test(`Experimental keeps the ${status} check badge while Standard hides it in both themes`, async ({
        page,
    }, info) => {
        await installProposal(page, proposedSql, {
            quality: {
                evaluatorVersion: 'test',
                evaluatedAt: '2026-10-11T00:00:00.000Z',
                status,
                score,
                checks: [],
            },
        });
        await trust(page);
        await replaceSql(page, originalSql);
        await askForChanges(page);
        const badge = page.locator('.proposal-quality');
        await expect(badge).toBeVisible();
        for (const theme of ['Dark theme', 'Light theme']) {
            await page
                .getByRole('radiogroup', { name: 'Theme' })
                .getByRole('radio', { name: theme })
                .click();
            const expectedColor = await page.evaluate(
                variable => {
                    const probe = document.createElement('span');
                    probe.style.color = `var(${variable})`;
                    document.body.append(probe);
                    const color = getComputedStyle(probe).color;
                    probe.remove();
                    return color;
                },
                theme === 'Light theme' && status !== 'warn' ? '--status-badge-ink' : token,
            );
            await expect(badge).toHaveCSS('color', expectedColor);
            if (theme === 'Light theme' && status !== 'warn') {
                await expect(badge.locator('small')).toHaveCSS('color', expectedColor);
                await expect(badge).toHaveCSS(
                    'background-color',
                    status === 'pass' ? 'rgb(0, 122, 69)' : 'rgb(197, 34, 67)',
                );
                await page.screenshot({ path: info.outputPath(`light-${status}-checks.png`) });
            }
            await setWorkspaceMode(page, 'Standard');
            await page.getByTestId('open-ai').click();
            await expect(page.getByTestId('assistant-proposal-summary')).toHaveText(
                'Updated query.',
            );
            await expect(badge).toHaveCount(0);
            await expect(page.getByTestId('sql-proposal-diff')).toContainText(
                status === 'fail' ? 'Checks failed' : 'Needs review',
            );
            const accept = review(page).getByRole('button', {
                name: 'Accept SQL changes',
                exact: true,
            });
            if (status === 'fail') {
                await expect(accept).toBeDisabled();
                await expect(review(page).getByRole('alert')).toHaveText(
                    'This proposal did not pass SQL checks.',
                );
            } else await expect(accept).toBeEnabled();
            await page.screenshot({ path: info.outputPath(`${theme}-standard-no-checks.png`) });
            await setWorkspaceMode(page, 'Experimental');
            await expect(badge).toBeVisible();
        }
    });

for (const reply of [
    { name: 'explanations', sql: proposedSql, action: 'explain' },
    { name: 'reviews', sql: proposedSql, action: 'review' },
    { name: 'unchanged SQL', sql: originalSql, action: 'ask' },
    { name: 'answers without SQL', sql: null, action: 'ask' },
] as const) {
    test(`Inline review leaves ${reply.name} in chat`, async ({ page }) => {
        await installProposal(page, reply.sql, { action: reply.action });
        await trust(page);
        await replaceSql(page, originalSql);
        await askForChanges(page);
        await expect(review(page)).toHaveCount(0);
        await expect(liveEditor(page)).toBeVisible();
        await expect(liveEditor(page)).toHaveText(originalSql);
        if (reply.action !== 'ask') {
            await expect(page.getByTestId('sql-proposal-diff')).toContainText('Review only');
            await expect(page.locator('.proposal-card')).not.toContainText('Needs review');
            await expect(page.locator('.proposal-card').getByRole('button')).toHaveCount(0);
        }
    });
}
