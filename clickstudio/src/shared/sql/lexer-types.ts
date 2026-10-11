export interface Token {
    text: string;
    from: number;
    to: number;
    kind: 'word' | 'quoted' | 'symbol';
}

export class SqlSyntaxError extends Error {
    constructor(
        message: string,
        public readonly position: number,
    ) {
        super(message);
    }
}

export interface SqlScan {
    tokens: Token[];
    protectedRanges: Array<{ from: number; to: number }>;
    hasComments: boolean;
    error?: SqlSyntaxError;
}

export function isSqlWhitespace(character: string): boolean {
    return /[\t\n\v\f\r \u0085\u00a0\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]/.test(
        character,
    );
}

export function heredocMarkerAt(sql: string, from: number): string | undefined {
    return /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(from))?.[0];
}

export function stopSqlScan(scan: SqlScan, sql: string, from: number, message: string): number {
    scan.error = new SqlSyntaxError(message, from);
    scan.protectedRanges.push({ from, to: sql.length });
    return sql.length;
}
