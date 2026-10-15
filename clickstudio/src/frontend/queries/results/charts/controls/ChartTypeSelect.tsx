import type { ChartKind } from '../../../../../shared/queries/results/chart-types';
import type { ChartConfig } from '../../../../../shared/queries/results/chart-settings';
import { copyGeographyConfig } from '../../../../../shared/queries/results/geography-settings';
import type { Result } from '../../../../../shared/queries/results/types';
import type { Copy } from '../../../../ui/copy';
import { SelectControl } from '../../../../ui/components/SelectControl';
import { chartKindIsAvailable, chartKindOptions, chartTypeLabel } from '../chart-helpers';
import type { prepareChartSelection } from './chart-selection';
import { temporalType } from '../../../../../shared/queries/results/results';

export function ChartTypeSelect({
    kind,
    chart,
    result,
    selection,
    copy,
    onChart,
    onChange,
}: {
    kind: Exclude<ChartKind, 'table'>;
    chart: ChartConfig;
    result: Result;
    selection: Pick<
        ReturnType<typeof prepareChartSelection>,
        'numericIndexes' | 'canChooseCandlestick' | 'geography'
    >;
    copy: Copy['chart'];
    onChart: (chart: ChartConfig) => void;
    onChange: (kind: Exclude<ChartKind, 'table' | 'geography'>) => void;
}) {
    const available = (value: Exclude<ChartKind, 'table'>) =>
        chartKindIsAvailable(
            value,
            result,
            selection.numericIndexes,
            selection.canChooseCandlestick,
            Boolean(selection.geography),
        );
    return (
        <SelectControl
            className="chart-select"
            compactMenu
            label={copy.type}
            menuHeading={copy.type}
            value={kind}
            hideDisabledOptions
            onChange={value => {
                const option = chartKindOptions.find(candidate => candidate.value === value);
                if (!option || !available(option.value)) return;
                if (
                    !selection.numericIndexes.length &&
                    (option.value === 'line' || option.value === 'bar')
                ) {
                    const time = option.value === 'line';
                    const accepts = (index: number) =>
                        Boolean(result.columns[index]) &&
                        temporalType(result.columns[index]!.type) === time;
                    const x = accepts(chart.x)
                        ? chart.x
                        : result.columns.findIndex((_column, index) => accepts(index));
                    onChart({ ...chart, kind: option.value, x });
                    return;
                }
                if (option.value === 'geography') {
                    if (selection.geography)
                        onChart({
                            ...chart,
                            kind: 'geography',
                            geography: copyGeographyConfig(selection.geography),
                        });
                } else onChange(option.value);
            }}
            options={chartKindOptions.map(option => ({
                value: option.value,
                label: chartTypeLabel(option.value, copy),
                disabled: !available(option.value),
            }))}
        />
    );
}
