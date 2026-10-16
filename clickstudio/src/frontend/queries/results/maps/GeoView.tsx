import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
    type MouseEvent as ReactMouseEvent,
} from 'react';
import {
    geoCentroid,
    geoGraticule10,
    geoMercator,
    geoPath,
    type ExtendedFeature,
    type ExtendedFeatureCollection,
} from 'd3';
import type { GeoProjection } from 'd3';
import { displayValue } from '../../../../shared/queries/results/results';
import {
    prepareGeoFeatures,
    geographyForColumns,
    type GeoFeature,
    type GeoRecommendation,
} from './geo';
import { geoHueForValue } from './geo-color';
import { geometryForProjection } from './geo-projection';
import type { Column, Json, Row } from '../../../../shared/common/values';
import type { Result } from '../../../../shared/queries/results/types';
import { ScrollEdgeFrame } from '../../../ui/components/ScrollEdgeShadows';
import { Spinner } from '../../../ui/components/primitives';
import type { ChartConfig } from '../../../../shared/queries/results/chart-settings';
import type { Copy } from '../../../ui/copy';
import type { prepareChartSelection } from '../charts/controls/chart-selection';
import { GeoChartControls } from './GeoChartControls';
import { useGeoBasemap } from './useGeoBasemap';
import type { MapLabel } from './geo-basemap';
import { isLargeCellReference } from '../../../../shared/queries/results/large-cells';
import {
    fetchLargeCellText,
    LARGE_CELL_FETCH_CONCURRENCY,
    largeCellUrl,
    type LargeCellRunContext,
} from '../large-cell-actions';

const WIDTH = 960;
const HEIGHT = 470;
const formatCount = (value: number) => new Intl.NumberFormat('en').format(value);
const geometryObject = (
    feature: GeoFeature,
): ExtendedFeature<GeoJSON.GeometryObject, Record<string, never>> => ({
    type: 'Feature',
    properties: {},
    geometry: geometryForProjection(feature.geometry),
});
type PointLabelPlacement = {
    x: number;
    y: number;
    width: number;
    height: number;
    label: string;
    measure?: string;
};

function mapPointerDelta(event: ReactPointerEvent<SVGSVGElement>, start: { x: number; y: number }) {
    const screen = event.currentTarget.getScreenCTM();
    if (!screen) return undefined;
    // The SVG can be letterboxed inside a wide, short map stage.
    const inverse = screen.inverse();
    const origin = new DOMPoint(start.x, start.y).matrixTransform(inverse);
    const pointer = new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
    return { x: pointer.x - origin.x, y: pointer.y - origin.y };
}

function useMapViewport() {
    const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
    const drag = useRef<
        { pointerId: number; x: number; y: number; originX: number; originY: number } | undefined
    >(undefined);
    const dragMoved = useRef(false);
    const zoom = (factor: number) =>
        setViewport(current => ({
            ...current,
            scale: Math.max(1, Math.min(8, current.scale * factor)),
        }));
    const reset = () => setViewport({ x: 0, y: 0, scale: 1 });
    const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
        if (event.button !== 0) return;
        dragMoved.current = false;
        // Keep capture on the hit feature so ordinary clicks reach its selection handler.
        if (event.target instanceof Element) event.target.setPointerCapture(event.pointerId);
        drag.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            originX: viewport.x,
            originY: viewport.y,
        };
    };
    const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 3)
            dragMoved.current = true;
        const delta = mapPointerDelta(event, current);
        if (!delta) return;
        setViewport(value => ({
            ...value,
            x: current.originX + delta.x,
            y: current.originY + delta.y,
        }));
    };
    const finishDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
        if (drag.current?.pointerId === event.pointerId) drag.current = undefined;
    };
    const onClickCapture = (event: ReactMouseEvent<SVGSVGElement>) => {
        if (!dragMoved.current) return;
        dragMoved.current = false;
        event.preventDefault();
        event.stopPropagation();
    };
    return { viewport, zoom, reset, onPointerDown, onPointerMove, finishDrag, onClickCapture };
}

