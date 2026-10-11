import type { ChartAxisTick } from './chart-helpers';

function tickAnchor(index: number, count: number) {
    if (count === 1) return 'middle';
    if (index === 0) return 'start';
    if (index === count - 1) return 'end';
    return 'middle';
}

export function ChartAxisLabels({ ticks, y }: { ticks: ChartAxisTick[]; y: number }) {
    return (
        <g className="chart-x-labels">
            {ticks.map((tick, index) => (
                <text
                    key={`${tick.position}-${index}`}
                    x={tick.position}
                    y={y}
                    textAnchor={tick.anchor ?? tickAnchor(index, ticks.length)}
                >
                    <title>{tick.label}</title>
                    {(tick.lines ?? [tick.label]).map((line, lineIndex) => (
                        <tspan key={lineIndex} x={tick.position} dy={lineIndex ? 11 : 0}>
                            {line}
                        </tspan>
                    ))}
                </text>
            ))}
        </g>
    );
}
