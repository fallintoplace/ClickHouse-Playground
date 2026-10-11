import assert from 'node:assert/strict';
import test from 'node:test';
import { copy } from '../../.workspace-build/src/frontend/ui/copy.js';
import { prepareChartSelection } from '../../.workspace-build/src/frontend/queries/results/charts/controls/chart-selection.js';
import { prepareChartView } from '../../.workspace-build/src/frontend/queries/results/charts/rendering/chart-view-model.js';
import {
    categoryAxisLayout,
    chartLabelWidth,
    fitCategoryTicks,
    fitChartTicks,
} from '../../.workspace-build/src/frontend/queries/results/charts/chart-helpers.js';
import {
    heatmapCellKey,
    MAX_CHART_RENDER_POINTS,
    MAX_CHART_SERIES,
} from '../../.workspace-build/src/shared/queries/results/results.js';

function result(columns, rows) {
    return {
        columns: columns.map(([name, type]) => ({ name, type })),
        rows,
        completeness: 'complete',
        totalRows: rows.length,
    };
}

function prepare(data, overrides = {}, width = 652, plotViewportWidth = 760) {
    const chart = { kind: 'line', x: 0, ys: [1], title: 'Query result', ...overrides };
    return prepareChartView({
        result: data,
        chart,
        chartCopy: copy.chart,
        categoryViewportWidth: width,
        plotViewportWidth,
        selection: prepareChartSelection(data, chart),
    });
}

test('Timestamp ticks reduce to endpoints or a middle tick when their labels cannot fit', () => {
    for (const [width, count] of [
        [500, 3],
        [300, 2],
        [180, 1],
    ]) {
        const ticks = ['01:31:00', '02:01:00', '02:31:00'].map((time, index) => ({
            label: `2026-10-11 ${time}`,
            position: (index * width) / 2,
        }));
        let expected = ticks;
        if (count === 2) expected = [ticks[0], ticks[2]];
        else if (count === 1) expected = [ticks[1]];
        assert.deepEqual(fitChartTicks(ticks), expected);
    }
    assert.deepEqual(fitChartTicks([]), []);
    const tick = { label: '2026-10-11 01:31:00', position: 100 };
    assert.deepEqual(fitChartTicks([tick]), [tick]);
    const crowded = [80, 100, 732].map(position => ({ ...tick, position }));
    assert.deepEqual(fitChartTicks(crowded), [crowded[0], crowded[2]]);
});

for (const [rowCount, width, tickCount] of [
    [2, 408, 1],
    [3, 508, 2],
]) {
    test(`${rowCount} timestamp bars at width ${width} avoid labels overlapping at slot centers`, () => {
        const view = prepare(
            result(
                [
                    ['time', 'DateTime'],
                    ['value', 'Float64'],
                ],
                Array.from({ length: rowCount }, (_value, index) => [
                    `2026-10-11 01:3${index}:00`,
                    index + 1,
                ]),
            ),
            { kind: 'bar' },
            652,
            width,
        );
        assert.equal(view.svg.chartXTicks.length, tickCount);
    });
}

for (const xType of ['DateTime', 'Float64']) {
    for (const kind of ['line', 'bar']) {
        test(`${xType} ${kind} charts use the viewport width with readable sparse ticks`, () => {
            const rows = Array.from({ length: 600 }, (_value, index) => [
                xType === 'DateTime'
                    ? new Date(Date.UTC(2026, 9, 11, 1, index)).toISOString()
                    : index,
                index + 1,
            ]);
            const data = result(
                [
                    ['x', xType],
                    ['value', 'Float64'],
                ],
                rows,
            );
            for (const width of [320, 760, 1800]) {
                const view = prepare(data, { kind }, 652, width);
                assert.equal(view.categoricalAxis, false);
                assert.equal(view.svg.viewportWidth, width);
                assert.equal(view.svg.plotLeft, 80);
                assert.equal(view.svg.plotRight, width - 28);
                assert.equal(
                    view.svg.chartXTicks.length,
                    width === 320 && xType === 'DateTime' ? 1 : 3,
                );
                assert.deepEqual(view.chartRows[0], rows[0]);
                assert.deepEqual(view.chartRows.at(-1), rows.at(-1));
                if (kind === 'bar') {
                    assert.equal(view.chartRows.length, rows.length);
                    assert.ok(view.svg.x(0) - view.svg.barWidth / 2 >= view.svg.plotLeft - 1);
                    assert.ok(
                        view.svg.x(rows.length - 1) + view.svg.barWidth / 2 <=
                            view.svg.plotRight + 1,
                    );
                } else {
                    assert.equal(view.chartRows.length, MAX_CHART_RENDER_POINTS);
                    assert.equal(view.svg.x(0), view.svg.plotLeft);
                    assert.equal(view.svg.x(view.chartRows.length - 1), view.svg.plotRight);
                }
            }
        });
    }
}

