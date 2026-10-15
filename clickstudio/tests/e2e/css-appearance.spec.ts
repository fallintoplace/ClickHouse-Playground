import { functionsWorkspace } from './sql-functions-helpers.js';
import {
    arrayValue,
    jsonRecord,
    setWorkspaceMode,
    openSqlExamples,
    replaceSql,
    runButton,
    runScript,
    trust,
    trustCurrentConnection,
    openStatementResults,
} from './helpers.js';
import { test, expect } from '@playwright/test';
import type { Script } from '../../src/shared/queries/execution/types.js';
import type { QueryDocument } from '../../src/shared/queries/saved-queries/types.js';
import {
    chooseExistingTable,
    mockWritableWorkspace,
    previewCsv,
    chooseImportOption,
} from './import-helpers.js';
import {
    chooseExistingCloudTable,
    connectPreviewCloud,
    mockCloudEndpoint,
} from './cloud-import-helpers.js';
import { expectReferenceStyles } from './style-reference.js';

test.beforeEach(async ({ page }) => {
    test.setTimeout(90000);
    await page.clock.setFixedTime(new Date('2026-10-10T10:00:00Z'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
});

for (const theme of ['Light', 'Dark']) {
    test(`CSS preserves ${theme} materialized view preparation`, async ({ page }, info) => {
        await trust(page);
        await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
        await runButton(page).click();
        const trigger = page.getByRole('button', { name: 'Result actions', exact: true });
        await trigger.click();
        const menu = page.getByRole('menu', { name: 'Result actions', exact: true });
        await expectReferenceStyles(page, info, 'materialized-view-menu', menu);
        await menu.getByRole('menuitem', { name: 'Create materialized view' }).click();
        const dialog = page.getByRole('dialog', { name: 'Create materialized view', exact: true });
        await dialog.getByRole('textbox', { name: 'View name' }).fill('daily_totals_mv');
        for (const width of [1280, 900]) {
            await page.setViewportSize({ width, height: 800 });
            await expectReferenceStyles(page, info, `materialized-view-${width}`, dialog);
            await dialog.screenshot({ path: info.outputPath(`materialized-view-${width}.png`) });
        }
    });

    for (const mode of ['Standard', 'Experimental'])
        test(`CSS preserves ${theme} ${mode} SQL examples without search autofocus`, async ({
            page,
        }, info) => {
            await trust(page, mode);
            await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
            const dialog = await openSqlExamples(page);
            await expect(dialog.getByRole('searchbox')).toHaveCount(0);
            await expect(dialog.locator('button:focus, input:focus')).toHaveCount(0);
            await expect(dialog).toHaveCSS('outline-style', 'none');
            await page.keyboard.press('Escape');
            await expect(dialog).toHaveCount(0);
            await page.getByRole('button', { name: 'Help', exact: true }).press('Enter');
            await expect(dialog).toBeVisible();
            await expect(dialog.locator('button:focus, input:focus')).toHaveCount(0);
            await expect(dialog).toHaveCSS('outline-style', 'none');
            for (const width of [1440, 700]) {
                await page.setViewportSize({ width, height: 900 });
                await expectReferenceStyles(page, info, `sql-examples-${mode}-${width}`, dialog);
                await dialog.screenshot({
                    path: info.outputPath(`sql-examples-${mode}-${width}.png`),
                });
            }
        });

    test(`CSS preserves ${theme} rich statement result menus`, async ({ page }, info) => {
        await trust(page);
        await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
        await replaceSql(
            page,
            'SELECT trip_distance, fare_amount FROM trips WHERE trip_distance > 5; SELECT 2;',
        );
        await runScript(page);
        await expect(page.locator('.script-results-trigger .script-statement-index')).toHaveClass(
            /status-succeeded/,
        );
        await expect(page.locator('.script-running-results')).toHaveCount(0);
        const results = page.getByRole('region', { name: 'Query results', exact: true });
        for (const mode of ['Standard', 'Experimental']) {
            await setWorkspaceMode(page, mode);
            for (const width of [1440, 360]) {
                await page.setViewportSize({ width, height: 900 });
                const menu = await openStatementResults(results);
                await expect(menu.locator('.script-statement-notice')).toHaveText([
                    '1 warning',
                    '1 warning',
                ]);
                await page.keyboard.press('Home');
                await expectReferenceStyles(page, info, `statement-menu-${mode}-${width}`, menu);
                await menu.screenshot({
                    path: info.outputPath(`statement-menu-${mode}-${width}.png`),
                });
                await page.keyboard.press('Escape');
            }
        }
    });
    for (const mode of ['Standard', 'Experimental'])
        test(`CSS preserves ${theme} ${mode} Geography map fitting`, async ({ page }, info) => {
            await trust(page, mode);
            await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
            const dialog = await openSqlExamples(page);
            await dialog.getByTestId('sql-example-category-all').click();
            await dialog.getByTestId('sql-example-nyc-taxi-after-dark').click();
            await dialog.getByTestId('run-sql-example').click();
            const stage = page.locator('.geo-stage');
            await expect(stage.locator('.geo-feature.is-area')).toHaveCount(96);
            await expect(stage.locator('.geo-borough')).toHaveCount(5);
            await expect(stage.locator('.geo-context-labels')).toContainText('Manhattan');
            const workspace = page.locator('.geo-workspace-frame');
            for (const width of [1440, 900]) {
                await page.setViewportSize({ width, height: 1000 });
                await expectReferenceStyles(page, info, `geography-${width}`, workspace);
                await workspace.screenshot({ path: info.outputPath(`geography-${width}.png`) });
            }
        });

    test(`CSS preserves ${theme} unsaved query version history`, async ({ page }, info) => {
        await trust(page);
        await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
        await page.getByRole('button', { name: 'More workspace panels', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Version history', exact: true }).click();
        const section = page.locator('.revision-history-section');
        await expect(section.getByRole('alert')).toHaveCount(0);
        await expect(
            section.getByRole('button', { name: 'Save query', exact: true }),
        ).toBeEnabled();
        for (const width of [1600, 900]) {
            await page.setViewportSize({ width, height: 900 });
            await expectReferenceStyles(page, info, `unsaved-versions-${width}`, section);
            if (width === 1600)
                await section.screenshot({ path: info.outputPath('unsaved-versions-preview.png') });
        }
        await page.locator('.inspector-pane').evaluate(element => {
            element.setAttribute('style', 'flex: 0 0 230px; width: 230px');
        });
        expect(await section.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(
            true,
        );
        const save = section.getByRole('button', { name: 'Save query', exact: true });
        await save.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        await expect(save).toBeFocused();
        expect(await save.evaluate(element => element.matches(':focus-visible'))).toBe(true);
        await expectReferenceStyles(page, info, 'unsaved-versions-narrow-focus', section);
    });

    test(`CSS preserves ${theme} saved queries and centered current versions`, async ({
        page,
    }, info) => {
        const latest: QueryDocument = {
            id: 'panel-query',
            owner: 'local-owner',
            connectionId: 'demo',
            name: 'Country totals grouped by continent with a long saved query name',
            sql: `-- Country totals\nSELECT ${'country_name, '.repeat(20)}total_area\nFROM countries;`,
            revision: 1000,
            createdAt: '2026-10-09T10:00:00Z',
            updatedAt: '2026-10-10T10:00:00Z',
            parameters: {},
            chart: { kind: 'table', x: 0, ys: [], title: 'Query result' },
            dependencies: [],
            kind: 'query',
        };
        const previous = { ...latest, revision: 999, sql: 'SELECT 1 AS previous_version;' };
        let documentReads = 0;
        await page.route(
            url => url.pathname === '/api/documents',
            route => {
                documentReads++;
                return route.fulfill({
                    json: [latest, { ...latest, id: 'daily-revenue', name: 'Daily revenue' }],
                });
            },
        );
        await page.route('**/api/documents/panel-query', route => route.fulfill({ json: latest }));
        await page.route('**/api/documents/panel-query/revisions', route =>
            route.fulfill({ json: [latest, previous] }),
        );
        await trust(page);
        await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
        const inspector = page.locator('.inspector-pane');
        const more = inspector.getByRole('button', {
            name: 'More workspace panels',
            exact: true,
        });
        await more.focus();
        await page.keyboard.press('Enter');
        await expect(more).toHaveAttribute('aria-expanded', 'true');
        await expect(more.locator('svg')).toHaveCSS('transform', 'matrix(-1, 0, 0, -1, 0, 0)');
        await expectReferenceStyles(page, info, 'more-menu-open', inspector);
        await page.keyboard.press('Escape');
        await expect(more).toBeFocused();
        await expect(more).toHaveAttribute('aria-expanded', 'false');
        await expect(more.locator('svg')).toHaveCSS('transform', 'none');
        await expectReferenceStyles(page, info, 'more-button-focus', inspector);
        const openPanel = async (name: string) => {
            await more.click();
            await page.getByRole('menuitem', { name, exact: true }).click();
        };
        await openPanel('Saved queries');
        const refreshDocuments = inspector.getByRole('button', {
            name: 'Refresh saved queries',
            exact: true,
        });
        await expect(refreshDocuments).toHaveText('');
        await expect(refreshDocuments.locator('svg')).toBeVisible();
        const initialReads = documentReads;
        await refreshDocuments.click();
        await expect.poll(() => documentReads).toBeGreaterThan(initialReads);
        for (const width of [1600, 900]) {
            await page.setViewportSize({ width, height: 900 });
            await expectReferenceStyles(page, info, `saved-queries-${width}`, inspector);
        }
        await inspector.locator('.document-card').first().click();
        await expect(page.locator('.cm-content')).toContainText('Country totals');
        await openPanel('Version history');
        const current = inspector.getByRole('button', { name: /Version 1000/ });
        await expect(current).toHaveAttribute('aria-pressed', 'true');
        const refreshVersions = inspector.getByRole('button', {
            name: 'Refresh versions',
            exact: true,
        });
        await expect(refreshVersions).toHaveText('');
        await expect(refreshVersions.locator('svg')).toBeVisible();
        for (const width of [1600, 900]) {
            await page.setViewportSize({ width, height: 900 });
            const rowBounds = await current.boundingBox();
            const badgeBounds = await current.locator('.revision-item-current').boundingBox();
            expect(rowBounds).not.toBeNull();
            expect(badgeBounds).not.toBeNull();
            expect(
                Math.abs(
                    badgeBounds!.y +
                        badgeBounds!.height / 2 -
                        (rowBounds!.y + rowBounds!.height / 2),
                ),
            ).toBeLessThanOrEqual(1);
            expect(
                await inspector
                    .locator('.revision-history-section')
                    .evaluate(element => element.scrollWidth <= element.clientWidth),
            ).toBe(true);
            await expectReferenceStyles(page, info, `query-versions-${width}`, inspector);
        }
        await inspector.getByRole('button', { name: /Version 999/ }).click();
        await expect(inspector.locator('.revision-preview pre')).toHaveText(previous.sql);
        await expect(inspector.getByRole('button', { name: 'Restore', exact: true })).toBeEnabled();

        let releaseRefresh = () => {};
        const pendingRefresh = new Promise<void>(resolve => {
            releaseRefresh = resolve;
        });
        await page.route('**/api/documents/panel-query/revisions', async route => {
            await pendingRefresh;
            await route.fulfill({ json: [latest, previous] });
        });
        try {
            await refreshVersions.click();
            const refreshing = inspector.getByRole('button', {
                name: 'Refreshing versions',
                exact: true,
            });
            await expect(refreshing).toBeDisabled();
            await expect(refreshing).toHaveAttribute('aria-busy', 'true');
            await expect(refreshing.locator('.loading-orbit')).toBeVisible();
        } finally {
            releaseRefresh();
        }
        await expect(refreshVersions).toBeEnabled();
        await expect(current).toBeVisible();
        await refreshVersions.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        await expect(refreshVersions).toBeFocused();
        expect(await refreshVersions.evaluate(element => element.matches(':focus-visible'))).toBe(
            true,
        );
        await expectReferenceStyles(page, info, 'query-versions-focus', inspector);
    });

    test(`CSS preserves ${theme} Run details`, async ({ page }, info) => {
        const reason = 'Query-log profiling is not enabled for this connection.';
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.route(
            url => url.pathname === '/api/connections',
            async route => {
                const response = await route.fetch();
                const connections = arrayValue(await response.json(), 'Connections');
                await route.fulfill({
                    response,
                    json: connections.map(value => {
                        const connection = jsonRecord(value, 'Connection');
                        const manifest = jsonRecord(
                            connection.manifest ?? {},
                            'Connection manifest',
                        );
                        return {
                            ...connection,
                            manifest: { ...manifest, queryLog: { available: false, reason } },
                        };
                    }),
                });
            },
        );
        await page.goto('/experimental');
        await expect(page.locator('.connection-trigger')).toBeVisible({ timeout: 15000 });
        await trustCurrentConnection(page);
        await expect(runButton(page)).toBeEnabled();
        await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
        await runButton(page).click();
        await expect(page.locator('.execution-bar')).toHaveAttribute(
            'data-run-status',
            'succeeded',
        );
        await page.getByTestId('execution-details').click();

        const inspector = page.locator('.inspector-pane');
        await expect(inspector.locator('.run-detail-note')).toContainText(reason);
        await expect(inspector.locator('.run-metric > span')).toHaveText([
            'Duration',
            'Rows returned',
        ]);
        for (const width of [1600, 900]) {
            await page.setViewportSize({ width, height: 900 });
            const summary = await inspector.locator('.run-detail-hero').boundingBox();
            const status = await inspector.locator('.run-detail-status').boundingBox();
            expect(summary).not.toBeNull();
            expect(status).not.toBeNull();
            expect(
                Math.abs(status!.y + status!.height / 2 - (summary!.y + summary!.height / 2)),
            ).toBeLessThanOrEqual(1);
            await expectReferenceStyles(page, info, `run-details-${width}`, inspector);
            if (width === 1600)
                await inspector.locator('.run-details-section').screenshot({
                    path: info.outputPath('run-details-preview.png'),
                });
        }
        await inspector.evaluate(element => {
            element.setAttribute('style', 'flex: 0 0 230px; width: 230px');
        });
        expect(
            await inspector
                .locator('.inspector-content')
                .evaluate(element => element.scrollWidth <= element.clientWidth),
        ).toBe(true);
        await expectReferenceStyles(page, info, 'run-details-narrow', inspector);
        const copyId = inspector.getByRole('button', { name: 'Copy query ID', exact: true });
        await copyId.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        await expect(copyId).toBeFocused();
        expect(await copyId.evaluate(element => element.matches(':focus-visible'))).toBe(true);
        await expectReferenceStyles(page, info, 'run-details-copy-focus', inspector);
        await page.unrouteAll({ behavior: 'wait' });
    });

    for (const mode of [theme === 'Light' ? 'Standard' : 'Experimental']) {
        test(`CSS preserves ${theme}, theme accent, ${mode} workspace layouts`, async ({
            page,
        }, info) => {
            await page.setViewportSize({ width: 1600, height: 1000 });
            await trust(page);
            await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
            await setWorkspaceMode(page, mode);
            await expectReferenceStyles(page, info, 'empty-workspace');
            if (mode === 'Standard') await setWorkspaceMode(page, 'Experimental');
            const inspector = page.locator('.inspector-pane');
            if (!(await inspector.isVisible()))
                await page
                    .locator('.icon-rail')
                    .getByRole('button', { name: 'Objects', exact: true })
                    .click();
            await inspector
                .getByRole('button', { name: 'More workspace panels', exact: true })
                .click();
            await page.getByRole('menuitem', { name: 'Reference', exact: true }).click();
            const reference = inspector.locator('.reference-results');
            await expect(reference).toBeVisible();
            await expectReferenceStyles(page, info, 'reference-list');
            await reference.getByRole('option').first().click();
            await expect(inspector.locator('.reference-entry')).toBeVisible();
            await expectReferenceStyles(page, info, 'reference-details');
            await inspector.locator('.reference-back').click();
            await inspector
                .getByRole('navigation', { name: 'Workspace browser', exact: true })
                .getByRole('button', { name: 'Objects', exact: true })
                .click();
            await expect(
                inspector.locator('.object-tree-row.is-database .object-kind-glyph').first(),
            ).toHaveCSS('color', theme === 'Dark' ? 'rgb(250, 255, 105)' : 'rgb(98, 55, 25)');
            await inspector.getByText('events', { exact: true }).first().click();
            await expect(inspector.getByLabel('Selected object')).toBeVisible();
            await expectReferenceStyles(page, info, 'object-details');
            await inspector.locator('.object-back-button').click();
            if (mode === 'Standard') await setWorkspaceMode(page, mode);
            await runButton(page).click();
            await expect(page.locator('.execution-bar')).toHaveAttribute(
                'data-run-status',
                'succeeded',
            );
            await expectReferenceStyles(page, info, 'query-results');
            if (mode === 'Experimental') {
                await page.getByRole('button', { name: 'Collapse SQL query', exact: true }).click();
                await expectReferenceStyles(page, info, 'collapsed-query');
            } else {
                await expect(page.locator('.panel-collapse-button')).toHaveCount(0);
                await expect(page.locator('#sql-editor-content')).toBeVisible();
                await expectReferenceStyles(page, info, 'expanded-query');
            }
            await page.route(
                url => url.pathname.endsWith('/result'),
                async route => {
                    const response = await route.fetch();
                    await route.fulfill({
                        response,
                        json: {
                            ...(await response.json()),
                            columns: [{ name: 'label', type: 'String' }],
                            rows: Array.from({ length: 200 }, (_, index) => [`row-${index}`]),
                            totalRows: 240,
                            offset: 0,
                            nextOffset: 200,
                        },
                    });
                },
            );
            await runButton(page).click();
            await expect(page.locator('.result-pages-toggle')).toBeVisible();
            await expect(page.locator('.results-header .result-row-count')).toHaveText('240 rows');
            await expectReferenceStyles(page, info, 'paged-results');
            await page.locator('.result-pages-toggle').click();
            await expect(
                page.getByRole('dialog', { name: 'Search & pages', exact: true }),
            ).toBeVisible();
            await expectReferenceStyles(page, info, 'floating-table-controls');
            await page.keyboard.press('Escape');
            await page.setViewportSize({ width: 900, height: 740 });
            await expectReferenceStyles(page, info, 'responsive-900');
            await page.setViewportSize({ width: 1440, height: 1000 });
            const results = page.getByRole('region', { name: 'Query results', exact: true });
            await results.getByRole('tab', { name: 'Chart', exact: true }).click();
            await expect(results.locator('.chart-toolbar')).toBeVisible();
            await expectReferenceStyles(page, info, 'compact-chart');
            await expect(
                results.getByRole('button', { name: 'Measures', exact: true }),
            ).toHaveCount(0);
            await expect(
                results.getByRole('button', { name: 'Chart details', exact: true }),
            ).toHaveCount(0);
            await page.getByTestId('open-ai').click();
            await expect(page.getByRole('textbox', { name: 'Ask AI', exact: true })).toBeVisible();
            await expect(page.locator('.assistant-context-meta')).toHaveCount(0);
            await expectReferenceStyles(page, info, 'assistant-composer');
            const question = page.getByRole('textbox', { name: 'Ask AI', exact: true });
            const composer = page.locator('.assistant-chat-composer');
            await question.fill('Explain this query\nKeep the answer concise');
            await expectReferenceStyles(page, info, 'assistant-composer-focused', composer);
            await question.fill(
                Array.from({ length: 20 }, () => 'A long pasted message').join('\n'),
            );
            await expectReferenceStyles(page, info, 'assistant-composer-capped', composer);
            await question.fill('');
            await page.getByRole('button', { name: /^Chat history:/ }).click();
            const chatHistory = page.getByRole('region', { name: 'Chat history', exact: true });
            await expectReferenceStyles(page, info, 'assistant-chat-history', chatHistory);
            await chatHistory.getByRole('button', { name: 'Rename New chat', exact: true }).click();
            await expectReferenceStyles(page, info, 'assistant-chat-rename', chatHistory);
        });
    }

    test(`CSS preserves ${theme} running script cards below the unchanged header`, async ({
        page,
    }, info) => {
        await trust(page);
        await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
        const statements = [
            'SELECT 1 AS a_long_column_name_that_should_stay_inside_the_statement_card',
            'SELECT 2',
            'SELECT 3',
        ];
        const script: Script = {
            id: 'running-style-script',
            owner: 'style-owner',
            connectionId: 'demo',
            sql: statements.join('; '),
            createdAt: '2026-10-10T10:00:00Z',
            status: 'running',
            stopOnError: true,
            cancelled: false,
            statements: statements.map((sql, index) => ({
                sql,
                from: 0,
                to: sql.length,
                status: index === 0 ? 'running' : 'pending',
            })),
        };
        await page.route('**/api/scripts', route => route.fulfill({ status: 202, json: script }));
        await page.route('**/api/scripts/running-style-script', route =>
            route.fulfill({ json: script }),
        );
        await replaceSql(page, script.sql);
        await runScript(page);
        const results = page.getByRole('region', { name: 'Query results', exact: true });
        await expect(results.locator('.script-statement-list > button')).toHaveCount(3);
        for (const width of [1440, 761]) {
            await page.setViewportSize({ width, height: 900 });
            await expectReferenceStyles(page, info, `running-cards-${width}`, results);
        }
    });

    test(`CSS preserves ${theme}, theme accent help and native explorers`, async ({
        page,
    }, info) => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await trust(page);
        await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
        await page.getByRole('button', { name: 'Help', exact: true }).click();
        const help = page.getByRole('dialog', { name: 'Explore ClickStudio', exact: true });
        for (const section of [
            'tour',
            'assistant',
            'query',
            'storage',
            'dependencies',
            'compare',
        ]) {
            await help.getByTestId(`help-section-${section}`).click();
            await expect(help.getByTestId(`help-section-${section}`)).toHaveAttribute(
                'aria-selected',
                'true',
            );
            await expectReferenceStyles(page, info, `help-${section}`);
        }
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'View dependencies', exact: true }).click();
        const lineage = page.getByRole('dialog', {
            name: 'Materialized view dependencies',
            exact: true,
        });
        await expect(lineage.locator('.native-lineage-canvas')).toBeVisible();
        await expect(
            lineage.getByRole('button', { name: 'Refresh metadata', exact: true }),
        ).toBeEnabled();
        await expectReferenceStyles(page, info, 'native-dependencies');
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'events MergeTree', exact: true }).click();
        await page.getByRole('button', { name: 'Visualize parts', exact: true }).click();
        const storage = page.getByRole('dialog', { name: 'MergeTree parts', exact: true });
        for (const section of ['Parts', 'Merges', 'Mutations']) {
            await storage.getByRole('button', { name: section, exact: true }).click();
            if (section === 'Parts')
                await expect(storage.locator('.parts-graph-viewport')).toBeVisible();
            else {
                await expect(storage.locator('.native-snapshot-meta time')).toHaveAttribute(
                    'datetime',
                    /\d{4}-\d{2}-\d{2}/,
                );
                await expect(
                    storage.getByRole('button', { name: 'Refresh', exact: true }),
                ).toBeEnabled();
            }
            await expectReferenceStyles(page, info, `native-${section}`);
        }
        await storage.getByRole('button', { name: 'Close', exact: true }).click();
    });

    test(`CSS preserves ${theme}, theme accent Cloud import destinations`, async ({
        page,
    }, info) => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await mockWritableWorkspace(page);
        await mockCloudEndpoint(page);
        await connectPreviewCloud(page);
        await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
        await page.getByRole('button', { name: 'Import', exact: true }).last().click();
        const dialog = await previewCsv(page);
        await expect(dialog.locator('.import-destination-choice')).toBeVisible();
        const compareStyles = (state: string) => expectReferenceStyles(page, info, `${state}-1440`);
        await compareStyles('cloud-choose-table');
        await chooseExistingCloudTable(dialog);
        await expect(
            dialog.getByRole('combobox', { name: 'Map day to destination', exact: true }),
        ).toHaveAttribute('data-value', 'day');
        await compareStyles('cloud-existing-table');
        const mappingSelect = dialog.getByRole('combobox', {
            name: 'Map day to destination',
            exact: true,
        });
        await mappingSelect.click();
        await expect(
            dialog.getByRole('searchbox', { name: 'Search map day to destination' }),
        ).toBeFocused();
        await compareStyles('cloud-mapping-options');
        await page.screenshot({ path: info.outputPath('cloud-mapping-selector.png') });
        await page.keyboard.press('Escape');
        await dialog.getByRole('radio', { name: /Create a table/ }).check();
        await dialog.getByLabel('New table name').fill('imported_events');
        await expect(
            dialog.getByRole('combobox', { name: 'Type for day', exact: true }),
        ).toHaveAttribute('data-value', 'Date');
        await compareStyles('cloud-create-table');
        await dialog.getByRole('combobox', { name: 'Type for day', exact: true }).click();
        const typeSearch = dialog.getByRole('searchbox', { name: 'Search type for day' });
        await expect(typeSearch).toBeFocused();
        await expect(typeSearch).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await compareStyles('cloud-type-options');
        await page.screenshot({ path: info.outputPath('cloud-type-selector.png') });
        await page.keyboard.press('Escape');
        await dialog.getByRole('button', { name: 'Review import', exact: true }).click();
        await expect(
            dialog.getByRole('heading', {
                name: 'Ready to import into default.imported_events',
            }),
        ).toBeVisible();
        await compareStyles('cloud-review');
        await dialog.getByRole('button', { name: 'Create table and import', exact: true }).click();
        await expect(dialog).toContainText('2 source rows processed successfully');
        await compareStyles('cloud-success');
    });

    test(`CSS preserves ${theme}, theme accent import states on desktop`, async ({
        page,
    }, info) => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await mockWritableWorkspace(page);
        await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
        const rows = [
            { day: '2026-01-01', events: '10' },
            { day: '2026-01-02', events: '20' },
        ];
        await page.route('**/api/imports/preview', route =>
            route.fulfill({
                status: 201,
                json: {
                    id: 'input-1',
                    name: 'events.csv',
                    format: 'csv',
                    columns: ['day', 'events'],
                    rows,
                    rowCount: 2,
                },
            }),
        );
        await page.route('**/api/imports/input-1/mapping', route =>
            route.fulfill({
                json: {
                    id: 'mapping-1',
                    inputId: 'input-1',
                    connectionId: 'live',
                    table: 'demo.events',
                    fields: { day: 'day', events: 'events' },
                    rows,
                    rowCount: 2,
                },
            }),
        );
        await page.route('**/api/imports/mapping-1/commit', route =>
            route.fulfill({
                json: {
                    id: 'mapping-1',
                    table: 'demo.events',
                    rows: 2,
                    status: 'succeeded',
                },
            }),
        );
        await page.getByRole('button', { name: 'Import', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Import data', exact: true });
        const compareStyles = (state: string) => expectReferenceStyles(page, info, `${state}-1440`);
        await compareStyles('file');
        await dialog.locator('.import-file-picker').hover();
        await expectReferenceStyles(page, info, 'file-hover', page, false);
        await dialog.locator('.import-kind-button.is-query').click();
        await dialog.getByLabel('Choose a SQL query file').focus();
        await compareStyles('sql-file-focus');
        await dialog.getByLabel('Choose a SQL query file').setInputFiles({
            name: 'notes.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('notes'),
        });
        await expect(dialog.getByRole('alert')).toBeVisible();
        await compareStyles('sql-file-error');
        await dialog.locator('.import-kind-button').first().click();
        await previewCsv(page);
        await compareStyles('mapping-disabled');
        await chooseExistingTable(dialog);
        const day = dialog.getByRole('combobox', { name: 'Map day to destination', exact: true });
        await chooseImportOption(day, 'events');
        await expect(day).toHaveAttribute('aria-invalid', 'true');
        await day.focus();
        await compareStyles('mapping-invalid');
        await chooseImportOption(day, 'day');
        await dialog.getByRole('combobox', { name: 'Map day to destination', exact: true }).focus();
        await compareStyles('mapping-focus');
        await dialog.getByRole('button', { name: 'Review import', exact: true }).click();
        await expect(
            dialog.getByRole('region', { name: 'Review import', exact: true }),
        ).toBeVisible();
        await compareStyles('review');
        await dialog.getByRole('button', { name: 'Import rows', exact: true }).click();
        await expect(dialog).toContainText('2 source rows processed successfully');
        await compareStyles('success');
    });
}

