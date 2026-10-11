import { useLayoutEffect, useRef, type ComponentPropsWithoutRef } from 'react';

function updateOverflowTitle(element: HTMLElement) {
    const text = element.querySelectorAll<HTMLElement>('[data-overflow-text]');
    const targets = text.length ? Array.from(text) : [element];
    const clipped = targets.some(
        target =>
            target.scrollWidth > target.clientWidth || target.scrollHeight > target.clientHeight,
    );
    const title = clipped ? (element.dataset.overflowTitle ?? '') : '';
    if (element.getAttribute('title') !== title) element.title = title;
}

export function NativeTable({ children, ...props }: ComponentPropsWithoutRef<'table'>) {
    const table = useRef<HTMLTableElement>(null);

    useLayoutEffect(() => {
        const element = table.current;
        if (!element) return;

        let frame = 0;
        let disposed = false;
        const measure = () => {
            frame = 0;
            for (const target of element.querySelectorAll<HTMLElement>('[data-overflow-title]')) {
                updateOverflowTitle(target);
            }
        };
        const scheduleMeasure = () => {
            if (!frame && !disposed) frame = requestAnimationFrame(measure);
        };

        measure();
        const resize = new ResizeObserver(scheduleMeasure);
        resize.observe(element);
        if (element.parentElement) resize.observe(element.parentElement);
        const mutations = new MutationObserver(scheduleMeasure);
        mutations.observe(element, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['data-overflow-title', 'class', 'style'],
        });
        void document.fonts.ready.then(scheduleMeasure);

        return () => {
            disposed = true;
            resize.disconnect();
            mutations.disconnect();
            if (frame) cancelAnimationFrame(frame);
        };
    }, [children]);

    return (
        <table {...props} ref={table}>
            {children}
        </table>
    );
}
