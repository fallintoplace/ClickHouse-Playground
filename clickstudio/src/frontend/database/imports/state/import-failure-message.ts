import { message, RequestError } from '../../../api/client';
import { CloudRequestError } from '../../connections/cloud-connection';

export function importFailureMessage(error: unknown) {
    if (error instanceof RequestError && error.detail.code === 'IMPORT_VALUE_TYPE')
        return error.message;
    if (error instanceof CloudRequestError && error.code === 'CLICKHOUSE_ERROR') {
        const column = error.message.match(/\bkey\s+['"`]?([^:'"`\s)]+)/i)?.[1];
        const row = error.message.match(/\(at row\s+(\d+)\)/i)?.[1];
        if (/cannot parse input/i.test(error.message)) {
            const location = [
                column ? `column ${JSON.stringify(column)}` : '',
                row ? `row ${row}` : '',
            ]
                .filter(Boolean)
                .join(' at ');
            return `ClickHouse could not parse an imported value${location ? ` for ${location}` : ''}. Check that the file values match the destination column types.`;
        }
        return error.message
            .replace(/\s*:\s*While executing\b[\s\S]*$/i, '')
            .replace(/\s+/g, ' ')
            .slice(0, 500);
    }
    return message(error);
}
