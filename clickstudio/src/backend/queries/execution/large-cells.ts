import type { Json } from '../../../shared/common/values.js';
import type { CloudCredentials } from '../../../shared/database/connections/cloud-requests.js';
import { hash, type Store } from '../../system/store.js';
import { isRecord } from '../../../shared/common/values.js';
import { MAX_LARGE_CELL_STORAGE_BYTES } from '../../../shared/queries/results/large-cells.js';

export const CLOUD_LARGE_CELL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface StoredLargeCell {
    ownerKey: string;
    runId: string;
    cellId: string;
    value: string;
    valueType: 'text' | 'json';
    bytes: number;
    serializedBytes: number;
    fileName: string;
    mimeType: string;
}

interface LargeCellIndexEntry {
    key: string;
    ownerKey: string;
    runId: string;
    cellId: string;
    createdAt: number;
    storageBytes: number;
}

export interface LargeCellContext {
    store: LargeCellStore;
    ownerKey: string;
    runId: string;
    referenceToken: string;
    expiresAt?: number;
}

function storedLargeCell(value: unknown): StoredLargeCell | undefined {
    if (
        isRecord(value) &&
        typeof value.ownerKey === 'string' &&
        typeof value.runId === 'string' &&
        typeof value.cellId === 'string' &&
        typeof value.value === 'string' &&
        (value.valueType === 'text' || value.valueType === 'json') &&
        typeof value.bytes === 'number' &&
        Number.isSafeInteger(value.bytes) &&
        (value.serializedBytes === undefined ||
            (typeof value.serializedBytes === 'number' &&
                Number.isSafeInteger(value.serializedBytes) &&
                value.serializedBytes >= value.bytes)) &&
        typeof value.fileName === 'string' &&
        typeof value.mimeType === 'string'
    ) {
        return {
            ...value,
            serializedBytes:
                typeof value.serializedBytes === 'number' ? value.serializedBytes : value.bytes,
        } as StoredLargeCell;
    }
    return undefined;
}

function isLargeCellIndexEntry(value: unknown): value is LargeCellIndexEntry {
    return (
        isRecord(value) &&
        typeof value.key === 'string' &&
        typeof value.ownerKey === 'string' &&
        typeof value.runId === 'string' &&
        typeof value.cellId === 'string' &&
        typeof value.createdAt === 'number' &&
        Number.isSafeInteger(value.createdAt) &&
        typeof value.storageBytes === 'number' &&
        Number.isSafeInteger(value.storageBytes) &&
        value.storageBytes > 0
    );
}

export function cloudCellOwnerKey(credentials: CloudCredentials): string {
    return hash([
        'clickhouse-cloud-large-cell',
        credentials.host,
        credentials.database,
        credentials.username,
        credentials.password,
    ]);
}

