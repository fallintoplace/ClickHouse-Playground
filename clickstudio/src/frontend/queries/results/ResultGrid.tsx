import { DEFAULT_RESULT_PAGE_ROWS } from '../../../shared/queries/execution/limits';
import { memo, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
    displayValue,
    filterRows,
    previewResultCell,
} from '../../../shared/queries/results/results';
import type { ResultPage } from '../../../shared/queries/results/types';
import type { Run } from '../../../shared/queries/execution/types';
import { CLICKHOUSE_CLOUD_CONNECTION_ID } from '../../../shared/database/connections/cloud-policy';
import { isLargeCellReference } from '../../../shared/queries/results/large-cells';
import { NativeTable } from '../../ui/components/NativeTable';
import { ScrollEdgeFrame } from '../../ui/components/ScrollEdgeShadows';
import { cx, Spinner } from '../../ui/components/primitives';
import { ResultTableControls } from './ResultTableControls';
import { CellInspector, type InspectedCell } from './CellInspector';
import { terminal } from '../execution/status';
import { statementOutcome } from './statement-outcome';
import { resultTypeGroup, type ResultTypeGroup } from './result-type-group';
import { largeCellUrl } from './large-cell-actions';

function ResultColumnHeader({
    name,
    type,
    group,
    index,
    pinned,
    left,
}: {
    name: string;
    type: string;
    group: ResultTypeGroup;
    index: number;
    pinned: boolean;
    left?: number;
}) {
    const headingRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const heading = headingRef.current;
        const cell = heading?.parentElement;
        const label = heading?.querySelector<HTMLSpanElement>('span');
        const badge = heading?.querySelector<HTMLElement>('.result-type-badge');
        if (!heading || !cell || !label || !badge) return;

        const measure = () => {
            const cellStyle = getComputedStyle(cell);
            const contentWidth =
                cell.clientWidth -
                Number.parseFloat(cellStyle.paddingLeft) -
                Number.parseFloat(cellStyle.paddingRight);
            const gap = Number.parseFloat(getComputedStyle(heading).columnGap);
            const requiredWidth = label.clientWidth + gap + badge.scrollWidth;
            heading.classList.toggle(
                'result-column-heading-wide',
                contentWidth > 300 && requiredWidth > 300,
            );
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(cell);
        return () => observer.disconnect();
    }, [name, type]);

    return (
        <th
            scope="col"
            data-column-index={index}
            data-type-group={group}
            data-pinned-column={pinned || undefined}
            style={pinned ? { left: `${left ?? 48}px` } : undefined}
            data-overflow-title={`${name}\n${type}`}
        >
            <div className="result-column-heading" ref={headingRef}>
                <span data-overflow-text>{name}</span>
                <small className="result-type-badge" data-overflow-text data-type-group={group}>
                    {type}
                </small>
            </div>
        </th>
    );
}

function emptyRetainedRowsMessage(page: ResultPage): string {
    let emptyRowsMessage: string;

    if (page.totalRows > 0) {
        emptyRowsMessage = 'No retained rows are available on this page.';
    } else if (page.completeness === 'truncated') {
        emptyRowsMessage =
            'No rows fit in the retained result. The query may still have matched rows; the result limits left none to keep.';
    } else {
        emptyRowsMessage = 'This query returned zero rows.';
    }
    return emptyRowsMessage;
}

function renderInContainer(content: ReactNode, container?: HTMLElement | null) {
    return container ? createPortal(content, container) : content;
}

function usePinnedColumnOffsets(
    page: ResultPage | undefined,
    orderedColumnKey: string,
    pinnedColumns: Set<number>,
) {
    const tableViewport = useRef<HTMLDivElement>(null);
    const [pinnedOffsets, setPinnedOffsets] = useState<Record<number, number>>({});
    const columns = page?.columns;

    useLayoutEffect(() => {
        const table = tableViewport.current?.querySelector<HTMLTableElement>('.data-table');
        if (!table || !columns) return;
        const orderedColumnIndices = orderedColumnKey
            ? orderedColumnKey.split(',').map(Number)
            : [];
        const measure = () => {
            let left = 48;
            const next: Record<number, number> = {};
            for (const index of orderedColumnIndices) {
                if (!pinnedColumns.has(index)) continue;
                next[index] = left;
                const header = table.querySelector<HTMLElement>(`[data-column-index="${index}"]`);
                left += header?.getBoundingClientRect().width ?? 128;
            }
            setPinnedOffsets(previous => {
                const previousKeys = Object.keys(previous);
                const nextKeys = Object.keys(next);
                if (
                    previousKeys.length === nextKeys.length &&
                    nextKeys.every(key => previous[Number(key)] === next[Number(key)])
                )
                    return previous;
                return next;
            });
        };
        measure();
        const observer =
            typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
        for (const header of table.querySelectorAll<HTMLElement>('th[data-column-index]'))
            observer?.observe(header);
        table.ownerDocument.defaultView?.addEventListener('resize', measure);
        return () => {
            observer?.disconnect();
            table.ownerDocument.defaultView?.removeEventListener('resize', measure);
        };
    }, [columns, orderedColumnKey, pinnedColumns]);

    return { tableViewport, pinnedOffsets };
}