for (const theme of ['Light', 'Dark']) {
    test(`CSS preserves ${theme} SQL UDF discovery, creation and tester`, async ({
        page,
    }, info) => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await functionsWorkspace(page, { existing: true });
        await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
        await expectReferenceStyles(
            page,
            info,
            'sql-udf-functions',
            page.locator('.inspector-pane'),
        );
        await page.getByRole('button', { name: 'Create SQL UDF', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Create SQL Function', exact: true });
        await expect(dialog.getByLabel('Function name', { exact: true })).toBeFocused();
        await expectReferenceStyles(page, info, 'sql-udf-create', dialog);
        await page.keyboard.press('Escape');
        await page
            .getByRole('button', { name: 'udf_array_remove_at SQL UDF', exact: true })
            .click();
        await page.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
        await expect(page.locator('.sql-function-output')).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Run on ClickHouse', exact: true }),
        ).toBeEnabled();
        await expectReferenceStyles(
            page,
            info,
            'sql-udf-array-result',
            page.locator('.inspector-pane'),
        );
        await page.getByRole('button', { name: 'Delete function', exact: true }).click();
        const deleteDialog = page.getByRole('dialog', { name: 'Delete function', exact: true });
        await deleteDialog.getByRole('textbox').fill('udf_array_remove_at');
        await expectReferenceStyles(page, info, 'sql-udf-delete', deleteDialog);
        await page.keyboard.press('Escape');
        await page.locator('.object-back-button').click();
        await page.getByRole('button', { name: 'udf_map_remove SQL UDF', exact: true }).click();
        await page.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
        await expect(page.locator('.sql-function-output')).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Run on ClickHouse', exact: true }),
        ).toBeEnabled();
        await expectReferenceStyles(
            page,
            info,
            'sql-udf-map-result',
            page.locator('.inspector-pane'),
        );
    });
}
