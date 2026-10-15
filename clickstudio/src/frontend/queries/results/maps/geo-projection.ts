import { geoArea } from 'd3';
import type { GeoGeometry, GeoPosition } from './geo.js';

function orientRing(ring: GeoPosition[], hole: boolean): GeoPosition[] {
    const first = ring[0];
    if (!first) return ring;
    const last = ring[ring.length - 1];
    const closed = last && first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
    const area = geoArea({ type: 'Polygon', coordinates: [closed] });
    return area > 2 * Math.PI !== hole ? [...closed].reverse() : closed;
}

/**
 * Native rings use their smaller spherical region, with opposite winding for holes.
 * D3's clockwise exterior convention is applied only for rendering; SQL rows stay unchanged.
 */
export function geometryForProjection(geometry: GeoGeometry): GeoGeometry {
    if (geometry.type === 'Polygon')
        return {
            ...geometry,
            coordinates: geometry.coordinates.map((ring, index) => orientRing(ring, index > 0)),
        };
    if (geometry.type === 'MultiPolygon')
        return {
            ...geometry,
            coordinates: geometry.coordinates.map(polygon =>
                polygon.map((ring, index) => orientRing(ring, index > 0)),
            ),
        };
    return geometry;
}
