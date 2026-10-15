/** Coercions used by workload and replication snapshots, not strict metadata validation. */
export const stringValue = (value: unknown, fallback = '') =>
    value === undefined || value === null ? fallback : String(value);

export const countValue = (value: unknown) => {
    const count = Number(value);
    return Number.isFinite(count) && count > 0
        ? Math.min(Number.MAX_SAFE_INTEGER, Math.floor(count))
        : 0;
};

export const booleanValue = (value: unknown) =>
    value === true || value === 1 || value === '1' || value === 'true';