const ResultRows = memo(function ResultRows({
    runId,
    cloudConnection,
    page,
    visibleRows,
    orderedColumnIndices,
    columnGroups,
    pinnedColumns,
    pinnedOffsets,
    onInspectCell,
}: {
    runId: string;
    cloudConnection: boolean;
    page: ResultPage;
    visibleRows: Array<{ row: ResultPage['rows'][number]; index: number }>;
    orderedColumnIndices: number[];
    columnGroups: ResultTypeGroup[];
    pinnedColumns: Set<number>;
    pinnedOffsets: Record<number, number>;
    onInspectCell: (cell: InspectedCell) => void;
}) {
    return (
        <tbody>
            {visibleRows.map(({ row, index: rowIndex }) => (
                <tr
                    key={`${page.offset}-${rowIndex}`}
                    style={{ animationDelay: `${Math.min(rowIndex, 12) * 16}ms` }}
                >
                    <td className="row-number">{page.offset + rowIndex + 1}</td>
                    {orderedColumnIndices.map(columnIndex => {
                        const value = row[columnIndex];
                        const largeCell = isLargeCellReference(value, page.largeCellToken)
                            ? value
                            : undefined;
                        const column = page.columns[columnIndex]!;
                        const preview = previewResultCell(value, page.largeCellToken);
                        const pinned = pinnedColumns.has(columnIndex);
                        const rowNumber = page.offset + rowIndex + 1;
                        const largeCellDescription = largeCell
                            ? `, large value ${(largeCell.bytes / 1_000_000).toFixed(1)} MB`
                            : '';
                        const accessibleLabel =
                            `Inspect ${column.name}, column ${columnIndex + 1}, row ${rowNumber}` +
                            `${largeCellDescription}: ${preview}`;
                        return (
                            <td
                                key={columnIndex}
                                data-column-index={columnIndex}
                                data-pinned-column={pinned || undefined}
                                style={
                                    pinned
                                        ? { left: `${pinnedOffsets[columnIndex] ?? 48}px` }
                                        : undefined
                                }
                                data-type-group={columnGroups[columnIndex] ?? 'other'}
                                className={value === null ? 'cell-null' : ''}
                            >
                                <button
                                    type="button"
                                    className={`result-cell-trigger${largeCell ? ' result-cell-trigger-large' : ''}`}
                                    data-overflow-title={
                                        largeCell
                                            ? `${preview}\n${(largeCell.bytes / 1_000_000).toFixed(1)} MB`
                                            : preview
                                    }
                                    aria-label={accessibleLabel}
                                    onClick={() =>
                                        onInspectCell({
                                            columnName: column.name,
                                            columnType: column.type,
                                            columnIndex,
                                            rowNumber,
                                            value,
                                            largeCellToken: page.largeCellToken,
                                            ...(largeCell
                                                ? {
                                                      largeCellUrl: largeCellUrl(
                                                          runId,
                                                          page.queryId,
                                                          cloudConnection,
                                                          largeCell.id,
                                                      ),
                                                  }
                                                : {}),
                                        })
                                    }
                                >
                                    {largeCell ? (
                                        <>
                                            <span className="result-cell-preview">{preview}</span>
                                            <small className="result-cell-size">
                                                {(largeCell.bytes / 1_000_000).toFixed(1)} MB
                                            </small>
                                        </>
                                    ) : (
                                        preview
                                    )}
                                </button>
                            </td>
                        );
                    })}
                </tr>
            ))}
        </tbody>
    );
});

