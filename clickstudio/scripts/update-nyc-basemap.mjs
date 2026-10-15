import { writeFileSync } from 'node:fs';

const source = 'https://data.cityofnewyork.us/resource/gthc-hcne.geojson';
const response = await fetch(source);
if (!response.ok) throw new Error(`NYC borough download failed: ${response.status}`);
const collection = await response.json();

function distanceSquared(point, start, end) {
    const dx = end[0] - start[0],
        dy = end[1] - start[1];
    const t =
        dx || dy
            ? Math.max(
                  0,
                  Math.min(
                      1,
                      ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) /
                          (dx * dx + dy * dy),
                  ),
              )
            : 0;
    return (point[0] - start[0] - t * dx) ** 2 + (point[1] - start[1] - t * dy) ** 2;
}

function simplify(points) {
    if (points.length <= 4) return points;
    let farthest = 0,
        distance = 0.00015 ** 2;
    for (let index = 1; index < points.length - 1; index++) {
        const candidate = distanceSquared(points[index], points[0], points.at(-1));
        if (candidate > distance) {
            farthest = index;
            distance = candidate;
        }
    }
    if (!farthest) return [points[0], points.at(-1)];
    return [
        ...simplify(points.slice(0, farthest + 1)).slice(0, -1),
        ...simplify(points.slice(farthest)),
    ];
}

function ringForMap(ring) {
    const simplified = simplify(ring);
    // Keep small islands rather than dropping rings below three distinct vertices.
    return (simplified.length >= 4 ? simplified : ring).map(point =>
        point.map(coordinate => Number(coordinate.toFixed(5))),
    );
}

const output = {
    type: 'FeatureCollection',
    features: collection.features.map(feature => ({
        type: 'Feature',
        properties: { name: feature.properties.boroname },
        geometry: {
            type: 'MultiPolygon',
            coordinates: feature.geometry.coordinates.map(polygon => polygon.map(ringForMap)),
        },
    })),
};
if (output.features.length !== 5) throw new Error('Expected all five NYC boroughs');
const json = `${JSON.stringify(output)}\n`;
writeFileSync(new URL('../public/geo/nyc-boroughs.geojson', import.meta.url), json);
console.log(`Updated NYC borough basemap (${json.length} bytes) from ${source}`);
