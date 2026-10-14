import { expect, test, type Page } from '@playwright/test';
import type { Proposal } from '../../src/shared/assistant/types.js';
import { jsonRecord, trust } from './helpers.js';

type PastedImage = {
    name: string;
    type: string;
    base64?: string;
    size?: number;
};

const pngSignature = 'iVBORw0KGgo=';

async function pasteImages(page: Page, images: readonly PastedImage[]) {
    const input = page.getByRole('textbox', { name: 'Ask AI', exact: true });
    await input.evaluate((element, pastedImages) => {
        const clipboardData = new DataTransfer();
        for (const image of pastedImages) {
            const bytes = image.base64
                ? Uint8Array.from(atob(image.base64), character => character.charCodeAt(0))
                : new Uint8Array(image.size ?? 8);
            clipboardData.items.add(new File([bytes], image.name, { type: image.type }));
        }
        element.dispatchEvent(
            new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData,
            }),
        );
    }, images);
}

function proposalFor(body: Record<string, unknown>): Proposal {
    return {
        id: 'image-paste-answer',
        owner: 'local-owner',
        connectionId: String(body.connectionId ?? 'demo'),
        action: 'ask',
        createdAt: '2026-10-14T00:00:00.000Z',
        baseSql: String(body.sql ?? ''),
        responseId: 'image-paste-response',
        model: 'fixture',
        promptVersion: 'test',
        contextSummary: [],
        decision: 'pending',
        sql: null,
        summary: 'I reviewed the attached screenshots.',
        assumptions: [],
        tables: [],
        caveats: [],
        clarification: null,
        findings: [],
    };
}

async function openAssistant(page: Page) {
    await trust(page);
    await page.getByTestId('open-ai').click();
}

test('Ask AI sends multiple pasted screenshots and stores only their labels in history', async ({
    page,
}) => {
    const requests: Record<string, unknown>[] = [];
    await page.route('**/api/assistant/sql', async route => {
        const body = jsonRecord(route.request().postDataJSON(), 'Assistant request body');
        requests.push(body);
        await route.fulfill({ json: proposalFor(body) });
    });
    await openAssistant(page);
    await pasteImages(page, [
        { name: 'snowflake.png', type: 'image/png', base64: pngSignature },
        { name: 'databricks.png', type: 'image/png', base64: pngSignature },
        { name: 'query-error.png', type: 'image/png', base64: pngSignature },
    ]);

    const composerAttachments = page.getByRole('group', { name: 'Attached images', exact: true });
    await expect(composerAttachments.locator('.assistant-image-chip')).toHaveCount(3);
    await composerAttachments.getByRole('button', { name: 'Remove snowflake.png' }).click();
    await expect(composerAttachments.locator('.assistant-image-chip')).toHaveCount(2);
    await page
        .getByRole('textbox', { name: 'Ask AI', exact: true })
        .fill('Explain these Snowflake and Databricks screenshots.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(
        page.getByText('I reviewed the attached screenshots.', { exact: true }),
    ).toBeVisible();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.question).toBe('Explain these Snowflake and Databricks screenshots.');
    expect(requests[0]?.images).toEqual([
        `data:image/png;base64,${pngSignature}`,
        `data:image/png;base64,${pngSignature}`,
    ]);
    await expect(
        page.locator('.assistant-user-image-attachments .assistant-image-chip'),
    ).toHaveCount(2);
    const storedChats = await page.evaluate(() =>
        Object.entries(localStorage)
            .filter(([key]) => key.startsWith('clickstudio:assistant-chats:'))
            .map(([, value]) => value)
            .join('\n'),
    );
    expect(storedChats).toContain('databricks.png');
    expect(storedChats).not.toContain('data:image/png;base64');
});

test('Ask AI can send an image without a typed question', async ({ page }) => {
    const requests: Record<string, unknown>[] = [];
    await page.route('**/api/assistant/sql', async route => {
        const body = jsonRecord(route.request().postDataJSON(), 'Assistant request body');
        requests.push(body);
        await route.fulfill({ json: proposalFor(body) });
    });
    await openAssistant(page);
    await pasteImages(page, [{ name: 'image.png', type: 'image/png', base64: pngSignature }]);
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(
        page.getByText('I reviewed the attached screenshots.', { exact: true }),
    ).toBeVisible();

    expect(requests[0]?.question).toBe(
        'Please analyze the attached images and explain any relevant SQL, database UI, or error details.',
    );
    expect(requests[0]?.images).toEqual([`data:image/png;base64,${pngSignature}`]);
});

test('Ask AI accepts up to twelve images and rejects a thirteenth', async ({ page }) => {
    await openAssistant(page);
    await pasteImages(
        page,
        Array.from({ length: 12 }, (_, index) => ({
            name: `image-${index + 1}.png`,
            type: 'image/png',
            base64: pngSignature,
        })),
    );
    const group = page.getByRole('group', { name: 'Attached images', exact: true });
    await expect(group.locator('.assistant-image-chip')).toHaveCount(5);
    await expect(group.getByRole('button', { name: '+7 more', exact: true })).toBeVisible();
    await group.getByRole('button', { name: '+7 more', exact: true }).click();
    await expect(group.locator('.assistant-image-chip')).toHaveCount(12);

    await pasteImages(page, [{ name: 'image-13.png', type: 'image/png', base64: pngSignature }]);
    await expect(page.locator('.assistant-composer-area').getByRole('alert')).toHaveText(
        'Attach at most 12 images.',
    );
    await expect(group.locator('.assistant-image-chip')).toHaveCount(12);
});

test('Ask AI rejects unsupported, oversized, and oversized image batches', async ({ page }) => {
    await openAssistant(page);
    const alert = page.locator('.assistant-composer-area').getByRole('alert');
    await pasteImages(page, [{ name: 'animation.gif', type: 'image/gif', base64: pngSignature }]);
    await expect(alert).toHaveText('Paste a PNG, JPEG, or WebP image.');

    await pasteImages(page, [{ name: 'large.png', type: 'image/png', size: 2_000_001 }]);
    await expect(alert).toHaveText('Each image must be at most 2 MB.');

    await pasteImages(
        page,
        Array.from({ length: 4 }, (_, index) => ({
            name: `large-${index + 1}.png`,
            type: 'image/png',
            size: 1_600_001,
        })),
    );
    await expect(alert).toHaveText('Attached images must total at most 6 MB.');
    await expect(page.getByRole('group', { name: 'Attached images', exact: true })).toHaveCount(0);
});
