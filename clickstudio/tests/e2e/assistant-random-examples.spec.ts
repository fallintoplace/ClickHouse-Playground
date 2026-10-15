import { expect, test } from '@playwright/test';
import { RANDOM_EXAMPLE_PROMPTS } from '../../src/frontend/assistant/proposals/random-example-prompts.js';
import { jsonRecord, trust } from './helpers.js';

for (const mode of ['beginner', 'expert']) {
    test(`${mode} random examples send all twenty topics across new chats before repeating`, async ({
        page,
    }) => {
        await page.addInitScript(() => {
            Math.random = () => 0;
        });
        const questions: unknown[] = [];
        const sampleExamples: unknown[] = [];
        await page.route('**/api/assistant/sql', async route => {
            const body = jsonRecord(route.request().postDataJSON());
            questions.push(body.question);
            sampleExamples.push(body.sampleExample);
            await route.fulfill({
                json: {
                    id: `random-example-${questions.length}`,
                    owner: 'local-owner',
                    connectionId: String(body.connectionId),
                    action: 'ask',
                    createdAt: '2026-10-15T00:00:00.000Z',
                    baseSql: String(body.sql),
                    responseId: `random-response-${questions.length}`,
                    model: 'fixture',
                    promptVersion: 'test',
                    contextSummary: [],
                    decision: 'pending',
                    sql: null,
                    summary: 'Generated a topic example.',
                    assumptions: [],
                    tables: [],
                    caveats: [],
                    clarification: null,
                    findings: [],
                },
            });
        });
        await trust(page, mode);
        await page.getByTestId('open-ai').click();
        const panel = page.getByRole('region', { name: 'Ask AI', exact: true });
        const createExample = panel.getByRole('button', {
            name: 'Create a sample query',
            exact: true,
        });

        for (let index = 0; index < 21; index++) {
            if (index > 0) {
                await panel.getByRole('button', { name: 'New chat', exact: true }).click();
            }
            await createExample.click();
            await expect(
                panel.getByText('Generated a topic example.', { exact: true }),
            ).toBeVisible();
            await expect(panel.locator('.assistant-user-message p')).toHaveText(
                String(questions[index]),
            );
        }

        expect(questions).toHaveLength(21);
        expect(new Set(questions.slice(0, 20))).toEqual(new Set(RANDOM_EXAMPLE_PROMPTS));
        expect(questions[20]).not.toBe(questions[19]);
        expect(sampleExamples).toEqual(Array.from({ length: 21 }, () => true));
        const internalRules = /sample dataset|safe to rerun|adding more sample data/i;
        await expect(panel.locator('.assistant-user-message')).not.toContainText(internalRules);

        await page.reload();
        await page.getByTestId('open-ai').click();
        await expect(panel.locator('.assistant-user-message p')).toHaveText(String(questions[20]));
        const storedChats = await page.evaluate(() =>
            Object.entries(localStorage)
                .filter(([key]) => key.startsWith('clickstudio:assistant-chats:'))
                .map(([, value]) => value)
                .join('\n'),
        );
        expect(storedChats).not.toMatch(internalRules);

        await page
            .getByRole('textbox', { name: 'Ask AI', exact: true })
            .fill('Explain the result.');
        await page.getByRole('button', { name: 'Send', exact: true }).click();
        await expect(panel.locator('.assistant-user-message p').last()).toHaveText(
            'Explain the result.',
        );
        await expect.poll(() => questions.length).toBe(22);
        expect(sampleExamples[21]).toBeUndefined();

        for (const [index, label] of ['Explain this query', 'Optimize this query'].entries()) {
            await panel.getByRole('button', { name: 'New chat', exact: true }).click();
            await panel.getByRole('button', { name: label, exact: true }).click();
            await expect.poll(() => questions.length).toBe(23 + index);
            expect(sampleExamples[22 + index]).toBeUndefined();
            await expect(
                panel.getByText('Generated a topic example.', { exact: true }),
            ).toBeVisible();
        }
    });
}
