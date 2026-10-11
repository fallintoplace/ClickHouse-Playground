import { useCallback, useLayoutEffect, useState } from 'react';

export function useChartPlotWidth<T extends Element = HTMLDivElement>(viewBoxHeight?: number) {
    const [viewport, setViewport] = useState<T | null>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const onViewport = useCallback((element: T | null) => setViewport(element), []);

    useLayoutEffect(() => {
        if (!viewport) return;
        const measure = () => {
            const bounds = viewport.getBoundingClientRect();
            const measuredHeight =
                viewport instanceof HTMLElement ? viewport.clientHeight : bounds.height;
            let measuredWidth =
                viewport instanceof HTMLElement ? viewport.clientWidth : bounds.width;
            if (viewBoxHeight !== undefined) {
                measuredWidth =
                    bounds.height > 0 ? (bounds.width * viewBoxHeight) / bounds.height : 0;
            }
            setSize(current =>
                current.width === measuredWidth && current.height === measuredHeight
                    ? current
                    : { width: measuredWidth, height: measuredHeight },
            );
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(viewport);
        return () => observer.disconnect();
    }, [viewport, viewBoxHeight]);

    return { ...size, onViewport };
}
