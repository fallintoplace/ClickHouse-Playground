import type { ChartKind } from '../../../../../shared/queries/results/chart-types';
import type { CSSProperties } from 'react';
import { MAX_CHART_SERIES } from '../../../../../shared/queries/results/results';
import type { CandlestickConfig } from '../../../../../shared/queries/results/chart-settings';
import type { Result } from '../../../../../shared/queries/results/types';
import type { Draft } from '../../../editor/drafts/workspace-state';
import type { Copy } from '../../../../ui/copy';
import { SelectControl } from '../../../../ui/components/SelectControl';
import { ChartPopover, ChartToolbar } from '../ChartToolbar';
import {
    chartKindIsAvailable,
    chartKindOptions,
    chartText,
    chartTypeLabel,
    seriesColor,
} from '../chart-helpers';

export function renderChartControls({
    chartKind,
    result,
    chartCopy,
    canChooseCandlestick,
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
}: {
    chartKind: Exclude<ChartKind, 'table'>;
    result: Result;
    chartCopy: Copy['chart'];
    canChooseCandlestick: boolean;
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
}) {
    return (
        <ChartToolbar>
            <label className="chart-control-field">
                <span className="chart-control-label">{chartCopy.type}</span>
                <SelectControl
                    className="chart-select"
                    label={chartCopy.type}
                    value={chartKind}
                    hideDisabledOptions
                    onChange={value => {
                        const option = chartKindOptions.find(
                            candidate => candidate.value === value,
                        );
                        if (
                            !option ||
                            !chartKindIsAvailable(
                                option.value,
                                result,
                                numericIndexes,
                                canChooseCandlestick,
                            )
                        )
                            return;
                        if (option.value === 'candlestick') {
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
                            option.value === 'heatmap'
                                ? (groupByIndex ??
                                  result.columns.findIndex(
                                      (_column, index) => index !== xIndex && index !== yIndex,
                                  ))
                                : undefined;
                        onChart({
                            ...chart,
                            kind: option.value,
                            groupBy:
                                nextGroupBy !== undefined && nextGroupBy >= 0
                                    ? nextGroupBy
                                    : undefined,
                            ys:
                                option.value === 'line' || option.value === 'bar'
                                    ? measureIndexes
                                    : [yIndex],
                        });
                    }}
                    options={chartKindOptions.map(option => ({
                        value: option.value,
                        label: chartTypeLabel(option.value, chartCopy),
                        disabled: !chartKindIsAvailable(
                            option.value,
                            result,
                            numericIndexes,
                            canChooseCandlestick,
                        ),
                    }))}
                />
            </label>
            {chartKind !== 'number' && (
                <label className="chart-control-field">
                    <span className="chart-control-label">
                        {chartKind === 'scatter' ? chartCopy.xAxisMeasure : chartCopy.xAxis}
                    </span>
                    <SelectControl
                        className="chart-select"
                        label={chartKind === 'scatter' ? chartCopy.xAxisMeasure : chartCopy.xAxis}
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
                </label>
            )}
            {chartKind === 'heatmap' && (
                <label className="chart-control-field">
                    <span className="chart-control-label">{chartCopy.yAxis}</span>
                    <SelectControl
                        className="chart-select"
                        label={chartCopy.yAxis}
                        value={String(groupByIndex ?? -1)}
                        searchable={result.columns.length >= 8}
                        onChange={value => onChart({ ...chart, groupBy: Number(value) })}
                        options={result.columns.map((column, index) => ({
                            value: String(index),
                            label: column.name,
                            disabled: index === xIndex || index === yIndex,
                        }))}
                    />
                </label>
            )}
            {chartKind === 'line' || chartKind === 'bar' ? (
                availableMeasures.length > 1 && (
                    <ChartPopover
                        label={chartCopy.measures}
                        closeLabel={chartCopy.closeControls}
                        controlLabel={chartCopy.measures}
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
                                        style={
                                            {
                                                '--series-color': seriesColor(
                                                    Math.max(0, measureIndexes.indexOf(index)),
                                                ),
                                            } as CSSProperties
                                        }
                                    />
                                    {result.columns[index]?.name}
                                </label>
                            ))}
                        </fieldset>
                        <p>{chartText(chartCopy.measureLimit, { count: MAX_CHART_SERIES })}</p>
                    </ChartPopover>
                )
            ) : (
                <label className="chart-control-field">
                    <span className="chart-control-label">{chartCopy.measure}</span>
                    <SelectControl
                        className="chart-select"
                        label={chartCopy.measure}
                        value={String(yIndex)}
                        searchable={numericIndexes.length >= 8}
                        onChange={value => onChart({ ...chart, ys: [Number(value)] })}
                        options={numericIndexes.map(index => ({
                            value: String(index),
                            label: result.columns[index]?.name ?? '',
                            disabled: index === xIndex || index === groupByIndex,
                        }))}
                    />
                </label>
            )}
        </ChartToolbar>
    );
}
