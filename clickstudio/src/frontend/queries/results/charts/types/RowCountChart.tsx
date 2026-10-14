import type { RefCallback } from 'react';
import type { recommendChart } from '../../../../../shared/queries/results/results';
import {
    type RowCountSeries,
    countRowsByCategory,
    countRowsOverTime,
    MAX_CHART_RENDER_POINTS,
    numericType,
    temporalType,
} from '../../../../../shared/queries/results/results';
import type { Result } from '../../../../../shared/queries/results/types';
import type { Draft } from '../../../editor/drafts/workspace-state';
import type { Copy } from '../../../../ui/copy';
import { ScrollEdgeFrame } from '../../../../ui/components/ScrollEdgeShadows';
import { SelectControl } from '../../../../ui/components/SelectControl';
import { ChartToolbar } from '../ChartToolbar';
import { ChartCanvas, ChartPlot } from '../rendering/chart-canvas';
import type { ChartPlotModel } from '../rendering/chart-canvas';
import {
    categoryAxisLayout,
    chartPlotBounds,
    chartText,
    fitCategoryTicks,
    fitChartTicks,
    formatCount,
    seriesColor,
} from '../chart-helpers';
import { useChartPlotWidth } from '../useChartPlotWidth';

export function RowCountChart({
    result,
    chart,
    suggestion,
    onChart,
    toolbarContainer,
    copy,
}: {
    result: Result;
    chart: Draft['chart'];
    suggestion: ReturnType<typeof recommendChart>;
    onChart: (chart: Draft['chart']) => void;
    toolbarContainer?: HTMLElement | null;
    copy: Copy['chart'];
}) {
    const {
        width: categoryViewportWidth,
        height: categoryViewportHeight,
        onViewport: onCategoryViewport,
    } = useChartPlotWidth();
    const { width: plotViewportWidth, onViewport: onPlotViewport } =
        useChartPlotWidth<SVGSVGElement>(230);
    const viewportWidth = plotViewportWidth || 760;
    const dimensions = result.columns.flatMap((column, index) =>
        numericType(column.type) ? [] : [index],
    );
    if (!dimensions.length) return <div className="chart-empty">{copy.noDimensions}</div>;
    const usesSuggestion = chart.kind === 'table' || !dimensions.includes(chart.x);
    const xIndex = usesSuggestion ? suggestion.config.x : chart.x;
    const timeAxis = temporalType(result.columns[xIndex]?.type ?? '');
    const breakdowns = dimensions.filter(
        index => index !== xIndex && !temporalType(result.columns[index]?.type ?? ''),
    );
    const defaultGroupBy = usesSuggestion ? suggestion.config.groupBy : chart.groupBy;
    const groupByIndex =
        timeAxis && defaultGroupBy !== undefined && breakdowns.includes(defaultGroupBy)
            ? defaultGroupBy
            : undefined;
    const countData = timeAxis ? countRowsOverTime(result.rows, xIndex, groupByIndex) : undefined;
    const categoryData = !timeAxis ? countRowsByCategory(result.rows, xIndex) : undefined;
    const series = countData?.series ?? [];
    const allTimePoints = series
        .flatMap(item => item.points)
        .sort((left, right) => left.timestamp - right.timestamp);
    const timeTicks = [...new Map(allTimePoints.map(point => [point.timestamp, point])).values()];
    const counts = timeAxis
        ? allTimePoints.map(point => point.count)
        : (categoryData?.map(group => group.count) ?? []);
    const max = Math.max(0, ...counts);
    const min = 0;
    const range = max || 1;
    const bars = categoryData ?? [];
    const categoryLayout = timeAxis
        ? undefined
        : categoryAxisLayout(
              bars.map(group => group.label),
              categoryViewportWidth,
          );
    const plotLeft = timeAxis ? 80 : 0,
        plotRight = categoryLayout?.width ?? viewportWidth - 28,
        plotWidth = plotRight - plotLeft;
    const { viewportHeight, plotTop, plotBottom, plotMiddle, plotHeight } = chartPlotBounds(
        !timeAxis,
        categoryViewportHeight,
    );
    const y = (value: number) => plotBottom - (value / range) * plotHeight;
    const timeMin = allTimePoints[0]?.timestamp ?? 0;
    const timeMax = allTimePoints.at(-1)?.timestamp ?? timeMin;
    const xTime = (timestamp: number) =>
        plotLeft +
        (timeMax === timeMin ? 0.5 : (timestamp - timeMin) / (timeMax - timeMin)) * plotWidth;
    const xCategory = (index: number, length: number) =>
        categoryLayout?.positions[index] ??
        plotLeft + (length <= 1 ? 0.5 : index / (length - 1)) * plotWidth;
    const ticks = timeAxis
        ? timeTicks.map(point => ({ label: point.label, position: xTime(point.timestamp) }))
        : bars.map((group, index) => ({
              label: group.label,
              position: xCategory(index, bars.length),
          }));
    const fittedTicks = timeAxis ? fitChartTicks(ticks) : fitCategoryTicks(ticks);
    const valueFormatter = new Intl.NumberFormat('en', {
        notation: 'compact',
        maximumFractionDigits: 1,
    });
    const barStep = categoryLayout?.minimumSlotWidth ?? plotWidth / Math.max(1, bars.length);
    const barWidth = Math.min(32, barStep * 0.64);
    const hasRows = result.rows.length > 0;
    const noTimeValues = timeAxis && !series.length;
    const dimensionName = result.columns[xIndex]?.name ?? '';
    const groupName = groupByIndex === undefined ? '' : (result.columns[groupByIndex]?.name ?? '');
    const describeRowCountChart = () => {
        let generatedTitle: string;

        if (timeAxis) {
            if (groupByIndex === undefined) {
                generatedTitle = 'Rows over time';
            } else {
                generatedTitle = `Rows over time by ${groupName}`;
            }
        } else {
            generatedTitle = `Rows by ${dimensionName}`;
        }
        const customTitle =
            chart.title.trim() &&
            !['Query result', generatedTitle, suggestion.config.title].includes(chart.title)
                ? chart.title
                : undefined;
        let timeUnit: string;

        switch (countData?.unit) {
            case 'minute':
                timeUnit = copy.minutes;
                break;
            case 'hour':
                timeUnit = copy.hours;
                break;
            case 'day':
                timeUnit = copy.days;
                break;
            case 'week':
                timeUnit = copy.weeks;
                break;
            case 'month':
                timeUnit = copy.months;
                break;
            default:
                timeUnit = '';
                break;
        }
        let chartAriaLabel: string;

        if (timeAxis) {
            if (groupByIndex === undefined) {
                chartAriaLabel = copy.rowsOverTime;
            } else {
                chartAriaLabel = chartText(copy.rowsOverTimeBy, { dimension: groupName });
            }
        } else {
            chartAriaLabel = chartText(copy.rowsBy, { dimension: dimensionName });
        }
        return { customTitle, timeUnit, chartAriaLabel };
    };
    const { customTitle, timeUnit, chartAriaLabel } = describeRowCountChart();
    const svg: ChartPlotModel = {
        viewportWidth,
        viewportHeight,
        plotRight,
        chartAriaLabel,
        plotTop,
        plotMiddle,
        plotBottom,
        plotLeft,
        chartYTicks: [
            { value: max, position: plotTop },
            { value: max / 2, position: plotMiddle },
            { value: min, position: plotBottom },
        ],
        compactNumber: valueFormatter,
        chartKind: timeAxis ? 'line' : 'bar',
        zeroY: plotBottom,
        chartXTicks: fittedTicks,
    };
    const renderChartSvg = createRowCountSvgRenderer(svg, {
        onPlotViewport,
        timeAxis,
        series,
        xTime,
        y,
        copy,
        bars,
        xCategory,
        barWidth,
    });

    return (
        <ScrollEdgeFrame<HTMLDivElement> className="chart-workspace-frame">
            {ref => {
                const renderChartContent = () => {
                    if (!hasRows) {
                        return <div className="chart-empty">{copy.noRetainedRows}</div>;
                    }

                    if (noTimeValues) {
                        return <div className="chart-empty">{copy.noValidTimeValues}</div>;
                    }

                    return (
                        <ChartCanvas
                            model={svg}
                            categoricalAxis={!timeAxis}
                            onCategoryViewport={onCategoryViewport}
                            renderChartSvg={renderChartSvg}
                        />
                    );
                };
                return (
                    <div ref={ref} className="chart-workspace animate-enter">
                        <RowCountChartToolbar
                            result={result}
                            chart={chart}
                            copy={copy}
                            xIndex={xIndex}
                            dimensions={dimensions}
                            timeAxis={timeAxis}
                            groupByIndex={groupByIndex}
                            breakdowns={breakdowns}
                            customTitle={customTitle}
                            onChart={onChart}
                            toolbarContainer={toolbarContainer}
                        />
                        {renderChartContent()}
                        <div className="chart-footer">
                            <span className="chart-legend">
                                {(timeAxis ? series : [{ key: 'rows', label: copy.rowsLabel }]).map(
                                    (item, index) => (
                                        <span key={item.key}>
                                            <span
                                                className="chart-legend-dot"
                                                style={{
                                                    backgroundColor: seriesColor(index),
                                                    color: seriesColor(index),
                                                }}
                                            />
                                            {item.label}
                                        </span>
                                    ),
                                )}
                            </span>
                            <span>
                                {timeAxis
                                    ? `${chartText(copy.timeSummary, { buckets: formatCount(timeTicks.length), unit: timeUnit, rows: formatCount(result.rows.length) })}${countData?.excludedRows ? ` · ${chartText(copy.invalidDatesSkipped, { count: formatCount(countData.excludedRows) })}` : ''}`
                                    : chartText(copy.categorySummary, {
                                          categories: formatCount(bars.length),
                                          rows: formatCount(result.rows.length),
                                      })}
                                <i>·</i>{' '}
                                {result.completeness === 'truncated'
                                    ? copy.retainedPrefixOnly
                                    : copy.completeQueryResult}
                            </span>
                        </div>
                    </div>
                );
            }}
        </ScrollEdgeFrame>
    );
}

