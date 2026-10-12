import type { ReactNode, RefCallback } from 'react';
import { ScrollEdgeFrame } from '../../../../ui/components/ScrollEdgeShadows';
import { ChartAxisLabels } from '../ChartAxisLabels';
import type { ChartSvgModel } from './chart-svg-model';

type ChartAxisModel = Pick<ChartSvgModel, 'viewportHeight' | 'chartYTicks' | 'compactNumber'>;

export type ChartPlotModel = Pick<
    ChartSvgModel,
    | keyof ChartAxisModel
    | 'viewportWidth'
    | 'plotRight'
    | 'chartAriaLabel'
    | 'plotTop'
    | 'plotMiddle'
    | 'plotBottom'
    | 'plotLeft'
    | 'chartKind'
    | 'zeroY'
    | 'chartXTicks'
>;

function ChartYTicks({ model, x }: { model: ChartAxisModel; x: number }) {
    return model.chartYTicks.map(tick => (
        <text
            key={`${tick.position}-${tick.value}`}
            className="chart-y-tick-label"
            x={x}
            y={tick.position}
            textAnchor="end"
            dominantBaseline="middle"
        >
            {model.compactNumber.format(tick.value)}
        </text>
    ));
}

export function ChartCanvas({
    model,
    categoricalAxis,
    onCategoryViewport,
    renderChartSvg,
}: {
    model: ChartAxisModel;
    categoricalAxis: boolean;
    onCategoryViewport: RefCallback<HTMLDivElement>;
    renderChartSvg: (categoricalAxis: boolean) => ReactNode;
}) {
    return (
        <div className={`chart-canvas${categoricalAxis ? ' chart-canvas--categorical' : ''}`}>
            {categoricalAxis && (
                <svg
                    className="chart-category-y-axis"
                    viewBox={`0 0 80 ${model.viewportHeight}`}
                    style={{ height: model.viewportHeight }}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                >
                    <ChartYTicks model={model} x={72} />
                </svg>
            )}
            {categoricalAxis ? (
                <ScrollEdgeFrame<HTMLDivElement>
                    className="chart-category-scroll-frame"
                    onViewport={onCategoryViewport}
                >
                    {ref => (
                        <div ref={ref} className="chart-category-scroll" tabIndex={0}>
                            {renderChartSvg(true)}
                        </div>
                    )}
                </ScrollEdgeFrame>
            ) : (
                renderChartSvg(false)
            )}
        </div>
    );
}

export function ChartPlot({
    model,
    categoricalAxis,
    onPlotViewport,
    children,
}: {
    model: ChartPlotModel;
    categoricalAxis: boolean;
    onPlotViewport: RefCallback<SVGSVGElement>;
    children: ReactNode;
}) {
    return (
        <svg
            ref={categoricalAxis ? undefined : onPlotViewport}
            className={categoricalAxis ? 'chart-category-plot' : undefined}
            viewBox={`0 0 ${categoricalAxis ? model.plotRight : model.viewportWidth} ${model.viewportHeight}`}
            preserveAspectRatio={categoricalAxis ? 'none' : undefined}
            style={
                categoricalAxis
                    ? {
                          '--chart-plot-width': `${model.plotRight}px`,
                          height: model.viewportHeight,
                      }
                    : undefined
            }
            role="img"
            aria-label={model.chartAriaLabel}
        >
            {[model.plotTop, model.plotMiddle, model.plotBottom].map(value => (
                <line
                    key={value}
                    x1={model.plotLeft}
                    x2={model.plotRight}
                    y1={value}
                    y2={value}
                    className="chart-gridline"
                />
            ))}
            {!categoricalAxis && <ChartYTicks model={model} x={model.plotLeft - 24} />}
            {model.chartKind !== 'scatter' && (
                <line
                    x1={model.plotLeft}
                    x2={model.plotRight}
                    y1={model.zeroY}
                    y2={model.zeroY}
                    className="chart-zero-line"
                />
            )}
            {children}
            <ChartAxisLabels
                ticks={model.chartXTicks}
                y={categoricalAxis ? model.plotBottom + 18 : 218}
            />
        </svg>
    );
}
