import { CHART_KINDS } from '../../../../shared/queries/results/chart-types.js';
import type { Draft } from '../../editor/drafts/workspace-state.js';
import type { Copy } from '../../../ui/copy.js';

export const chartKindOptions = CHART_KINDS.filter(kind => kind !== 'table').map(value => ({
    value,
}));

const chartColors = [
    'var(--accent)',
    'var(--green)',
    'var(--amber)',
    'var(--red)',
    'var(--violet)',
] as const;
export const seriesColor = (index: number) => chartColors[index % chartColors.length]!;
export type ChartPoint = { label: string; value: number | null; index: number };
export type ChartAxisTick = {
    label: string;
    position: number;
    lines?: string[];
    anchor?: 'start' | 'middle' | 'end';
};

export function chartText(template: string, values: Record<string, string | number> = {}) {
    return template.replace(/\{(\w+)\}/g, (_match, key: string) => String(values[key] ?? ''));
}

export function chartTypeLabel(kind: Draft['chart']['kind'], copy: Copy['chart']) {
    return {
        number: copy.numberType,
        line: copy.lineType,
        bar: copy.barType,
        scatter: copy.scatterType,
        heatmap: copy.heatmapType,
        candlestick: copy.candlestickType,
        table: copy.queryResult,
    }[kind];
}

export function formatCount(value: number) {
    return new Intl.NumberFormat('en').format(value);
}

export function categoryAxisLayout(labels: readonly string[], viewportWidth = 652) {
    const width = viewportWidth > 0 && Number.isFinite(viewportWidth) ? viewportWidth : 652;
    const inset = Math.min(4, width / 4);
    const slotWidth = (width - inset * 2) / Math.max(1, labels.length);
    return {
        width,
        positions: labels.map((_label, index) => inset + (index + 0.5) * slotWidth),
        minimumSlotWidth: slotWidth,
    };
}

export function chartPlotBounds(categoricalAxis: boolean, measuredHeight = 230) {
    const viewportHeight = categoricalAxis ? measuredHeight || 230 : 230;
    const plotTop = categoricalAxis ? 24 : 40;
    const plotBottom = categoricalAxis ? Math.max(plotTop + 1, viewportHeight - 44) : 190;
    return {
        viewportHeight,
        plotTop,
        plotBottom,
        plotMiddle: (plotTop + plotBottom) / 2,
        plotHeight: plotBottom - plotTop,
    };
}

export function chartLabelWidth(label: string) {
    return Array.from(label).reduce(
        (width, character) => width + (character.codePointAt(0)! <= 255 ? 6 : 10),
        0,
    );
}

function chartLabelPrefix(characters: string[], width: number) {
    let usedWidth = 0;
    let length = 0;
    for (const character of characters) {
        usedWidth += chartLabelWidth(character);
        if (usedWidth > width) break;
        length++;
    }
    return characters.slice(0, length);
}

function wrapChartLabel(label: string, availableWidth: number) {
    const characters = Array.from(label.trim().replace(/\s+/g, ' '));
    const width = Math.max(10, availableWidth);
    if (chartLabelWidth(characters.join('')) <= width) return [characters.join('')];
    const limit = chartLabelPrefix(characters, width).length;
    const wordBreak = characters.slice(0, limit + 1).lastIndexOf(' ');
    const split = wordBreak > 0 ? wordBreak : limit;
    const remaining = characters.slice(split).join('').trim();
    const secondLine =
        chartLabelWidth(remaining) > width
            ? `${chartLabelPrefix(Array.from(remaining), width - chartLabelWidth('…')).join('')}…`
            : remaining;
    return [characters.slice(0, split).join(''), secondLine];
}

export function fitCategoryTicks(ticks: ChartAxisTick[], width: number): ChartAxisTick[] {
    let count = Math.min(ticks.length, Math.max(1, Math.floor(width / 64)));
    while (count > 0) {
        const fitted = Array.from({ length: count }, (_value, index) => {
            const sourceIndex =
                count === 1
                    ? Math.floor((ticks.length - 1) / 2)
                    : Math.round((index * (ticks.length - 1)) / (count - 1));
            const tick = ticks[sourceIndex]!;
            const lines = wrapChartLabel(tick.label, Math.min(112, width / count - 12));
            const labelWidth = Math.max(...lines.map(chartLabelWidth));
            let anchor: ChartAxisTick['anchor'] = 'middle';
            if (tick.position < labelWidth / 2) anchor = 'start';
            else if (width - tick.position < labelWidth / 2) anchor = 'end';
            return {
                ...tick,
                lines,
                anchor,
            };
        });
        let previousRight = Number.NEGATIVE_INFINITY;
        const fits = fitted.every(tick => {
            const labelWidth = Math.max(...tick.lines.map(chartLabelWidth));
            let left = tick.position - labelWidth / 2;
            if (tick.anchor === 'start') left = tick.position;
            if (tick.anchor === 'end') left = tick.position - labelWidth;
            const fits = left >= 0 && left + labelWidth <= width && left >= previousRight + 8;
            previousRight = left + labelWidth;
            return fits;
        });
        if (fits) return fitted;
        count--;
    }
    return [];
}

export function fitChartTicks(ticks: { label: string; position: number }[]) {
    if (ticks.length <= 1) return ticks;
    const labelsFit = (candidates: typeof ticks) => {
        let previousRight = Number.NEGATIVE_INFINITY;
        return candidates.every((tick, index) => {
            const width = Array.from(tick.label).length * 6;
            let left = tick.position;
            if (index === candidates.length - 1) left -= width;
            else if (index > 0) left -= width / 2;
            const fits = left >= previousRight + 8;
            previousRight = left + width;
            return fits;
        });
    };
    if (labelsFit(ticks)) return ticks;
    const endpoints = [ticks[0]!, ticks.at(-1)!];
    if (ticks.length > 2 && labelsFit(endpoints)) return endpoints;
    return [ticks[Math.floor((ticks.length - 1) / 2)]!];
}

export function splitChartSegments(points: ChartPoint[]) {
    const segments: ChartPoint[][] = [];
    let current: ChartPoint[] = [];
    for (const point of points) {
        if (point.value === null) {
            if (current.length) segments.push(current);
            current = [];
        } else current.push(point);
    }
    if (current.length) segments.push(current);
    return segments;
}