for (const [rowCount, measureCount] of [
    [61, MAX_CHART_SERIES],
    [600, 3],
]) {
    test(`${rowCount} fitted bar groups with ${measureCount} measures stay inside their row slots`, () => {
        const data = result(
            [
                ['x', 'Float64'],
                ...Array.from({ length: measureCount }, (_value, index) => [
                    `y${index}`,
                    'Float64',
                ]),
            ],
            Array.from({ length: rowCount }, (_value, index) => [
                index,
                ...Array.from({ length: measureCount }, () => index + 1),
            ]),
        );
        for (const width of [320, 760, 1800]) {
            const view = prepare(
                data,
                {
                    kind: 'bar',
                    ys: Array.from({ length: measureCount }, (_value, index) => index + 1),
                },
                652,
                width,
            );
            const slotWidth = (view.svg.plotRight - view.svg.plotLeft) / rowCount;
            const groupWidth = view.svg.barWidth * measureCount;
            const strokeWidth = Math.min(1, view.svg.barWidth * 0.4);
            assert.ok(groupWidth + strokeWidth < slotWidth);
            assert.ok(view.svg.x(0) - (groupWidth + strokeWidth) / 2 >= view.svg.plotLeft);
            assert.ok(
                view.svg.x(rowCount - 1) + (groupWidth + strokeWidth) / 2 <= view.svg.plotRight,
            );
        }
    });
}

for (const rows of [[], [[1, -10, 20]], [[1, null, null]]]) {
    test(`Fitted bars keep finite and contained geometry with ${JSON.stringify(rows)}`, () => {
        const view = prepare(
            result(
                [
                    ['x', 'Float64'],
                    ['first', 'Nullable(Float64)'],
                    ['second', 'Nullable(Float64)'],
                ],
                rows,
            ),
            { kind: 'bar', ys: [1, 2] },
            652,
            1200,
        );
        assert.equal(view.svg.x(0), (80 + 1172) / 2);
        assert.ok(Number.isFinite(view.svg.y(0)));
        assert.ok(view.svg.x(0) - view.svg.barWidth >= view.svg.plotLeft);
        assert.ok(view.svg.x(0) + view.svg.barWidth <= view.svg.plotRight);
    });
}

test('Numeric scatter axes and named categories follow the viewport', () => {
    const scatter = prepare(
        result(
            [
                ['x', 'Float64'],
                ['y', 'Float64'],
            ],
            [[10, 20]],
        ),
        { kind: 'scatter' },
        652,
        1200,
    );
    assert.equal(scatter.svg.scatterX(10), 1172);
    const categories = prepare(
        result(
            [
                ['x', 'String'],
                ['y', 'Float64'],
            ],
            Array.from({ length: 61 }, (_value, index) => [`Named category ${index}`, index]),
        ),
        { kind: 'bar' },
        1100,
        1200,
    );
    assert.equal(categories.categoricalAxis, true);
    assert.ok(categories.svg.plotRight > 1100);
    assert.equal(categories.chartRows.length, 61);
    assert.equal(categories.svg.chartXTicks.length, 61);
});

