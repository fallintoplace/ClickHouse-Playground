import { CHART_KINDS } from '../../../../shared/queries/results/chart-types.js';
import type { ChartKind } from '../../../../shared/queries/results/chart-types.js';
import type { Result } from '../../../../shared/queries/results/types.js';
import type { Draft } from '../../editor/drafts/workspace-state.js';
import type { Copy } from '../../../ui/copy.js';

export const chartKindOptions = CHART_KINDS.filter(kind => kind !== 'table').map(value => ({
    value,
}));

export function chartKindIsAvailable(
    kind: Exclude<ChartKind, 'table'>,
    result: Pick<Result, 'columns' | 'rows'>,
    numericIndexes: number[],
    canChooseCandlestick: boolean,
) {
    switch (kind) {
        case 'number':
            return result.rows.length === 1 && numericIndexes.length > 0;

        case 'line':
        case 'bar':
            return numericIndexes.length > 0;

        case 'scatter':
            return numericIndexes.length >= 2;

        case 'heatmap':
            return result.columns.length >= 3 && numericIndexes.length > 0;

        case 'candlestick':
            return canChooseCandlestick;
    }
}

const chartColors = [
    'var(--accent)',
    'var(--green)',
    'var(--amber)',
    'var(--red)',
    'var(--violet)',
] as const;
const chartLabelSegments = new Intl.Segmenter('en', { granularity: 'grapheme' });
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
    const minimumWidth = viewportWidth > 0 && Number.isFinite(viewportWidth) ? viewportWidth : 652;
    const slotWidths = labels.map(label =>
        Math.max(32, Math.max(...wrapChartLabel(label).map(chartLabelWidth)) + 16),
    );
    const contentWidth = slotWidths.reduce((total, width) => total + width, 8);
    const width = Math.max(minimumWidth, contentWidth);
    const extraSpace = labels.length ? (width - contentWidth) / labels.length : 0;
    let offset = 4;
    const positions = slotWidths.map(slotWidth => {
        const expandedWidth = slotWidth + extraSpace;
        const position = offset + expandedWidth / 2;
        offset += expandedWidth;
        return position;
    });
    return {
        width,
        positions,
        minimumSlotWidth: slotWidths.length ? Math.min(...slotWidths) + extraSpace : width - 8,
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

export function chartTickLabelWidth(label: string) {
    return Array.from(label).length * 5;
}

function wrapChartLabel(label: string) {
    const text = label.trim().replace(/\s+/g, ' ');
    const width = chartLabelWidth(text);
    if (width <= 64) return [text];
    const characters = Array.from(chartLabelSegments.segment(text), part => part.segment);
    if (characters.length <= 1) return [text];
    const prefixWidths = [0];
    for (const character of characters)
        prefixWidths.push(prefixWidths.at(-1)! + chartLabelWidth(character));
    const wordBreaks = characters.flatMap((character, index) => (character === ' ' ? [index] : []));
    const candidates = wordBreaks.length
        ? wordBreaks
        : Array.from({ length: characters.length - 1 }, (_value, index) => index + 1);
    let split = candidates[0]!;
    let bestWidth = Number.POSITIVE_INFINITY;
    for (const index of candidates) {
        const secondStart = characters[index] === ' ' ? index + 1 : index;
        const widestLine = Math.max(prefixWidths[index]!, width - prefixWidths[secondStart]!);
        if (widestLine < bestWidth) {
            bestWidth = widestLine;
            split = index;
        }
    }
    return [characters.slice(0, split).join('').trim(), characters.slice(split).join('').trim()];
}

export function fitCategoryTicks(ticks: ChartAxisTick[]): ChartAxisTick[] {
    return ticks.map(tick => ({ ...tick, lines: wrapChartLabel(tick.label), anchor: 'middle' }));
}

export function fitChartTicks(ticks: { label: string; position: number }[]) {
    if (ticks.length <= 1) return ticks;
    const bounds = (tick: (typeof ticks)[number], anchor: 'start' | 'middle' | 'end') => {
        const width = chartTickLabelWidth(tick.label);
        let left = tick.position;
        if (anchor === 'end') left -= width;
        else if (anchor === 'middle') left -= width / 2;
        return { left, right: left + width };
    };
    const anchorAt = (index: number, length: number) => {
        if (length === 1) return 'middle';
        if (index === 0) return 'start';
        if (index === length - 1) return 'end';
        return 'middle';
    };
    const labelsFit = (candidates: typeof ticks) => {
        let previousRight = Number.NEGATIVE_INFINITY;
        return candidates.every((tick, index) => {
            const { left, right } = bounds(tick, anchorAt(index, candidates.length));
            const fits = left >= previousRight + 8;
            previousRight = right;
            return fits;
        });
    };
    if (labelsFit(ticks)) return ticks;

    const first = ticks[0]!;
    const last = ticks.at(-1)!;
    const endpoints = [first, last];
    if (ticks.length <= 2 || !labelsFit(endpoints))
        return [ticks[Math.floor((ticks.length - 1) / 2)]!];

    const firstBounds = bounds(first, 'start');
    const lastBounds = bounds(last, 'end');
    const interior = ticks
        .slice(1, -1)
        .map((tick, index) => {
            const labelBounds = bounds(tick, 'middle');
            return { tick, index: index + 1, ...labelBounds };
        })
        .filter(tick => tick.left >= firstBounds.right + 8 && tick.right <= lastBounds.left - 8)
        .sort((left, right) => left.right - right.right || left.index - right.index);
    const selected: typeof interior = [];
    let previousRight = firstBounds.right;
    for (const tick of interior) {
        if (tick.left < previousRight + 8) continue;
        selected.push(tick);
        previousRight = tick.right;
    }
    selected.sort((left, right) => left.index - right.index);
    return [first, ...selected.map(tick => tick.tick), last];
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