function safeFilePart(value: string): string {
    return value
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

export class LargeCellStore {
    private index?: Map<string, LargeCellIndexEntry>;
    private lastCreatedAt = 0;
    private readonly activeRuns = new Map<string, number>();
    private readonly pendingRunDeletes = new Set<string>();

    constructor(private readonly store: Store) {}

    private expiryPrefix(cellId: string): string | undefined {
        const match = /^e([0-9a-z]{1,10})_([0-9a-f-]{36})$/i.exec(cellId);
        if (!match) return undefined;
        const expiresAt = Number.parseInt(match[1]!, 36);
        return Number.isSafeInteger(expiresAt) ? `e${match[1]}_` : undefined;
    }

    private key(ownerKey: string, runId: string, cellId: string): string {
        const expiryPrefix = this.expiryPrefix(cellId) ?? '';
        const id = expiryPrefix ? cellId.slice(expiryPrefix.length) : cellId;
        return `${expiryPrefix}${hash(ownerKey).slice(0, 24)}-${hash(runId).slice(0, 24)}-${id}`;
    }

    private runKey(ownerKey: string, runId: string): string {
        return hash([ownerKey, runId]);
    }

    protectRun(ownerKey: string, runId: string): () => void {
        const runKey = this.runKey(ownerKey, runId);
        this.activeRuns.set(runKey, (this.activeRuns.get(runKey) ?? 0) + 1);
        let released = false;
        return () => {
            if (released) return;
            released = true;
            const count = this.activeRuns.get(runKey) ?? 0;
            if (count <= 1) {
                this.activeRuns.delete(runKey);
                if (this.pendingRunDeletes.delete(runKey)) this.deleteRun(ownerKey, runId);
            } else this.activeRuns.set(runKey, count - 1);
        };
    }

    private ensureIndex(): Map<string, LargeCellIndexEntry> {
        if (this.index) return this.index;
        const entries = new Map<string, LargeCellIndexEntry>();
        const cellKeys = new Set(this.store.keys('large-cells'));
        for (const entry of this.store.list('large-cell-index', isLargeCellIndexEntry)) {
            if (
                !cellKeys.has(entry.key) ||
                this.key(entry.ownerKey, entry.runId, entry.cellId) !== entry.key
            ) {
                this.store.delete('large-cell-index', entry.key);
                continue;
            }
            entries.set(entry.key, entry);
            this.lastCreatedAt = Math.max(this.lastCreatedAt, entry.createdAt);
        }

        // Re-index values written before the quota index existed, and recover entries if
        // the process stopped between writing a value and its small index record.
        for (const key of cellKeys) {
            if (entries.has(key)) continue;
            const value = this.store.get('large-cells', key, isRecord);
            const cell = storedLargeCell(value);
            if (!cell) continue;
            const entry: LargeCellIndexEntry = {
                key,
                ownerKey: cell.ownerKey,
                runId: cell.runId,
                cellId: cell.cellId,
                createdAt: 0,
                storageBytes: Buffer.byteLength(JSON.stringify(value)) + 512,
            };
            this.store.put('large-cell-index', key, entry);
            entries.set(key, entry);
        }
        this.index = entries;
        return entries;
    }

    private removeKey(key: string): void {
        this.store.delete('large-cells', key);
        this.store.delete('large-cell-index', key);
        this.index?.delete(key);
    }

    private ensureCapacity(requiredBytes: number, replacingKey?: string): void {
        const entries = this.ensureIndex();
        let usedBytes = 0;
        for (const [key, entry] of entries)
            if (key !== replacingKey) usedBytes += entry.storageBytes;
        if (usedBytes + requiredBytes <= MAX_LARGE_CELL_STORAGE_BYTES) return;

        const byRun = new Map<string, LargeCellIndexEntry[]>();
        for (const entry of entries.values()) {
            if (entry.key === replacingKey) continue;
            const runKey = this.runKey(entry.ownerKey, entry.runId);
            if (this.activeRuns.has(runKey)) continue;
            const runEntries = byRun.get(runKey) ?? [];
            runEntries.push(entry);
            byRun.set(runKey, runEntries);
        }
        const oldestRuns = [...byRun.values()].sort((left, right) => {
            const leftCreatedAt = Math.min(...left.map(entry => entry.createdAt));
            const rightCreatedAt = Math.min(...right.map(entry => entry.createdAt));
            return leftCreatedAt - rightCreatedAt || left[0]!.key.localeCompare(right[0]!.key);
        });
        for (const runEntries of oldestRuns) {
            for (const entry of runEntries) {
                this.removeKey(entry.key);
                usedBytes -= entry.storageBytes;
            }
            if (usedBytes + requiredBytes <= MAX_LARGE_CELL_STORAGE_BYTES) return;
        }
        throw new Error('Large cell storage capacity was exceeded.');
    }

    trimToCapacity(): void {
        const entries = this.ensureIndex();
        let usedBytes = [...entries.values()].reduce(
            (total, entry) => total + entry.storageBytes,
            0,
        );
        if (usedBytes <= MAX_LARGE_CELL_STORAGE_BYTES) return;

        const byRun = new Map<string, LargeCellIndexEntry[]>();
        for (const entry of entries.values()) {
            const runKey = this.runKey(entry.ownerKey, entry.runId);
            const runEntries = byRun.get(runKey) ?? [];
            runEntries.push(entry);
            byRun.set(runKey, runEntries);
        }
        const oldestRuns = [...byRun.values()].sort((left, right) => {
            const leftCreatedAt = Math.min(...left.map(entry => entry.createdAt));
            const rightCreatedAt = Math.min(...right.map(entry => entry.createdAt));
            return leftCreatedAt - rightCreatedAt || left[0]!.key.localeCompare(right[0]!.key);
        });
        for (const runEntries of oldestRuns) {
            for (const entry of runEntries) {
                this.removeKey(entry.key);
                usedBytes -= entry.storageBytes;
            }
            if (usedBytes <= MAX_LARGE_CELL_STORAGE_BYTES) return;
        }
    }

    save(input: {
        ownerKey: string;
        runId: string;
        cellId: string;
        value: string;
        valueType: StoredLargeCell['valueType'];
        bytes: number;
        serializedBytes: number;
        columnName: string;
        columnIndex: number;
        rowNumber: number;
    }): void {
        const extension = input.valueType === 'text' ? 'txt' : 'json';
        const safeName = safeFilePart(input.columnName) || 'cell';
        const key = this.key(input.ownerKey, input.runId, input.cellId);
        const cell = {
            ownerKey: input.ownerKey,
            runId: input.runId,
            cellId: input.cellId,
            value: input.value,
            valueType: input.valueType,
            bytes: input.bytes,
            serializedBytes: input.serializedBytes,
            fileName: `${safeName}-column-${input.columnIndex + 1}-row-${input.rowNumber}.${extension}`,
            mimeType:
                input.valueType === 'text'
                    ? 'text/plain;charset=utf-8'
                    : 'application/json;charset=utf-8',
        } satisfies StoredLargeCell;
        const storageBytes = Buffer.byteLength(JSON.stringify(cell)) + 512;
        this.ensureCapacity(storageBytes, key);
        const createdAt = Math.max(Date.now(), this.lastCreatedAt + 1);
        const entry: LargeCellIndexEntry = {
            key,
            ownerKey: input.ownerKey,
            runId: input.runId,
            cellId: input.cellId,
            createdAt,
            storageBytes,
        };
        this.store.put('large-cells', key, cell);
        try {
            this.store.put('large-cell-index', key, entry);
        } catch (error) {
            this.store.delete('large-cells', key);
            throw error;
        }
        this.ensureIndex().set(key, entry);
        this.lastCreatedAt = createdAt;
    }

    get(ownerKey: string, runId: string, cellId: string): StoredLargeCell | undefined {
        const expiryPrefix = this.expiryPrefix(cellId);
        const key = this.key(ownerKey, runId, cellId);
        if (expiryPrefix && Number.parseInt(expiryPrefix.slice(1, -1), 36) <= Date.now()) {
            this.removeKey(key);
            return undefined;
        }
        const cell = storedLargeCell(this.store.get('large-cells', key, isRecord));
        if (!cell || cell.ownerKey !== ownerKey || cell.runId !== runId || cell.cellId !== cellId)
            return undefined;
        return cell;
    }

    deleteRun(ownerKey: string, runId: string): void {
        const runKey = this.runKey(ownerKey, runId);
        if (this.activeRuns.has(runKey)) {
            this.pendingRunDeletes.add(runKey);
            return;
        }
        const prefix = `${hash(ownerKey).slice(0, 24)}-${hash(runId).slice(0, 24)}-`;
        for (const key of this.store.keys('large-cells')) {
            const expiryPrefix = /^e[0-9a-z]{1,10}_/i.exec(key)?.[0] ?? '';
            if (key.slice(expiryPrefix.length).startsWith(prefix)) this.removeKey(key);
        }
    }

    sweepExpiredCloudCells(now = Date.now()): void {
        for (const key of this.store.keys('large-cells')) {
            const expiryPrefix = /^e([0-9a-z]{1,10})_/i.exec(key);
            if (expiryPrefix && Number.parseInt(expiryPrefix[1]!, 36) <= now) this.removeKey(key);
        }
    }

    jsonValue(cell: StoredLargeCell): Json {
        return cell.valueType === 'text' ? cell.value : (JSON.parse(cell.value) as Json);
    }
}
