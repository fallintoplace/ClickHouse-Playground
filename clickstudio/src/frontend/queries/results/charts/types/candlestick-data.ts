import { chartNumber, chartTimestamp } from '../../../../../shared/queries/results/results.js';
import type { CandlestickConfig } from '../../../../../shared/queries/results/chart-settings.js';
import type { Row } from '../../../../../shared/common/values.js';
import type { Result } from '../../../../../shared/queries/results/types.js';

export interface CandleValues {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
}

function indexValue(row: Row, index: number | undefined) {
    return index === undefined ? null : chartNumber(row[index]);
}

export function candleValues(
    row: Row,
    x: number,
    config: CandlestickConfig,
): CandleValues | undefined {
    const time = chartTimestamp(row[x]);
    const open = indexValue(row, config.open);
    const high = indexValue(row, config.high);
    const low = indexValue(row, config.low);
    const close = indexValue(row, config.close);
    if (
        time === null ||
        open === null ||
        high === null ||
        low === null ||
        close === null ||
        high < Math.max(open, close) ||
        low > Math.min(open, close)
    )
        return undefined;
    return { time, open, high, low, close };
}

export function hasValidCandle(result: Pick<Result, 'rows'>, x: number, config: CandlestickConfig) {
    return result.rows.some(row => candleValues(row, x, config) !== undefined);
}
