import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

export type SelectControlOption = {
    value: string;
    label: string;
    disabled?: boolean;
};

export function SelectControl({
    label,
    value,
    options,
    onChange,
    searchable = false,
    hideDisabledOptions = true,
    className = '',
}: {
    label: string;
    value: string;
    options: SelectControlOption[];
    onChange: (value: string) => void;
    searchable?: boolean;
    hideDisabledOptions?: boolean;
    className?: string;
}) {
    const id = useId();
    const trigger = useRef<HTMLButtonElement>(null);
    const menu = useRef<HTMLDivElement>(null);
    const searchInput = useRef<HTMLInputElement>(null);
    const listbox = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const selected = options.find(option => option.value === value);
    const hasEnabledOptions = options.some(option => !option.disabled);
    const availableOptions = hideDisabledOptions
        ? options.filter(option => !option.disabled)
        : options;
    const singleOption =
        availableOptions.length === 1 && !availableOptions[0]?.disabled
            ? availableOptions[0]
            : undefined;
    const hasSingleOption = singleOption !== undefined;
    const visibleOptions = availableOptions.filter(option =>
        option.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
    );
    const enabledIndexes = visibleOptions.flatMap((option, index) =>
        option.disabled ? [] : [index],
    );
    const activeOption = visibleOptions[activeIndex];
    const activeOptionId = activeOption ? `${id}-option-${activeIndex}` : undefined;

    const positionMenu = useCallback(() => {
        const element = menu.current;
        const button = trigger.current;
        const view = element?.ownerDocument.defaultView;
        if (!element || !button || !view) return;
        const anchor = button.getBoundingClientRect();
        const bounds = element.getBoundingClientRect();
        const left = Math.max(8, Math.min(anchor.left, view.innerWidth - bounds.width - 8));
        const top =
            anchor.bottom + 4 + bounds.height <= view.innerHeight - 8
                ? anchor.bottom + 4
                : Math.max(8, anchor.top - bounds.height - 4);
        element.style.left = `${left}px`;
        element.style.top = `${top}px`;
    }, []);

    const showMenu = () => {
        const element = menu.current;
        if (!element || !hasEnabledOptions || element.matches(':popover-open')) return;
        setSearch('');
        const selectedIndex = availableOptions.findIndex(
            option => option.value === value && !option.disabled,
        );
        const firstEnabledIndex = availableOptions.findIndex(option => !option.disabled);
        setActiveIndex(Math.max(0, selectedIndex >= 0 ? selectedIndex : firstEnabledIndex));
        element.showPopover();
    };

    const hideMenu = (restoreFocus = false) => {
        const element = menu.current;
        if (element?.matches(':popover-open')) element.hidePopover();
        if (restoreFocus) trigger.current?.focus({ preventScroll: true });
    };

    const chooseOption = (option: SelectControlOption | undefined) => {
        if (!option || option.disabled) return;
        onChange(option.value);
        hideMenu(true);
    };

    const moveActive = (direction: number) => {
        if (enabledIndexes.length === 0) return;
        const current = enabledIndexes.indexOf(activeIndex);
        let start = current;
        if (start < 0) start = direction > 0 ? -1 : 0;
        const next = (start + direction + enabledIndexes.length) % enabledIndexes.length;
        setActiveIndex(enabledIndexes[next]!);
    };

    const handleListboxKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            moveActive(event.key === 'ArrowDown' ? 1 : -1);
        } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            const next = event.key === 'Home' ? enabledIndexes[0] : enabledIndexes.at(-1);
            if (next !== undefined) setActiveIndex(next);
        } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            chooseOption(activeOption);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            hideMenu(true);
        }
    };

    useEffect(() => {
        const element = menu.current;
        if ((hasEnabledOptions && !hasSingleOption) || !element?.matches(':popover-open')) return;
        element.hidePopover();
    }, [hasEnabledOptions, hasSingleOption]);

    useEffect(() => {
        if (!open) return;
        const element = menu.current;
        const document = element?.ownerDocument;
        const view = document?.defaultView;
        if (!element || !document || !view) return;
        const closeOnResize = () => {
            if (element.matches(':popover-open')) element.hidePopover();
        };
        const repositionOnScroll = (event: Event) => {
            if (
                element.matches(':popover-open') &&
                trigger.current &&
                !event.composedPath().includes(element)
            )
                positionMenu();
        };
        view.addEventListener('resize', closeOnResize);
        document.addEventListener('scroll', repositionOnScroll, true);
        return () => {
            view.removeEventListener('resize', closeOnResize);
            document.removeEventListener('scroll', repositionOnScroll, true);
        };
    }, [open, positionMenu]);

    return (
        <span
            className={
                className === 'chart-select' ? className : `chart-select ${className}`.trim()
            }
        >
            {singleOption ? (
                <span
                    className="chart-select-trigger chart-select-static"
                    title={singleOption.label}
                >
                    <span className="chart-select-value">{singleOption.label}</span>
                </span>
            ) : (
                <button
                    ref={trigger}
                    type="button"
                    className="chart-select-trigger"
                    disabled={!hasEnabledOptions}
                    role="combobox"
                    aria-label={label}
                    aria-haspopup="listbox"
                    aria-expanded={open}
                    aria-controls={`${id}-listbox`}
                    aria-activedescendant={open ? activeOptionId : undefined}
                    aria-valuetext={selected?.label ?? ''}
                    data-value={value}
                    data-state={open ? 'open' : 'closed'}
                    popoverTarget={id}
                    popoverTargetAction="toggle"
                    onKeyDown={event => {
                        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                            event.preventDefault();
                            showMenu();
                        }
                    }}
                >
                    <span className="chart-select-value">{selected?.label ?? ''}</span>
                    <span className="chart-select-chevron" aria-hidden="true" />
                </button>
            )}
            <div
                ref={menu}
                id={id}
                className="chart-select-menu"
                popover="auto"
                onToggle={event => {
                    const isOpen = event.newState === 'open';
                    setOpen(isOpen);
                    if (!isOpen) {
                        setSearch('');
                        return;
                    }
                    positionMenu();
                    requestAnimationFrame(() => {
                        if (searchable) searchInput.current?.focus({ preventScroll: true });
                        else listbox.current?.focus({ preventScroll: true });
                    });
                }}
                onKeyDown={event => {
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        hideMenu(true);
                    }
                }}
            >
                {searchable && (
                    <input
                        ref={searchInput}
                        className="chart-select-search"
                        type="search"
                        aria-label={`Search ${label.toLocaleLowerCase()}`}
                        placeholder={`Search ${label.toLocaleLowerCase()}`}
                        value={search}
                        onChange={event => {
                            const nextSearch = event.target.value;
                            setSearch(nextSearch);
                            const nextVisibleOptions = availableOptions.filter(option =>
                                option.label
                                    .toLocaleLowerCase()
                                    .includes(nextSearch.trim().toLocaleLowerCase()),
                            );
                            const firstEnabled = nextVisibleOptions.findIndex(
                                option => !option.disabled,
                            );
                            setActiveIndex(Math.max(0, firstEnabled));
                        }}
                        onKeyDown={event => {
                            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                                event.preventDefault();
                                listbox.current?.focus({ preventScroll: true });
                                moveActive(event.key === 'ArrowDown' ? 1 : -1);
                            } else if (event.key === 'Enter') {
                                event.preventDefault();
                                chooseOption(activeOption);
                            }
                        }}
                    />
                )}
                <div
                    ref={listbox}
                    id={`${id}-listbox`}
                    className="chart-select-listbox"
                    role="listbox"
                    aria-label={label}
                    aria-activedescendant={activeOptionId}
                    tabIndex={-1}
                    onKeyDown={handleListboxKeyDown}
                >
                    {visibleOptions.map((option, index) => (
                        <div
                            key={option.value}
                            id={`${id}-option-${index}`}
                            className="chart-select-option"
                            role="option"
                            aria-selected={option.value === value}
                            aria-disabled={option.disabled || undefined}
                            data-value={option.value}
                            data-active={index === activeIndex || undefined}
                            data-disabled={option.disabled || undefined}
                            title={option.label}
                            onMouseMove={() => {
                                if (!option.disabled) setActiveIndex(index);
                            }}
                            onMouseDown={event => event.preventDefault()}
                            onClick={() => chooseOption(option)}
                        >
                            <span>{option.label}</span>
                            {option.value === value && (
                                <span className="chart-select-check" aria-hidden="true" />
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </span>
    );
}
