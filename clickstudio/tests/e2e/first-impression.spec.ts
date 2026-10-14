import { setWorkspaceMode, replaceSql, trust } from './helpers.js';
import { test, expect } from '@playwright/test';

test('Experimental mode keeps Objects and AI primary and moves Reference into More', async ({
    page,
}) => {
    await trust(page);

    const content = page.locator('.workspace-content');
    await expect(content).not.toHaveClass(/has-run/);
    await expect(page.getByRole('region', { name: 'Query results', exact: true })).toHaveCount(0);
    await expect(page.locator('.empty-workspace')).toHaveCount(0);
    const rail = page.locator('.icon-rail');
    const inspector = page.locator('.inspector-pane.is-docked-inspector');
    const workspace = page.locator('.workspace-main');
    await expect(rail).toBeVisible();
    await expect(rail.getByRole('button', { name: 'Objects', exact: true })).toBeVisible();
    await expect(rail.getByRole('button', { name: 'Reference', exact: true })).toHaveCount(0);
    await expect(rail.getByRole('button', { name: 'AI', exact: true })).toBeVisible();
    await expect(inspector).toBeVisible();
    await expect(inspector.locator('.inspector-tabs')).toBeVisible();
    await expect(inspector).toHaveAccessibleName('Objects');
    await expect(inspector.getByRole('button', { name: 'Objects', exact: true })).toBeVisible();
    await expect(inspector.getByRole('button', { name: 'Reference', exact: true })).toHaveCount(0);
    await expect(inspector.getByRole('button', { name: 'AI', exact: true })).toBeVisible();
    await expect(
        inspector.getByRole('button', { name: 'Close inspector', exact: true }),
    ).toBeVisible();

    for (const width of [1280, 1120, 851]) {
        await page.setViewportSize({ width, height: 900 });
        const railBounds = await rail.evaluate(element => element.getBoundingClientRect().toJSON());
        const workspaceBounds = await workspace.evaluate(element =>
            element.getBoundingClientRect().toJSON(),
        );
        const inspectorBounds = await inspector.evaluate(element =>
            element.getBoundingClientRect().toJSON(),
        );
        expect(railBounds.right).toBeLessThanOrEqual(workspaceBounds.left + 1);
        expect(workspaceBounds.right).toBeLessThanOrEqual(inspectorBounds.left + 1);
        expect(inspectorBounds.width).toBeGreaterThanOrEqual(320);
    }

    await page.setViewportSize({ width: 1280, height: 720 });
    const browser = inspector.getByRole('navigation', { name: 'Workspace browser', exact: true });
    await expect(browser.getByRole('button')).toHaveCount(4);
    for (const name of ['Objects', 'AI', 'More workspace panels', 'Close inspector'])
        await expect(browser.getByRole('button', { name, exact: true })).toBeVisible();
    await browser.getByRole('button', { name: 'More workspace panels', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Reference', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Query history', exact: true })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Reference', exact: true }).click();
    await expect(inspector).toHaveAccessibleName('Reference');
    await rail.getByRole('button', { name: 'AI', exact: true }).click();
    await expect(inspector).toHaveAccessibleName('AI');
    await expect(page.locator('.assistant-panel')).toBeVisible();

    await inspector.getByRole('button', { name: 'Close inspector', exact: true }).click();
    await expect(inspector).toHaveCount(0);
    await expect(rail.getByRole('button', { name: 'AI', exact: true })).toHaveAttribute(
        'aria-pressed',
        'false',
    );
    await rail.getByRole('button', { name: 'AI', exact: true }).click();
    await expect(inspector).toBeVisible();
    await expect(inspector).toHaveAccessibleName('AI');

    await inspector.getByRole('button', { name: 'More workspace panels', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Query history', exact: true })).toHaveCount(0);
    await expect(
        page.getByRole('menuitem', { name: 'Version history', exact: true }),
    ).toBeVisible();
    await page.getByRole('menuitem', { name: 'Saved queries', exact: true }).click();
    await expect(inspector).toHaveAccessibleName('Saved queries');
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();
});

test('Standard keeps Objects and AI while preserving execution and saving', async ({ page }) => {
    await trust(page, 'beginner');
    const rail = page.locator('.icon-rail');
    const inspector = page.locator('.inspector-pane.is-docked-inspector');
    const browser = inspector.getByRole('navigation', { name: 'Workspace browser', exact: true });
    const aiTab = browser.getByRole('button', { name: 'AI', exact: true });
    await expect(inspector).toHaveCount(0);
    await expect(page.getByTestId('save-query')).toHaveCount(0);
    await expect(page.locator('.tab-unsaved')).toHaveCount(0);
    await expect(rail.getByRole('button', { name: 'Objects', exact: true })).toBeVisible();
    for (const name of ['Reference', 'AI', 'Query history', 'Saved queries'])
        await expect(rail.getByRole('button', { name, exact: true })).toHaveCount(0);
    await page.locator('.editor-heading').getByTestId('open-ai').click();
    await expect(browser.getByRole('button')).toHaveText(['Objects', 'AI']);
    await expect(aiTab).toHaveAttribute('aria-pressed', 'true');
    await expect(inspector.locator('.assistant-panel')).toBeVisible();
    await expect(inspector.locator('.inspector-tabs')).toHaveCount(0);
    await expect(
        page.getByRole('button', { name: 'More workspace panels', exact: true }),
    ).toHaveCount(0);

    await page.getByTestId('run-button').click();
    await expect(
        page.getByRole('table', { name: 'Retained query rows', exact: true }),
    ).toBeVisible();
    await expect(aiTab).toHaveAttribute('aria-pressed', 'true');
    await expect(inspector.locator('.assistant-panel')).toBeVisible();
    const saved = page.waitForResponse(
        response =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === '/api/documents',
    );
    await expect(page.getByTestId('execution-details')).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+s');
    expect((await saved).ok()).toBe(true);
    const sql = await page.locator('.cm-content').innerText();
    const queryId = await page.locator('.execution-bar').getAttribute('data-query-id');
    await setWorkspaceMode(page, 'Experimental');
    await expect(page.getByTestId('save-query')).toBeVisible();
    await expect(page.getByTestId('execution-details')).toBeVisible();
    await inspector.getByRole('button', { name: 'More workspace panels', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Saved queries', exact: true }).click();
    await expect(inspector.locator('.document-card')).not.toHaveCount(0);
    await setWorkspaceMode(page, 'Standard');
    await expect(inspector).toHaveCount(0);
    await expect(page.getByTestId('save-query')).toHaveCount(0);
    await expect(page.locator('.tab-unsaved')).toHaveCount(0);
    await expect(page.locator('.cm-content')).toHaveText(sql, { useInnerText: true });
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', queryId!);
    await expect(
        page.getByRole('table', { name: 'Retained query rows', exact: true }),
    ).toBeVisible();
    const localSql = 'SELECT 42 AS locally_stored_draft';
    await replaceSql(page, localSql);
    await page.reload();
    await expect(inspector).toHaveCount(0);
    await expect(page.locator('.cm-content')).toHaveText(localSql, { useInnerText: true });
    await expect(page.getByTestId('save-query')).toHaveCount(0);
    await expect(page.locator('.tab-unsaved')).toHaveCount(0);
    await expect(rail.getByRole('button', { name: 'AI', exact: true })).toHaveCount(0);
    await page.locator('.editor-heading').getByTestId('open-ai').click();
    await expect(aiTab).toHaveAttribute('aria-pressed', 'true');
    await expect(inspector.locator('.assistant-panel')).toBeVisible();
    await inspector.getByRole('button', { name: 'Close inspector', exact: true }).click();
    await expect(inspector).toHaveCount(0);
});

for (const panel of ['Objects', 'Reference', 'Saved queries', 'Version history']) {
    test(`Standard preserves the Experimental ${panel} selection`, async ({ page }) => {
        await trust(page);
        const inspector = page.locator('.inspector-pane.is-docked-inspector');
        if (panel === 'Objects')
            await inspector.getByRole('button', { name: panel, exact: true }).click();
        else {
            await inspector
                .getByRole('button', { name: 'More workspace panels', exact: true })
                .click();
            await page.getByRole('menuitem', { name: panel, exact: true }).click();
        }
        await expect(inspector).toHaveAccessibleName(panel);
        const sql = await page.locator('.cm-content').innerText();
        await setWorkspaceMode(page, 'Standard');
        await expect(inspector).toHaveCount(0);
        await expect(
            page.locator('.icon-rail').getByRole('button', { name: 'AI', exact: true }),
        ).toHaveCount(0);
        await page.locator('.editor-heading').getByTestId('open-ai').click();
        const browser = inspector.getByRole('navigation', {
            name: 'Workspace browser',
            exact: true,
        });
        await expect(browser.getByRole('button')).toHaveText(['Objects', 'AI']);
        await expect(browser.getByRole('button', { name: 'AI', exact: true })).toHaveAttribute(
            'aria-pressed',
            'true',
        );
        await expect(inspector.locator('.assistant-panel')).toBeVisible();
        await expect(inspector.locator('.inspector-tabs')).toHaveCount(0);
        await setWorkspaceMode(page, 'Experimental');
        await expect(inspector).toHaveAccessibleName(panel);
        await expect(page.locator('.cm-content')).toHaveText(sql, { useInnerText: true });
    });
}

for (const previousTopic of ['reference', 'monitoring'])
    test(`Standard Help hides Experimental topics after visiting ${previousTopic}`, async ({
        page,
    }, info) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await trust(page);
        const help = page.getByRole('dialog', { name: 'Explore ClickStudio', exact: true });
        const experimentalTopics = [
            'reference',
            'monitoring',
            'query',
            'geo',
            'explain',
            'storage',
            'dependencies',
            'compare',
        ];
        await page.getByRole('button', { name: 'Help', exact: true }).click();
        await expect(help.locator('.workspace-help-tour-experimental')).toBeVisible();
        for (const topic of experimentalTopics)
            await expect(help.getByTestId(`help-section-${topic}`)).toBeVisible();
        await help.getByTestId(`help-section-${previousTopic}`).click();
        await expect(help.locator(`#workspace-help-panel-${previousTopic}`)).toBeVisible();
        if (previousTopic === 'reference')
            await expect(help.getByTestId('reference-search')).toBeVisible();
        await setWorkspaceMode(page, 'Standard');
        await expect(help.locator('.workspace-help-tab strong')).toHaveText([
            'Tour',
            'SQL examples',
            'Query workflows',
            'AI assistant',
        ]);
        await expect(
            help.locator('.workspace-help-tabs-group-label, .workspace-help-tour-experimental'),
        ).toHaveCount(0);
        for (const topic of experimentalTopics) {
            await expect(help.getByTestId(`help-section-${topic}`)).toHaveCount(0);
            await expect(help.locator(`#workspace-help-panel-${topic}`)).toHaveCount(0);
        }
        await expect(help.getByTestId('help-section-tour')).toHaveAttribute(
            'aria-selected',
            'true',
        );
        await expect(help.locator('.workspace-help-feature-card strong')).toHaveText([
            'SQL examples',
            'Query workflows',
            'AI assistant',
        ]);
        await expect(help).not.toContainText(/experimental|EXPLAIN|observability|SQL map/i);
        await page.screenshot({ path: info.outputPath('standard-help.png') });
        await help.getByTestId('help-section-tour').press('End');
        await expect(help.getByTestId('help-section-assistant')).toHaveAttribute(
            'aria-selected',
            'true',
        );
        await expect(help.getByTestId('help-section-assistant')).toBeFocused();
        await help.getByTestId('help-section-assistant').press('ArrowDown');
        await expect(help.getByTestId('help-section-tour')).toHaveAttribute(
            'aria-selected',
            'true',
        );
        await help.getByTestId('help-section-examples').click();
        await expect(help.getByTestId('sql-example-search')).toBeVisible();
        await help.getByTestId('help-section-workflows').click();
        await expect(help.locator('#workspace-help-panel-workflows')).toContainText(
            'Cancel a running query',
        );
        await expect(help).not.toContainText(/experimental|EXPLAIN|SQL map/i);
        await help.getByRole('button', { name: 'Close help', exact: true }).click();
        await setWorkspaceMode(page, 'Experimental');
        await page.getByRole('button', { name: 'Help', exact: true }).click();
        await expect(help.getByTestId('help-section-tour')).toHaveAttribute(
            'aria-selected',
            'true',
        );
        await expect(help.locator('.workspace-help-tour-experimental')).toBeVisible();
        for (const topic of experimentalTopics)
            await expect(help.getByTestId(`help-section-${topic}`)).toBeVisible();
        await help.getByTestId('help-section-workflows').click();
        await expect(help.locator('#workspace-help-panel-workflows')).toContainText(
            'SQL map, or Insights in Experimental mode.',
        );
    });

test('One Run button and the explain actions stay visible in Experimental mode', async ({
    page,
}) => {
    await trust(page);
    const actions = page.getByRole('group', { name: 'Run actions', exact: true });
    const run = page
        .locator('.editor-heading-actions')
        .getByRole('button', { name: 'Run', exact: true });
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toHaveCount(1);
    await expect(run).toBeVisible();
    await expect(actions.getByRole('button', { name: 'Run script', exact: true })).toHaveCount(0);
    await expect(
        actions.getByRole('button', { name: 'EXPLAIN INDEXES', exact: true }),
    ).toBeVisible();
    await expect(actions.getByRole('button', { name: 'EXPLAIN PLAN', exact: true })).toBeVisible();
    await expect(
        actions.getByRole('button', { name: 'EXPLAIN PIPELINE', exact: true }),
    ).toBeVisible();
    await expect(
        actions.getByRole('button', { name: 'EXPLAIN ANALYZE', exact: true }),
    ).toBeVisible();
    await expect(run).toBeEnabled();
    await run.focus();
    await expect(run).toBeFocused();
});

test('EXPLAIN INDEXES opens an interactive index graph and keeps the raw result available', async ({
    page,
}) => {
    await trust(page);
    await page.getByTestId('run-action-explain').click();

    const graph = page.getByRole('region', { name: 'Index pruning graph · Graph', exact: true });
    await expect(graph).toBeVisible();
    await expect(graph.locator('[data-node-id]')).toHaveCount(6);
    await expect(page.locator('.pipeline-graph-heading')).toContainText('4 index checks');

    const bloomIndex = graph.locator('[data-node-id]').filter({ hasText: 'tenant_bloom' });
    await expect(bloomIndex).toBeVisible();
    await bloomIndex.click();
    const inspection = page.locator(
        '.pipeline-node-inspector[aria-label="Selected index details"]',
    );
    await expect(inspection).toContainText('tenant_bloom');
    await expect(inspection).toContainText('Granules');
    await expect(inspection).toContainText('4 / 12');

    const controls = page.getByRole('group', { name: 'Graph view controls', exact: true });
    await controls.getByRole('button', { name: 'Zoom in', exact: true }).click();
    const zoomBeforeEditorFocus = await controls.getByLabel('Zoom level').innerText();
    const selectedId = await graph
        .locator('[data-node-id][aria-pressed="true"]')
        .getAttribute('data-node-id');
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await expect(editor).toBeFocused();
    await expect(graph.locator('[data-node-id][aria-pressed="true"]')).toHaveAttribute(
        'data-node-id',
        selectedId!,
    );
    await expect(controls.getByLabel('Zoom level')).toHaveText(zoomBeforeEditorFocus);

    await page.getByRole('tab', { name: 'Table', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
});

test('EXPLAIN PLAN opens a graph with a tree view and keeps the raw result available', async ({
    page,
}) => {
    await trust(page);
    await page.getByTestId('run-action-explain-plan').click();

    const plan = page.locator('.results-surface[aria-label="Logical query plan"]');
    await expect(plan).toContainText('Expression');
    await expect(plan).toContainText('ReadFromFixture');
    await expect(plan).toContainText('Fixture only; the SQL was not evaluated.');
    await expect(plan.locator('.results-header')).not.toContainText('no runtime measurements');
    await expect(plan.getByRole('button', { name: 'Graph', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
    );
    await expect(page.getByRole('region', { name: 'Logical query plan', exact: true })).toHaveCount(
        1,
    );
    const graph = plan.getByRole('region', { name: 'Logical query plan · Graph', exact: true });
    await expect(graph).toBeVisible();
    const graphNodes = graph.locator('[data-node-id]');
    await expect(graphNodes).toHaveCount(2);
    await expect(graph.locator('[data-node-id][tabindex="0"]')).toHaveCount(1);
    await expect(graph.locator('[data-node-id][tabindex="-1"]')).toHaveCount(1);
    const initiallySelected = graph.locator('[data-node-id][aria-pressed="true"]');
    const initialNodeId = await initiallySelected.getAttribute('data-node-id');
    expect(initialNodeId).not.toBeNull();
    await initiallySelected.focus();
    await page.keyboard.press('ArrowDown');
    const keyboardSelected = graph.locator('[data-node-id][aria-pressed="true"]');
    await expect(keyboardSelected).not.toHaveAttribute('data-node-id', initialNodeId!);
    await expect(keyboardSelected).toBeFocused();

    const controls = plan.getByRole('group', { name: 'Graph view controls', exact: true });
    await controls.getByRole('button', { name: 'Zoom in', exact: true }).click();
    const zoomBeforeEditorFocus = await controls.getByLabel('Zoom level').innerText();
    const selectedNodeId = await keyboardSelected.getAttribute('data-node-id');
    expect(selectedNodeId).not.toBeNull();
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await expect(editor).toBeFocused();
    await expect(graph.locator('[data-node-id][aria-pressed="true"]')).toHaveAttribute(
        'data-node-id',
        selectedNodeId!,
    );
    await expect(controls.getByLabel('Zoom level')).toHaveText(zoomBeforeEditorFocus);

    await expect(plan.locator('.results-plan-controls > strong')).toBeVisible();
    const headingHeight = await plan
        .locator('.results-plan-controls')
        .evaluate(element => element.getBoundingClientRect().height);
    expect(headingHeight).toBeLessThan(56);
    await plan.getByRole('button', { name: 'Tree', exact: true }).click();
    await expect(plan.locator('.explain-plan-tree')).toBeVisible();
    await plan.getByRole('button', { name: 'Graph', exact: true }).click();
    await expect(
        plan.getByRole('region', { name: 'Logical query plan · Graph', exact: true }),
    ).toBeVisible();

    await page.getByRole('tab', { name: 'Table', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
});

test('EXPLAIN ANALYZE opens a measured runtime graph and retains the raw result', async ({
    page,
}) => {
    await trust(page);
    await page.getByTestId('run-action-explain-analyze').click();

    const runtime = page.locator('.results-surface[aria-label="Runtime"]');
    await expect(runtime.locator('.runtime-summary-grid')).toContainText('31.42 ms');
    await expect(runtime.locator('.runtime-summary-grid')).toContainText('29.34 ms');
    const graph = runtime.getByRole('region', { name: 'Runtime · Graph', exact: true });
    await expect(graph).toBeVisible();
    await expect(graph.locator('[data-node-id]')).toHaveCount(5);
    await expect(graph).toContainText('ReadFromMergeTree');

    const read = graph.locator('[data-node-id]').filter({ hasText: 'ReadFromMergeTree' });
    await read.click();
    const inspection = runtime.locator('.pipeline-node-inspector');
    await expect(inspection).toContainText('ReadFromMergeTree');
    await expect(inspection).toContainText('1.24 million');
    await expect(inspection).toContainText('87.6%');

    await page.getByRole('tab', { name: 'Table', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
});

test('EXPLAIN PIPELINE opens an interactive ClickHouse operator graph', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 644 });
    await trust(page);
    await page.getByTestId('run-action-explain-pipeline').click();

    const graph = page.getByRole('region', { name: 'Scrollable operator graph', exact: true });
    const controls = page.getByRole('group', { name: 'Graph view controls', exact: true });
    const initiallySelected = graph.locator('[data-node-id][aria-pressed="true"]');
    await expect(initiallySelected).toBeVisible();
    const selectedIsInGraphViewport = await graph.evaluate(element => {
        const selectedNode = element.querySelector('[data-node-id][aria-pressed="true"]');
        if (!selectedNode) return false;
        const viewport = element.getBoundingClientRect();
        const node = selectedNode.getBoundingClientRect();
        return (
            node.right > viewport.left &&
            node.left < viewport.right &&
            node.bottom > viewport.top &&
            node.top < viewport.bottom
        );
    });
    expect(selectedIsInGraphViewport).toBe(true);
    const filter = graph.locator('[data-node-id]').filter({ hasText: 'FilterTransform' });
    await expect(filter).toBeVisible();
    await filter.click();
    await expect(page.locator('.pipeline-node-inspector')).toContainText('FilterTransform');
    await expect(page.locator('.pipeline-node-inspector')).toContainText('planned');

    const graphMetrics = await graph.evaluate(element => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
    }));
    expect(graphMetrics.scrollHeight).toBeGreaterThan(graphMetrics.clientHeight);
    const lastNode = graph.locator('[data-node-id]').last();
    await graph.evaluate(element => {
        element.scrollTop = element.scrollHeight;
    });
    await expect(lastNode).toBeInViewport();

    const svg = graph.locator('svg');
    const initialWidth = Number(await svg.getAttribute('width'));
    await controls.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect
        .poll(async () => Number(await svg.getAttribute('width')))
        .toBeGreaterThan(initialWidth);
    await controls.getByRole('button', { name: 'Focus node', exact: true }).click();
    await expect(controls.getByLabel('Zoom level')).toHaveText('100%');
    await controls.getByRole('button', { name: 'Fit graph', exact: true }).click();
    await expect(controls.getByLabel('Zoom level')).not.toHaveText('100%');

    const resultsContent = page.locator('#query-results-content');
    const resultsMetrics = await resultsContent.evaluate(element => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
    }));
    expect(resultsMetrics.scrollHeight).toBeGreaterThan(resultsMetrics.clientHeight);
    await resultsContent.evaluate(element => {
        element.scrollTop = element.scrollHeight;
    });
    await expect(page.locator('.pipeline-node-inspector')).toBeInViewport();

    const zoomBeforeEditorFocus = await controls.getByLabel('Zoom level').innerText();
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await expect(editor).toBeFocused();
    await expect(filter).toHaveAttribute('aria-pressed', 'true');
    await expect(controls.getByLabel('Zoom level')).toHaveText(zoomBeforeEditorFocus);
});

test('Reference stays in More while Objects and AI stay primary', async ({ page }) => {
    await trust(page);
    await page.getByRole('button', { name: 'More workspace panels', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Reference', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Query history', exact: true })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Reference', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Reference', exact: true })).toBeVisible();

    await page.locator('.icon-rail').getByRole('button', { name: 'AI', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'AI', exact: true })).toBeVisible();
    await expect(page.locator('.assistant-panel')).toBeVisible();
    await expect(page.locator('.cm-content')).toContainText('SELECT');
});
