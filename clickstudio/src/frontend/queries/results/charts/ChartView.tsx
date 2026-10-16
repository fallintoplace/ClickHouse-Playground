import { useMemo } from 'react';
import { GeoView } from '../maps/GeoView';
import type { Result } from '../../../../shared/queries/results/types';
import type { Draft } from '../../editor/drafts/workspace-state';
import type { Copy } from '../../../ui/copy';
import { RowCountChart } from './types/RowCountChart';
import { useChartPlotWidth } from './useChartPlotWidth';
import { prepareChartSelection } from './controls/chart-selection';
import { prepareChartView } from './rendering/chart-view-model';
import { renderCandlestickChart } from './types/candlestick-chart-view';
import { createChartSvgRenderer } from './rendering/chart-svg-renderer';
import { Spinner } from '../../../ui/components/primitives';
import { renderChartWorkspace } from './controls/chart-workspace';
import type { LargeCellRunContext } from '../large-cell-actions';

export function ChartView({
    result,
    loading,
    chart,
    onChart,
    toolbarContainer,
    copy,
    largeCellContext,
}: {
    result?: Result;
    loading: boolean;
    chart: Draft['chart'];
    onChart: (chart: Draft['chart']) => void;
    toolbarContainer?: HTMLElement | null;
    copy: Copy;
    largeCellContext?: LargeCellRunContext;
}) {
    const {
        width: categoryViewportWidth,
        height: categoryViewportHeight,
        onViewport: onCategoryViewport,
    } = useChartPlotWidth();
    const { width: plotViewportWidth, onViewport: onPlotViewport } =
        useChartPlotWidth<SVGSVGElement>(230);
    const chartCopy = copy.chart;
    const selection = useMemo(
        () => (result ? prepareChartSelection(result, chart) : undefined),
        [result, chart],
    );
    if (loading || !result)
        return (
            <div className="result-loading">
                <Spinner />
                <span>{chartCopy.preparing}</span>
            </div>
        );
    if (!result.columns.length) return <div className="chart-empty">{chartCopy.noColumns}</div>;

    if (!selection) return null;
    const visibleChart =
        chart.kind === 'geography' && !selection.geography
            ? { ...chart, kind: 'table' as const }
            : chart;
    if (chart.kind === 'geography' && selection.geography)
        return (
            <GeoView
                result={result}
                chart={chart}
                onChart={onChart}
                selection={selection}
                recommendation={selection.geography}
                copy={chartCopy}
                toolbarContainer={toolbarContainer}
                largeCellContext={largeCellContext}
            />
        );
    const { suggestion, numericIndexes } = selection;
    if (
        visibleChart.kind === 'candlestick' ||
        (visibleChart.kind === 'table' && suggestion.config.kind === 'candlestick')
    )
        return renderCandlestickChart({
            result,
            chart: visibleChart,
            onChart,
            chartCopy,
            selection,
            toolbarContainer,
        });
    if (!numericIndexes.length)
        return (
            <RowCountChart
                result={result}
                chart={visibleChart}
                suggestion={suggestion}
                geography={selection.geography}
                onChart={onChart}
                toolbarContainer={toolbarContainer}
                copy={chartCopy}
            />
        );
    const model = prepareChartView({
        result,
        chart: visibleChart,
        chartCopy,
        categoryViewportWidth,
        categoryViewportHeight,
        plotViewportWidth: plotViewportWidth || 760,
        selection,
    });
    const renderChartSvg = createChartSvgRenderer(model.svg, onPlotViewport);
    return renderChartWorkspace({
        ...model,
        onChart,
        onCategoryViewport,
        renderChartSvg,
        toolbarContainer,
    });
}