test('Chart preparation keeps valid saved measures and repairs unavailable axes', () => {
    const data = result(
        [
            ['name', 'String'],
            ['first', 'Float64'],
            ['second', 'Float64'],
        ],
        [['a', 10, 20]],
    );
    const view = prepare(data, { x: 999, ys: [2, 2, 99, 0] });
    assert.equal(view.xIndex, 0);
    assert.deepEqual(view.measureIndexes, [2]);
    assert.deepEqual(view.availableMeasures, [1, 2]);
});

test('Saved multi-series charts respect the rendering limit and reuse series colors', () => {
    const measures = Array.from({ length: MAX_CHART_SERIES + 5 }, (_, index) => index + 1);
    const data = result(
        [['name', 'String'], ...measures.map(index => [`value_${index}`, 'Float64'])],
        [['a', ...measures]],
    );
    const view = prepare(data, { ys: measures });
    assert.equal(view.measureIndexes.length, MAX_CHART_SERIES);
    assert.equal(view.svg.plotSeries[0].color, view.svg.plotSeries[5].color);
});

test('Scatter charts use one measure and select another numeric column for X', () => {
    const data = result(
        [
            ['label', 'String'],
            ['x', 'Float64'],
            ['y', 'Float64'],
        ],
        [['a', 10, 20]],
    );
    const view = prepare(data, { kind: 'scatter', x: 0, ys: [2, 1] });
    assert.equal(view.xIndex, 1);
    assert.deepEqual(view.measureIndexes, [2]);
});

test('Positive and negative measures share the same zero baseline', () => {
    const view = prepare(
        result(
            [
                ['x', 'UInt64'],
                ['y', 'Float64'],
            ],
            [
                [1, -10],
                [2, 10],
            ],
        ),
    );
    assert.deepEqual(
        view.chartYTicks.map(tick => tick.value),
        [10, 0, -10],
    );
    assert.equal(view.svg.zeroY, 115);
    assert.equal(view.svg.y(-10), 190);
    assert.equal(view.svg.y(10), 40);
});

test('NULL and invalid measures keep their gaps without contributing to the value range', () => {
    const view = prepare(
        result(
            [
                ['x', 'UInt64'],
                ['y', 'Nullable(Float64)'],
            ],
            [
                [1, null],
                [2, 'bad'],
                [3, 5],
            ],
        ),
    );
    assert.deepEqual(view.values, [5]);
    assert.deepEqual(
        view.svg.plotSeries[0].points.map(point => point.value),
        [null, null, 5],
    );
});

for (const rows of [[], [[0, 0]], [[0, null]]]) {
    test(`Empty or flat chart data keeps finite geometry with ${JSON.stringify(rows)}`, () => {
        const view = prepare(
            result(
                [
                    ['x', 'UInt64'],
                    ['y', 'Nullable(Float64)'],
                ],
                rows,
            ),
        );
        assert.equal(view.svg.zeroY, 190);
        assert.ok(view.chartYTicks.every(tick => Number.isFinite(tick.position)));
        assert.ok(Number.isFinite(view.svg.x(0)));
        assert.ok(Number.isFinite(view.svg.y(0)));
    });
}

test('Scatter plots exclude points with an invalid coordinate', () => {
    const view = prepare(
        result(
            [
                ['x', 'Nullable(Float64)'],
                ['y', 'Nullable(Float64)'],
            ],
            [
                [1, 2],
                [null, 3],
                [4, null],
                ['bad', 5],
                [6, 'bad'],
            ],
        ),
        { kind: 'scatter' },
    );
    assert.deepEqual(view.svg.scatterPoints, [{ x: 1, y: 2, label: '1' }]);
    assert.equal(view.scatterSummary, '1 plotted points');
});

test('A zero-only scatter plot centers its point and collapses duplicate ticks', () => {
    const view = prepare(
        result(
            [
                ['x', 'Float64'],
                ['y', 'Float64'],
            ],
            [[0, 0]],
        ),
        {
            kind: 'scatter',
        },
    );
    assert.equal(view.svg.scatterX(0), 406);
    assert.equal(view.svg.scatterY(0), 115);
    assert.deepEqual(view.chartYTicks, [{ value: 0, position: 115 }]);
    assert.deepEqual(view.svg.chartXTicks, [{ label: '0', position: 406 }]);
});