function MapContext({
    land,
    labels,
}: {
    land: { name: string | undefined; d: string }[];
    labels: (MapLabel & { x: number; y: number })[];
}) {
    return (
        <g className="geo-context" aria-hidden="true">
            <g className="geo-context-boundaries">
                {land.map((area, index) => (
                    <path key={area.name ?? index} d={area.d} />
                ))}
            </g>
            <g className="geo-context-labels">
                {labels.map(label => (
                    <text
                        key={label.name}
                        className={label.water ? 'is-water' : undefined}
                        x={label.x}
                        y={label.y}
                        transform={
                            label.rotate
                                ? `rotate(${label.rotate} ${label.x} ${label.y})`
                                : undefined
                        }
                    >
                        {label.name}
                    </text>
                ))}
            </g>
        </g>
    );
}

function MapCanvas({
    prepared,
    columns,
    largeCellToken,
    measureIndex,
    completeness,
}: {
    prepared: ReturnType<typeof prepareGeoFeatures>;
    columns: Column[];
    largeCellToken?: string;
    measureIndex?: number;
    completeness: Result['completeness'];
}) {
    const [selectedIndex, setSelectedIndex] = useState<number>();
    const [hoveredIndex, setHoveredIndex] = useState<number>();
    const basemap = useGeoBasemap(prepared.features);
    const { viewport, zoom, reset, onPointerDown, onPointerMove, finishDrag, onClickCapture } =
        useMapViewport();
    const collection = useMemo<
        ExtendedFeatureCollection<ExtendedFeature<GeoJSON.GeometryObject, Record<string, never>>>
    >(
        () => ({
            type: 'FeatureCollection',
            features: prepared.features.map(geometryObject),
        }),
        [prepared.features],
    );
    const map = useMemo(() => {
        const projection = geoMercator();
        projection.fitExtent(
            [
                [34, 28],
                [WIDTH - 34, HEIGHT - 28],
            ],
            collection,
        );
        const center = geoCentroid(collection);
        if (!Number.isFinite(projection.scale()) || projection.scale() > basemap.config.maxScale)
            projection
                .center(center)
                .scale(basemap.config.maxScale)
                .translate([WIDTH / 2, HEIGHT / 2]);
        const path = geoPath(projection);
        return {
            projection,
            path,
            sphere: path({ type: 'Sphere' }),
            graticule: path(geoGraticule10()),
            land: basemap.features.flatMap(feature => {
                const d = path(feature);
                return d ? [{ name: feature.properties.name, d }] : [];
            }),
            labels: basemap.config.labels.flatMap(label => {
                const point = projection(label.position);
                return point &&
                    point[0] >= 10 &&
                    point[0] <= WIDTH - 10 &&
                    point[1] >= 15 &&
                    point[1] <= HEIGHT - 15
                    ? [{ ...label, x: point[0], y: point[1] }]
                    : [];
            }),
        };
    }, [basemap, collection]);
    const measures = prepared.features.flatMap(feature =>
        feature.measure === null ? [] : [feature.measure],
    );
    const minimum = Math.min(...measures, 0),
        maximum = Math.max(...measures, 0),
        range = maximum - minimum;
    const intensity = (feature: GeoFeature) => {
        if (feature.measure === null) {
            return 34;
        }

        if (range === 0) {
            return 76;
        }

        return 28 + 66 * ((feature.measure - minimum) / range);
    };
    const pointRadius = (feature: GeoFeature) =>
        feature.measure === null || range === 0
            ? 5
            : 4 + 6 * Math.sqrt(Math.max(0, (feature.measure - minimum) / range));
    const labelPlacements = useMapLabelPlacements({
        prepared,
        selectedIndex,
        hoveredIndex,
        map,
        range,
        minimum,
    });
    const selected = selectedIndex === undefined ? undefined : prepared.features[selectedIndex];
    return (
        <>
            <div className="geo-stage" data-basemap={basemap.config.id}>
                <div className="geo-map-tools" role="group" aria-label="Map view controls">
                    <button type="button" onClick={() => zoom(1.35)} aria-label="Zoom in">
                        +
                    </button>
                    <button type="button" onClick={() => zoom(1 / 1.35)} aria-label="Zoom out">
                        −
                    </button>
                    <button type="button" onClick={reset}>
                        Fit
                    </button>
                </div>
                <svg
                    className="geo-map"
                    viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                    role="img"
                    aria-label={`Spatial result map with ${prepared.features.length} rendered features`}
                    onClick={() => setSelectedIndex(undefined)}
                    onClickCapture={onClickCapture}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={finishDrag}
                    onPointerCancel={finishDrag}
                >
                    <g
                        transform={`translate(${viewport.x} ${viewport.y}) translate(${WIDTH / 2} ${HEIGHT / 2}) scale(${viewport.scale}) translate(${-WIDTH / 2} ${-HEIGHT / 2})`}
                    >
                        {map.sphere && <path className="geo-sphere" d={map.sphere} />}
                        {map.land.map((country, index) => (
                            <path
                                key={country.name ?? index}
                                className={
                                    basemap.config.id === 'nyc' ? 'geo-borough' : 'geo-country'
                                }
                                d={country.d}
                            >
                                {country.name && <title>{country.name}</title>}
                            </path>
                        ))}
                        {map.graticule && <path className="geo-graticule" d={map.graticule} />}
                        {prepared.features.map((feature, index) => {
                            const style = {
                                '--geo-intensity': `${Math.round(intensity(feature))}%`,
                                '--geo-hue': geoHueForValue(feature.measure, minimum, maximum),
                            };
                            if (feature.geometry.type === 'Point') {
                                const projected = map.projection(feature.geometry.coordinates);
                                if (!projected) return null;
                                const placement = labelPlacements.get(index);
                                const selectPoint = () => setSelectedIndex(index);
                                return (
                                    <g key={`${feature.rowIndex}-${index}`}>
                                        <circle
                                            className={`geo-feature geo-point${selectedIndex === index ? ' is-selected' : ''}`}
                                            cx={projected[0]}
                                            cy={projected[1]}
                                            r={pointRadius(feature)}
                                            style={style}
                                            onPointerEnter={() => setHoveredIndex(index)}
                                            onPointerLeave={() =>
                                                setHoveredIndex(current =>
                                                    current === index ? undefined : current,
                                                )
                                            }
                                            onClick={event => {
                                                event.stopPropagation();
                                                selectPoint();
                                            }}
                                        >
                                            <title>
                                                {feature.label}
                                                {feature.measure === null
                                                    ? ''
                                                    : ` · ${feature.measure}`}
                                            </title>
                                        </circle>
                                        {placement && (
                                            <g
                                                className="geo-point-label"
                                                transform={`translate(${placement.x} ${placement.y})`}
                                                aria-hidden="true"
                                            >
                                                <rect
                                                    width={placement.width}
                                                    height={placement.height}
                                                    rx="6"
                                                />
                                                <text
                                                    className="geo-point-label-name"
                                                    x="8"
                                                    y={placement.measure ? 13 : 15}
                                                >
                                                    {placement.label}
                                                </text>
                                                {placement.measure && (
                                                    <text
                                                        className="geo-point-label-measure"
                                                        x="8"
                                                        y="26"
                                                    >
                                                        {placement.measure}
                                                    </text>
                                                )}
                                            </g>
                                        )}
                                    </g>
                                );
                            }
                            const projectedFeature = collection.features[index];
                            const path = projectedFeature ? map.path(projectedFeature) : undefined;
                            if (!path) return null;
                            const line =
                                feature.geometry.type === 'LineString' ||
                                feature.geometry.type === 'MultiLineString';
                            return (
                                <path
                                    key={`${feature.rowIndex}-${index}`}
                                    className={`geo-feature${line ? ' is-line' : ' is-area'}${selectedIndex === index ? ' is-selected' : ''}`}
                                    d={path}
                                    style={style}
                                    onPointerEnter={() => setHoveredIndex(index)}
                                    onPointerLeave={() =>
                                        setHoveredIndex(current =>
                                            current === index ? undefined : current,
                                        )
                                    }
                                    onClick={event => {
                                        event.stopPropagation();
                                        setSelectedIndex(index);
                                    }}
                                >
                                    <title>
                                        {feature.label}
                                        {feature.measure === null ? '' : ` · ${feature.measure}`}
                                    </title>
                                </path>
                            );
                        })}
                        {basemap.config.id === 'nyc' && (
                            <MapContext land={map.land} labels={map.labels} />
                        )}
                    </g>
                </svg>
                <div className="geo-map-caption">
                    <span>
                        {formatCount(prepared.totalFeatures)} valid features
                        {prepared.sampled
                            ? ` · ${formatCount(prepared.features.length)} rendered`
                            : ''}
                        {basemap.config.id === 'nyc' && (
                            <>
                                {' '}
                                ·{' '}
                                <a href={basemap.config.source} target="_blank" rel="noreferrer">
                                    {basemap.config.name}
                                </a>
                            </>
                        )}
                    </span>
                    <span>
                        {prepared.invalidRows
                            ? `${formatCount(prepared.invalidRows)} rows outside geographic bounds · `
                            : ''}
                        {completeness === 'truncated'
                            ? 'retained prefix only'
                            : 'complete retained result'}
                    </span>
                </div>
            </div>
            <GeoMapDetails
                columns={columns}
                largeCellToken={largeCellToken}
                measureIndex={measureIndex}
                measures={measures}
                minimum={minimum}
                maximum={maximum}
                selected={selected}
            />
        </>
    );
}

