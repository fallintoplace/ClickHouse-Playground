import type { RefCallback } from 'react';
import { displayValue, numericType } from '../../../../../shared/queries/results/results';
import type { Draft } from '../../../editor/drafts/workspace-state';
import { ScrollEdgeFrame } from '../../../../ui/components/ScrollEdgeShadows';
import { chartText, formatCount, seriesColor } from '../chart-helpers';
import type { prepareChartView } from '../rendering/chart-view-model';
import type { createChartSvgRenderer } from '../rendering/chart-svg-renderer';
import { renderChartControls } from './chart-controls';
import { HeatmapGrid } from '../types/HeatmapGrid';
import { ChartCanvas } from '../rendering/chart-canvas';

export function renderChartWorkspace({
    chartKind,
    result,
    chartCopy,
    canChooseCandlestick,
    geography,
    onChart,
    chart,
    candleX,
    inferredCandle,
    groupByIndex,
    xIndex,
    yIndex,
    measureIndexes,
    numericIndexes,
    availableMeasures,
    heatmapTooLarge,
    heatmap,
    heatmapXLabels,
    heatmapYLabels,
    heatmapMaximum,
    compactNumber,
    values,
    categoricalAxis,
    svg,
    onCategoryViewport,
    renderChartSvg,
    toolbarContainer,
    scatterSummary,
    rowSummary,
}: ReturnType<typeof prepareChartView> & {
    onChart: (chart: Draft['chart']) => void;
    onCategoryViewport: RefCallback<HTMLDivElement>;
    renderChartSvg: ReturnType<typeof createChartSvgRenderer>;
    toolbarContainer?: HTMLElement | null;
}) {
    return (
        <ScrollEdgeFrame<HTMLDivElement> className="chart-workspace-frame">
            {ref => {
                const renderChartContent = () => {
                    switch (chartKind) {
                        case 'number':
                            if (result.rows.length !== 1) {
                                return (
                                    <div className="chart-empty">{chartCopy.numberNeedsOneRow}</div>
                                );
                            }

                            if (!numericType(result.columns[yIndex]?.type ?? '')) {
                                return (
                                    <div className="chart-empty">
                                        {chartCopy.chooseNumericColumn}
                                    </div>
                                );
                            }

                            return (
                                <div className="chart-number-card">
                                    <span className="eyebrow">{chartCopy.singleValue}</span>
                                    <strong>{displayValue(result.rows[0]?.[yIndex])}</strong>
                                    <span>{result.columns[yIndex]?.name}</span>
                                    <small>{chartCopy.exactResultValue}</small>
                                </div>
                            );

                        case 'heatmap':
                            if (
                                !heatmap ||
                                groupByIndex === undefined ||
                                heatmap.present.size === 0
                            ) {
                                return (
                                    <div className="chart-empty">
                                        {chartCopy.heatmapNeedsDimensions}
                                    </div>
                                );
                            }

                            return (
                                <HeatmapGrid
                                    {...{
                                        chartCopy,
                                        result,
                                        yIndex,
                                        groupByIndex,
                                        xIndex,
                                        heatmapXLabels,
                                        heatmapYLabels,
                                        heatmap,
                                        heatmapMaximum,
                                        compactNumber,
                                    }}
                                />
                            );
                        case 'scatter':
                            if (
                                xIndex === yIndex ||
                                !numericIndexes.includes(xIndex) ||
                                !numericIndexes.includes(yIndex)
                            ) {
                                return (
                                    <div className="chart-empty">
                                        {chartCopy.scatterNeedsTwoNumeric}
                                    </div>
                                );
                            }
                            break;
                    }

                    if (!values.length) {
                        return <div className="chart-empty">{chartCopy.chooseNumericMeasure}</div>;
                    }

                    return (
                        <ChartCanvas
                            model={svg}
                            categoricalAxis={categoricalAxis}
                            onCategoryViewport={onCategoryViewport}
                            renderChartSvg={renderChartSvg}
                        />
                    );
                };
                const renderLegend = () => {
                    switch (chartKind) {
                        case 'heatmap':
                            return (
                                <>
                                    <span className="chart-legend-dot" />
                                    {result.columns[yIndex]?.name}
                                </>
                            );

                        case 'line':
                        case 'bar':
                            return measureIndexes.map((index, seriesIndex) => (
                                <span key={index}>
                                    <span
                                        className="chart-legend-dot"
                                        style={{
                                            backgroundColor: seriesColor(seriesIndex),
                                            color: seriesColor(seriesIndex),
                                        }}
                                    />
                                    {result.columns[index]?.name}
                                </span>
                            ));

                        default:
                            return (
                                <>
                                    <span
                                        className="chart-legend-dot"
                                        style={{
                                            backgroundColor: seriesColor(0),
                                            color: seriesColor(0),
                                        }}
                                    />
                                    {result.columns[yIndex]?.name}
                                </>
                            );
                    }
                };
                const getRowSummary = () => {
                    switch (chartKind) {
                        case 'number':
                            if (result.rows.length === 1) {
                                return chartCopy.oneValue;
                            }

                            return chartText(chartCopy.retainedRows, {
                                rows: formatCount(result.rows.length),
                            });

                        case 'heatmap':
                            return chartText(chartCopy.populatedCells, {
                                cells: formatCount(heatmap?.cells.size ?? 0),
                                rows: formatCount(
                                    heatmapTooLarge
                                        ? (heatmap?.processedRows ?? 0)
                                        : result.rows.length,
                                ),
                            });

                        case 'scatter':
                            return scatterSummary;

                        default:
                            return rowSummary;
                    }
                };
                return (
                    <div ref={ref} className="chart-workspace animate-enter">
                        {renderChartControls({
                            chartKind,
                            result,
                            chartCopy,
                            canChooseCandlestick,
                            geography,
                            onChart,
                            chart,
                            candleX,
                            inferredCandle,
                            groupByIndex,
                            xIndex,
                            yIndex,
                            measureIndexes,
                            numericIndexes,
                            availableMeasures,
                            toolbarContainer,
                        })}
                        {renderChartContent()}
                        <div className="chart-footer">
                            <span className="chart-legend">{renderLegend()}</span>
                            <span>
                                {getRowSummary()} <i>·</i>{' '}
                                {result.completeness === 'truncated'
                                    ? chartCopy.retainedPrefixOnly
                                    : chartCopy.completeQueryResult}
                            </span>
                        </div>
                    </div>
                );
            }}
        </ScrollEdgeFrame>
    );
}
