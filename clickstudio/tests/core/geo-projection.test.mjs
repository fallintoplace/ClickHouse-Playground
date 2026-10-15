import assert from 'node:assert/strict';
import test from 'node:test';
import { geoArea, geoBounds, geoCentroid, geoContains, geoMercator, geoPath } from 'd3';
import { geometryForProjection } from '../../.core-build/src/frontend/queries/results/maps/geo-projection.js';
import { GEO_HELP_PREVIEW_ROWS } from '../../.core-build/src/shared/samples/geography.js';

const outer = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
];
const hole = [
    [2, 2],
    [8, 2],
    [8, 8],
    [2, 8],
    [2, 2],
];
const reverse = ring => [...ring].reverse();

test('NYC pickup cells project their own neighborhoods instead of the rest of the world', () => {
    const sample = GEO_HELP_PREVIEW_ROWS['nyc-taxi-after-dark'];
    const geometry = sample.rows.map(row => ({ type: 'Polygon', coordinates: row[1] }));
    const fixed = geometry.map(geometryForProjection);
    const collection = { type: 'GeometryCollection', geometries: fixed };
    const path = geoPath(
        geoMercator().fitExtent(
            [
                [34, 28],
                [926, 442],
            ],
            collection,
        ),
    );
    const boxes = [];
    for (let index = 0; index < fixed.length; index++) {
        assert.ok(geoContains(fixed[index], geoCentroid(fixed[index])), sample.rows[index][0]);
        assert.equal(geoContains(fixed[index], [0, -70]), false);
        assert.ok(geoArea(fixed[index]) < 2 * Math.PI);
        const bounds = path.bounds(fixed[index]);
        assert.ok(bounds[1][0] - bounds[0][0] < 480);
        assert.ok(bounds[1][1] - bounds[0][1] < 235);
        boxes.push(JSON.stringify(bounds));
    }
    assert.equal(new Set(boxes).size, 96);
});

for (const exterior of [outer, reverse(outer)])
    for (const interior of [hole, reverse(hole)])
        test(`Polygon preserves its region and hole with ring areas ${geoArea({ type: 'Polygon', coordinates: [exterior] }).toFixed(2)}/${geoArea({ type: 'Polygon', coordinates: [interior] }).toFixed(2)}`, () => {
            const source = { type: 'Polygon', coordinates: [exterior, interior] };
            const snapshot = structuredClone(source);
            const fixed = geometryForProjection(source);
            assert.equal(geoContains(fixed, [1, 1]), true);
            assert.equal(geoContains(fixed, [5, 5]), false);
            assert.equal(geoContains(fixed, [30, 30]), false);
            assert.deepEqual(source, snapshot);
        });

test('Open rings close for projection without changing retained coordinates', () => {
    const source = { type: 'Polygon', coordinates: [outer.slice(0, -1), hole.slice(0, -1)] };
    const snapshot = structuredClone(source);
    const fixed = geometryForProjection(source);
    for (const ring of fixed.coordinates) {
        assert.deepEqual(ring[0], ring.at(-1));
        assert.equal(ring.length, 5);
    }
    assert.equal(geoContains(fixed, [1, 1]), true);
    assert.equal(geoContains(fixed, [5, 5]), false);
    assert.deepEqual(source, snapshot);
});

test('An unclosed triangle keeps all three vertices when D3 streams its boundary', () => {
    const source = {
        type: 'Polygon',
        coordinates: [
            [
                [0, 0],
                [5, 0],
                [0, 5],
            ],
        ],
    };
    const fixed = geometryForProjection(source);
    assert.equal(fixed.coordinates[0].length, 4);
    assert.equal(geoContains(fixed, [1, 1]), true);
    assert.equal(geoContains(fixed, [4, 4]), false);
    assert.equal(source.coordinates[0].length, 3);
});

test('MultiPolygon orients every exterior and hole independently', () => {
    const other = [
        [20, 20],
        [25, 20],
        [25, 25],
        [20, 25],
        [20, 20],
    ];
    const source = {
        type: 'MultiPolygon',
        coordinates: [[outer, reverse(hole)], [reverse(other)]],
    };
    const snapshot = structuredClone(source);
    const fixed = geometryForProjection(source);
    for (const point of [
        [1, 1],
        [22, 22],
    ])
        assert.equal(geoContains(fixed, point), true);
    for (const point of [
        [5, 5],
        [15, 15],
        [30, 30],
    ])
        assert.equal(geoContains(fixed, point), false);
    assert.deepEqual(source, snapshot);
});

test('Antimeridian polygons keep the small region across the dateline', () => {
    const ring = [
        [170, -10],
        [-170, -10],
        [-170, 10],
        [170, 10],
        [170, -10],
    ];
    for (const coordinates of [ring, reverse(ring)]) {
        const fixed = geometryForProjection({ type: 'Polygon', coordinates: [coordinates] });
        assert.equal(geoContains(fixed, [179, 0]), true);
        assert.equal(geoContains(fixed, [-179, 0]), true);
        assert.equal(geoContains(fixed, [0, 0]), false);
        const bounds = geoBounds(fixed);
        assert.ok(bounds[0][0] > bounds[1][0]);
        assert.ok(bounds[0][1] > -20 && bounds[1][1] < 20);
    }
});

test('Polar rings keep the polar cap instead of the opposite hemisphere', () => {
    const ring = [
        [-135, 80],
        [-45, 80],
        [45, 80],
        [135, 80],
        [-135, 80],
    ];
    for (const coordinates of [ring, reverse(ring)]) {
        const fixed = geometryForProjection({ type: 'Polygon', coordinates: [coordinates] });
        assert.equal(geoContains(fixed, [0, 89]), true);
        assert.equal(geoContains(fixed, [0, 0]), false);
        assert.ok(geoArea(fixed) < 0.1);
    }
});

test('Point and line geometry is passed through without changing coordinates', () => {
    for (const geometry of [
        { type: 'Point', coordinates: [13, 52] },
        {
            type: 'LineString',
            coordinates: [
                [13, 52],
                [14, 53],
            ],
        },
        {
            type: 'MultiLineString',
            coordinates: [
                [
                    [13, 52],
                    [14, 53],
                ],
            ],
        },
    ])
        assert.equal(geometryForProjection(geometry), geometry);
    assert.deepEqual(geometryForProjection({ type: 'Polygon', coordinates: [[]] }), {
        type: 'Polygon',
        coordinates: [[]],
    });
});
