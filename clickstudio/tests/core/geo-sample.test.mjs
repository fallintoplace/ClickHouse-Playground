import assert from 'node:assert/strict';
import test from 'node:test';
import { DemoDriver } from '../../.core-build/src/backend/database/clickhouse/sample-client.js';
import {
    GEO_HELP_SQL,
    GEO_HELP_PREVIEW_ROWS,
    geoSampleResult,
} from '../../.core-build/src/shared/samples/geography.js';
import {
    prepareGeoFeatures,
    recommendValidGeo,
} from '../../.core-build/src/frontend/queries/results/maps/geo.js';

test('Geography sample matching accepts whitespace and a trailing terminator without matching arbitrary SQL', () => {
    for (const [id, sql] of Object.entries(GEO_HELP_SQL)) {
        assert.deepEqual(geoSampleResult(sql), GEO_HELP_PREVIEW_ROWS[id]);
        assert.deepEqual(
            geoSampleResult(`\n${sql.replaceAll('\n', '\n\t')}\n;\n`),
            GEO_HELP_PREVIEW_ROWS[id],
        );
        assert.equal(geoSampleResult(`${sql} UNION ALL SELECT 1`), undefined);
    }
    assert.equal(geoSampleResult('SELECT (1, 2)::Point AS location'), undefined);
    assert.equal(geoSampleResult('SELECT 1'), undefined);
});

test('Server fixture queries return drawable points, routes, and zones with their sample measures', async () => {
    const driver = new DemoDriver();
    const signal = new AbortController().signal;
    for (const [id, type, count] of [
        ['clickhouse-geo-cities', 'Point', 20],
        ['clickhouse-geo-flight-routes', 'LineString', 8],
        ['nyc-taxi-after-dark', 'Polygon', 52],
    ]) {
        const result = await driver.execute(
            { sql: GEO_HELP_SQL[id], kind: 'query' },
            signal,
            () => {},
        );
        assert.equal(result.rows.length, count, id);
        assert.equal(result.columns[1].type, type, id);
        const config = recommendValidGeo(result.columns, result.rows);
        assert.ok(config, id);
        const prepared = prepareGeoFeatures(result.rows, result.columns, config);
        assert.equal(prepared.totalFeatures, count, id);
        assert.equal(prepared.invalidRows, 0, id);
        assert.ok(
            prepared.features.every(feature => feature.geometry.type === type),
            id,
        );
        assert.ok(
            prepared.features.every(feature => feature.label && feature.measure > 0),
            id,
        );
        assert.equal(result.truncated, false);
        assert.match(result.warnings.join(' '), /DEMO FIXTURE/);
    }
    const explain = await driver.execute(
        { sql: GEO_HELP_SQL['clickhouse-geo-cities'], kind: 'explain' },
        signal,
        () => {},
    );
    assert.deepEqual(explain.columns, [{ name: 'explain', type: 'String' }]);
});
