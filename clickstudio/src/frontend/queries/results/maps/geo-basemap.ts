import { isRecord } from '../../../../shared/common/values.js';
import type { GeoFeature, GeoGeometry, GeoPosition } from './geo.js';
import { geometryForProjection } from './geo-projection.js';

export type BasemapFeature = GeoJSON.Feature<
    Extract<GeoGeometry, { type: 'Polygon' | 'MultiPolygon' }>,
    { name: string }
>;
export type MapLabel = {
    name: string;
    position: GeoPosition;
    rotate?: number;
    water?: boolean;
};
export type GeoBasemap = {
    id: 'world' | 'nyc';
    file: string;
    name: string;
    source: string;
    maxScale: number;
    labels: MapLabel[];
};

export const WORLD_BASEMAP: GeoBasemap = {
    id: 'world',
    file: 'countries-50m.geojson',
    name: 'Natural Earth',
    source: 'https://www.naturalearthdata.com/',
    maxScale: 65_000,
    labels: [],
};
const NYC_BASEMAP: GeoBasemap = {
    id: 'nyc',
    file: 'nyc-boroughs.geojson',
    name: 'NYC boroughs',
    source: 'https://data.cityofnewyork.us/City-Government/Borough-Boundaries/gthc-hcne',
    maxScale: 250_000,
    labels: [
        { name: 'Manhattan', position: [-73.973, 40.782], rotate: -62 },
        { name: 'Brooklyn', position: [-73.955, 40.655] },
        { name: 'Queens', position: [-73.825, 40.745] },
        { name: 'Bronx', position: [-73.866, 40.855] },
        { name: 'Staten Island', position: [-74.15, 40.58] },
        { name: 'Hudson River', position: [-73.994, 40.787], rotate: -62, water: true },
        { name: 'East River', position: [-73.9477, 40.768], rotate: -56, water: true },
    ],
};

function positions(geometry: GeoGeometry): GeoPosition[] {
    switch (geometry.type) {
        case 'Point':
            return [geometry.coordinates];
        case 'LineString':
            return geometry.coordinates;
        case 'MultiLineString':
        case 'Polygon':
            return geometry.coordinates.flat();
        case 'MultiPolygon':
            return geometry.coordinates.flat(2);
    }
}

/** Choose local context from the returned geometry, independently of query or example names. */
export function basemapForFeatures(features: Pick<GeoFeature, 'geometry'>[]): GeoBasemap {
    const points = features.flatMap(feature => positions(feature.geometry));
    return points.length &&
        points.every(
            ([longitude, latitude]) =>
                longitude >= -74.26 && longitude <= -73.7 && latitude >= 40.49 && latitude <= 40.93,
        )
        ? NYC_BASEMAP
        : WORLD_BASEMAP;
}

function isPosition(value: unknown): value is GeoPosition {
    return (
        Array.isArray(value) &&
        value.length === 2 &&
        value.every(Number.isFinite) &&
        value[0] >= -180 &&
        value[0] <= 180 &&
        value[1] >= -90 &&
        value[1] <= 90
    );
}
function isRing(value: unknown): value is GeoPosition[] {
    return Array.isArray(value) && value.length >= 4 && value.every(isPosition);
}
function isPolygon(value: unknown): value is GeoPosition[][] {
    return Array.isArray(value) && value.length > 0 && value.every(isRing);
}
function isMultiPolygon(value: unknown): value is GeoPosition[][][] {
    return Array.isArray(value) && value.length > 0 && value.every(isPolygon);
}

export function basemapFeatures(collection: unknown): BasemapFeature[] {
    if (
        !isRecord(collection) ||
        collection.type !== 'FeatureCollection' ||
        !Array.isArray(collection.features)
    )
        return [];
    return collection.features.flatMap(feature => {
        if (
            !isRecord(feature) ||
            feature.type !== 'Feature' ||
            !isRecord(feature.properties) ||
            typeof feature.properties.name !== 'string' ||
            !isRecord(feature.geometry)
        )
            return [];
        const { type, coordinates } = feature.geometry;
        let geometry: BasemapFeature['geometry'];
        if (type === 'Polygon' && isPolygon(coordinates)) geometry = { type, coordinates };
        else if (type === 'MultiPolygon' && isMultiPolygon(coordinates))
            geometry = { type, coordinates };
        else return [];
        const projected = geometryForProjection(geometry);
        if (projected.type !== 'Polygon' && projected.type !== 'MultiPolygon') return [];
        return [
            { type: 'Feature', properties: { name: feature.properties.name }, geometry: projected },
        ];
    });
}
