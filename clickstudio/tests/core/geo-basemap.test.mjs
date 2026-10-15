import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { geoArea, geoContains } from 'd3';
import {
    basemapFeatures,
    basemapForFeatures,
} from '../../.core-build/src/frontend/queries/results/maps/geo-basemap.js';
import { GEO_HELP_PREVIEW_ROWS } from '../../.core-build/src/shared/samples/geography.js';

const file = name =>
    JSON.parse(readFileSync(new URL(`../../public/geo/${name}`, import.meta.url), 'utf8'));
const point = coordinates => ({ geometry: { type: 'Point', coordinates } });

test('NYC pickup cells receive city context while global, empty, and mixed results stay on the world map', () => {
    const cells = GEO_HELP_PREVIEW_ROWS['nyc-taxi-after-dark'].rows.map(row => ({
        geometry: { type: 'Polygon', coordinates: row[1] },
    }));
    assert.equal(basemapForFeatures(cells).id, 'nyc');
    assert.equal(basemapForFeatures([]).id, 'world');
    assert.equal(basemapForFeatures([point([-73.98, 40.75]), point([13, 52])]).id, 'world');
    assert.equal(basemapForFeatures([point([40.75, -73.98])]).id, 'world');
    assert.equal(basemapForFeatures([point([-122, 37])]).id, 'world');
});

for (const geometry of [
    {
        type: 'LineString',
        coordinates: [
            [-73.99, 40.75],
            [-73.98, 40.76],
        ],
    },
    {
        type: 'MultiLineString',
        coordinates: [
            [
                [-73.99, 40.75],
                [-73.98, 40.76],
            ],
        ],
    },
    {
        type: 'MultiPolygon',
        coordinates: [
            [
                [
                    [-73.99, 40.75],
                    [-73.98, 40.75],
                    [-73.98, 40.76],
                    [-73.99, 40.75],
                ],
            ],
        ],
    },
])
    test(`${geometry.type} context examines all returned positions`, () => {
        assert.equal(basemapForFeatures([{ geometry }]).id, 'nyc');
        assert.equal(basemapForFeatures([{ geometry }, point([0, 0])]).id, 'world');
    });

test('Official borough geometry distinguishes Manhattan from the Hudson and East River', () => {
    const source = file('nyc-boroughs.geojson');
    const original = JSON.stringify(source);
    const boroughs = basemapFeatures(source);
    assert.deepEqual(boroughs.map(borough => borough.properties.name).sort(), [
        'Bronx',
        'Brooklyn',
        'Manhattan',
        'Queens',
        'Staten Island',
    ]);
    const manhattan = boroughs.find(borough => borough.properties.name === 'Manhattan');
    assert.equal(geoContains(manhattan, [-73.973, 40.782]), true);
    assert.equal(geoContains(manhattan, [-73.994, 40.787]), false);
    assert.equal(geoContains(manhattan, [-73.9477, 40.768]), false);
    const context = basemapForFeatures([point([-73.98, 40.75])]);
    for (const label of context.labels) {
        const containing = boroughs.filter(borough => geoContains(borough, label.position));
        assert.deepEqual(
            containing.map(borough => borough.properties.name),
            label.water ? [] : [label.name],
        );
    }
    for (const borough of boroughs) {
        assert.ok(geoArea(borough) < 0.001, borough.properties.name);
        for (const polygon of borough.geometry.coordinates)
            for (const ring of polygon) assert.deepEqual(ring[0], ring.at(-1));
    }
    assert.equal(JSON.stringify(source), original);
});

test('World context preserves country regions after winding normalization', () => {
    const source = file('countries-50m.geojson');
    const countries = basemapFeatures(source);
    assert.equal(countries.length, source.features.length);
    const france = countries.find(country => country.properties.name === 'France');
    assert.equal(geoContains(france, [2.35, 48.86]), true);
    assert.equal(geoContains(france, [-73.98, 40.75]), false);
});

test('Invalid basemap responses and malformed features cannot become drawn context', () => {
    const valid = file('nyc-boroughs.geojson').features[0];
    for (const value of [
        null,
        [],
        {},
        { type: 'FeatureCollection' },
        { type: 'FeatureCollection', features: 'bad' },
    ])
        assert.deepEqual(basemapFeatures(value), []);
    const features = [
        null,
        {},
        { ...valid, geometry: { type: 'Point', coordinates: [-73.98, 40.75] } },
        { ...valid, properties: { name: 42 } },
        { ...valid, geometry: { type: 'Polygon', coordinates: [[[NaN, 40.75]]] } },
        { ...valid, geometry: { type: 'MultiPolygon', coordinates: [] } },
        {
            ...valid,
            geometry: {
                type: 'Polygon',
                coordinates: [
                    [
                        [0, 100],
                        [1, 100],
                        [1, 101],
                        [0, 100],
                    ],
                ],
            },
        },
        valid,
    ];
    assert.equal(basemapFeatures({ type: 'FeatureCollection', features }).length, 1);
});