function GeoMapDetails({
    columns,
    largeCellToken,
    measureIndex,
    measures,
    minimum,
    maximum,
    selected,
}: {
    columns: Column[];
    largeCellToken?: string;
    measureIndex: number | undefined;
    measures: number[];
    minimum: number;
    maximum: number;
    selected: GeoFeature | undefined;
}) {
    return (
        <div className="geo-detail-row">
            <div className="geo-legend">
                <span className="geo-gradient" />
                <div>
                    <strong>
                        {measureIndex === undefined ? 'Features' : columns[measureIndex]?.name}
                    </strong>
                    <small>
                        {measureIndex === undefined || !measures.length
                            ? 'Uniform styling'
                            : `${minimum.toLocaleString('en')} → ${maximum.toLocaleString('en')}`}
                    </small>
                </div>
            </div>
            <div className="geo-selection">
                {selected ? (
                    <>
                        <div>
                            <span className="eyebrow">SELECTED FEATURE</span>
                            <strong>{selected.label}</strong>
                        </div>
                        <dl>
                            {columns.slice(0, 6).map((column, index) => (
                                <div key={index}>
                                    <dt>{column.name}</dt>
                                    <dd>{displayValue(selected.row[index], largeCellToken)}</dd>
                                </div>
                            ))}
                        </dl>
                    </>
                ) : (
                    <p>Select a point, line, or region to inspect its retained row.</p>
                )}
            </div>
        </div>
    );
}

