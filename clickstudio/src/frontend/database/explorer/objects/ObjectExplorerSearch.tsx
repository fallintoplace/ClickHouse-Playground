import { Icon } from '../../../ui/components/icons';
import type { ObjectExplorerProps } from './tree/object-explorer-types';

export function ObjectExplorerSearch({
    search,
    changeSearch,
    copy,
    includeFunctions = false,
}: {
    includeFunctions?: boolean;
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
                placeholder={includeFunctions ? 'Search objects and functions…' : copy.objectSearch}
                aria-label={includeFunctions ? 'Search objects and functions…' : copy.objectSearch}
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