test('Continuous charts sample large results while retaining both endpoints', () => {
    const rows = Array.from({ length: 600 }, (_, index) => [index, index * 2]);
    const view = prepare(
        result(
            [
                ['x', 'UInt64'],
                ['y', 'UInt64'],
            ],
            rows,
        ),
    );
    assert.equal(view.chartRows.length, MAX_CHART_RENDER_POINTS);
    assert.deepEqual(view.chartRows[0], rows[0]);
    assert.deepEqual(view.chartRows.at(-1), rows.at(-1));
    assert.match(view.rowSummary, /240.*600/);
});

test('Categorical charts retain every category label in a compact scrollable plot', () => {
    const rows = Array.from({ length: 300 }, (_, index) => [`long category label ${index}`, index]);
    const view = prepare(
        result(
            [
                ['name', 'String'],
                ['value', 'UInt64'],
            ],
            rows,
        ),
    );
    assert.equal(view.chartRows, rows);
    assert.equal(view.svg.chartXTicks.length, rows.length);
    assert.equal(view.svg.chartXTicks[0].label, rows[0][0]);
    assert.equal(view.svg.chartXTicks.at(-1).label, rows.at(-1)[0]);
    assert.ok(view.svg.plotRight > 652);
    assert.ok(view.svg.x(299) < view.svg.plotRight);
    assert.ok(view.svg.plotRight < rows.reduce((sum, [label]) => sum + chartLabelWidth(label), 0));
});

for (const width of [48, 320, 630, 1200]) {
    for (const labels of [
        [],
        [''],
        ['Detroit Red Wings'],
        ['a', 'b'],
        ['Repeated category', 'Repeated category', 'Another category'],
        ['Detroit Red Wings', 'Chicago Blackhawks', 'Colorado Avalanche', 'New Jersey Devils'],
        Array.from({ length: 300 }, (_, index) => `Team with a very long name ${index}`),
        ['😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀', '  Team    with\nspaces  '],
        Array.from({ length: 16 }, (_, index) => `超级无敌宇宙中文分类名字${index}`),
    ]) {
        test(`${labels.length} category labels use width ${width} without hiding or clipping names`, () => {
            const layout = categoryAxisLayout(labels, width);
            assert.ok(layout.width >= width);
            assert.equal(layout.positions.length, labels.length);
            assert.ok(layout.positions.every(position => position > 0 && position < layout.width));
            const ticks = fitCategoryTicks(
                labels.map((label, index) => ({ label, position: layout.positions[index] })),
            );
            assert.equal(ticks.length, labels.length);
            let previousRight = -Infinity;
            for (const [index, tick] of ticks.entries()) {
                assert.equal(tick.label, labels[index]);
                assert.ok(tick.lines.length <= 2);
                assert.equal(tick.lines.join('').replace(/\s/g, ''), tick.label.replace(/\s/g, ''));
                const labelWidth = Math.max(...tick.lines.map(chartLabelWidth));
                const left = tick.position - labelWidth / 2;
                assert.equal(tick.anchor, 'middle');
                assert.equal(tick.position, layout.positions[index]);
                assert.ok(left >= -1);
                assert.ok(left + labelWidth <= layout.width + 1);
                assert.ok(left >= previousRight + 8);
                previousRight = left + labelWidth;
                for (const line of tick.lines)
                    assert.doesNotMatch(
                        line,
                        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u,
                    );
            }
            if (ticks.length > 1) {
                assert.equal(ticks[0].label, labels[0]);
                assert.equal(ticks.at(-1).label, labels.at(-1));
            }
        });
    }
}

