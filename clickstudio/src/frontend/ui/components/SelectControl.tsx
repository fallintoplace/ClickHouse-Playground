import {
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type AriaAttributes,
    type KeyboardEvent,
} from 'react';

export type SelectControlOption = {
    value: string;
    label: string;
    title?: string;
    searchText?: string;
    disabled?: boolean;
};

function matchesSearch(option: SelectControlOption, search: string) {
    const query = search.trim().toLocaleLowerCase();
    return (
        !query || `${option.label} ${option.searchText ?? ''}`.toLocaleLowerCase().includes(query)
    );
}

function positionSelectMenu(
    element: HTMLDivElement,
    button: HTMLButtonElement,
    compactMenu: boolean,
) {
    const view = element.ownerDocument.defaultView;
    if (!view) return;
    const anchor = button.getBoundingClientRect();
    const edge = 8;
    const gap = 4;
    element.style.minWidth = `${Math.min(
        Math.max(anchor.width, compactMenu ? 140 : 220),
        view.innerWidth - edge * 2,
    )}px`;
    element.style.setProperty('--select-available-height', `${view.innerHeight - edge * 2}px`);
    const desiredHeight = element.getBoundingClientRect().height;
    const below = Math.max(0, view.innerHeight - anchor.bottom - gap - edge);
    const above = Math.max(0, anchor.top - gap - edge);
    const openAbove = below < desiredHeight && above > below;
    element.style.setProperty('--select-available-height', `${openAbove ? above : below}px`);
    const bounds = element.getBoundingClientRect();
    const left = Math.max(edge, Math.min(anchor.left, view.innerWidth - bounds.width - edge));
    const top = openAbove ? anchor.top - bounds.height - gap : anchor.bottom + gap;
    element.style.left = `${left}px`;
    element.style.top = `${Math.max(edge, Math.min(top, view.innerHeight - bounds.height - edge))}px`;
}

export function SelectControl({
    label,
    value,
    options,
    onChange,
    searchable = false,
    compactMenu = false,
    hideDisabledOptions = true,
    disabled = false,
    className = '',
    'aria-invalid': invalid,
    'aria-describedby': describedBy,
}: {
    label: string;
    value: string;
    options: SelectControlOption[];
    onChange: (value: string) => void;
    searchable?: boolean;
    compactMenu?: boolean;
    hideDisabledOptions?: boolean;
    disabled?: boolean;
    className?: string;
} & Pick<AriaAttributes, 'aria-invalid' | 'aria-describedby'>) {
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
    const visibleOptions = availableOptions.filter(option => matchesSearch(option, search));
    const enabledIndexes = visibleOptions.flatMap((option, index) =>
        option.disabled ? [] : [index],
    );
    const activeOption = visibleOptions[activeIndex];
    const activeOptionId = activeOption ? `${id}-option-${activeIndex}` : undefined;

    const positionMenu = useCallback(() => {
        if (menu.current && trigger.current)
            positionSelectMenu(menu.current, trigger.current, compactMenu);
    }, [compactMenu]);

    const showMenu = () => {
        const element = menu.current;
        if (!element || disabled || !hasEnabledOptions || element.matches(':popover-open')) return;
        setSearch('');
        const selectedIndex = availableOptions.findIndex(
            option => option.value === value && !option.disabled,
        );
        const firstEnabledIndex = availableOptions.findIndex(option => !option.disabled);
        setActiveIndex(Math.max(0, selectedIndex >= 0 ? selectedIndex : firstEnabledIndex));
        element.showPopover();
        setOpen(true);
        positionMenu();
        if (searchable) searchInput.current?.focus({ preventScroll: true });
        else listbox.current?.focus({ preventScroll: true });
    };

    const hideMenu = (restoreFocus = false) => {
        const element = menu.current;
        if (element?.matches(':popover-open')) element.hidePopover();
        setOpen(false);
        setSearch('');
        if (restoreFocus) trigger.current?.focus({ preventScroll: true });
    };

    const chooseOption = (option: SelectControlOption | undefined) => {
        if (disabled || !option || option.disabled) return;
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
        if (
            (!disabled && hasEnabledOptions && !hasSingleOption) ||
            !element?.matches(':popover-open')
        )
            return;
        element.hidePopover();
    }, [disabled, hasEnabledOptions, hasSingleOption]);

    useLayoutEffect(() => {
        if (!open) return;
        positionMenu();
        listbox.current
            ?.querySelector<HTMLElement>('[data-active="true"]')
            ?.scrollIntoView({ block: 'nearest' });
    }, [open, activeIndex, search, options, positionMenu]);

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
                    role="group"
                    aria-label={label}
                    aria-invalid={invalid}
                    aria-describedby={describedBy}
                    data-value={value}
                >
                    <span className="chart-select-value">{singleOption.label}</span>
                </span>
            ) : (
                <button
                    ref={trigger}
                    type="button"
                    className="chart-select-trigger"
                    disabled={disabled || !hasEnabledOptions}
                    role="combobox"
                    aria-label={label}
                    aria-invalid={invalid}
                    aria-describedby={describedBy}
                    aria-haspopup="listbox"
                    aria-expanded={open}
                    aria-controls={`${id}-listbox`}
                    aria-activedescendant={open ? activeOptionId : undefined}
                    aria-valuetext={selected?.label ?? ''}
                    title={selected?.title ?? selected?.label}
                    data-value={value}
                    data-state={open ? 'open' : 'closed'}
                    popoverTarget={id}
                    popoverTargetAction="toggle"
                    onClick={event => {
                        event.preventDefault();
                        if (menu.current?.matches(':popover-open')) hideMenu();
                        else showMenu();
                    }}
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
                    if (!isOpen) setSearch('');
                }}
                onKeyDown={event => {
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        hideMenu(true);
                    } else if (event.key === 'Tab') hideMenu(true);
                }}
            >
                {searchable && (
                    <input
                        ref={searchInput}
                        className="chart-select-search"
                        type="search"
                        aria-label={`Search ${label.toLocaleLowerCase()}`}
                        placeholder="Search options…"
                        value={search}
                        onChange={event => {
                            const nextSearch = event.target.value;
                            setSearch(nextSearch);
                            const nextVisibleOptions = availableOptions.filter(option =>
                                matchesSearch(option, nextSearch),
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
                            title={option.title ?? option.label}
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
                    {visibleOptions.length === 0 && (
                        <div className="chart-select-empty" role="status">
                            No matches
                        </div>
                    )}
                </div>
            </div>
        </span>
    );
}