function useMapLabelPlacements({
    prepared,
    selectedIndex,
    hoveredIndex,
    map,
    range,
    minimum,
}: {
    prepared: ReturnType<typeof prepareGeoFeatures>;
    selectedIndex: number | undefined;
    hoveredIndex: number | undefined;
    map: {
        projection: GeoProjection;
    };
    range: number;
    minimum: number;
}) {
    return useMemo(() => {
        const placements = new Map<number, PointLabelPlacement>();
        const indexes = prepared.features.flatMap((feature, index) =>
            feature.geometry.type === 'Point' &&
            (prepared.features.length <= 12 || index === selectedIndex || index === hoveredIndex)
                ? [index]
                : [],
        );
        const visibleIndexes = new Set(indexes);
        const prioritized = [selectedIndex, hoveredIndex].filter(
            (index): index is number => index !== undefined,
        );
        const orderedIndexes = [...new Set([...prioritized, ...indexes])].filter(index =>
            visibleIndexes.has(index),
        );
        const occupied: Array<{ x: number; y: number; width: number; height: number }> = [];
        for (const index of orderedIndexes) {
            const feature = prepared.features[index];
            if (!feature || feature.geometry.type !== 'Point') continue;
            const projected = map.projection(feature.geometry.coordinates);
            if (!projected) continue;
            const label =
                feature.label.length > 19 ? `${feature.label.slice(0, 18)}…` : feature.label;
            const measure =
                feature.measure === null
                    ? undefined
                    : new Intl.NumberFormat('en', {
                          notation: 'compact',
                          maximumSignificantDigits: 4,
                      }).format(feature.measure);
            const width = Math.max(
                58,
                Math.min(148, Math.max(label.length * 5.3, (measure?.length ?? 0) * 5.2) + 16),
            );
            const height = measure ? 32 : 23;
            const radius =
                feature.measure === null || range === 0
                    ? 5
                    : 4 + 6 * Math.sqrt(Math.max(0, (feature.measure - minimum) / range));
            const sides =
                projected[0] < WIDTH / 2
                    ? (['right', 'left'] as const)
                    : (['left', 'right'] as const);
            const verticals =
                projected[1] < HEIGHT / 2
                    ? (['below', 'above'] as const)
                    : (['above', 'below'] as const);
            const candidates = sides.flatMap(side =>
                verticals.map(vertical => {
                    const x =
                        side === 'right'
                            ? projected[0] + radius + 7
                            : projected[0] - radius - 7 - width;
                    const y =
                        vertical === 'above'
                            ? projected[1] - radius - 6 - height
                            : projected[1] + radius + 6;
                    const placed = {
                        x: Math.max(7, Math.min(WIDTH - width - 7, x)),
                        y: Math.max(7, Math.min(HEIGHT - height - 7, y)),
                        width,
                        height,
                    };
                    const shiftPenalty = (Math.abs(placed.x - x) + Math.abs(placed.y - y)) * 2;
                    const overlapPenalty = occupied.reduce((total, other) => {
                        const overlapX = Math.max(
                            0,
                            Math.min(placed.x + width, other.x + other.width) -
                                Math.max(placed.x, other.x),
                        );
                        const overlapY = Math.max(
                            0,
                            Math.min(placed.y + height, other.y + other.height) -
                                Math.max(placed.y, other.y),
                        );
                        return total + (overlapX && overlapY ? 140 + overlapX * overlapY : 0);
                    }, 0);
                    return { ...placed, score: shiftPenalty + overlapPenalty };
                }),
            );
            const best = candidates.reduce((choice, candidate) =>
                candidate.score < choice.score ? candidate : choice,
            );
            if (best.score > 180 && index !== selectedIndex && index !== hoveredIndex) continue;
            occupied.push(best);
            placements.set(index, { ...best, label, measure });
        }
        return placements;
    }, [hoveredIndex, map, minimum, prepared.features, range, selectedIndex]);
}

