import type { ChartKind } from '../../../../../shared/queries/results/chart-types.js';
import { chartNumber, displayValue } from '../../../../../shared/queries/results/results.js';
import type { Result } from '../../../../../shared/queries/results/types.js';
import type { Row } from '../../../../../shared/common/values.js';
import type { Copy } from '../../../../ui/copy.js';
import {
    chartText,
    fitCategoryTicks,
    fitChartTicks,
    formatCount,
    type ChartAxisTick,
    type ChartSeries,
} from '../chart-helpers.js';

function scatterNumberFormat(values: number[], compactNumber: Intl.NumberFormat) {
    return new Set(values.map(value => compactNumber.format(value))).size === values.length
        ? compactNumber
        : new Intl.NumberFormat('en', { useGrouping: false, maximumSignificantDigits: 15 });
}

export function prepareScatterAxes({
    chartRows,
    xIndex,
    yIndex,
    chartCopy,
    result,
    rowSummary,
    plotLeft,
    plotRight,
    plotWidth,
    plotMiddle,
    plotBottom,
    plotHeight,
    chartKind,
    plotTop,
    min,
    max,
    compactNumber,
    categoricalAxis,
    plotSeries,
    x,
}: {
    chartRows: Row[];
    xIndex: number;
    yIndex: number;
    chartCopy: Copy['chart'];
    result: Result;
    rowSummary: string;
    plotLeft: number;
    plotRight: number;
    plotWidth: number;
    plotMiddle: number;
    plotBottom: number;
    plotHeight: number;
    chartKind: Exclude<ChartKind, 'table'>;
    plotTop: number;
    min: number;
    max: number;
    compactNumber: Intl.NumberFormat;
    categoricalAxis: boolean;
    plotSeries: ChartSeries[];
    x: (index: number) => number;
}) {
    const scatterPoints = chartRows
        .map(row => ({
            x: chartNumber(row[xIndex]),
            y: chartNumber(row[yIndex]),
            label: displayValue(row[xIndex]),
        }))
        .filter(
            (point): point is { x: number; y: number; label: string } =>
                point.x !== null && point.y !== null,
        );
    const scatterSummary = `${chartText(chartCopy.plottedPoints, { points: formatCount(scatterPoints.length) })}${chartRows.length < result.rows.length ? ` · ${rowSummary}` : ''}`;
    // A zero baseline compresses offset values such as release years into one corner.
    const scatterMinX = scatterPoints.length ? Math.min(...scatterPoints.map(point => point.x)) : 0;
    const scatterMaxX = scatterPoints.length ? Math.max(...scatterPoints.map(point => point.x)) : 0;
    const scatterMinY = scatterPoints.length ? Math.min(...scatterPoints.map(point => point.y)) : 0;
    const scatterMaxY = scatterPoints.length ? Math.max(...scatterPoints.map(point => point.y)) : 0;
    const xValues =
        scatterMinX === scatterMaxX
            ? [scatterMinX]
            : [scatterMinX, (scatterMinX + scatterMaxX) / 2, scatterMaxX];
    const yValues =
        scatterMinY === scatterMaxY
            ? [scatterMinY]
            : [scatterMaxY, (scatterMinY + scatterMaxY) / 2, scatterMinY];
    // Keep nearby values distinguishable, including years that all round to "2K".
    const scatterXNumber = scatterNumberFormat(xValues, compactNumber);
    const scatterNumber = scatterNumberFormat(yValues, compactNumber);
    const scatterRangeX = scatterMaxX - scatterMinX || 1;
    const scatterRangeY = scatterMaxY - scatterMinY || 1;
    const scatterX = (value: number) =>
        scatterMinX === scatterMaxX
            ? (plotLeft + plotRight) / 2
            : plotLeft + ((value - scatterMinX) / scatterRangeX) * plotWidth;
    const scatterY = (value: number) =>
        scatterMinY === scatterMaxY
            ? plotMiddle
            : plotBottom - ((value - scatterMinY) / scatterRangeY) * plotHeight;
    let chartYTicks;

    if (chartKind === 'scatter') {
        chartYTicks = yValues.map(value => ({ value, position: scatterY(value) }));
    } else if (min === max) {
        chartYTicks = [{ value: min, position: plotBottom }];
    } else {
        chartYTicks = [
            { value: max, position: plotTop },
            { value: (min + max) / 2, position: plotMiddle },
            { value: min, position: plotBottom },
        ];
    }
    let chartXTicks: ChartAxisTick[];

    if (chartKind === 'scatter') {
        chartXTicks = xValues.map(value => ({
            label: scatterXNumber.format(value),
            position: scatterX(value),
        }));
    } else if (categoricalAxis) {
        chartXTicks =
            plotSeries[0]?.points.map((point, index) => ({
                label: point.label,
                position: x(index),
            })) ?? [];
    } else {
        chartXTicks = chartRows.map((row, index) => ({
            label: displayValue(row[xIndex]),
            position: x(index),
        }));
    }
    chartXTicks = categoricalAxis ? fitCategoryTicks(chartXTicks) : fitChartTicks(chartXTicks);
    return {
        chartYTicks,
        scatterPoints,
        scatterX,
        scatterY,
        chartXTicks,
        scatterSummary,
        scatterNumber,
    };
}
