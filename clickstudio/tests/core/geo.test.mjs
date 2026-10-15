import assert from 'node:assert/strict';
import test from 'node:test';
import {
    nativeGeoType,
    recommendValidGeo,
    geographyForColumns,
    normalizeGeoGeometry,
    prepareGeoFeatures,
    recommendGeo,
} from '../../.core-build/src/frontend/queries/results/maps/geo.js';

test('Geo recommends native ClickHouse geometry before numeric coordinates', () => {
    const columns = [
        { name: 'name', type: 'String' },
        { name: 'location', type: 'Point' },
        { name: 'longitude', type: 'Float64' },
        { name: 'latitude', type: 'Float64' },
        { name: 'visits', type: 'UInt64' },
    ];
    assert.deepEqual(recommendGeo(columns), {
        source: { mode: 'geometry', column: 1 },
        label: 0,
        measure: 4,
        swapCoordinates: false,
        reason: 'Native ClickHouse Point column',
    });
});

test('Geo pairs latitude and longitude columns with the same prefix', () => {
    const recommendation = recommendGeo([
        { name: 'dropoff_longitude', type: 'Float64' },
        { name: 'pickup_latitude', type: 'Float64' },
        { name: 'pickup_longitude', type: 'Float64' },
        { name: 'dropoff_latitude', type: 'Float64' },
        { name: 'trips', type: 'UInt64' },
    ]);
    assert.deepEqual(recommendation?.source, { mode: 'coordinates', longitude: 0, latitude: 3 });
    assert.equal(recommendation?.measure, 4);
});

test('Geo unwraps nullable native types and swaps H3 boundary coordinates', () => {
    assert.equal(nativeGeoType('Nullable(Point)'), 'Point');
    assert.deepEqual(
        normalizeGeoGeometry(
            [
                [51.5, -0.2],
                [51.6, -0.1],
                [51.5, -0.2],
            ],
            'Ring',
            true,
        ),
        {
            type: 'Polygon',
            coordinates: [
                [
                    [-0.2, 51.5],
                    [-0.1, 51.6],
                    [-0.2, 51.5],
                ],
            ],
        },
    );
});

test('Geo prepares only valid geographic rows and preserves retained evidence', () => {
    const columns = [
        { name: 'name', type: 'String' },
        { name: 'location', type: 'Point' },
        { name: 'trips', type: 'UInt64' },
    ];
    const recommendation = recommendGeo(columns);
    assert.ok(recommendation);
    const prepared = prepareGeoFeatures(
        [
            ['Berlin', [13.405, 52.52], 10],
            ['Outside bounds', [181, 52], 20],
        ],
        columns,
        recommendation,
    );
    assert.equal(prepared.totalFeatures, 1);
    assert.equal(prepared.invalidRows, 1);
    assert.equal(prepared.features[0]?.label, 'Berlin');
    assert.equal(prepared.features[0]?.measure, 10);
    assert.deepEqual(prepared.features[0]?.row, ['Berlin', [13.405, 52.52], 10]);
});

test('Mixed Geometry infers points, lines, and closed rings from retained JSON', () => {
    assert.deepEqual(normalizeGeoGeometry([13.4, 52.5], 'Geometry'), {
        type: 'Point',
        coordinates: [13.4, 52.5],
    });
    assert.equal(
        normalizeGeoGeometry(
            [
                [13.4, 52.5],
                [13.5, 52.6],
            ],
            'Geometry',
        )?.type,
        'LineString',
    );
    assert.equal(
        normalizeGeoGeometry(
            [
                [13.4, 52.5],
                [13.5, 52.6],
                [13.4, 52.5],
            ],
            'Geometry',
        )?.type,
        'Polygon',
    );
});

