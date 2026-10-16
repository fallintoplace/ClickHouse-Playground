import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type KeyboardEvent,
    type PointerEvent,
} from 'react';

type Point = { left: number; top: number };
type DockTarget = 'search' | 'page' | 'columns';

function clampPosition(panel: HTMLElement, point: Point): Point {
    const view = panel.ownerDocument.defaultView!;
    const bounds = panel.getBoundingClientRect();
    return {
        left: Math.max(8, Math.min(point.left, view.innerWidth - bounds.width - 8)),
        top: Math.max(8, Math.min(point.top, view.innerHeight - bounds.height - 8)),
    };
}

function placePanel(panel: HTMLElement, point: Point) {
    const position = clampPosition(panel, point);
    panel.style.left = `${position.left}px`;
    panel.style.top = `${position.top}px`;
    return position;
}

export function useResultControlsDock() {
    const anchor = useRef<HTMLDivElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const search = useRef<HTMLInputElement>(null);
    const page = useRef<HTMLInputElement>(null);
    const columns = useRef<HTMLInputElement>(null);
    const invoker = useRef<HTMLButtonElement | null>(null);
    const moved = useRef<Point | undefined>(undefined);
    const drag = useRef<{ x: number; y: number; start: Point } | undefined>(undefined);
    const [open, setOpen] = useState(false);
    const [pinned, setPinned] = useState(false);
    const [target, setTarget] = useState<DockTarget>('search');

    const close = useCallback((restoreFocus = false) => {
        const element = panel.current;
        if (element?.matches(':popover-open')) element.hidePopover();
        setOpen(false);
        setPinned(false);
        setTarget('search');
        moved.current = undefined;
        if (restoreFocus) invoker.current?.focus({ preventScroll: true });
    }, []);

    const reposition = useCallback(() => {
        const element = panel.current;
        const control = anchor.current;
        if (!element?.matches(':popover-open') || !control) return;
        if (!control.getClientRects().length) {
            close();
            return;
        }
        if (moved.current) {
            moved.current = placePanel(element, moved.current);
            return;
        }
        const bounds = control.getBoundingClientRect();
        const height = element.getBoundingClientRect().height;
        const fitsBelow =
            bounds.bottom + height + 14 <= element.ownerDocument.defaultView!.innerHeight;
        placePanel(element, {
            left: bounds.right - element.getBoundingClientRect().width,
            top: fitsBelow ? bounds.bottom + 6 : bounds.top - height - 6,
        });
    }, [close]);

    useEffect(() => {
        const element = panel.current;
        const control = anchor.current;
        const document = element?.ownerDocument;
        const view = document?.defaultView;
        if (!element || !control || !document || !view) return;
        const outside = (event: Event) => {
            const path = event.composedPath();
            const button = invoker.current;
            const target = event.target;
            const insidePanel =
                path.includes(element) ||
                (target instanceof Node && element.contains(target));
            if (
                !pinned &&
                !insidePanel &&
                (!button || !path.includes(button))
            )
                close();
        };
        const observer = new ResizeObserver(reposition);
        observer.observe(control);
        observer.observe(element);
        view.addEventListener('resize', reposition);
        document.addEventListener('scroll', reposition, true);
        document.addEventListener('pointerdown', outside, true);
        return () => {
            observer.disconnect();
            view.removeEventListener('resize', reposition);
            document.removeEventListener('scroll', reposition, true);
            document.removeEventListener('pointerdown', outside, true);
        };
    }, [pinned, close, reposition]);

    const show = (nextTarget: DockTarget, button: HTMLButtonElement) => {
        if (panel.current?.matches(':popover-open') && target === nextTarget) {
            close(true);
            return;
        }
        invoker.current = button;
        setTarget(nextTarget);
        panel.current?.showPopover();
        setOpen(true);
        reposition();
        if (nextTarget !== 'columns')
            (nextTarget === 'search' ? search : page).current?.focus({ preventScroll: true });
    };

    const move = (point: Point) => {
        if (panel.current) moved.current = placePanel(panel.current, point);
    };
    const moveByKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
        const directions: Record<string, [number, number]> = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1],
            ArrowDown: [0, 1],
        };
        const direction = directions[event.key];
        if (!direction || !panel.current) return;
        event.preventDefault();
        const bounds = panel.current.getBoundingClientRect();
        const step = event.shiftKey ? 40 : 10;
        move({ left: bounds.left + direction[0] * step, top: bounds.top + direction[1] * step });
    };
    const startMove = (event: PointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0 || !panel.current) return;
        const bounds = panel.current.getBoundingClientRect();
        drag.current = { x: event.clientX, y: event.clientY, start: bounds };
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const movePointer = (event: PointerEvent<HTMLButtonElement>) => {
        if (!drag.current) return;
        move({
            left: drag.current.start.left + event.clientX - drag.current.x,
            top: drag.current.start.top + event.clientY - drag.current.y,
        });
    };

    return {
        anchor,
        panel,
        search,
        page,
        columns,
        target,
        open,
        pinned,
        show,
        close,
        togglePin: () => {
            const bounds = panel.current?.getBoundingClientRect();
            moved.current = !pinned && bounds ? { left: bounds.left, top: bounds.top } : undefined;
            setPinned(value => !value);
            reposition();
        },
        moveHandle: {
            onKeyDown: moveByKeyboard,
            onPointerDown: startMove,
            onPointerMove: movePointer,
            onPointerUp: () => {
                drag.current = undefined;
            },
            onLostPointerCapture: () => {
                drag.current = undefined;
            },
        },
    };
}
