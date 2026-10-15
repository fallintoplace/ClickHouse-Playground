import {
    numericType,
    recommendChart,
    temporalType,
} from '../../../../../shared/queries/results/results.js';
import type { CandlestickConfig } from '../../../../../shared/queries/results/chart-settings.js';
import type { Result } from '../../../../../shared/queries/results/types.js';
import type { Draft } from '../../../editor/drafts/workspace-state.js';
import { hasValidCandle } from '../types/candlestick-data.js';
import { recommendValidGeo } from '../../maps/geo.js';

export function prepareChartSelection(result: Result, chart: Draft['chart']) {
    const suggestion = recommendChart(result.columns, result.rows);
    const numericIndexes = result.columns.flatMap((column, index) =>
        numericType(column.type) ? [index] : [],
    );
    const inferredCandle = suggestion.config.candlestick;
    const validCandleIndex = (index: number | undefined): index is number =>
        typeof index === 'number' &&
        Number.isSafeInteger(index) &&
        index >= 0 &&
        index < result.columns.length &&
        numericType(result.columns[index]?.type ?? '');
    const isValidCandleConfig = (
        config: CandlestickConfig | undefined,
    ): config is CandlestickConfig =>
        Boolean(
            config &&
            [config.open, config.high, config.low, config.close].every(validCandleIndex) &&
            new Set([config.open, config.high, config.low, config.close]).size === 4,
        );
    const namedTime = result.columns.findIndex(column =>
        /^(?:time|timestamp|datetime|date)$/i.test(column.name),
    );
    const fallbackTime = result.columns.findIndex(
        (column, index) =>
            temporalType(column.type) ||
            (!numericIndexes.includes(index) &&
                !['open', 'high', 'low', 'close'].includes(column.name.toLowerCase())),
    );
    const chartXIsTime =
        chart.x >= 0 &&
        chart.x < result.columns.length &&
        (temporalType(result.columns[chart.x]?.type ?? '') ||
            /^(?:time|timestamp|datetime|date)$/i.test(result.columns[chart.x]?.name ?? ''));
    let candleX: number;

    if (chartXIsTime) {
        candleX = chart.x;
    } else if (suggestion.config.kind === 'candlestick') {
        candleX = suggestion.config.x;
    } else if (namedTime >= 0) {
        candleX = namedTime;
    } else if (fallbackTime >= 0) {
        candleX = fallbackTime;
    } else {
        candleX = suggestion.config.x;
    }
    const activeCandle = chart.candlestick ?? inferredCandle;
    const activeCandleValid = isValidCandleConfig(activeCandle);
    const candleCandidate = chart.kind === 'candlestick' ? activeCandle : inferredCandle;
    const candleCandidateIsValid = Boolean(
        isValidCandleConfig(candleCandidate) && hasValidCandle(result, candleX, candleCandidate),
    );
    const canChooseCandlestick = candleCandidateIsValid;

    return {
        suggestion,
        numericIndexes,
        inferredCandle,
        canChooseCandlestick,
        candleX,
        activeCandle,
        activeCandleValid,
        geography: recommendValidGeo(result.columns, result.rows, chart.geography),
    };
}