test('Unbroken category labels balance two complete lines without truncating text', () => {
    const label = 'AReallyLongUnbrokenCategoryNameThatCannotFitOnTwoLines';
    const layout = categoryAxisLayout([label], 96);
    const [tick] = fitCategoryTicks([{ label, position: layout.positions[0] }]);
    assert.equal(tick.label, label);
    assert.equal(tick.lines.length, 2);
    assert.equal(tick.lines.join(''), label);
    assert.ok(Math.abs(chartLabelWidth(tick.lines[0]) - chartLabelWidth(tick.lines[1])) <= 6);
});

test('Team names split at word boundaries and share only the space they need', () => {
    const labels = ['Detroit Red Wings', 'Chicago Blackhawks', 'Dallas Stars'];
    const layout = categoryAxisLayout(labels, 48);
    const ticks = fitCategoryTicks(
        labels.map((label, index) => ({ label, position: layout.positions[index] })),
    );
    assert.deepEqual(
        ticks.map(tick => tick.lines),
        [
            ['Detroit', 'Red Wings'],
            ['Chicago', 'Blackhawks'],
            ['Dallas', 'Stars'],
        ],
    );
    assert.equal(layout.width, 206);
    assert.notEqual(
        layout.positions[1] - layout.positions[0],
        layout.positions[2] - layout.positions[1],
    );
});

test('Category wrapping preserves joined emoji, flags and combining accents', () => {
    const labels = ['👨‍👩‍👧‍👦', '🇵🇱'.repeat(5), 'e\u0301'.repeat(12)];
    const ticks = fitCategoryTicks(labels.map(label => ({ label, position: 48 })));
    const segments = new Intl.Segmenter('en', { granularity: 'grapheme' });
    const graphemes = text => Array.from(segments.segment(text), part => part.segment);
    assert.deepEqual(ticks[0].lines, ['👨‍👩‍👧‍👦']);
    for (const tick of ticks) {
        assert.deepEqual(tick.lines.flatMap(graphemes), graphemes(tick.label));
        assert.equal(tick.lines.join(''), tick.label);
    }
});

test('Category layout has a finite fallback before the viewport is measured', () => {
    for (const width of [0, -1, NaN, Infinity]) {
        assert.equal(categoryAxisLayout(['a'], width).width, 652);
    }
});

test('Categorical chart geometry follows the available height with stable labels and marks', () => {
    const data = result(
        [
            ['name', 'String'],
            ['value', 'Int64'],
        ],
        [
            ['a', -3],
            ['b', 5],
        ],
    );
    const chart = { kind: 'bar', x: 0, ys: [1], title: 'Query result' };
    for (const height of [110, 230, 480]) {
        const view = prepareChartView({
            result: data,
            chart,
            chartCopy: copy.chart,
            categoryViewportWidth: 630,
            categoryViewportHeight: height,
            selection: prepareChartSelection(data, chart),
        });
        assert.equal(view.svg.viewportHeight, height);
        assert.equal(view.svg.plotBottom, height - 44);
        assert.ok(view.svg.y(5) >= 0);
        assert.ok(view.svg.y(-3) <= height - 44);
        assert.ok(view.svg.plotBottom + 29 < height);
    }
});

test('Categorical viewport changes update geometry without changing measures or rows', () => {
    const data = result(
        [
            ['name', 'String'],
            ['value', 'UInt64'],
        ],
        [
            ['a', 1],
            ['b', 2],
        ],
    );
    const narrow = prepare(data);
    const wide = prepare(data, {}, 1200);
    assert.equal(wide.svg.plotRight, 1200);
    assert.ok(wide.svg.x(1) > narrow.svg.x(1));
    assert.deepEqual(wide.measureIndexes, narrow.measureIndexes);
    assert.equal(wide.chartRows, narrow.chartRows);
});

test('Heatmap axes avoid the measure and recover a conflicting breakdown', () => {
    const data = result(
        [
            ['day', 'String'],
            ['hour', 'String'],
            ['value', 'Float64'],
        ],
        [['Mon', '10', 3]],
    );
    const view = prepare(data, { kind: 'heatmap', ys: [2], groupBy: 0 });
    assert.equal(view.xIndex, 0);
    assert.equal(view.groupByIndex, 1);
    assert.equal(view.yIndex, 2);
});

