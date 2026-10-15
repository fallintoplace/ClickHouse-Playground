import { test, expect } from '@playwright/test';
import { trust } from './helpers.js';

const explainViews = [
    ['run-action-explain', 'Explain indexes'],
    ['run-action-explain-plan', 'Explain plan'],
    ['run-action-explain-pipeline', 'Explain pipeline'],
    ['run-action-explain-analyze', 'Explain analyze'],
] as const;

for (const theme of ['Light', 'Dark']) {
    for (const width of [1600, 900]) {
        test(`${theme} Explain graphs keep compact controls at ${width}px`, async ({
            page,
        }, info) => {
            await page.setViewportSize({ width, height: 1000 });
            await trust(page);
            await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();

            for (const [action, label] of explainViews) {
                await page.getByTestId(action).click();
                await expect(
                    page.getByRole('table', { name: 'Retained query rows' }),
                ).toBeVisible();
                await page.getByRole('tab', { name: label, exact: true }).click();
                const card = page.locator('.is-explain-graph');
                const controls = card.getByRole('group', { name: 'Graph view controls' });
                await expect(controls).toBeVisible();
                await expect(card.locator('.pipeline-graph-heading .eyebrow')).toHaveCount(0);
                await expect(controls.getByRole('button')).toHaveCount(4);
                await expect(controls.getByRole('button', { name: 'Focus node' })).toBeVisible();
                await expect(controls.getByRole('button', { name: 'Fit graph' })).toBeVisible();

                const bounds = await card.evaluate(element => {
                    const rect = (selector: string) =>
                        element.querySelector(selector)!.getBoundingClientRect().toJSON();
                    return {
                        card: element.getBoundingClientRect().toJSON(),
                        toolbar: rect('.pipeline-graph-toolbar'),
                        controls: rect('.pipeline-graph-controls'),
                        viewport: rect('.pipeline-graph-scroll'),
                        buttons: [
                            ...element.querySelectorAll('.pipeline-graph-controls button'),
                        ].map(button => button.getBoundingClientRect().height),
                        heading: element
                            .querySelector('.pipeline-graph-heading')
                            ?.getBoundingClientRect()
                            .toJSON(),
                    };
                });
                expect(bounds.controls.height).toBeLessThanOrEqual(28);
                expect(bounds.buttons.every(height => height <= 28)).toBe(true);
                expect(bounds.controls.left).toBeGreaterThanOrEqual(bounds.card.left);
                expect(bounds.controls.right).toBeLessThanOrEqual(bounds.card.right);
                expect(bounds.viewport.top - bounds.toolbar.bottom).toBeLessThanOrEqual(9);
                expect(bounds.viewport.top - bounds.card.top).toBeLessThan(100);
                if (width === 1600 && bounds.heading) {
                    expect(bounds.controls.top).toBeLessThan(bounds.heading.bottom);
                    expect(bounds.controls.bottom).toBeGreaterThan(bounds.heading.top);
                    expect(bounds.viewport.top - bounds.card.top).toBeLessThan(60);
                }
                const screenshotPath = info.outputPath(`${label}-${theme}-${width}.png`);
                await card.screenshot({ path: screenshotPath });
                await info.attach(`${label}-${theme}-${width}`, {
                    path: screenshotPath,
                    contentType: 'image/png',
                });
            }
        });
    }
}

test('Large Explain pipelines keep the warning below the compact toolbar', async ({
    page,
}, info) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await trust(page);
    const lines = [
        'digraph {',
        ...Array.from({ length: 245 }, (_, index) => `n${index} [label="Operator ${index}"];`),
        ...Array.from({ length: 244 }, (_, index) => `n${index} -> n${index + 1};`),
        '}',
    ];
    await page.route(
        url => url.pathname.endsWith('/snapshot'),
        async route => {
            const response = await route.fetch();
            await route.fulfill({
                response,
                json: {
                    ...(await response.json()),
                    columns: [{ name: 'explain', type: 'String' }],
                    rows: lines.map(line => [line]),
                },
            });
        },
    );
    await page.getByTestId('run-action-explain-pipeline').click();
    await expect(page.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
    await page.getByRole('tab', { name: 'Explain pipeline', exact: true }).click();
    const card = page.locator('.is-explain-graph');
    const warning = card.locator('.pipeline-graph-warning');
    await expect(warning).toHaveText(
        'This plan is large. The graph shows a bounded set of operators.',
    );
    const toolbarBounds = await card.locator('.pipeline-graph-toolbar').boundingBox();
    const warningBounds = await warning.boundingBox();
    const viewportBounds = await card.locator('.pipeline-graph-scroll').boundingBox();
    expect(warningBounds!.height).toBeLessThan(26);
    expect(warningBounds!.y).toBeGreaterThanOrEqual(toolbarBounds!.y + toolbarBounds!.height);
    expect(viewportBounds!.y - warningBounds!.y - warningBounds!.height).toBeLessThanOrEqual(9);
    const screenshotPath = info.outputPath('compact-large-pipeline.png');
    await card.screenshot({ path: screenshotPath });
    await info.attach('compact-large-pipeline', {
        path: screenshotPath,
        contentType: 'image/png',
    });
    await page.setViewportSize({ width: 900, height: 1000 });
    await expect(warning).toBeVisible();
    await expect(card.getByRole('button', { name: 'Fit graph' })).toBeVisible();
    const cardBounds = await card.boundingBox();
    const narrowWarningBounds = await warning.boundingBox();
    expect(narrowWarningBounds!.x + narrowWarningBounds!.width).toBeLessThanOrEqual(
        cardBounds!.x + cardBounds!.width,
    );
});
