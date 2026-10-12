import { DEFAULT_RESULT_PAGE_ROWS } from '../../../shared/queries/execution/limits';
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { displayValue, filterRows } from '../../../shared/queries/results/results';
import type { ResultPage } from '../../../shared/queries/results/types';
import type { Run } from '../../../shared/queries/execution/types';
import { NativeTable } from '../../ui/components/NativeTable';
import { ScrollEdgeFrame } from '../../ui/components/ScrollEdgeShadows';
import { cx, Spinner } from '../../ui/components/primitives';
import { ResultTableControls } from './ResultTableControls';
import { terminal } from '../execution/status';
import { statementOutcome } from './statement-outcome';

type ResultTypeGroup = 'number' | 'text' | 'temporal' | 'boolean' | 'complex' | 'other';

function resultTypeGroup(type: string): ResultTypeGroup {
    let baseType = type.trim();
    let wrapper = /^(?:Nullable|LowCardinality)\((.*)\)$/i.exec(baseType);
    while (wrapper) {
        const wrappedType = wrapper[1];
        if (!wrappedType) break;
        baseType = wrappedType.trim();
        wrapper = /^(?:Nullable|LowCardinality)\((.*)\)$/i.exec(baseType);
    }
    const simpleAggregate = /^SimpleAggregateFunction\([^,]+,\s*(.+)\)$/i.exec(baseType);
    const aggregateType = simpleAggregate?.[1];
    if (aggregateType) baseType = aggregateType.trim();

    if (
        /^(?:U?Int(?:8|16|32|64|128|256)|Float(?:16|32|64)|BFloat16|Decimal(?:32|64|128|256)?(?:\([^)]*\))?)$/i.test(
            baseType,
        )
    )
        return 'number';
    if (/^Bool$/i.test(baseType)) return 'boolean';
    if (/^(?:Date(?:32)?|DateTime(?:64)?(?:\([^)]*\))?|Time(?:64)?(?:\([^)]*\))?)$/i.test(baseType))
        return 'temporal';
    if (/^(?:String|FixedString|Enum8|Enum16|UUID|IPv4|IPv6)\b/i.test(baseType)) return 'text';
    if (
        /^(?:Array|Map|Tuple|Nested|JSON|Object|Dynamic|Variant|AggregateFunction)\b/i.test(
            baseType,
        )
    )
        return 'complex';
    return 'other';
}

function ResultColumnHeader({
    name,
    type,
    group,
}: {
    name: string;
    type: string;
    group: ResultTypeGroup;
}) {
    return (
        <th scope="col" data-type-group={group} data-overflow-title={`${name}\n${type}`}>
            <div className="result-column-heading">
                <span data-overflow-text>{name}</span>
                <small data-overflow-text>{type}</small>
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
    const [retainedPage, setRetainedPage] = useState(page);
    if (page && page !== retainedPage) setRetainedPage(page);
    const loadedPage = page;
    const pageLoading = loading || !loadedPage;
    page = loadedPage ?? retainedPage;
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
    const searchableRows = page.rows.map(row =>
        row.map(value => displayValue(value).toLocaleLowerCase()).join('\u0001'),
    );
    const matchingRows = new Set(filterRows(page.rows, filter, searchableRows));
    const visibleRows = page.rows.flatMap((row, index) =>
        matchingRows.has(row) ? [{ row, index }] : [],
    );
    const columnGroups = page.columns.map(column => resultTypeGroup(column.type));
    const pageCount = Math.max(1, Math.ceil(page.totalRows / DEFAULT_RESULT_PAGE_ROWS));
    const rowRange = page.rows.length
        ? `${(page.offset + 1).toLocaleString()}–${(page.offset + page.rows.length).toLocaleString()}`
        : '0';
    const retainedRange = `${rowRange} of ${page.totalRows.toLocaleString()} retained rows`;
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
            />
        </div>
    );
    const emptyRowsMessage = emptyRetainedRowsMessage(page);
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
                            ref={ref}
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
                                        {page.columns.map((column, index) => (
                                            <ResultColumnHeader
                                                key={`${column.name}-${index}`}
                                                name={column.name}
                                                type={column.type}
                                                group={columnGroups[index] ?? 'other'}
                                            />
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {visibleRows.map(({ row, index: rowIndex }) => (
                                        <tr
                                            key={`${page.offset}-${rowIndex}`}
                                            style={{
                                                animationDelay: `${Math.min(rowIndex, 12) * 16}ms`,
                                            }}
                                        >
                                            <td className="row-number">
                                                {page.offset + rowIndex + 1}
                                            </td>
                                            {row.map((value, index) => (
                                                <td
                                                    key={index}
                                                    data-overflow-title={displayValue(value)}
                                                    data-type-group={columnGroups[index] ?? 'other'}
                                                    className={value === null ? 'cell-null' : ''}
                                                >
                                                    {displayValue(value)}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </NativeTable>
                            {page.rows.length === 0 ? (
                                <div className="no-rows" role="status">
                                    {emptyRowsMessage}
                                </div>
                            ) : (
                                visibleRows.length === 0 && (
                                    <div className="no-rows">No rows match on this page.</div>
                                )
                            )}
                        </div>
                    )}
                </ScrollEdgeFrame>
            )}
        </div>
    );
}
