import type { CandlestickConfig } from '../../../../../shared/queries/results/chart-settings';
import type { Result } from '../../../../../shared/queries/results/types';
import type { Draft } from '../../../editor/drafts/workspace-state';
import type { Copy } from '../../../../ui/copy';
import { SelectControl } from '../../../../ui/components/SelectControl';
import type { SelectControlOption } from '../../../../ui/components/SelectControl';
import { CandlestickChart } from './CandlestickChart';
import { ChartPopover, ChartToolbar } from '../ChartToolbar';
import { ScrollEdgeFrame } from '../../../../ui/components/ScrollEdgeShadows';
import { chartKindOptions, chartTypeLabel } from '../chart-helpers';
import type { prepareChartSelection } from '../controls/chart-selection';

export function renderCandlestickChart({
    result,
    chart,
    onChart,
    chartCopy,
    selection,
}: {
    result: Result;
    chart: Draft['chart'];
    onChart: (chart: Draft['chart']) => void;
    chartCopy: Copy['chart'];
    selection: ReturnType<typeof prepareChartSelection>;
}) {
    const {
        activeCandle,
        candleX,
        numericIndexes,
        inferredCandle,
        canChooseCandlestick,
        activeCandleValid,
    } = selection;
    const candle = activeCandle ?? {};
    const patchCandle = (
        field: 'open' | 'high' | 'low' | 'close' | 'bid' | 'ask' | 'spread' | 'quoteActivity',
        value: string,
    ) => {
        const next = value === '' ? undefined : Number(value);
        const candlestick: CandlestickConfig = { ...candle };
        if (next === undefined) delete candlestick[field];
        else candlestick[field] = next;
        onChart({ ...chart, kind: 'candlestick', x: candleX, ys: [], candlestick });
    };
    const updateKind = (value: string) => {
        const option = chartKindOptions.find(candidate => candidate.value === value);
        if (!option) return;
        if (option.value === 'candlestick' && !canChooseCandlestick) return;
        onChart({
            ...chart,
            kind: option.value,
            ...(option.value === 'candlestick'
                ? { x: candleX, ys: [], candlestick: inferredCandle ?? {} }
                : { ys: numericIndexes.slice(0, 1) }),
        });
    };
    const candleColumns = (selected: number | undefined): SelectControlOption[] => [
        { value: '', label: '—' },
        ...numericIndexes.map(index => ({
            value: String(index),
            label: result.columns[index]?.name ?? '',
            disabled:
                index !== selected &&
                [candle.open, candle.high, candle.low, candle.close].includes(index),
        })),
    ];
    return renderCandlestickControls({
        chart,
        chartCopy,
        updateKind,
        canChooseCandlestick,
        candleX,
        onChart,
        candle,
        result,
        patchCandle,
        candleColumns,
        optionalColumns: candleColumns,
        activeCandleValid,
    });
}

function renderCandlestickControls({
    chart,
    chartCopy,
    updateKind,
    canChooseCandlestick,
    candleX,
    onChart,
    candle,
    result,
    patchCandle,
    candleColumns,
    optionalColumns,
    activeCandleValid,
}: {
    chart: Draft['chart'];
    chartCopy: Copy['chart'];
    updateKind: (value: string) => void;
    canChooseCandlestick: boolean;
    candleX: number;
    onChart: (chart: Draft['chart']) => void;
    candle: CandlestickConfig;
    result: Result;
    patchCandle: (
        field: 'open' | 'high' | 'low' | 'close' | 'bid' | 'ask' | 'spread' | 'quoteActivity',
        value: string,
    ) => void;
    candleColumns: (selected: number | undefined) => SelectControlOption[];
    optionalColumns: (selected: number | undefined) => SelectControlOption[];
    activeCandleValid: boolean;
}) {
    return (
        <ScrollEdgeFrame<HTMLDivElement> className="chart-workspace-frame">
            {ref => (
                <div ref={ref} className="chart-workspace animate-enter">
                    <ChartToolbar>
                        <label className="chart-control-field">
                            <span className="chart-control-label">{chartCopy.type}</span>
                            <SelectControl
                                className="chart-select"
                                label={chartCopy.type}
                                value="candlestick"
                                hideDisabledOptions
                                onChange={updateKind}
                                options={chartKindOptions.map(option => ({
                                    value: option.value,
                                    label: chartTypeLabel(option.value, chartCopy),
                                    disabled:
                                        option.value === 'candlestick' && !canChooseCandlestick,
                                }))}
                            />
                        </label>
                        <label className="chart-control-field">
                            <span className="chart-control-label">{chartCopy.xAxis}</span>
                            <SelectControl
                                className="chart-select"
                                label={chartCopy.xAxis}
                                value={String(candleX)}
                                hideDisabledOptions
                                searchable={result.columns.length >= 8}
                                onChange={value =>
                                    onChart({
                                        ...chart,
                                        kind: 'candlestick',
                                        x: Number(value),
                                        ys: [],
                                        candlestick: { ...candle },
                                    })
                                }
                                options={result.columns.map((column, index) => ({
                                    value: String(index),
                                    label: column.name,
                                }))}
                            />
                        </label>
                        <ChartPopover
                            label={chartCopy.setup}
                            closeLabel={chartCopy.closeControls}
                            trigger={chartCopy.setup}
                        >
                            <div className="chart-setup-fields">
                                {(['open', 'high', 'low', 'close'] as const).map(field => {
                                    const options = candleColumns(candle[field]);
                                    return (
                                        <label key={field}>
                                            {chartCopy[`${field}Label`]}
                                            <SelectControl
                                                className="chart-select"
                                                label={chartCopy[`${field}Label`]}
                                                value={
                                                    candle[field] === undefined
                                                        ? ''
                                                        : String(candle[field])
                                                }
                                                searchable={options.length >= 9}
                                                onChange={value => patchCandle(field, value)}
                                                options={options}
                                            />
                                        </label>
                                    );
                                })}
                                {(['bid', 'ask', 'spread', 'quoteActivity'] as const).map(field => {
                                    const getFieldLabel = () => {
                                        switch (field) {
                                            case 'bid':
                                            case 'ask':
                                                return field.toUpperCase();

                                            case 'spread':
                                                return chartCopy.spreadBps;

                                            default:
                                                return chartCopy.quoteActivity;
                                        }
                                    };
                                    const options = optionalColumns(candle[field]);
                                    const label = getFieldLabel();
                                    return (
                                        <label key={field}>
                                            {label}
                                            <SelectControl
                                                className="chart-select"
                                                label={label}
                                                value={
                                                    candle[field] === undefined
                                                        ? ''
                                                        : String(candle[field])
                                                }
                                                searchable={options.length >= 9}
                                                onChange={value => patchCandle(field, value)}
                                                options={options}
                                            />
                                        </label>
                                    );
                                })}
                            </div>
                        </ChartPopover>
                    </ChartToolbar>
                    {!activeCandleValid ? (
                        <div className="chart-empty" role="status">
                            {chartCopy.noValidCandles}
                        </div>
                    ) : (
                        <CandlestickChart
                            result={result}
                            config={candle}
                            x={candleX}
                            copy={chartCopy}
                        />
                    )}
                </div>
            )}
        </ScrollEdgeFrame>
    );
}
