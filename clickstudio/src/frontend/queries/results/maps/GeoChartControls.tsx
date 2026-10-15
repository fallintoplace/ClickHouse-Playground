import type { ChartConfig } from '../../../../shared/queries/results/chart-settings';
import {
    copyGeographyConfig,
    type GeographyConfig,
} from '../../../../shared/queries/results/geography-settings';
import type { Result } from '../../../../shared/queries/results/types';
import { numericType } from '../../../../shared/queries/results/results';
import { SelectControl, type SelectControlOption } from '../../../ui/components/SelectControl';
import type { Copy } from '../../../ui/copy';
import { ChartPopover, ChartToolbar } from '../charts/ChartToolbar';
import { ChartTypeSelect } from '../charts/controls/ChartTypeSelect';
import type { prepareChartSelection } from '../charts/controls/chart-selection';
import {
    coordinatePairs,
    geographySourceNames,
    nativeGeoColumns,
    nativeGeoType,
    type GeoRecommendation,
} from './geo';

function GeoSelect({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: string;
    options: SelectControlOption[];
    onChange: (value: string) => void;
}) {
    return (
        <div className="chart-setup-field">
            <span>{label}</span>
            <SelectControl
                className="chart-select"
                compactMenu
                label={label}
                value={value}
                options={options}
                onChange={onChange}
                hideDisabledOptions
                searchable={options.length >= 8}
            />
        </div>
    );
}

export function GeoChartControls({
    result,
    chart,
    config,
    selection,
    copy,
    onChart,
    toolbarContainer,
}: {
    result: Result;
    chart: ChartConfig;
    config: GeoRecommendation;
    selection: ReturnType<typeof prepareChartSelection>;
    copy: Copy['chart'];
    onChart: (chart: ChartConfig) => void;
    toolbarContainer?: HTMLElement | null;
}) {
    const { columns } = result;
    const numericColumns = columns.flatMap((column, index) =>
        numericType(column.type) ? [index] : [],
    );
    const numericOptions = numericColumns.map(index => ({
        value: String(index),
        label: columns[index]!.name,
    }));
    const { source } = config;
    const patch = (values: Partial<GeographyConfig>) =>
        onChart({
            ...chart,
            kind: 'geography',
            geography: copyGeographyConfig({
                ...config,
                ...values,
                sourceColumnNames: geographySourceNames(columns, values.source ?? config.source),
            }),
        });
    const sourceOptions = nativeGeoColumns(columns).map(index => ({
        value: `geometry:${index}`,
        label: `${columns[index]!.name} · ${nativeGeoType(columns[index]!.type)}`,
    }));
    if (numericColumns.length >= 2)
        sourceOptions.push({ value: 'coordinates', label: 'Longitude / latitude' });
    return (
        <ChartToolbar portalTarget={toolbarContainer}>
            <div className="chart-control-field">
                <ChartTypeSelect
                    kind="geography"
                    chart={chart}
                    result={result}
                    selection={selection}
                    copy={copy}
                    onChart={onChart}
                    onChange={kind =>
                        onChart({
                            ...chart,
                            kind,
                            ...(kind === 'candlestick'
                                ? {
                                      x: selection.candleX,
                                      ys: [],
                                      candlestick: selection.inferredCandle ?? {},
                                  }
                                : {}),
                        })
                    }
                />
            </div>
            <ChartPopover label={copy.setup} closeLabel={copy.closeControls} trigger={copy.setup}>
                <div className="chart-setup-fields">
                    <GeoSelect
                        label="Source"
                        value={
                            source.mode === 'geometry' ? `geometry:${source.column}` : 'coordinates'
                        }
                        options={sourceOptions}
                        onChange={value => {
                            if (value === 'coordinates') {
                                const pair = coordinatePairs(columns)[0] ?? {
                                    longitude: numericColumns[0]!,
                                    latitude: numericColumns[1]!,
                                };
                                patch({
                                    source: { mode: 'coordinates', ...pair },
                                    swapCoordinates: false,
                                });
                            } else {
                                const column = Number(value.slice('geometry:'.length));
                                patch({
                                    source: { mode: 'geometry', column },
                                    swapCoordinates: /h3/i.test(columns[column]!.name),
                                });
                            }
                        }}
                    />
                    {source.mode === 'coordinates' && (
                        <>
                            <GeoSelect
                                label="Longitude"
                                value={String(source.longitude)}
                                options={numericOptions.map(option => ({
                                    ...option,
                                    disabled: Number(option.value) === source.latitude,
                                }))}
                                onChange={value =>
                                    patch({ source: { ...source, longitude: Number(value) } })
                                }
                            />
                            <GeoSelect
                                label="Latitude"
                                value={String(source.latitude)}
                                options={numericOptions.map(option => ({
                                    ...option,
                                    disabled: Number(option.value) === source.longitude,
                                }))}
                                onChange={value =>
                                    patch({ source: { ...source, latitude: Number(value) } })
                                }
                            />
                        </>
                    )}
                    <GeoSelect
                        label="Label"
                        value={config.label === undefined ? '' : String(config.label)}
                        options={[
                            { value: '', label: 'Row number' },
                            ...columns.map((column, index) => ({
                                value: String(index),
                                label: column.name,
                            })),
                        ]}
                        onChange={value =>
                            patch({ label: value === '' ? undefined : Number(value) })
                        }
                    />
                    <GeoSelect
                        label={copy.measure}
                        value={config.measure === undefined ? '' : String(config.measure)}
                        options={[
                            { value: '', label: 'None' },
                            ...numericOptions.filter(
                                option =>
                                    source.mode !== 'coordinates' ||
                                    (Number(option.value) !== source.longitude &&
                                        Number(option.value) !== source.latitude),
                            ),
                        ]}
                        onChange={value =>
                            patch({ measure: value === '' ? undefined : Number(value) })
                        }
                    />
                    {source.mode === 'geometry' && (
                        <GeoSelect
                            label="Coordinate order"
                            value={config.swapCoordinates ? 'yx' : 'xy'}
                            options={[
                                { value: 'xy', label: 'X / Y' },
                                { value: 'yx', label: 'Y / X' },
                            ]}
                            onChange={value => patch({ swapCoordinates: value === 'yx' })}
                        />
                    )}
                </div>
            </ChartPopover>
        </ChartToolbar>
    );
}
