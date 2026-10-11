import { useCallback, useLayoutEffect, useState } from 'react';

export function useChartPlotWidth<T extends Element = HTMLDivElement>(viewBoxHeight?: number) {
    const [viewport, setViewport] = useState<T | null>(null);
    const [width, setWidth] = useState(0);
    const onViewport = useCallback((element: T | null) => setViewport(element), []);

    useLayoutEffect(() => {
        if (!viewport) return;
        const measure = () => {
            const bounds = viewport.getBoundingClientRect();
            let measuredWidth = bounds.width;
            if (viewBoxHeight !== undefined) {
                measuredWidth =
                    bounds.height > 0 ? (bounds.width * viewBoxHeight) / bounds.height : 0;
            }
            setWidth(measuredWidth);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(viewport);
        return () => observer.disconnect();
    }, [viewport, viewBoxHeight]);

    return { width, onViewport };
}
