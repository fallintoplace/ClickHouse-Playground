import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { jsonRecord } from './helpers.js';

async function loadHarness(page: Page) {
    await page.goto('/experimental');
    await page.evaluate(() => {
        const container = document.createElement('div');
        container.id = 'assistant-harness';
        document.body.append(container);
    });
    const fixture = fileURLToPath(
        new URL('./fixtures/assistant-cancellation.tsx', import.meta.url),
    );
    await page.addScriptTag({ type: 'module', url: `/@fs${fixture}` });
    await page.waitForFunction(() => Boolean(window.assistantCancellationHarness));
}

test('Explicit concurrent accepts can replace the same SQL draft', async ({ page }) => {
    const proposals = new Map<string, Record<string, unknown>>();
    await page.route('**/api/assistant/sql', async route => {
        const body = jsonRecord(route.request().postDataJSON());
        const proposal = {
            id: String(body.question),
            owner: 'local-owner',
            connectionId: 'assistant-cancellation-test',
            action: 'ask',
            createdAt: '2026-10-11T00:00:00.000Z',
            baseSql: body.sql,
            responseId: 'concurrent-response',
            model: 'fixture',
            promptVersion: 'test',
            contextSummary: [],
            decision: 'pending',
            sql: body.question === 'First acceptance' ? 'SELECT 3' : 'SELECT 4',
            summary: 'Concurrent reply',
            assumptions: [],
            tables: [],
            caveats: [],
            clarification: null,
            findings: [],
        };
        proposals.set(proposal.id, proposal);
        await route.fulfill({ json: proposal });
    });
    const releases: (() => void)[] = [];
    await page.route('**/api/assistant/proposals/*/decision', async route => {
        await new Promise<void>(resolve => {
            releases.push(resolve);
            if (releases.length === 2) releases.forEach(release => release());
        });
        const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-2)!);
        await route.fulfill({
            json: {
                ...proposals.get(id),
                decision: 'accepted',
                decidedAt: '2026-10-11T00:00:01.000Z',
            },
        });
    });
    await loadHarness(page);
    const state = await page.evaluate(() =>
        window.assistantCancellationHarness.acceptConcurrently(),
    );
    expect(releases).toHaveLength(2);
    expect(state.turns.filter(turn => turn.applied)).toHaveLength(2);
    expect(state.turns.map(turn => turn.decision)).toEqual(['accepted', 'accepted']);
    expect(state.turns.map(turn => turn.sql)).toContain(state.sql);
});

for (const change of ['edit', 'close', 'unmount'] as const) {
    test(`A pending acceptance ${change === 'edit' ? 'replaces the edited draft' : `does not apply after ${change}`}`, async ({
        page,
    }) => {
        const proposal = {
            id: 'delayed-proposal',
            owner: 'local-owner',
            connectionId: 'assistant-cancellation-test',
            action: 'ask',
            createdAt: '2026-10-11T00:00:00.000Z',
            baseSql: 'SELECT 1',
            responseId: 'prepared-response',
            model: 'fixture',
            promptVersion: 'test',
            contextSummary: [],
            decision: 'pending',
            sql: 'SELECT 3',
            summary: 'Prepared reply',
            assumptions: [],
            tables: [],
            caveats: [],
            clarification: null,
            findings: [],
        };
        await page.route('**/api/assistant/sql', route => route.fulfill({ json: proposal }));
        await page.route('**/api/assistant/proposals/*/decision', route =>
            route
                .fulfill({
                    json: {
                        ...proposal,
                        decision: 'accepted',
                        decidedAt: '2026-10-11T00:00:01.000Z',
                    },
                })
                .catch(() => undefined),
        );
        await loadHarness(page);
        const state = await page.evaluate(
            change => window.assistantCancellationHarness.acceptAfterChange(change),
            change,
        );
        if (change === 'unmount') {
            expect(state.sql).toEqual(['SELECT 1']);
            expect(state.applied).toBeUndefined();
            expect(state.review).toBe('Needs review');
        } else if (change === 'edit') {
            expect(state.sql).toEqual(['SELECT 3', 'SELECT 2']);
            expect(state.applied).toBe(true);
            expect(state.review).toBe('Applied');
        } else {
            expect(state.sql).toEqual(['SELECT 2']);
            expect(state.applied).toBe(false);
            expect(state.review).toBe('Not applied');
        }
    });
}

for (const mode of ['ask', 'repair', 'run'] as const) {
    test(`Assistant cancellation clears activity before ${mode} context reaches submission`, async ({
        page,
    }) => {
        let submissions = 0;
        await page.route('**/api/assistant/sql', async route => {
            submissions++;
            await route.fulfill({ json: {} });
        });
        await loadHarness(page);
        const state = await page.evaluate(
            mode => window.assistantCancellationHarness.cancelRequest(mode),
            mode,
        );
        expect(state).toEqual({ busy: false, phase: undefined, statuses: ['cancelled'] });
        expect(submissions).toBe(0);
    });
}

for (const mode of ['run', 'ask', 'repair'] as const) {
    test(`Changes during ${mode} preparation preserve the original context and one request per chat`, async ({
        page,
    }) => {
        const submissions: Record<string, unknown>[] = [];
        await page.route('**/api/assistant/sql', async route => {
            const body = jsonRecord(route.request().postDataJSON());
            submissions.push(body);
            await route.fulfill({
                json: {
                    id: 'prepared-proposal',
                    owner: 'local-owner',
                    connectionId: 'assistant-cancellation-test',
                    action: body.action,
                    createdAt: '2026-10-11T00:00:00.000Z',
                    baseSql: body.sql,
                    responseId: 'prepared-response',
                    model: 'fixture',
                    promptVersion: 'test',
                    contextSummary: [],
                    decision: 'pending',
                    sql: 'SELECT 3',
                    summary: 'Prepared reply',
                    assumptions: [],
                    tables: [],
                    caveats: [],
                    clarification: null,
                    findings: [],
                },
            });
        });
        await loadHarness(page);
        const state = await page.evaluate(
            mode => window.assistantCancellationHarness.continueWhilePreparing(mode),
            mode,
        );
        expect(submissions).toHaveLength(1);
        expect(submissions[0]).toMatchObject({ sql: 'SELECT 1', includeRun: mode === 'run' });
        expect(state).toMatchObject({
            busy: false,
            statuses: ['complete'],
            otherChatBusy: false,
            sql: 'SELECT 2',
            originalTurns: [{ contextSql: 'SELECT 1' }],
        });
        if (mode === 'run') {
            expect(submissions[0]).toMatchObject({
                runId: 'selected-run',
                evidenceSql: 'SELECT original_run',
            });
            expect(state.originalTurns[0]).toMatchObject({
                runId: 'selected-run',
                runContext: { evidenceSql: 'SELECT original_run' },
            });
        } else if (mode === 'repair') {
            expect(submissions[0]).toMatchObject({
                action: 'repair',
                repair: { sql: 'SELECT broken()', error: 'Original error' },
            });
        }
    });
}