export function ResultGrid({
    run,
    page,
    pageIndex,
    loading,
    onPage,
    showPagination = true,
    obscured = false,
    toolbarContainer,
    rowCountContainer,
    previousRunLabel,
}: {
    run: Run;
    page?: ResultPage;
    pageIndex: number;
    loading: boolean;
    onPage: (page: number) => void;
    showPagination?: boolean;
    obscured?: boolean;
    toolbarContainer?: HTMLElement | null;
    rowCountContainer?: HTMLElement | null;
    previousRunLabel?: string;
}) {
    const [filter, setFilter] = useState('');
    const [columnSearch, setColumnSearch] = useState('');
    const [hiddenColumns, setHiddenColumns] = useState<Set<number>>(() => new Set());
    const [pinnedColumns, setPinnedColumns] = useState<Set<number>>(() => new Set());
    const [inspectedCell, setInspectedCell] = useState<InspectedCell | null>(null);
    const [retainedPage, setRetainedPage] = useState(page);
    if (page && page !== retainedPage) setRetainedPage(page);
    const loadedPage = page;
    const pageLoading = loading || !loadedPage;
    page = loadedPage ?? retainedPage;
    const columns = page?.columns;
    const rows = page?.rows;
    const largeCellToken = page?.largeCellToken;
    const hasFilter = Boolean(filter);
    const orderedColumnIndices = useMemo(
        () =>
            columns
                ? columns
                      .map((_, index) => index)
                      .filter(index => pinnedColumns.has(index))
                      .concat(
                          columns
                              .map((_, index) => index)
                              .filter(index => !pinnedColumns.has(index)),
                      )
                      .filter(index => !hiddenColumns.has(index))
                : [],
        [columns, pinnedColumns, hiddenColumns],
    );
    const searchableRows = useMemo(
        () =>
            hasFilter
                ? rows?.map(row =>
                      row
                          .map(value => displayValue(value, largeCellToken).toLocaleLowerCase())
                          .join('\u0001'),
                  )
                : undefined,
        [rows, largeCellToken, hasFilter],
    );
    const visibleRows = useMemo(() => {
        if (!rows) return [];
        const matchingRows = new Set(filterRows(rows, filter, searchableRows, largeCellToken));
        return rows.flatMap((row, index) => (matchingRows.has(row) ? [{ row, index }] : []));
    }, [rows, filter, searchableRows, largeCellToken]);
    const columnGroups = useMemo(
        () => columns?.map(column => resultTypeGroup(column.type)) ?? [],
        [columns],
    );
    const orderedColumnKey = orderedColumnIndices.join(',');
    const { tableViewport, pinnedOffsets } = usePinnedColumnOffsets(
        page,
        orderedColumnKey,
        pinnedColumns,
    );

    const toggleHiddenColumn = (index: number) =>
        setHiddenColumns(previous => {
            const next = new Set(previous);
            if (next.has(index)) next.delete(index);
            else next.add(index);
            return next;
        });
    const togglePinnedColumn = (index: number) =>
        setPinnedColumns(previous => {
            const next = new Set(previous);
            if (next.has(index)) next.delete(index);
            else next.add(index);
            return next;
        });
    const restoreColumns = () => {
        setHiddenColumns(new Set());
        setPinnedColumns(new Set());
    };
    if (run.resultState === 'unavailable') return null;
    if (run.resultState !== 'reopenable')
        return (
            <div className="result-empty-state">
                {terminal(run) ? <span className="empty-result-icon">!</span> : <Spinner />}
                <strong>{terminal(run) ? 'No retained result' : 'Query is running'}</strong>
                <p>
                    {terminal(run)
                        ? 'This run did not produce result rows.'
                        : 'The live execution status appears in the bottom bar.'}
                </p>
            </div>
        );
    if (!page)
        return (
            <div className="result-loading">
                <Spinner />
                <span>Loading retained rows…</span>
            </div>
        );
    if (
        page.columns.length === 0 &&
        page.rows.length === 0 &&
        page.totalRows === 0 &&
        page.completeness !== 'truncated'
    )
        return (
            <div className="result-empty-state" role="status">
                <strong>{statementOutcome(run)}</strong>
                <p>No result set was returned.</p>
            </div>
        );
    const pageCount = Math.max(1, Math.ceil(page.totalRows / DEFAULT_RESULT_PAGE_ROWS));
    const rowRange = page.rows.length
        ? `${(page.offset + 1).toLocaleString()}–${(page.offset + page.rows.length).toLocaleString()}`
        : '0';
    const retainedRange = `${rowRange} of ${page.totalRows.toLocaleString()} retained rows`;
    const emptyRowsMessage = emptyRetainedRowsMessage(page);
    let noRowsText: string | undefined;
    if (page.rows.length === 0) noRowsText = emptyRowsMessage;
    else if (orderedColumnIndices.length === 0)
        noRowsText = 'All columns are hidden. Open Manage columns to show them.';
    else if (visibleRows.length === 0) noRowsText = 'No rows match on this page.';
    const rowCount = `${page.totalRows.toLocaleString()} ${page.totalRows === 1 ? 'row' : 'rows'}`;
    const rowCountLabel = (
        <span
            className="result-row-count"
            role="status"
            aria-live="polite"
            inert={obscured || undefined}
            title={pageCount > 1 ? retainedRange : undefined}
        >
            {rowCount}
            {previousRunLabel && <> · {previousRunLabel}</>}
        </span>
    );
    const toolbar = showPagination && (
        <div className="result-table-toolbar" inert={obscured || undefined}>
            {renderInContainer(rowCountLabel, rowCountContainer)}
            <ResultTableControls
                filter={filter}
                onFilter={setFilter}
                matchingCount={visibleRows.length}
                pageRows={page.rows.length}
                pageIndex={pageIndex}
                pageCount={pageCount}
                retainedRange={retainedRange}
                loading={pageLoading}
                onPage={onPage}
                columns={page.columns}
                hiddenColumns={hiddenColumns}
                pinnedColumns={pinnedColumns}
                columnSearch={columnSearch}
                onColumnSearch={setColumnSearch}
                onToggleColumn={toggleHiddenColumn}
                onTogglePinned={togglePinnedColumn}
                onRestoreColumns={restoreColumns}
            />
        </div>
    );
    return (
        <div
            className={cx(
                'result-grid-wrap animate-enter',
                obscured && 'is-pending-previous-result',
            )}
            aria-busy={obscured || undefined}
            inert={obscured || undefined}
        >
            {renderInContainer(toolbar, toolbarContainer)}
            {pageLoading ? (
                <div className="result-loading" role="status">
                    <Spinner />
                    <span>Loading retained rows…</span>
                </div>
            ) : (
                <ScrollEdgeFrame<HTMLDivElement> className="data-table-scroll-frame">
                    {(ref, edges) => (
                        <div
                            ref={element => {
                                ref(element);
                                tableViewport.current = element;
                            }}
                            className="data-table-scroll"
                            role="region"
                            aria-label={
                                edges.left || edges.right
                                    ? 'Retained query rows. Scroll horizontally to view all columns.'
                                    : 'Retained query rows'
                            }
                            tabIndex={edges.left || edges.right ? 0 : undefined}
                        >
                            <NativeTable className="data-table" aria-label="Retained query rows">
                                <thead>
                                    <tr>
                                        <th className="row-number" scope="col">
                                            #
                                        </th>
                                        {orderedColumnIndices.map(index => {
                                            const column = page.columns[index]!;
                                            const pinned = pinnedColumns.has(index);
                                            return (
                                                <ResultColumnHeader
                                                    key={index}
                                                    name={column.name}
                                                    type={column.type}
                                                    group={columnGroups[index] ?? 'other'}
                                                    index={index}
                                                    pinned={pinned}
                                                    left={pinnedOffsets[index]}
                                                />
                                            );
                                        })}
                                    </tr>
                                </thead>
                                <ResultRows
                                    runId={run.id}
                                    cloudConnection={
                                        run.connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID
                                    }
                                    page={page}
                                    visibleRows={visibleRows}
                                    orderedColumnIndices={orderedColumnIndices}
                                    columnGroups={columnGroups}
                                    pinnedColumns={pinnedColumns}
                                    pinnedOffsets={pinnedOffsets}
                                    onInspectCell={setInspectedCell}
                                />
                            </NativeTable>
                            {noRowsText && (
                                <div className="no-rows" role="status">
                                    {noRowsText}
                                </div>
                            )}
                        </div>
                    )}
                </ScrollEdgeFrame>
            )}
            {inspectedCell && (
                <CellInspector cell={inspectedCell} onClose={() => setInspectedCell(null)} />
            )}
        </div>
    );
}
