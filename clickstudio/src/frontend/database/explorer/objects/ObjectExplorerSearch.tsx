import { Icon } from '../../../ui/components/icons';
import type { ObjectExplorerProps } from './tree/object-explorer-types';

export function ObjectExplorerSearch({
    search,
    changeSearch,
    copy,
}: {
    search: ObjectExplorerProps['search'];
    changeSearch: (value: string) => void;
    copy: ObjectExplorerProps['copy'];
}) {
    return (
        <div className="inspector-search object-search">
            <Icon name="search" />
            <input
                data-testid="schema-search"
                value={search}
                onChange={event => changeSearch(event.target.value)}
                placeholder={copy.objectSearch}
                aria-label={copy.objectSearch}
            />
            {search && (
                <button
                    type="button"
                    className="object-search-clear"
                    aria-label="Clear object search"
                    onClick={() => changeSearch('')}
                >
                    ×
                </button>
            )}
        </div>
    );
}