function RowCountChartToolbar({
    result,
    chart,
    copy,
    xIndex,
    dimensions,
    timeAxis,
    groupByIndex,
    breakdowns,
    customTitle,
    onChart,
    toolbarContainer,
}: {
    result: Result;
    chart: Draft['chart'];
    copy: Copy['chart'];
    xIndex: number;
    dimensions: number[];
    timeAxis: boolean;
    groupByIndex: number | undefined;
    breakdowns: number[];
    customTitle: string | undefined;
    onChart: (chart: Draft['chart']) => void;
    toolbarContainer?: HTMLElement | null;
}) {
    return (
        <ChartToolbar portalTarget={toolbarContainer}>
            <div className="chart-control-field">
                <SelectControl
                    className="chart-select"
                    compactMenu
                    label={copy.xAxis}
                    menuHeading={copy.xAxis}
                    value={String(xIndex)}
                    searchable={dimensions.length >= 8}
                    onChange={value => {
                        const nextX = Number(value);
                        const nextTime = temporalType(result.columns[nextX]?.type ?? '');
                        const nextGroupBy = nextTime
                            ? (groupByIndex ??
                              dimensions.find(
                                  index =>
                                      index !== nextX &&
                                      !temporalType(result.columns[index]?.type ?? ''),
                              ))
                            : undefined;
                        let nextTitle: string;

                        if (nextTime) {
                            if (nextGroupBy === undefined) {
                                nextTitle = 'Rows over time';
                            } else {
                                nextTitle = `Rows over time by ${result.columns[nextGroupBy]?.name}`;
                            }
                        } else {
                            nextTitle = `Rows by ${result.columns[nextX]?.name}`;
                        }
                        onChart({
                            ...chart,
                            kind: nextTime ? 'line' : 'bar',
                            x: nextX,
                            groupBy: nextGroupBy,
                            ys: [],
                            title: customTitle ?? nextTitle,
                        });
                    }}
                    options={dimensions.map(index => ({
                        value: String(index),
                        label: result.columns[index]?.name ?? '',
                    }))}
                />
            </div>
            {timeAxis && breakdowns.length > 0 && (
                <div className="chart-control-field">
                    <SelectControl
                        className="chart-select"
                        compactMenu
                        label={copy.breakdownBy}
                        menuHeading={copy.breakdownBy}
                        value={groupByIndex === undefined ? '' : String(groupByIndex)}
                        searchable={breakdowns.length >= 8}
                        onChange={value => {
                            const nextGroupBy = value === '' ? undefined : Number(value);
                            onChart({
                                ...chart,
                                kind: 'line',
                                x: xIndex,
                                groupBy: nextGroupBy,
                                ys: [],
                                title:
                                    customTitle ??
                                    (nextGroupBy === undefined
                                        ? 'Rows over time'
                                        : `Rows over time by ${result.columns[nextGroupBy]?.name}`),
                            });
                        }}
                        options={[
                            { value: '', label: copy.allRows },
                            ...breakdowns.map(index => ({
                                value: String(index),
                                label: result.columns[index]?.name ?? '',
                            })),
                        ]}
                    />
                </div>
            )}
            <span className="chart-row-count-type">
                <span className="chart-legend-dot" />
                {copy.rowsLabel}
            </span>
        </ChartToolbar>
    );
}

