import type { Diagnostic } from '@codemirror/lint';
import { heredocMarkerAt, type SqlScan } from '../../../../shared/sql/lexer-types.js';

export function lexicalDiagnostic(sql: string, scan: SqlScan): Diagnostic | undefined {
    const error = scan.error;
    if (!error) return undefined;
    const from = Math.max(0, Math.min(error.position, sql.length));
    const width = heredocMarkerAt(sql, from)?.length ?? (sql.startsWith('/*', from) ? 2 : 1);
    return {
        from,
        to: Math.min(sql.length, from + width),
        severity: 'error',
        message: error.message,
        source: 'SQL',
    };
}
