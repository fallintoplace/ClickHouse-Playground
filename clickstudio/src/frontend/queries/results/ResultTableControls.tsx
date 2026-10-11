import { useId, useState, type RefObject } from 'react';
import { Button, cx } from '../../ui/components/ui';
import { Icon } from '../../ui/components/icons';
import { useResultControlsDock } from './useResultControlsDock';

function ResultPagination({
    pageIndex,
    pageCount,
    loading,
    onPage,
    pageInput,
}: {
    pageIndex: number;
    pageCount: number;
    loading: boolean;
    onPage: (page: number) => void;
    pageInput: RefObject<HTMLInputElement | null>;
}) {
    const [jump, setJump] = useState(String(pageIndex + 1));
    const [previousPage, setPreviousPage] = useState(pageIndex);
    if (previousPage !== pageIndex) {
        setPreviousPage(pageIndex);
        setJump(String(pageIndex + 1));
    }
    return (
        <>
            <nav className="result-pagination" aria-label="Result pagination">
                <Button
                    variant="ghost"
                    aria-label="First page"
                    title="First page"
                    disabled={loading || pageIndex === 0}
                    onClick={() => onPage(0)}
                >
                    <Icon name="firstPage" />
                </Button>
                <Button
                    variant="ghost"
                    aria-label="Previous page"
                    title="Previous page"
                    disabled={loading || pageIndex === 0}
                    onClick={() => onPage(pageIndex - 1)}
                >
                    <Icon name="previousPage" />
                </Button>
                <span className="result-page-status" role="status" aria-live="polite">
                    Page {pageIndex + 1} of {pageCount}
                </span>
                <Button
                    variant="ghost"
                    aria-label="Next page"
                    title="Next page"
                    disabled={loading || pageIndex + 1 >= pageCount}
                    onClick={() => onPage(pageIndex + 1)}
                >
                    <Icon name="nextPage" />
                </Button>
                <Button
                    variant="ghost"
                    aria-label="Last page"
                    title="Last page"
                    disabled={loading || pageIndex + 1 >= pageCount}
                    onClick={() => onPage(pageCount - 1)}
                >
                    <Icon name="lastPage" />
                </Button>
            </nav>
            <form
                className="result-page-jump"
                onSubmit={event => {
                    event.preventDefault();
                    const next = Number(jump);
                    if (Number.isInteger(next) && next >= 1 && next <= pageCount && !loading)
                        onPage(next - 1);
                }}
            >
                <label>
                    Go to page
                    <input
                        ref={pageInput}
                        type="number"
                        min={1}
                        max={pageCount}
                        step={1}
                        required
                        value={jump}
                        disabled={loading}
                        onChange={event => setJump(event.target.value)}
                    />
                </label>
                <Button type="submit" disabled={loading}>
                    Go
                </Button>
            </form>
        </>
    );
}

export function ResultTableControls({
    filter,
    onFilter,
    matchingCount,
    pageRows,
    pageIndex,
    pageCount,
    retainedRange,
    loading,
    onPage,
}: {
    filter: string;
    onFilter: (filter: string) => void;
    matchingCount: number;
    pageRows: number;
    pageIndex: number;
    pageCount: number;
    retainedRange: string;
    loading: boolean;
    onPage: (page: number) => void;
}) {
    const id = useId();
    const dock = useResultControlsDock();
    return (
        <div className="result-table-controls" ref={dock.anchor}>
            <button
                type="button"
                className={cx('result-search-toggle', filter && 'is-active')}
                aria-label="Search rows"
                aria-description={filter ? `Search active: ${filter}` : undefined}
                aria-expanded={dock.open}
                aria-haspopup="dialog"
                aria-controls={id}
                title={filter ? `Search active: ${filter}` : 'Search this page'}
                onClick={event => dock.show('search', event.currentTarget)}
            >
                <Icon name="search" />
                {filter && <span className="result-search-active" aria-label="Search active" />}
            </button>
            {pageCount > 1 && (
                <button
                    type="button"
                    className="result-pages-toggle"
                    aria-label={`Pages: Page ${pageIndex + 1} of ${pageCount}`}
                    aria-haspopup="dialog"
                    aria-controls={id}
                    aria-expanded={dock.open}
                    title={`Page ${pageIndex + 1} of ${pageCount}`}
                    onClick={event => dock.show('page', event.currentTarget)}
                >
                    {pageIndex + 1}/{pageCount} <Icon name="chevron" />
                </button>
            )}
            <div
                ref={dock.panel}
                id={id}
                className="result-controls-panel"
                popover="manual"
                role="dialog"
                aria-label="Search & pages"
                aria-busy={loading || undefined}
                data-pinned={dock.pinned || undefined}
            >
                <div className="result-controls-heading">
                    <strong>Search & pages</strong>
                    {dock.pinned && (
                        <Button
                            variant="ghost"
                            className="result-controls-move"
                            aria-label="Move search and pages"
                            title="Drag to move. Use arrow keys to move; Shift moves faster."
                            {...dock.moveHandle}
                        >
                            <Icon name="move" />
                        </Button>
                    )}
                    <Button
                        variant="ghost"
                        aria-label="Keep search and pages open"
                        aria-pressed={dock.pinned}
                        title={dock.pinned ? 'Unpin' : 'Keep open'}
                        onClick={dock.togglePin}
                    >
                        <Icon name="pin" />
                    </Button>
                    <Button
                        variant="ghost"
                        aria-label="Close search and pages"
                        title="Close"
                        onClick={() => dock.close(true)}
                    >
                        <Icon name="close" />
                    </Button>
                </div>
                <label className="result-search-label" htmlFor={`${id}-search`}>
                    Search this page
                </label>
                <div className="result-filter-field">
                    <Icon name="search" className="result-filter-icon" />
                    <input
                        ref={dock.search}
                        id={`${id}-search`}
                        className="result-filter"
                        type="search"
                        placeholder="Find a value…"
                        value={filter}
                        onChange={event => onFilter(event.target.value)}
                    />
                </div>
                <div className="result-search-summary">
                    <span className="result-match-count" role="status" aria-live="polite">
                        {loading
                            ? 'Loading this page…'
                            : `${matchingCount.toLocaleString()} of ${pageRows.toLocaleString()} rows on this page`}
                    </span>
                    {filter && (
                        <Button
                            variant="ghost"
                            aria-label="Clear row filter"
                            onClick={() => {
                                onFilter('');
                                dock.search.current?.focus();
                            }}
                        >
                            Clear
                        </Button>
                    )}
                </div>
                {pageCount > 1 && (
                    <div className="result-controls-pages">
                        <ResultPagination
                            pageIndex={pageIndex}
                            pageCount={pageCount}
                            loading={loading}
                            onPage={onPage}
                            pageInput={dock.page}
                        />
                        <span className="result-retained-range">
                            {loading ? 'Loading retained rows…' : retainedRange}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}
