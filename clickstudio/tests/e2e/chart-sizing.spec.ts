import { setWorkspaceMode, runButton, trust } from './helpers.js';
import { expect, test, type Locator } from '@playwright/test';
import type { Result } from '../../src/shared/queries/results/types.js';
import { chooseChartOption } from './chart-control-helpers.js';

const eventRows = [
    ['PushEvent', 573_100_000],
    ['CreateEvent', 160_000_000],
    ['PullRequestEvent', 100_000_000],
    ['IssueCommentEvent', 30_000_000],
    ['IssuesEvent', 30_000_000],
];

const teamNames = [
    'Detroit Red Wings',
    'Chicago Blackhawks',
    'Colorado Avalanche',
    'New Jersey Devils',
    'Pittsburgh Penguins',
    'Tampa Bay Lightning',
    'Los Angeles Kings',
    'Florida Panthers',
    'Anaheim Ducks',
    'Boston Bruins',
    'Carolina Hurricanes',
    'Dallas Stars',
    'New York Rangers',
    'St. Louis Blues',
    'Vegas Golden Knights',
    'Washington Capitals',
];

for (const fixture of [
    { name: 'team bars', labels: teamNames, kind: 'bar', rowCount: false },
    { name: 'team lines', labels: teamNames, kind: 'line', rowCount: false },
    { name: 'team row counts', labels: teamNames, kind: 'bar', rowCount: true },
    {
        name: 'Chinese category lines',
        labels: Array.from({ length: 16 }, (_, index) => `超级无敌宇宙中文分类名字${index}`),
        kind: 'line',
        rowCount: false,
    },
    {
        name: 'emoji category bars',
        labels: Array.from({ length: 16 }, (_, index) => `${'😀🏆🦆'.repeat(6)}${index}`),
        kind: 'bar',
        rowCount: false,
    },
    { name: 'two short categories', labels: ['A', 'B'], kind: 'bar', rowCount: false },
    {
        name: 'joined emoji and accent categories',
        labels: ['👨‍👩‍👧‍👦', '🇵🇱'.repeat(5), 'e\u0301'.repeat(12)],
        kind: 'bar',
        rowCount: false,
    },
    {
        name: 'dense category bars',
        labels: Array.from({ length: 600 }, (_, index) => `Long category name ${index}`),
        kind: 'bar',
        rowCount: false,
    },
]) {
    test(`${fixture.name} show every full label in a compact scrollable plot`, async ({
        page,
    }, info) => {
        const expectedLabels = fixture.rowCount
            ? [...fixture.labels].sort(
                  new Intl.Collator('en', { numeric: true, sensitivity: 'base' }).compare,
              )
            : fixture.labels;
        await page.setViewportSize({ width: 1280, height: 824 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.route('**/api/runs/*/snapshot', async route => {
            const response = await route.fetch();
            const rows = fixture.labels.map((label, index) =>
                fixture.rowCount ? [label] : [label, 4 - (index % 4)],
            );
            await route.fulfill({
                response,
                json: {
                    ...(await response.json()),
                    columns: [
                        { name: 'team', type: 'String' },
                        ...(fixture.rowCount ? [] : [{ name: 'titles_won', type: 'UInt64' }]),
                    ],
                    rows,
                    totalRows: rows.length,
                    completeness: 'complete',
                },
            });
        });
        await trust(page);
        const reservedBottomGutter =
            fixture.name === 'team bars' || fixture.name === 'team row counts';
        if (reservedBottomGutter)
            await page.addStyleTag({
                content: '.chart-category-scroll {border-bottom: 16px solid transparent}',
            });
        await setWorkspaceMode(page, 'Standard');
        await runButton(page).click();
        const results = page.getByRole('region', { name: 'Query results', exact: true });
        await results.getByRole('tab', { name: 'Chart', exact: true }).click();
        if (!fixture.rowCount)
            await chooseChartOption(
                page,
                results.getByRole('combobox', { name: 'Type', exact: true }),
                fixture.kind,
            );
        await page.getByRole('button', { name: 'Ask AI', exact: true }).click();
        const plot = results.locator('.chart-category-plot');
        const marks = plot.locator(fixture.kind === 'line' ? '.chart-point' : '.chart-bar');
        await expect(marks).toHaveCount(fixture.labels.length);
        await expect(plot.locator('.chart-x-labels text')).toHaveCount(fixture.labels.length);
        expect(
            await plot.locator('.chart-x-labels text').evaluateAll(labels =>
                labels.map(label =>
                    [...label.querySelectorAll('tspan')]
                        .map(line => line.textContent)
                        .join('')
                        .replace(/\s/g, ''),
                ),
            ),
        ).toEqual(expectedLabels.map(label => label.replace(/\s/g, '')));
        await expect(marks.first().locator('title')).toContainText(expectedLabels[0]!);
        const checkLayout = async () => {
            await expect
                .poll(() =>
                    results.locator('.chart-workspace').evaluate(workspace => {
                        const viewport = workspace.querySelector('.chart-category-scroll')!;
                        const svg = workspace.querySelector(
                            '.chart-category-plot',
                        )! as SVGSVGElement;
                        const bounds = svg.getBoundingClientRect();
                        const labels = [...svg.querySelectorAll('.chart-x-labels text')].map(
                            label => label.getBoundingClientRect(),
                        );
                        const marks = [...svg.querySelectorAll('.chart-bar, .chart-point')].map(
                            mark => mark.getBoundingClientRect(),
                        );
                        const footer = workspace
                            .querySelector('.chart-footer')!
                            .getBoundingClientRect();
                        const matrix = svg.getScreenCTM()!;
                        const axis = workspace.querySelector(
                            '.chart-category-y-axis',
                        )! as SVGSVGElement;
                        const axisMatrix = axis.getScreenCTM()!;
                        const yTicks = [...axis.querySelectorAll('text')];
                        const gridlines = [...svg.querySelectorAll('.chart-gridline')];
                        return (
                            viewport.scrollWidth >= viewport.clientWidth &&
                            workspace.scrollHeight <= workspace.clientHeight + 1 &&
                            footer.bottom <= workspace.getBoundingClientRect().bottom + 1 &&
                            Math.abs(matrix.a / matrix.d - 1) < 0.02 &&
                            Math.abs(axisMatrix.d - matrix.d) < 0.02 &&
                            yTicks.every((tick, index) => {
                                const y = Number(tick.getAttribute('y'));
                                const gridY = Number(gridlines[index]!.getAttribute('y1'));
                                return (
                                    Math.abs(
                                        axisMatrix.d * y +
                                            axisMatrix.f -
                                            matrix.d * gridY -
                                            matrix.f,
                                    ) < 1
                                );
                            }) &&
                            marks.every(
                                mark =>
                                    mark.left >= bounds.left - 1 && mark.right <= bounds.right + 1,
                            ) &&
                            labels.every(
                                (label, index) =>
                                    label.left >= bounds.left - 1 &&
                                    label.right <= bounds.right + 1 &&
                                    label.bottom <= bounds.bottom + 1 &&
                                    (index === 0 || label.left >= labels[index - 1]!.right + 2),
                            )
                        );
                    }),
                )
                .toBe(true);
        };
        await checkLayout();
        const viewport = results.locator('.chart-category-scroll');
        if (reservedBottomGutter)
            expect(
                await viewport.evaluate(
                    element => element.getBoundingClientRect().height - element.clientHeight,
                ),
            ).toBeGreaterThanOrEqual(16);
        await viewport.evaluate(element => {
            element.scrollLeft = element.scrollWidth;
        });
        await expect
            .poll(() =>
                plot
                    .locator('.chart-x-labels text')
                    .last()
                    .evaluate(label => {
                        const bounds = label.getBoundingClientRect();
                        const viewport = label
                            .closest('.chart-category-scroll')!
                            .getBoundingClientRect();
                        return (
                            bounds.left >= viewport.left - 1 && bounds.right <= viewport.right + 1
                        );
                    }),
            )
            .toBe(true);
        await viewport.evaluate(element => {
            element.scrollLeft = 0;
        });
        if (fixture.labels.length > 2)
            await expect(plot.locator('.chart-x-labels text tspan[dy="11"]').first()).toBeVisible();
        else {
            const positions = await plot.locator('.chart-x-labels text').evaluateAll(labels =>
                labels.map(label => ({
                    x: Number(label.getAttribute('x')),
                    anchor: label.getAttribute('text-anchor'),
                })),
            );
            const centers = await marks.evaluateAll(bars =>
                bars.map(
                    bar => Number(bar.getAttribute('x')) + Number(bar.getAttribute('width')) / 2,
                ),
            );
            expect(positions.map(label => label.x)).toEqual(centers);
            expect(positions.every(label => label.anchor === 'middle')).toBe(true);
        }
        await expect(plot.locator('.chart-x-labels text').first().locator('title')).toHaveText(
            expectedLabels[0]!,
        );
        await expect(plot.locator('.chart-x-labels text').last().locator('title')).toHaveText(
            expectedLabels.at(-1)!,
        );
        await results.screenshot({
            path: info.outputPath('fitted-chart.png'),
            animations: 'disabled',
        });
        for (const viewport of [
            { width: 900, height: 824 },
            { width: 1280, height: 650 },
        ]) {
            await page.setViewportSize(viewport);
            await checkLayout();
        }
        await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
        await page.setViewportSize({ width: 1778, height: 824 });
        await checkLayout();
        await expect(marks).toHaveCount(fixture.labels.length);
        await expect(plot.locator('.chart-x-labels text')).toHaveCount(fixture.labels.length);
        await results.screenshot({
            path: info.outputPath('compact-labels-wide.png'),
            animations: 'disabled',
        });
    });
}

for (const fixture of [
    {
        name: 'bar chart',
        data: {
            columns: [
                { name: 'event_type', type: 'String' },
                { name: 'event_rows', type: 'UInt64' },
            ],
            rows: eventRows,
        },
        kind: 'bar',
    },
    {
        name: 'line chart',
        data: {
            columns: [
                { name: 'event_type', type: 'String' },
                { name: 'event_rows', type: 'UInt64' },
            ],
            rows: eventRows,
        },
        kind: 'line',
    },
    {
        name: 'row-count chart',
        data: {
            columns: [{ name: 'event_type', type: 'String' }],
            rows: eventRows.map(([event]) => [event]),
        },
        kind: 'bar',
    },
] as const) {
    test(`${fixture.name} keeps its SVG geometry when the workspace resizes`, async ({ page }) => {
        await page.setViewportSize({ width: 1680, height: 950 });
        await page.route('**/api/runs/*/snapshot', async route => {
            const response = await route.fetch();
            await route.fulfill({
                response,
                json: {
                    ...(await response.json()),
                    ...fixture.data,
                    totalRows: fixture.data.rows.length,
                    completeness: 'complete',
                } satisfies Partial<Result>,
            });
        });
        await trust(page);
        await setWorkspaceMode(page, 'Standard');
        await runButton(page).click();
        const results = page.getByRole('region', { name: 'Query results', exact: true });
        await results.getByRole('tab', { name: 'Chart', exact: true }).click();
        if (fixture.kind === 'line')
            await chooseChartOption(
                page,
                results.getByRole('combobox', { name: 'Type', exact: true }),
                'line',
            );

        const plot = results.locator('.chart-category-plot');
        await expect(plot).toBeVisible();
        for (const width of [1680, 1120, 900]) {
            await page.setViewportSize({ width, height: 950 });
            await expect
                .poll(async () =>
                    plot.evaluate(svg => {
                        if (!(svg instanceof SVGSVGElement)) return Number.POSITIVE_INFINITY;
                        const matrix = svg.getScreenCTM();
                        if (!matrix) return Number.POSITIVE_INFINITY;
                        return Math.abs(matrix.a / matrix.d - 1);
                    }),
                )
                .toBeLessThan(0.1);
        }
        if (fixture.kind === 'bar') {
            const bar = results.locator('.chart-category-plot .chart-bar').first();
            expect((await bar.boundingBox())?.width).toBeLessThan(36);
        }
    });
}

async function expectPlotFits(results: Locator) {
    const canvas = results.locator('.chart-canvas');
    await expect(results.locator('.chart-category-scroll')).toHaveCount(0);
    await expect
        .poll(() =>
            canvas.evaluate(element => {
                const svg = element.querySelector('svg')!;
                const grid = svg.querySelector('.chart-gridline')!.getBoundingClientRect();
                const bounds = svg.getBoundingClientRect();
                const matrix = svg.getScreenCTM()!;
                const marks = [...svg.querySelectorAll('.chart-bar, .chart-point')].map(mark =>
                    mark.getBoundingClientRect(),
                );
                return (
                    grid.left - bounds.left < 100 &&
                    bounds.right - grid.right < 45 &&
                    grid.left >= bounds.left &&
                    grid.right <= bounds.right + 1 &&
                    Math.abs(matrix.a / matrix.d - 1) < 0.02 &&
                    marks.every(mark => mark.left >= bounds.left && mark.right <= bounds.right + 1)
                );
            }),
        )
        .toBe(true);
    await expect
        .poll(() => canvas.evaluate(element => element.scrollWidth - element.clientWidth))
        .toBeLessThanOrEqual(1);
    await expect
        .poll(() =>
            results.locator('.chart-x-labels text').evaluateAll(labels => {
                const bounds = labels.map(label => label.getBoundingClientRect());
                return bounds.every(
                    (rect, index) => index === 0 || rect.left >= bounds[index - 1]!.right,
                );
            }),
        )
        .toBe(true);
}

for (const xType of ['DateTime', 'Float64']) {
    test(`${xType} line and bar charts fit all 61 rows into the results width`, async ({
        page,
    }, info) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.setViewportSize({ width: 1778, height: 824 });
        const rows = Array.from({ length: 61 }, (_value, index) => [
            xType === 'DateTime'
                ? new Date(Date.UTC(2026, 9, 11, 1, 31 + index))
                      .toISOString()
                      .replace('T', ' ')
                      .slice(0, 19)
                : index,
            30 + (index % 20),
        ]);
        await page.route('**/api/runs/*/snapshot', async route => {
            const response = await route.fetch();
            await route.fulfill({
                response,
                json: {
                    ...(await response.json()),
                    columns: [
                        { name: 'x', type: xType },
                        { name: 'value', type: 'Float64' },
                    ],
                    rows,
                    totalRows: rows.length,
                    completeness: 'complete',
                },
            });
        });
        await trust(page);
        await setWorkspaceMode(page, 'Standard');
        await runButton(page).click();
        const results = page.getByRole('region', { name: 'Query results', exact: true });
        await results.getByRole('tab', { name: 'Chart', exact: true }).click();
        const type = results.getByRole('combobox', { name: 'Type', exact: true });
        for (const kind of ['line', 'bar']) {
            await chooseChartOption(page, type, kind);
            await expect(
                results.locator(kind === 'bar' ? '.chart-bar' : '.chart-point'),
            ).toHaveCount(rows.length);
            await expectPlotFits(results);
            await page.getByRole('button', { name: 'Ask AI', exact: true }).click();
            for (const width of [1778, 1280, 900]) {
                await page.setViewportSize({ width, height: 824 });
                await expectPlotFits(results);
            }
            await page.setViewportSize({ width: 1280, height: 500 });
            await expectPlotFits(results);
            await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
            await page.setViewportSize({ width: 1778, height: 824 });
            await expectPlotFits(results);
            await expect
                .poll(() =>
                    results.locator('.chart-canvas').evaluate((element, kind) => {
                        const marks = element.querySelectorAll(
                            kind === 'bar' ? '.chart-bar' : '.chart-point',
                        );
                        const first = marks[0]?.getBoundingClientRect();
                        const last = marks[marks.length - 1]?.getBoundingClientRect();
                        const canvas = element.getBoundingClientRect();
                        return (
                            first !== undefined &&
                            last !== undefined &&
                            first.left >= canvas.left &&
                            last.right <= canvas.right
                        );
                    }, kind),
                )
                .toBe(true);
            await results.locator('.chart-canvas').screenshot({
                path: info.outputPath(`${xType}-${kind}.png`),
            });
        }
    });
}

test('Row-count time lines fill the width after opening and closing the inspector', async ({
    page,
}) => {
    await page.setViewportSize({ width: 1778, height: 824 });
    await page.route('**/api/runs/*/snapshot', async route => {
        const response = await route.fetch();
        const rows = Array.from({ length: 61 }, (_value, index) => [
            new Date(Date.UTC(2026, 9, 11, 1, index)).toISOString(),
        ]);
        await route.fulfill({
            response,
            json: {
                ...(await response.json()),
                columns: [{ name: 'time', type: 'DateTime' }],
                rows,
                totalRows: rows.length,
                completeness: 'complete',
            },
        });
    });
    await trust(page);
    await setWorkspaceMode(page, 'Standard');
    await runButton(page).click();
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await results.getByRole('tab', { name: 'Chart', exact: true }).click();
    await expectPlotFits(results);
    await page.getByRole('button', { name: 'Ask AI', exact: true }).click();
    await expectPlotFits(results);
    await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
    await expectPlotFits(results);
});

test('Dense fitted bars show every series without delayed animation or oversized outlines', async ({
    page,
}) => {
    await page.setViewportSize({ width: 1778, height: 824 });
    await page.route('**/api/runs/*/snapshot', async route => {
        const response = await route.fetch();
        const rows = Array.from({ length: 600 }, (_value, index) => [
            index,
            index + 1,
            index + 2,
            index + 3,
        ]);
        await route.fulfill({
            response,
            json: {
                ...(await response.json()),
                columns: [
                    { name: 'x', type: 'Float64' },
                    ...[1, 2, 3].map(index => ({ name: `y${index}`, type: 'Float64' })),
                ],
                rows,
                totalRows: rows.length,
                completeness: 'complete',
            },
        });
    });
    await trust(page);
    await setWorkspaceMode(page, 'Standard');
    await runButton(page).click();
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await results.getByRole('tab', { name: 'Chart', exact: true }).click();
    await chooseChartOption(
        page,
        results.getByRole('combobox', { name: 'Type', exact: true }),
        'bar',
    );
    await expect(results.locator('.chart-bar--static')).toHaveCount(1800);
    await expectPlotFits(results);
    expect(
        await results.locator('.chart-bar').evaluateAll(bars =>
            bars.every(bar => {
                const styles = getComputedStyle(bar);
                return (
                    styles.animationName === 'none' &&
                    Number.parseFloat(styles.strokeWidth) < Number(bar.getAttribute('width'))
                );
            }),
        ),
    ).toBe(true);
});