export function GeoView({
    result,
    chart,
    onChart,
    selection,
    recommendation,
    copy,
    toolbarContainer,
    largeCellContext,
}: {
    result: Result;
    chart: ChartConfig;
    onChart: (chart: ChartConfig) => void;
    selection: ReturnType<typeof prepareChartSelection>;
    recommendation: GeoRecommendation;
    copy: Copy['chart'];
    toolbarContainer?: HTMLElement | null;
    largeCellContext?: LargeCellRunContext;
}) {
    const columns = result.columns;
    const config = useMemo(
        () => geographyForColumns(columns, chart.geography) ?? recommendation,
        [columns, chart.geography, recommendation],
    );
    const geometryColumn = config.source.mode === 'geometry' ? config.source.column : undefined;
    const hasLargeGeometry =
        geometryColumn !== undefined &&
        result.rows.some(row => isLargeCellReference(row[geometryColumn], result.largeCellToken));
    const geometryKey = `${result.runId}:${result.queryId}:${geometryColumn ?? ''}:${result.largeCellToken ?? ''}`;
    const [hydratedGeometry, setHydratedGeometry] = useState<
        { key: string; rows: Row[]; failed: boolean } | undefined
    >();
    useEffect(() => {
        if (!hasLargeGeometry || geometryColumn === undefined || !largeCellContext) return;
        const controller = new AbortController();
        let active = true;
        let geometryLoadFailed = false;
        let nextReference = 0;
        const rows: Row[] = result.rows.map(row => [...row]);
        const references = result.rows.flatMap((row, rowIndex) => {
            const value = row[geometryColumn];
            return isLargeCellReference(value, result.largeCellToken)
                ? [{ rowIndex, reference: value }]
                : [];
        });
        const loadGeometry = async () => {
            while (!controller.signal.aborted) {
                const referenceIndex = nextReference++;
                if (referenceIndex >= references.length) return;
                const entry = references[referenceIndex];
                if (!entry) return;
                const { rowIndex, reference } = entry;
                try {
                    const text = await fetchLargeCellText(
                        largeCellUrl(
                            largeCellContext.runId,
                            largeCellContext.queryId,
                            largeCellContext.isCloud,
                            reference.id,
                        ),
                        controller.signal,
                    );
                    const value: Json =
                        reference.valueType === 'text' ? text : (JSON.parse(text) as Json);
                    const row = rows[rowIndex];
                    if (row) row[geometryColumn] = value;
                } catch {
                    if (!controller.signal.aborted) geometryLoadFailed = true;
                }
            }
        };
        void Promise.all(
            Array.from({ length: Math.min(LARGE_CELL_FETCH_CONCURRENCY, references.length) }, () =>
                loadGeometry(),
            ),
        ).then(() => {
            if (active && !controller.signal.aborted) {
                setHydratedGeometry({ key: geometryKey, rows, failed: geometryLoadFailed });
            }
        });
        return () => {
            active = false;
            controller.abort();
        };
    }, [
        geometryColumn,
        geometryKey,
        hasLargeGeometry,
        largeCellContext?.isCloud,
        largeCellContext?.queryId,
        largeCellContext?.runId,
        result.largeCellToken,
        result.rows,
    ]);
    const hydrated = hydratedGeometry?.key === geometryKey ? hydratedGeometry : undefined;
    const geometryPending = hasLargeGeometry && Boolean(largeCellContext) && !hydrated;
    const geometryUnavailable = hasLargeGeometry && (!largeCellContext || hydrated?.failed);
    const rowsForMap = hydrated?.rows ?? result.rows;
    const prepared = useMemo(
        () =>
            prepareGeoFeatures(
                rowsForMap,
                columns,
                config,
                undefined,
                result.largeCellToken,
                result.rows,
            ),
        [config, rowsForMap, result.largeCellToken, result.rows, columns],
    );
    return (
        <ScrollEdgeFrame<HTMLDivElement> className="geo-workspace-frame">
            {ref => (
                <div ref={ref} className="geo-workspace animate-enter">
                    <GeoChartControls
                        result={result}
                        chart={chart}
                        config={config}
                        selection={selection}
                        copy={copy}
                        onChart={onChart}
                        toolbarContainer={toolbarContainer}
                    />
                    {geometryPending ? (
                        <div className="result-loading">
                            <Spinner />
                            <span>Loading large geometry values</span>
                        </div>
                    ) : !prepared.features.length ? (
                        <div className="chart-empty" role="status">
                            {geometryUnavailable
                                ? 'Large geometry values could not be loaded.'
                                : 'No returned rows contain valid longitude/latitude geometry for this selection.'}
                        </div>
                    ) : (
                        <>
                            {geometryUnavailable && (
                                <div className="chart-empty" role="status">
                                    Some large geometry values could not be loaded.
                                </div>
                            )}
                            <MapCanvas
                                prepared={prepared}
                                columns={columns}
                                largeCellToken={result.largeCellToken}
                                measureIndex={config.measure}
                                completeness={result.completeness}
                            />
                        </>
                    )}
                </div>
            )}
        </ScrollEdgeFrame>
    );
}
