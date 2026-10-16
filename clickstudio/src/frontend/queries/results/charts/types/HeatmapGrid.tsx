import { NativeTable } from '../../../../ui/components/NativeTable';
import {
    MAX_HEATMAP_CELLS,
    type HeatmapPreparation,
    heatmapCellKey,
} from '../../../../../shared/queries/results/results';
import type { Result } from '../../../../../shared/queries/results/types';
import type { Copy } from '../../../../ui/copy';
import { ScrollEdgeFrame } from '../../../../ui/components/ScrollEdgeShadows';
import { chartText, formatCount } from '../chart-helpers';

export function HeatmapGrid({
    chartCopy,
    result,
    yIndex,
    groupByIndex,
    xIndex,
    heatmapXLabels,
    heatmapXKeys,
    heatmapYLabels,
    heatmapYKeys,
    heatmap,
    heatmapMaximum,
    compactNumber,
}: {
    chartCopy: Copy['chart'];
    result: Result;
    yIndex: number;
    groupByIndex: number;
    xIndex: number;
    heatmapXLabels: string[];
    heatmapXKeys: string[];
    heatmapYLabels: string[];
    heatmapYKeys: string[];
    heatmap: HeatmapPreparation;
    heatmapMaximum: number;
    compactNumber: Intl.NumberFormat;
}) {
    let captionNote = chartCopy.heatmapCompleteNote;
    if (heatmap.tooLarge) {
        captionNote = chartText(chartCopy.heatmapCutoffNote, {
            cells: formatCount(MAX_HEATMAP_CELLS),
        });
    } else if (result.completeness === 'truncated') {
        captionNote = chartCopy.heatmapTruncatedNote;
    }

    return (
        <ScrollEdgeFrame<HTMLDivElement> className="heatmap-scroll-frame">
            {ref => (
                <div ref={ref} className="heatmap-scroll">
                    <NativeTable
                        className="heatmap-grid"
                        aria-label={chartText(chartCopy.heatmapTableAria, {
                            measure: result.columns[yIndex]?.name ?? '',
                            groupBy: result.columns[groupByIndex]?.name ?? '',
                            xAxis: result.columns[xIndex]?.name ?? '',
                        })}
                    >
                        <thead>
                            <tr>
                                <th className="heatmap-corner" scope="col">
                                    {result.columns[groupByIndex]?.name} /{' '}
                                    {result.columns[xIndex]?.name}
                                </th>
                                {heatmapXLabels.map((label, index) => (
                                    <th
                                        className="heatmap-axis-label"
                                        scope="col"
                                        key={`x-${heatmapXKeys[index]}`}
                                        data-overflow-title={label}
                                    >
                                        {label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {heatmapYLabels.map((yLabel, rowIndex) => (
                                <tr key={`y-${heatmapYKeys[rowIndex]}`}>
                                    <th
                                        className="heatmap-axis-label heatmap-row-label"
                                        scope="row"
                                        data-overflow-title={yLabel}
                                    >
                                        {yLabel}
                                    </th>
                                    {heatmapXLabels.map((xLabel, xIndex) => {
                                        const key = heatmapCellKey(
                                            heatmapXKeys[xIndex]!,
                                            heatmapYKeys[rowIndex]!,
                                        );
                                        const value = heatmap.cells.get(key);
                                        const hasRow = heatmap.present.has(key);
                                        const missing = !hasRow;
                                        let cellDescription: string;

                                        if (missing) {
                                            if (result.completeness === 'truncated') {
                                                cellDescription = chartCopy.heatmapNotRetained;
                                            } else {
                                                cellDescription = chartCopy.heatmapNoReturnedRow;
                                            }
                                        } else if (value === undefined) {
                                            cellDescription = chartCopy.heatmapNullMeasure;
                                        } else {
                                            cellDescription = formatCount(value);
                                        }
                                        const plotted = value ?? 0;
                                        const intensity =
                                            heatmapMaximum > 0 ? plotted / heatmapMaximum : 0;
                                        const displayNumber =
                                            value === undefined ? '·' : compactNumber.format(value);
                                        return (
                                            <td
                                                className="heatmap-cell"
                                                key={`${heatmapYKeys[rowIndex]}-${heatmapXKeys[xIndex]}`}
                                                title={`${result.columns[groupByIndex]?.name}: ${yLabel} · ${result.columns[xIndex]?.name}: ${xLabel} · ${result.columns[yIndex]?.name}: ${cellDescription}`}
                                                aria-label={`${yLabel}, ${xLabel}: ${cellDescription}`}
                                                style={{
                                                    backgroundColor:
                                                        missing || value === undefined
                                                            ? 'var(--panel)'
                                                            : `color-mix(in srgb, var(--accent) calc(${Math.round(intensity * 78)}% * var(--heatmap-strength, 1)), var(--panel-raised))`,
                                                    color: `var(--heatmap-text, ${intensity > 0.55 ? 'var(--accent-ink)' : 'var(--text-soft)'})`,
                                                }}
                                            >
                                                {missing ? '·' : displayNumber}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </NativeTable>
                    <div className="heatmap-caption">
                        {chartText(chartCopy.heatmapCaption, {
                            measure: result.columns[yIndex]?.name ?? '',
                            rows: formatCount(heatmapYLabels.length),
                            columns: formatCount(heatmapXLabels.length),
                            note: captionNote,
                        })}
                    </div>
                </div>
            )}
        </ScrollEdgeFrame>
    );
}
