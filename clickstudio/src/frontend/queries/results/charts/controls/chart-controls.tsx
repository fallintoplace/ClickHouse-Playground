import type { ChartKind } from '../../../../../shared/queries/results/chart-types';
import { MAX_CHART_SERIES } from '../../../../../shared/queries/results/results';
import type { CandlestickConfig } from '../../../../../shared/queries/results/chart-settings';
import type { Result } from '../../../../../shared/queries/results/types';
import type { Draft } from '../../../editor/drafts/workspace-state';
import type { Copy } from '../../../../ui/copy';
import { SelectControl } from '../../../../ui/components/SelectControl';
import { ChartPopover, ChartToolbar } from '../ChartToolbar';
import { ChartTypeSelect } from './ChartTypeSelect';
import type { GeoRecommendation } from '../../maps/geo';
import { chartText, seriesColor } from '../chart-helpers';

export function renderChartControls({
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
}: {
    chartKind: Exclude<ChartKind, 'table'>;
    result: Result;
    chartCopy: Copy['chart'];
    canChooseCandlestick: boolean;
    geography: GeoRecommendation | undefined;
    onChart: (chart: Draft['chart']) => void;
    chart: Draft['chart'];
    candleX: number;
    inferredCandle: CandlestickConfig | undefined;
    groupByIndex: number | undefined;
    xIndex: number;
    yIndex: number;
    measureIndexes: number[];
    numericIndexes: number[];
    availableMeasures: number[];
    toolbarContainer?: HTMLElement | null;
}) {
    return (
        <ChartToolbar portalTarget={toolbarContainer}>
            <div className="chart-control-field">
                <ChartTypeSelect
                    kind={chartKind}
                    chart={chart}
                    result={result}
                    selection={{ numericIndexes, canChooseCandlestick, geography }}
                    copy={chartCopy}
                    onChart={onChart}
                    onChange={value => {
                        if (value === 'candlestick') {
                            onChart({
                                ...chart,
                                kind: 'candlestick',
                                x: candleX,
                                ys: [],
                                candlestick: inferredCandle ?? {},
                            });
                            return;
                        }
                        const nextGroupBy =
                            value === 'heatmap'
                                ? (groupByIndex ??
                                  result.columns.findIndex(
                                      (_column, index) => index !== xIndex && index !== yIndex,
                                  ))
                                : undefined;
                        onChart({
                            ...chart,
                            kind: value,
                            groupBy:
                                nextGroupBy !== undefined && nextGroupBy >= 0
                                    ? nextGroupBy
                                    : undefined,
                            ys: value === 'line' || value === 'bar' ? measureIndexes : [yIndex],
                        });
                    }}
                />
            </div>
            {chartKind !== 'number' && (
                <div className="chart-control-field">
                    <SelectControl
                        className="chart-select"
                        compactMenu
                        label={chartKind === 'scatter' ? chartCopy.xAxisMeasure : chartCopy.xAxis}
                        menuHeading={
                            chartKind === 'scatter' ? chartCopy.xAxisMeasure : chartCopy.xAxis
                        }
                        value={String(xIndex)}
                        hideDisabledOptions
                        searchable={result.columns.length >= 8}
                        onChange={value => {
                            const nextX = Number(value);
                            const nextGroupCandidate =
                                chartKind === 'heatmap' && nextX === groupByIndex
                                    ? result.columns.findIndex(
                                          (_column, index) => index !== nextX && index !== yIndex,
                                      )
                                    : groupByIndex;
                            const nextGroupBy =
                                nextGroupCandidate !== undefined && nextGroupCandidate >= 0
                                    ? nextGroupCandidate
                                    : undefined;
                            onChart({
                                ...chart,
                                x: nextX,
                                groupBy: nextGroupBy,
                                ys: measureIndexes.filter(
                                    index => index !== nextX && index !== nextGroupBy,
                                ),
                            });
                        }}
                        options={result.columns.map((column, index) => ({
                            value: String(index),
                            label: column.name,
                            disabled:
                                chartKind === 'scatter'
                                    ? !numericIndexes.includes(index) || index === yIndex
                                    : index === yIndex || index === groupByIndex,
                        }))}
                    />
                </div>
            )}
            {chartKind === 'heatmap' && (
                <div className="chart-control-field">
                    <SelectControl
                        className="chart-select"
                        compactMenu
                        label={chartCopy.yAxis}
                        menuHeading={chartCopy.yAxis}
                        value={String(groupByIndex ?? -1)}
                        hideDisabledOptions
                        searchable={result.columns.length >= 8}
                        onChange={value => onChart({ ...chart, groupBy: Number(value) })}
                        options={result.columns.map((column, index) => ({
                            value: String(index),
                            label: column.name,
                            disabled: index === xIndex || index === yIndex,
                        }))}
                    />
                </div>
            )}
            {chartKind === 'line' || chartKind === 'bar' ? (
                availableMeasures.length > 1 && (
                    <ChartPopover
                        label={chartCopy.measures}
                        closeLabel={chartCopy.closeControls}
                        triggerClassName="chart-measures-trigger"
                        popoverClassName="chart-measures-popover"
                        trigger={
                            <>
                                <span
                                    className="chart-legend-dot"
                                    style={{
                                        backgroundColor: seriesColor(0),
                                        color: seriesColor(0),
                                    }}
                                />
                                <span
                                    className="chart-measure-summary"
                                    title={measureIndexes
                                        .map(index => result.columns[index]?.name)
                                        .join(', ')}
                                >
                                    {result.columns[yIndex]?.name}
                                    {measureIndexes.length > 1 && ` +${measureIndexes.length - 1}`}
                                </span>
                            </>
                        }
                    >
                        <fieldset className="chart-measures">
                            <legend>{chartCopy.measures}</legend>
                            {availableMeasures.map(index => (
                                <label key={index}>
                                    <input
                                        type="checkbox"
                                        checked={measureIndexes.includes(index)}
                                        disabled={
                                            measureIndexes.includes(index)
                                                ? measureIndexes.length === 1
                                                : measureIndexes.length >= MAX_CHART_SERIES
                                        }
                                        onChange={event => {
                                            const next = event.target.checked
                                                ? [...measureIndexes, index]
                                                : measureIndexes.filter(value => value !== index);
                                            onChart({
                                                ...chart,
                                                ys: next.slice(0, MAX_CHART_SERIES),
                                            });
                                        }}
                                    />
                                    <span
                                        style={{
                                            '--series-color': seriesColor(
                                                Math.max(0, measureIndexes.indexOf(index)),
                                            ),
                                        }}
                                    />
                                    {result.columns[index]?.name}
                                </label>
                            ))}
                        </fieldset>
                        <p>{chartText(chartCopy.measureLimit, { count: MAX_CHART_SERIES })}</p>
                    </ChartPopover>
                )
            ) : (
                <div className="chart-control-field">
                    <SelectControl
                        className="chart-select"
                        compactMenu
                        label={chartCopy.measure}
                        menuHeading={chartCopy.measure}
                        value={String(yIndex)}
                        searchable={numericIndexes.length >= 8}
                        onChange={value => onChart({ ...chart, ys: [Number(value)] })}
                        options={numericIndexes.map(index => ({
                            value: String(index),
                            label: result.columns[index]?.name ?? '',
                            disabled: index === xIndex || index === groupByIndex,
                        }))}
                    />
                </div>
            )}
        </ChartToolbar>
    );
}
