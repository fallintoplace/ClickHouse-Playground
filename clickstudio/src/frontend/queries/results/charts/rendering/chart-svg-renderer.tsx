import type { CSSProperties, RefCallback } from 'react';
import { MAX_CHART_RENDER_POINTS } from '../../../../../shared/queries/results/results';
import { formatCount, seriesColor, splitChartSegments } from '../chart-helpers';
import type { ChartSvgModel } from './chart-svg-model';
import { ChartAxisLabels } from '../ChartAxisLabels';

export function createChartSvgRenderer(
    {
        viewportWidth,
        viewportHeight,
        plotRight,
        chartAriaLabel,
        plotTop,
        plotMiddle,
        plotBottom,
        plotLeft,
        chartYTicks,
        compactNumber,
        chartKind,
        zeroY,
        scatterPoints,
        scatterX,
        scatterY,
        result,
        xIndex,
        yIndex,
        plotSeries,
        x,
        y,
        barWidth,
        chartRows,
        chartXTicks,
    }: ChartSvgModel,
    onPlotViewport: RefCallback<SVGSVGElement>,
) {
    return (categoricalAxis: boolean) => {
        const renderSeries = () => {
            switch (chartKind) {
                case 'scatter':
                    return scatterPoints.map((point, index) => (
                        <circle
                            key={index}
                            cx={scatterX(point.x)}
                            cy={scatterY(point.y)}
                            r="3.5"
                            className="chart-point"
                            style={{ fill: seriesColor(0), stroke: seriesColor(0) }}
                        >
                            <title>{`${result.columns[xIndex]?.name}: ${formatCount(point.x)} · ${result.columns[yIndex]?.name}: ${formatCount(point.y)}`}</title>
                        </circle>
                    ));

                case 'line':
                    return plotSeries.map(series => {
                        const segments = splitChartSegments(series.points);
                        return (
                            <g
                                key={series.columnIndex}
                                style={{ '--series-color': series.color } as CSSProperties}
                            >
                                {segments
                                    .filter(points => points.length > 1)
                                    .map((points, index) => (
                                        <polygon
                                            key={`area-${index}`}
                                            points={`${x(points[0]!.index)},${zeroY} ${points.map(point => `${x(point.index)},${y(point.value!)}`).join(' ')} ${x(points.at(-1)!.index)},${zeroY}`}
                                            className="chart-area-fill"
                                        />
                                    ))}
                                {segments.map((points, index) => (
                                    <polyline
                                        key={`line-${index}`}
                                        points={points
                                            .map(point => `${x(point.index)},${y(point.value!)}`)
                                            .join(' ')}
                                        pathLength={1}
                                        className="chart-line"
                                    />
                                ))}
                                {series.points
                                    .filter(point => point.value !== null)
                                    .map(point => (
                                        <circle
                                            key={point.index}
                                            cx={x(point.index)}
                                            cy={y(point.value!)}
                                            r="3.5"
                                            className="chart-point"
                                        >
                                            <title>{`${point.label}: ${result.columns[series.columnIndex]?.name} ${point.value}`}</title>
                                        </circle>
                                    ))}
                            </g>
                        );
                    });

                default:
                    return plotSeries.flatMap((series, seriesIndex) =>
                        series.points.flatMap(point => {
                            if (point.value === null) return [];
                            const valueY = y(point.value),
                                top = Math.min(zeroY, valueY),
                                height = Math.max(1, Math.abs(valueY - zeroY));
                            const groupOffset =
                                (seriesIndex - (plotSeries.length - 1) / 2) * barWidth;
                            const disableBarAnimation = chartRows.length > MAX_CHART_RENDER_POINTS;
                            return [
                                <rect
                                    key={`${series.columnIndex}-${point.index}`}
                                    x={x(point.index) + groupOffset - barWidth / 2}
                                    y={top}
                                    width={barWidth}
                                    height={height}
                                    rx="3"
                                    className={`chart-bar${disableBarAnimation ? ' chart-bar--static' : ''}`}
                                    style={
                                        {
                                            '--series-color': series.color,
                                            strokeWidth: Math.min(1, barWidth * 0.4),
                                            ...(disableBarAnimation
                                                ? {}
                                                : { animationDelay: `${point.index * 20}ms` }),
                                        } as CSSProperties
                                    }
                                >
                                    <title>{`${point.label}: ${result.columns[series.columnIndex]?.name} ${point.value}`}</title>
                                </rect>,
                            ];
                        }),
                    );
            }
        };
        return (
            <svg
                ref={categoricalAxis ? undefined : onPlotViewport}
                className={categoricalAxis ? 'chart-category-plot' : undefined}
                viewBox={`0 0 ${categoricalAxis ? plotRight : viewportWidth} ${viewportHeight}`}
                preserveAspectRatio={categoricalAxis ? 'none' : undefined}
                role="img"
                aria-label={chartAriaLabel}
            >
                {[plotTop, plotMiddle, plotBottom].map(value => (
                    <line
                        key={value}
                        x1={plotLeft}
                        x2={plotRight}
                        y1={value}
                        y2={value}
                        className="chart-gridline"
                    />
                ))}
                {!categoricalAxis &&
                    chartYTicks.map(tick => (
                        <text
                            key={`${tick.position}-${tick.value}`}
                            className="chart-y-tick-label"
                            x={plotLeft - 24}
                            y={tick.position}
                            textAnchor="end"
                            dominantBaseline="middle"
                        >
                            {compactNumber.format(tick.value)}
                        </text>
                    ))}
                {chartKind !== 'scatter' && (
                    <line
                        x1={plotLeft}
                        x2={plotRight}
                        y1={zeroY}
                        y2={zeroY}
                        className="chart-zero-line"
                    />
                )}
                {renderSeries()}
                <ChartAxisLabels ticks={chartXTicks} y={categoricalAxis ? plotBottom + 18 : 218} />
            </svg>
        );
    };
}