test('Heatmaps combine repeated cells and sort dimension labels naturally', () => {
    const view = prepare(
        result(
            [
                ['day', 'String'],
                ['hour', 'String'],
                ['value', 'Float64'],
            ],
            [
                ['day10', 'hour2', 3],
                ['day2', 'hour2', 4],
                ['day2', 'hour2', 5],
            ],
        ),
        { kind: 'heatmap', ys: [2], groupBy: 1 },
    );
    assert.deepEqual(view.heatmapXLabels, ['day2', 'day10']);
    assert.equal(view.heatmap.cells.get(heatmapCellKey('day2', 'hour2')), 9);
    assert.equal(view.heatmapMaximum, 9);
});

test('Heatmaps keep returned NULL cells distinct from missing combinations', () => {
    const view = prepare(
        result(
            [
                ['day', 'String'],
                ['hour', 'String'],
                ['value', 'Nullable(Float64)'],
            ],
            [
                ['Mon', '10', null],
                ['Tue', '11', 3],
            ],
        ),
        { kind: 'heatmap', ys: [2], groupBy: 1 },
    );
    const key = heatmapCellKey('Mon', '10');
    assert.equal(view.heatmap.present.has(key), true);
    assert.equal(view.heatmap.cells.has(key), false);
    assert.equal(view.heatmap.present.has(heatmapCellKey('Mon', '11')), false);
});

test('Heatmaps stop preparing labels when their cell budget is exceeded', () => {
    const rows = Array.from({ length: 1000 }, (_, index) => [`x${index}`, `y${index}`, index]);
    const view = prepare(
        result(
            [
                ['x', 'String'],
                ['y', 'String'],
                ['value', 'Float64'],
            ],
            rows,
        ),
        {
            kind: 'heatmap',
            ys: [2],
            groupBy: 1,
        },
    );
    assert.equal(view.heatmapTooLarge, true);
    assert.deepEqual(view.heatmapXLabels, []);
    assert.deepEqual(view.heatmapYLabels, []);
});

test('Chart summaries preserve custom titles', () => {
    const data = result(
        [
            ['x', 'UInt64'],
            ['y', 'UInt64'],
        ],
        [[1, 2]],
    );
    assert.equal(prepare(data).chartTitle, undefined);
    assert.equal(prepare(data, { title: 'Revenue' }).chartTitle, 'Revenue');
});

test('Candlestick selection finds the time axis and rejects overlapping or invalid mappings', () => {
    const data = result(
        [
            ['time', 'DateTime'],
            ['open', 'Float64'],
            ['high', 'Float64'],
            ['low', 'Float64'],
            ['close', 'Float64'],
        ],
        [['2026-01-01', 10, 12, 9, 11]],
    );
    const valid = {
        kind: 'candlestick',
        x: 99,
        ys: [],
        candlestick: { open: 1, high: 2, low: 3, close: 4 },
    };
    assert.equal(prepareChartSelection(data, valid).candleX, 0);
    assert.equal(prepareChartSelection(data, valid).activeCandleValid, true);
    for (const close of [1, -1, 99, 1.5, undefined]) {
        const chart = { ...valid, candlestick: { ...valid.candlestick, close } };
        assert.equal(prepareChartSelection(data, chart).activeCandleValid, false);
    }
});

test('Preparing a chart preserves frozen result data and saved configuration', () => {
    const data = result(
        [
            ['x', 'UInt64'],
            ['y', 'Float64'],
        ],
        [[1, 2]],
    );
    Object.freeze(data.rows[0]);
    Object.freeze(data.rows);
    data.columns.forEach(Object.freeze);
    Object.freeze(data.columns);
    Object.freeze(data);
    const ys = Object.freeze([1]);
    const view = prepare(data, { ys });
    assert.equal(view.chart.ys, ys);
    assert.equal(view.result, data);
});