test('Geo prepares retained ClickHouse text geometry without requiring rerun decoding', () => {
    const columns = [
        { name: 'city', type: 'String' },
        { name: 'location', type: 'Point' },
        { name: 'events', type: 'UInt64' },
    ];
    const recommendation = recommendGeo(columns);
    assert.ok(recommendation);
    const prepared = prepareGeoFeatures(
        [
            ['Berlin', '(13.405,52.52)', 120],
            ['Paris', '(2.3522,48.8566)', 95],
            ['London', '(-0.1276,51.5072)', 140],
            ['Madrid', '(-3.7038,40.4168)', 80],
        ],
        columns,
        recommendation,
    );
    assert.equal(prepared.totalFeatures, 4);
    assert.equal(prepared.invalidRows, 0);
    assert.deepEqual(prepared.features[0]?.geometry, {
        type: 'Point',
        coordinates: [13.405, 52.52],
    });
    assert.equal(prepared.features[0]?.label, 'Berlin');
});

const nativeExamples = [
    ['Point', [13, 52]],
    ['Nullable(Point)', '(13,52)'],
    [
        'Ring',
        [
            [13, 52],
            [14, 53],
            [13, 52],
        ],
    ],
    [
        'LineString',
        [
            [13, 52],
            [14, 53],
        ],
    ],
    [
        'MultiLineString',
        [
            [
                [13, 52],
                [14, 53],
            ],
        ],
    ],
    [
        'Polygon',
        [
            [
                [13, 52],
                [14, 53],
                [13, 52],
            ],
        ],
    ],
    [
        'MultiPolygon',
        [
            [
                [
                    [13, 52],
                    [14, 53],
                    [13, 52],
                ],
            ],
        ],
    ],
    ['Geometry', [13, 52]],
];
for (const [type, value] of nativeExamples) {
    test(`Geography is available for valid ${type} values without a numeric measure`, () => {
        const columns = [{ name: 'location', type }];
        const recommendation = recommendValidGeo(columns, [[value]]);
        assert.ok(recommendation);
        assert.equal(prepareGeoFeatures([[value]], columns, recommendation).features.length, 1);
    });
}

test('Geography needs a valid retained row, not just a recognized column type', () => {
    const columns = [{ name: 'location', type: 'Nullable(Point)' }];
    for (const rows of [
        [],
        [[null]],
        [[[]]],
        [['bad']],
        [[[181, 52]]],
        [[[13, 91]]],
        [[[NaN, 0]]],
        [[[Infinity, 0]]],
    ])
        assert.equal(recommendValidGeo(columns, rows), undefined);
});

test('Geography accepts coordinate aliases, zeroes, boundary values and numeric strings', () => {
    const columns = [
        { name: 'lng', type: 'Nullable(Float64)' },
        { name: 'lat', type: 'Float64' },
    ];
    for (const row of [
        [0, 0],
        [-180, -90],
        [180, 90],
        ['13.4', '52.5'],
    ]) {
        const recommendation = recommendValidGeo(columns, [row]);
        assert.ok(recommendation);
        assert.equal(prepareGeoFeatures([row], columns, recommendation).features.length, 1);
    }
    for (const row of [
        [null, 0],
        [0, null],
        ['', 0],
        [181, 0],
        [0, -91],
        [Infinity, 0],
        ['NaN', 0],
    ])
        assert.equal(recommendValidGeo(columns, [row]), undefined);
});

test('Geography does not guess from arbitrary numbers, names or a single coordinate', () => {
    for (const columns of [
        [
            { name: 'x', type: 'Float64' },
            { name: 'y', type: 'Float64' },
        ],
        [
            { name: 'longitude', type: 'Float64' },
            { name: 'value', type: 'Float64' },
        ],
        [
            { name: 'city', type: 'String' },
            { name: 'country', type: 'String' },
        ],
        [
            { name: 'longitude', type: 'String' },
            { name: 'latitude', type: 'String' },
        ],
    ])
        assert.equal(recommendValidGeo(columns, [[13, 52]]), undefined);
});