function createRowCountSvgRenderer(
    model: ChartPlotModel,
    {
        onPlotViewport,
        timeAxis,
        series,
        xTime,
        y,
        copy,
        bars,
        xCategory,
        barWidth,
    }: {
        onPlotViewport: RefCallback<SVGSVGElement>;
        timeAxis: boolean;
        series: RowCountSeries[];
        xTime: (timestamp: number) => number;
        y: (value: number) => number;
        copy: Copy['chart'];
        bars: { key: string; label: string; count: number }[];
        xCategory: (index: number, length: number) => number;
        barWidth: number;
    },
) {
    const { plotBottom } = model;
    return (categoricalAxis: boolean) => (
        <ChartPlot model={model} categoricalAxis={categoricalAxis} onPlotViewport={onPlotViewport}>
            {timeAxis
                ? series.map((item, seriesIndex) => (
                      <g key={item.key} style={{ '--series-color': seriesColor(seriesIndex) }}>
                          {item.points.length > 1 && (
                              <polyline
                                  points={item.points
                                      .map(point => `${xTime(point.timestamp)},${y(point.count)}`)
                                      .join(' ')}
                                  pathLength={1}
                                  className="chart-line"
                              />
                          )}
                          {item.points.map(point => (
                              <circle
                                  key={`${item.key}-${point.timestamp}`}
                                  cx={xTime(point.timestamp)}
                                  cy={y(point.count)}
                                  r="3.5"
                                  className="chart-point"
                              >
                                  <title>
                                      {chartText(copy.timePointTooltip, {
                                          bucket: point.label,
                                          series: item.label,
                                          count: formatCount(point.count),
                                      })}
                                  </title>
                              </circle>
                          ))}
                      </g>
                  ))
                : bars.map((group, index) => {
                      const valueY = y(group.count),
                          top = Math.min(plotBottom, valueY),
                          height = Math.max(1, plotBottom - valueY);
                      const disableBarAnimation = bars.length > MAX_CHART_RENDER_POINTS;
                      return (
                          <rect
                              key={group.key}
                              x={xCategory(index, bars.length) - barWidth / 2}
                              y={top}
                              width={barWidth}
                              height={height}
                              rx="3"
                              className={`chart-bar${disableBarAnimation ? ' chart-bar--static' : ''}`}
                              style={{
                                  '--series-color': seriesColor(0),
                                  strokeWidth: Math.min(1, barWidth * 0.4),
                                  ...(disableBarAnimation
                                      ? {}
                                      : { animationDelay: `${index * 25}ms` }),
                              }}
                          >
                              <title>
                                  {chartText(copy.categoryBarTooltip, {
                                      category: group.label,
                                      count: formatCount(group.count),
                                  })}
                              </title>
                          </rect>
                      );
                  })}
        </ChartPlot>
    );
}