test('Geography checks later native sources and named coordinate pairs', () => {
    const columns = [
        { name: 'broken', type: 'Point' },
        { name: 'valid', type: 'Point' },
        { name: 'pickup_longitude', type: 'Float64' },
        { name: 'pickup_latitude', type: 'Float64' },
        { name: 'dropoff_longitude', type: 'Float64' },
        { name: 'dropoff_latitude', type: 'Float64' },
    ];
    assert.deepEqual(recommendValidGeo(columns, [[null, [13, 52], 999, 999, 14, 53]])?.source, {
        mode: 'geometry',
        column: 1,
    });
    assert.deepEqual(recommendValidGeo(columns, [[null, null, 999, 999, 14, 53]])?.source, {
        mode: 'coordinates',
        longitude: 4,
        latitude: 5,
    });
});

test('Geography availability stops at the first valid feature and retains H3 coordinate order', () => {
    const rows = [
        [
            [
                [52, 13],
                [53, 14],
                [52, 13],
            ],
        ],
        [],
    ];
    Object.defineProperty(rows, 1, {
        get() {
            throw new Error('Scanned past the first valid feature');
        },
    });
    const recommendation = recommendValidGeo([{ name: 'h3_boundary', type: 'Ring' }], rows);
    assert.equal(recommendation?.swapCoordinates, true);
});

test('Saved geography mappings are validated against the current columns', () => {
    const columns = [
        { name: 'lon', type: 'Float64' },
        { name: 'lat', type: 'Float64' },
        { name: 'place', type: 'String' },
    ];
    const config = {
        source: { mode: 'coordinates', longitude: 0, latitude: 1 },
        label: 99,
        measure: 0,
        swapCoordinates: false,
    };
    const selected = geographyForColumns(columns, config);
    assert.equal(selected.label, undefined);
    assert.equal(selected.measure, undefined);
    assert.equal(
        geographyForColumns(columns, { ...config, source: { mode: 'geometry', column: 0 } }),
        undefined,
    );
    assert.equal(
        geographyForColumns(columns, {
            ...config,
            source: { mode: 'coordinates', longitude: 0, latitude: 2 },
        }),
        undefined,
    );
    assert.ok(
        recommendValidGeo(columns, [[13, 52, 'Berlin']], {
            ...config,
            source: { mode: 'geometry', column: 99 },
        }),
    );
});

test('Explicit saved coordinate mappings can use aliases without guessing their meaning', () => {
    const columns = [
        { name: 'x', type: 'Float64' },
        { name: 'y', type: 'Float64' },
    ];
    const config = {
        source: { mode: 'coordinates', longitude: 0, latitude: 1 },
        swapCoordinates: false,
        sourceColumnNames: ['x', 'y'],
    };
    assert.deepEqual(recommendValidGeo(columns, [[13, 52]], config)?.source, config.source);
    assert.equal(recommendValidGeo(columns, [[999, 52]], config), undefined);
});

test('One dual-role coordinate column cannot enable an unsaveable Geography chart', () => {
    const columns = [{ name: 'lat_lon', type: 'Float64' }];
    assert.equal(recommendGeo(columns), undefined);
    assert.equal(recommendValidGeo(columns, [[13]]), undefined);
});

test('Saved source names prevent unrelated numeric columns from becoming geography after a schema change', () => {
    const columns = [
        { name: 'longitude', type: 'Float64' },
        { name: 'latitude', type: 'Float64' },
    ];
    const saved = recommendValidGeo(columns, [[13, 52]]);
    assert.ok(saved);
    assert.deepEqual(saved.sourceColumnNames, ['longitude', 'latitude']);
    const unrelated = [
        { name: 'age', type: 'UInt8' },
        { name: 'orders', type: 'UInt64' },
    ];
    assert.equal(geographyForColumns(unrelated, saved), undefined);
    assert.equal(recommendValidGeo(unrelated, [[30, 15]], saved), undefined);
    assert.equal(
        recommendValidGeo(unrelated, [[30, 15]], { ...saved, sourceColumnNames: undefined }),
        undefined,
    );
});
