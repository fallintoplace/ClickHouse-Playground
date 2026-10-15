import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PLAYGROUND_STARTER_SQL,
    validatePlaygroundQuery,
} from '../../.workspace-build/src/frontend/database/connections/playground-client.js';
import { sqlExamplesFor } from '../../.workspace-build/src/frontend/help/examples/sql-examples.js';
import { helpCategories } from '../../.workspace-build/src/frontend/help/workspace-help-model.js';
import { isGeographyConfig } from '../../.workspace-build/src/shared/queries/results/geography-settings.js';
import { prepareChartSelection } from '../../.workspace-build/src/frontend/queries/results/charts/controls/chart-selection.js';
import { prepareGeoFeatures } from '../../.workspace-build/src/frontend/queries/results/maps/geo.js';

test('SQL example catalogs match the selected Playground or fixture source', () => {
    const playground = sqlExamplesFor({ id: 'playground', dataSource: 'clickhouse' });
    const fixtures = sqlExamplesFor({ id: 'demo', dataSource: 'fixture' });
    const starter = playground.find(example => example.id === 'github-recent-events');

    assert.equal(starter?.sql, PLAYGROUND_STARTER_SQL);
    assert.ok(
        playground.some(
            example =>
                example.name === 'Daily activity' && example.sql.includes('FROM github.events'),
        ),
    );
    assert.ok(
        fixtures.some(
            example => example.name === 'Top countries' && example.sql.includes('FROM events'),
        ),
    );
    assert.notEqual(fixtures[0]?.sql, starter?.sql);
    assert.equal(new Set(playground.map(example => example.id)).size, playground.length);
    assert.equal(new Set(fixtures.map(example => example.id)).size, fixtures.length);
});

test('Playground examples use ClickHouse-owned datasets with chart-ready result shapes', () => {
    const examples = sqlExamplesFor({ id: 'playground', dataSource: 'clickhouse' });
    const byId = new Map(examples.map(example => [example.id, example]));
    const cases = [
        ['hackernews-daily-pulse', 'Hacker News', 'line', 'FROM hackernews.hackernews'],
        ['nyc-taxi-weekly-rhythm', 'NYC Taxi', 'heatmap', 'FROM nyc_taxi.trips_small'],
        ['nyc-taxi-fare-distance', 'NYC Taxi', 'scatter', 'FROM nyc_taxi.trips_small'],
        ['bluesky-activity-by-hour', 'Bluesky', 'heatmap', 'FROM bluesky.events_per_hour_of_day'],
        ['stock-jnj-history', 'Stock sample', 'line', 'FROM stock.stock'],
    ];

    for (const [id, dataset, kind, table] of cases) {
        const example = byId.get(id);
        assert.ok(example, `missing ${id}`);
        assert.equal(example.dataset, dataset);
        assert.equal(example.chart.kind, kind);
        assert.ok(example.sql.includes(table), `${id} should query ${table}`);
        assert.match(example.sql, /^SELECT\b/);
    }

    assert.deepEqual(byId.get('hackernews-daily-pulse')?.chart.ys, [1, 2]);
    for (const id of ['nyc-taxi-weekly-rhythm', 'bluesky-activity-by-hour']) {
        const chart = byId.get(id)?.chart;
        assert.ok(chart?.kind === 'heatmap');
        assert.notEqual(chart.x, chart.groupBy);
        assert.ok(chart.groupBy !== undefined && !chart.ys.includes(chart.groupBy));
        assert.ok(!chart.ys.includes(chart.x));
    }
    assert.match(byId.get('nyc-taxi-fare-distance')?.sql ?? '', /LIMIT 60\s*$/);
    assert.match(byId.get('stock-jnj-history')?.description ?? '', /historical/i);
});

test('new Playground examples have unique read-only queries and valid chart column indexes', () => {
    const examples = sqlExamplesFor({ id: 'playground', dataSource: 'clickhouse' });
    const byId = new Map(examples.map(example => [example.id, example]));
    const cases = [
        [
            'amazon-customer-review-health',
            'Amazon Reviews',
            'bar',
            'FROM amazon.amazon_reviews',
            5,
            [1, 2, 3],
            0,
        ],
        [
            'otel-service-latency-slo',
            'OpenTelemetry',
            'line',
            'FROM otel_v2.otel_traces',
            4,
            [1, 2, 3],
            0,
        ],
        [
            'ontime-flight-delay-operations',
            'US flights',
            'heatmap',
            'FROM ontime.ontime',
            3,
            [2],
            1,
            0,
        ],
        [
            'stackoverflow-technology-trends',
            'Stack Overflow',
            'line',
            'FROM stackoverflow.posts',
            5,
            [1, 2, 3, 4],
            0,
        ],
        [
            'stackoverflow-popular-tags',
            'Stack Overflow',
            'bar',
            'FROM stackoverflow.posts',
            2,
            [1],
            0,
        ],
        [
            'pypi-package-downloads',
            'PyPI',
            'heatmap',
            'FROM pypi.pypi_downloads_per_month',
            3,
            [2],
            0,
            1,
        ],
        [
            'stackoverflow-qa-volume',
            'Stack Overflow',
            'line',
            'FROM stackoverflow.posts',
            3,
            [1, 2],
            0,
        ],
        [
            'uk-house-prices-by-county',
            'UK property data',
            'bar',
            'FROM uk.uk_price_paid',
            3,
            [1],
            0,
        ],
        ['imdb-ratings-by-year', 'IMDb', 'scatter', 'FROM imdb.movies', 2, [1], 0],
        ['noaa-central-park-weather', 'NOAA weather', 'heatmap', 'FROM noaa.noaa', 3, [2], 0, 1],
        ['forex-eur-usd-monthly', 'Forex', 'line', 'FROM forex.forex', 2, [1], 0],
        [
            'nyc-taxi-fare-quantiles',
            'NYC Taxi',
            'heatmap',
            'FROM nyc_taxi.trips_small',
            4,
            [2],
            1,
            0,
        ],
        ['github-rolling-activity', 'GitHub', 'line', 'FROM github.events', 3, [1, 2], 0],
    ];

    for (const [id, dataset, kind, table, columnCount, measures, x, groupBy] of cases) {
        const example = byId.get(id);
        assert.ok(example, `missing ${id}`);
        assert.equal(example.dataset, dataset);
        assert.equal(example.chart.kind, kind);
        assert.equal(example.chart.x, x);
        assert.deepEqual(example.chart.ys, measures);
        if (groupBy === undefined) assert.equal(example.chart.groupBy, undefined);
        else assert.equal(example.chart.groupBy, groupBy);
        assert.ok(example.sql.includes(table), `${id} should query ${table}`);
        assert.match(example.sql, /^(?:SELECT|WITH)\b/);
        assert.doesNotMatch(
            example.sql,
            /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|OPTIMIZE|KILL)\b/i,
        );
        assert.ok(
            [
                example.chart.x,
                ...example.chart.ys,
                ...(example.chart.groupBy === undefined ? [] : [example.chart.groupBy]),
            ].every(index => Number.isInteger(index) && index >= 0 && index < columnCount),
        );
    }

    assert.equal(new Set(examples.map(example => example.id)).size, examples.length);
    assert.match(byId.get('pypi-package-downloads')?.sql ?? '', /LIMIT 100\s*$/);
    assert.match(byId.get('stackoverflow-qa-volume')?.sql ?? '', /LIMIT 100\s*$/);
    assert.match(byId.get('uk-house-prices-by-county')?.sql ?? '', /LIMIT 12\s*$/);
    assert.match(byId.get('imdb-ratings-by-year')?.sql ?? '', /LIMIT 200\s*$/);
    assert.match(byId.get('noaa-central-park-weather')?.sql ?? '', /LIMIT 240\s*$/);
});

test('Stack Overflow examples match the Playground tag format and stay chart friendly', () => {
    const examples = sqlExamplesFor({ id: 'playground', dataSource: 'clickhouse' });
    const byId = new Map(examples.map(example => [example.id, example]));
    const trends = byId.get('stackoverflow-technology-trends');
    const popularTags = byId.get('stackoverflow-popular-tags');

    assert.ok(trends);
    for (const tag of ['python', 'javascript', 'java', 'rust']) {
        assert.ok(trends.sql.includes(`Tags LIKE '%|${tag}|%'`), `${tag} should match a full tag`);
    }
    assert.doesNotMatch(trends.sql, /Tags LIKE '%<[^>]+>%/);

    assert.ok(popularTags);
    assert.match(popularTags.sql, /ARRAY JOIN splitByChar\('\|', Tags\) AS tag/);
    assert.match(popularTags.sql, /tag != ''/);
    assert.match(popularTags.sql, /LIMIT 15\s*$/);
    assert.equal(popularTags.featuredOrder, 12);
    assert.equal(popularTags.chart.kind, 'bar');
    assert.deepEqual(popularTags.chart.ys, [1]);
});

test('Business, Observability, and Operations retain their bounded workflow charts', () => {
    const examples = sqlExamplesFor({ id: 'playground', dataSource: 'clickhouse' });
    const cases = [
        ['amazon-monthly-review-volume', 'business', 'amazon.amazon_reviews', 'line', 24, 3],
        ['amazon-category-ratings', 'business', 'amazon.amazon_reviews', 'bar', 15, 3],
        ['uk-monthly-property-sales', 'business', 'uk.uk_price_paid', 'line', 36, 3],
        ['uk-town-median-prices', 'business', 'uk.uk_price_paid', 'bar', 15, 3],
        ['otel-service-request-volume', 'observability', 'otel_v2.otel_traces', 'line', 30, 4],
        ['otel-service-latency-ranking', 'observability', 'otel_v2.otel_traces', 'bar', 15, 4],
        ['otel-span-error-trend', 'observability', 'otel_v2.otel_traces', 'line', 30, 2],
        ['otel-service-latency-heatmap', 'observability', 'otel_v2.otel_traces', 'heatmap', 42, 3],
        ['ontime-airline-delay-rates', 'operations', 'ontime.ontime', 'bar', 15, 3],
        ['ontime-airport-delay-minutes', 'operations', 'ontime.ontime', 'bar', 15, 4],
        ['ontime-monthly-disruption-rates', 'operations', 'ontime.ontime', 'line', 24, 3],
        ['ontime-weekly-delay-heatmap', 'operations', 'ontime.ontime', 'heatmap', 42, 3],
    ];

    for (const category of ['business', 'observability', 'operations']) {
        const categoryExamples = examples.filter(example => example.category === category);
        assert.ok(categoryExamples.length >= 5, category);
        assert.ok(categoryExamples.every(example => example.chart.kind !== 'table'));
    }

    for (const [id, category, table, kind, limit, columnCount] of cases) {
        const example = examples.find(candidate => candidate.id === id);
        assert.ok(example, `missing ${id}`);
        assert.equal(example.category, category);
        assert.equal(example.chart.kind, kind);
        assert.ok(example.sql.includes(`FROM ${table}`), id);
        assert.doesNotThrow(() => validatePlaygroundQuery(example.sql), id);
        assert.match(example.sql, new RegExp(`LIMIT ${limit}\\s*$`));
        assert.match(example.sql, /GROUP BY/);
        assert.match(example.sql, /ORDER BY/);
        assert.doesNotMatch(example.sql, /\b(?:now|today)\s*\(/i);
        assert.equal(example.featuredOrder, undefined);
        assert.ok(example.chart.ys.length > 0);
        assert.ok(
            [example.chart.x, ...example.chart.ys, example.chart.groupBy]
                .filter(index => index !== undefined)
                .every(index => Number.isInteger(index) && index >= 0 && index < columnCount),
            id,
        );
        assert.ok(!example.chart.ys.includes(example.chart.x), id);
        if (kind === 'heatmap') {
            assert.equal(example.chart.x, 1);
            assert.equal(example.chart.groupBy, 0);
            assert.deepEqual(example.chart.ys, [2]);
        }
    }

    assert.equal(
        new Set(cases.map(([id]) => examples.find(example => example.id === id).sql)).size,
        12,
    );
});

test('New trend examples exclude partial time buckets and anchor windows to available data', () => {
    const examples = sqlExamplesFor({ id: 'playground', dataSource: 'clickhouse' });
    const cases = [
        ['amazon-monthly-review-volume', 'review_date', 'latest_month', '24 MONTH'],
        ['uk-monthly-property-sales', 'date', 'latest_month', '36 MONTH'],
        ['otel-service-request-volume', 'Timestamp', 'window_end', '60 MINUTE'],
        ['otel-span-error-trend', 'Timestamp', 'window_end', '60 MINUTE'],
        ['otel-service-latency-heatmap', 'Timestamp', 'window_end', '60 MINUTE'],
    ];

    for (const [id, column, anchor, window] of cases) {
        const sql = examples.find(example => example.id === id).sql;
        assert.ok(sql.includes(`max(${column})`), id);
        assert.ok(sql.includes(`${column} >= ${anchor} - INTERVAL ${window}`), id);
        assert.ok(sql.includes(`${column} < ${anchor}`), id);
    }
});

test('Flight delay examples exclude unfinished flights while disruption rates include them', () => {
    const examples = sqlExamplesFor({ id: 'playground', dataSource: 'clickhouse' });
    for (const id of [
        'ontime-airline-delay-rates',
        'ontime-airport-delay-minutes',
        'ontime-weekly-delay-heatmap',
    ]) {
        const sql = examples.find(example => example.id === id).sql;
        assert.match(sql, /SELECT max\(Year\)/);
        assert.match(sql, /HAVING uniqExact\(Month\) = 12/);
        assert.match(sql, /WHERE Year = latest_full_year/);
        assert.match(sql, /AND Cancelled = 0/);
        assert.match(sql, /AND Diverted = 0/);
    }

    const disruptions = examples.find(example => example.id === 'ontime-monthly-disruption-rates');
    assert.match(disruptions.sql, /HAVING uniqExact\(Month\) = 12/);
    assert.match(disruptions.sql, /WHERE Year - 1 IN \(SELECT Year FROM complete_years\)/);
    assert.match(disruptions.sql, /WHERE Year BETWEEN latest_full_year - 1 AND latest_full_year/);
    assert.match(disruptions.sql, /countIf\(Cancelled = 1\) \/ count\(\)/);
    assert.match(disruptions.sql, /countIf\(Diverted = 1\) \/ count\(\)/);
    assert.doesNotMatch(disruptions.sql, /AND (?:Cancelled|Diverted) = 0/);
    const heatmap = examples.find(example => example.id === 'ontime-weekly-delay-heatmap');
    assert.match(heatmap.sql, /CRSDepTime >= 0/);
    assert.match(heatmap.sql, /CRSDepTime < 2400/);
});

test('Retired ClickHouse and Cities categories rehome every example into an available category', () => {
    const playground = sqlExamplesFor({ id: 'playground', dataSource: 'clickhouse' });
    const fixtures = sqlExamplesFor({ id: 'demo', dataSource: 'fixture' });
    const generic = sqlExamplesFor({ id: 'production', dataSource: 'clickhouse' });
    const cases = [
        [playground, 'github-pr-contributors', 'openSource'],
        [playground, 'github-rolling-activity', 'openSource'],
        [playground, 'nyc-taxi-weekly-rhythm', 'operations'],
        [playground, 'nyc-taxi-fare-distance', 'operations'],
        [playground, 'nyc-taxi-fare-quantiles', 'operations'],
        [playground, 'clickhouse-geo-cities', 'operations'],
        [playground, 'clickhouse-geo-flight-routes', 'operations'],
        [playground, 'clickhouse-geo-delivery-zones', 'operations'],
        [fixtures, 'preview-starter-latency-anomaly', 'timeSeries'],
        [fixtures, 'preview-starter-latest-event', 'basics'],
        [fixtures, 'preview-starter-top-pages-country', 'aggregation'],
        [fixtures, 'preview-starter-distinct-estimates', 'aggregation'],
        [fixtures, 'preview-starter-channel-conversion', 'aggregation'],
    ];
    assert.ok(!helpCategories.includes('clickhouse'));
    assert.ok(!helpCategories.includes('cities'));
    for (const [catalog, id, category] of cases) {
        assert.equal(catalog.find(example => example.id === id)?.category, category, id);
    }
    for (const catalog of [playground, fixtures, generic]) {
        assert.ok(catalog.every(example => helpCategories.includes(example.category)));
        assert.equal(new Set(catalog.map(example => example.id)).size, catalog.length);
    }
});

test('Native geometry examples open Geography charts with explicit labels and measures', () => {
    for (const connection of [
        { id: 'playground', dataSource: 'clickhouse' },
        { id: 'production', dataSource: 'clickhouse' },
    ]) {
        const examples = sqlExamplesFor(connection);
        for (const [id, geometryName] of [
            ['clickhouse-geo-cities', 'location'],
            ['clickhouse-geo-flight-routes', 'path'],
            ['clickhouse-geo-delivery-zones', 'coverage'],
        ]) {
            const example = examples.find(candidate => candidate.id === id);
            assert.ok(example, id);
            assert.equal(example.chart.kind, 'geography');
            assert.ok(isGeographyConfig(example.chart.geography), id);
            assert.deepEqual(example.chart.geography.source, { mode: 'geometry', column: 1 });
            assert.deepEqual(example.chart.geography.sourceColumnNames, [geometryName]);
            assert.equal(example.chart.geography.label, 0);
            assert.equal(example.chart.geography.measure, 2);
            assert.equal(example.chart.geography.swapCoordinates, false);
            assert.doesNotThrow(() => validatePlaygroundQuery(example.sql), id);
        }
    }
});

test('GitHub trend examples use complete periods and warm up the rolling average before display', () => {
    const examples = sqlExamplesFor({ id: 'playground', dataSource: 'clickhouse' });
    const contributors = examples.find(example => example.id === 'github-pr-contributors');
    assert.match(contributors.sql, /uniqExact\(actor_login\)/);
    assert.match(contributors.sql, /created_at >= latest_month - INTERVAL 24 MONTH/);
    assert.match(contributors.sql, /created_at < latest_month/);
    assert.match(contributors.sql, /actor_login != ''/);
    assert.match(contributors.sql, /LIMIT 24\s*$/);

    const rolling = examples.find(example => example.id === 'github-rolling-activity');
    assert.match(rolling.sql, /created_at >= latest_day - INTERVAL 66 DAY/);
    assert.match(rolling.sql, /created_at < latest_day/);
    assert.match(rolling.sql, /ORDER BY day WITH FILL/);
    assert.match(rolling.sql, /ROWS BETWEEN 6 PRECEDING AND CURRENT ROW/);
    assert.match(rolling.sql, /FROM smoothed\s+WHERE day >= latest_day - INTERVAL 60 DAY/);
    assert.match(rolling.sql, /LIMIT 60\s*$/);
    for (const example of [contributors, rolling]) {
        assert.doesNotMatch(example.sql, /\b(?:now|today)\s*\(/i);
        assert.doesNotThrow(() => validatePlaygroundQuery(example.sql));
    }
});

test('Taxi heatmaps use 42 four-hour buckets and the scatter excludes extreme values', () => {
    const examples = sqlExamplesFor({ id: 'playground', dataSource: 'clickhouse' });
    for (const id of ['nyc-taxi-weekly-rhythm', 'nyc-taxi-fare-quantiles']) {
        const example = examples.find(candidate => candidate.id === id);
        assert.match(example.sql, /intDiv\(toHour\(pickup_datetime\), 4\) \* 4 AS hour/);
        assert.match(example.sql, /LIMIT 42\s*$/);
        assert.equal(example.chart.x, 1);
        assert.equal(example.chart.groupBy, 0);
        assert.deepEqual(example.chart.ys, [2]);
    }
    const scatter = examples.find(example => example.id === 'nyc-taxi-fare-distance');
    assert.match(scatter.sql, /trip_distance BETWEEN 0.1 AND 30/);
    assert.match(scatter.sql, /fare_amount BETWEEN 1 AND 200/);
    assert.match(scatter.sql, /ORDER BY trip_id\s+LIMIT 60\s*$/);
});

test('Featured Playground examples lead with enterprise workflows', () => {
    const examples = sqlExamplesFor({ id: 'playground', dataSource: 'clickhouse' });
    const featured = examples
        .filter(example => example.featuredOrder !== undefined)
        .sort((left, right) => left.featuredOrder - right.featuredOrder);

    assert.deepEqual(
        featured.slice(0, 4).map(example => example.id),
        [
            'amazon-customer-review-health',
            'otel-service-latency-slo',
            'ontime-flight-delay-operations',
            'stackoverflow-technology-trends',
        ],
    );
    assert.deepEqual(
        featured.slice(0, 4).map(example => example.category),
        ['business', 'observability', 'operations', 'engineering'],
    );
});

test('SQL examples use safe generic queries until a real connection schema is available', () => {
    const connection = { id: 'production', dataSource: 'clickhouse' };
    const generic = sqlExamplesFor(connection);
    assert.deepEqual(
        generic.map(example => example.name),
        [
            'ClickHouse version',
            'Server time',
            'Generate a number series',
            'Native Point cities',
            'Intercontinental flight paths',
            'Colorful delivery zones',
        ],
    );
    assert.ok(generic.every(example => /^SELECT/.test(example.sql)));

    const schema = {
        connectionId: 'production',
        fetchedAt: '2026-09-24T00:00:00.000Z',
        columns: [],
        warnings: [],
        truncated: false,
        tables: [
            { database: 'system', name: 'tables' },
            { database: 'information_schema', name: 'columns' },
            { database: 'analytics`archive', name: 'event`log' },
        ],
    };
    const examples = sqlExamplesFor(connection, schema);
    const preview = examples.find(
        example => example.name === 'Preview analytics`archive.event`log',
    );
    assert.ok(preview);
    assert.match(preview.sql, /FROM `analytics``archive`\.`event``log`\nLIMIT 50$/);
    assert.equal(
        examples.some(
            example =>
                example.name.includes('system.') || example.name.includes('information_schema.'),
        ),
        false,
    );
});

test('Offline examples cover common analytics patterns with bounded chart columns', () => {
    const examples = sqlExamplesFor({ id: 'demo', dataSource: 'fixture' });
    const byId = new Map(examples.map(example => [example.id, example]));
    const cases = [
        ['preview-starter-monthly-revenue', 'FROM orders', 'line', 3],
        ['preview-starter-channel-conversion', 'FROM sessions', 'bar', 4],
        ['preview-starter-signup-cohorts', 'FROM users', 'line', 4],
        ['preview-starter-product-page-conversion', 'FROM events', 'bar', 4],
    ];

    for (const [id, table, kind, columnCount] of cases) {
        const example = byId.get(id);
        assert.ok(example, `missing ${id}`);
        assert.ok(example.sql.includes(table));
        assert.match(example.sql, /^(?:SELECT|WITH)\b/);
        assert.doesNotMatch(
            example.sql,
            /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|OPTIMIZE|KILL)\b/i,
        );
        assert.equal(example.chart.kind, kind);
        assert.ok(
            [
                example.chart.x,
                ...example.chart.ys,
                ...(example.chart.groupBy === undefined ? [] : [example.chart.groupBy]),
            ].every(index => Number.isInteger(index) && index >= 0 && index < columnCount),
        );
    }

    assert.equal(new Set(examples.map(example => example.id)).size, examples.length);
    assert.ok(examples.length > 13);
});

test('Schema examples expose only the first six non-system tables', () => {
    const connection = { id: 'production', dataSource: 'clickhouse' };
    const schema = {
        connectionId: 'production',
        fetchedAt: '',
        columns: [],
        warnings: [],
        truncated: false,
        tables: [
            ...Array.from({ length: 8 }, (_, index) => ({
                database: 'analytics',
                name: `table_${index}`,
            })),
            { database: 'system', name: 'tables' },
        ],
    };
    const tableExamples = sqlExamplesFor(connection, schema).filter(
        example => example.category === 'schema',
    );
    assert.equal(tableExamples.length, 6);
    assert.deepEqual(
        tableExamples.map(example => example.name),
        Array.from({ length: 6 }, (_, index) => `Preview analytics.table_${index}`),
    );
});

function exampleSchema(tables) {
    return {
        connectionId: 'production',
        fetchedAt: '',
        warnings: [],
        truncated: false,
        tables: tables.map(({ columns: _columns, ...table }) => ({
            database: 'analytics',
            engine: 'MergeTree',
            ...table,
        })),
        columns: tables.flatMap(table =>
            (table.columns ?? []).map(column => ({
                database: 'analytics',
                table: table.name,
                comment: '',
                ...column,
            })),
        ),
    };
}

test('Empty Cloud schemas offer generated read queries and separately labeled write examples', () => {
    const schema = exampleSchema([{ database: 'system', name: 'tables' }]);
    const connection = {
        id: 'production',
        dataSource: 'clickhouse',
        database: ' analytics`archive ',
    };
    const examples = sqlExamplesFor(connection, schema);
    const writes = examples.filter(example => example.category === 'writeOperations');
    const generated = examples.filter(example => example.dataset === 'Generated data');
    assert.equal(generated.length, 3);
    assert.ok(generated.every(example => /^(?:SELECT|WITH)\b/.test(example.sql)));
    assert.deepEqual(
        writes.map(example => example.featuredOrder),
        [4, 5],
    );
    assert.match(writes[0].sql, /^CREATE TABLE IF NOT EXISTS `analytics``archive`\./);
    assert.match(writes[1].sql, /^INSERT INTO `analytics``archive`\./);
    assert.ok(
        writes.every(
            example => example.chart.kind === 'table' && /permission/.test(example.description),
        ),
    );
    assert.equal(
        sqlExamplesFor({ ...connection, database: ' ' }, schema).some(
            example => example.category === 'writeOperations',
        ),
        false,
    );
});

test('Schema examples use wrapped column types, exclude identifier dimensions, and retain native geometry', () => {
    const schema = exampleSchema([
        {
            name: 'events',
            rowEstimate: '500',
            columns: [
                { name: 'created_at', type: "Nullable(DateTime64(3, 'UTC'))" },
                { name: 'revenue', type: 'Nullable(Decimal(18, 2))' },
                { name: 'country', type: 'LowCardinality(Nullable(String))' },
                { name: 'user_id', type: 'String' },
                { name: 'location', type: 'Point' },
            ],
        },
    ]);
    const examples = sqlExamplesFor({ id: 'production', dataSource: 'clickhouse' }, schema);
    const time = examples.find(example => example.category === 'timeSeries');
    const category = examples.find(example => example.category === 'aggregation');
    const geo = examples.find(example => example.id.startsWith('cloud-geo-native'));
    assert.match(time.sql, /sum\(`revenue`\) AS metric_value/);
    assert.match(time.sql, /`created_at` IS NOT NULL/);
    assert.match(time.sql, /LIMIT 30/);
    assert.match(category.sql, /`country` AS category/);
    assert.doesNotMatch(category.sql, /user_id/);
    assert.match(geo.sql, /SELECT `location` AS location/);
    assert.match(geo.sql, /LIMIT 100$/);
    assert.equal(geo.category, 'operations');
    assert.equal(geo.chart.kind, 'geography');
    assert.ok(isGeographyConfig(geo.chart.geography));
    assert.deepEqual(geo.chart.geography.source, { mode: 'geometry', column: 0 });
    assert.ok(examples.every(example => helpCategories.includes(example.category)));
    const result = {
        columns: [{ name: 'location', type: 'Point' }],
        rows: [[[13.405, 52.52]]],
    };
    const selection = prepareChartSelection(result, geo.chart);
    assert.ok(selection.geography);
    assert.equal(
        prepareGeoFeatures(result.rows, result.columns, selection.geography).totalFeatures,
        1,
    );
    assert.deepEqual(
        [time, category, geo].map(example => example.featuredOrder),
        [1, 2, 3],
    );

    const identifiersOnly = exampleSchema([
        {
            name: 'users',
            columns: [
                { name: 'user_id', type: 'String' },
                { name: 'session_uuid', type: 'UUID' },
            ],
        },
    ]);
    assert.equal(
        sqlExamplesFor({ id: 'production', dataSource: 'clickhouse' }, identifiersOnly).some(
            example => example.category === 'aggregation',
        ),
        false,
    );
});

test('Large unsampled tables offer only bounded previews until a usable time key is known', () => {
    const table = {
        name: 'events',
        rowEstimate: '1000000',
        columns: [
            { name: 'created_at', type: 'DateTime' },
            { name: 'latency', type: 'Float64' },
            { name: 'country', type: 'String' },
            { name: 'location', type: 'Point' },
        ],
    };
    const connection = { id: 'production', dataSource: 'clickhouse' };
    const unbounded = sqlExamplesFor(connection, exampleSchema([table]));
    assert.equal(
        unbounded.some(example => example.id.startsWith('cloud-')),
        false,
    );
    const bounded = sqlExamplesFor(
        connection,
        exampleSchema([{ ...table, partitionKey: 'toYYYYMM(created_at)' }]),
    );
    const time = bounded.find(example => example.category === 'timeSeries');
    assert.match(time.sql, /avg\(`latency`\) AS metric_value/);
    assert.match(time.sql, /`created_at` >= now\(\) - INTERVAL 30 DAY/);
    assert.doesNotMatch(time.sql, /SAMPLE/);
    assert.equal(
        bounded.some(example => example.category === 'aggregation'),
        false,
    );
});

for (const [measure, expected] of [
    [{ name: 'revenue', type: 'UInt64' }, 'sum(`revenue` * _sample_factor) AS metric_value'],
    [{ name: 'price', type: 'Decimal64(2)' }, 'avg(`price`) AS metric_value'],
    [undefined, 'sum(_sample_factor) AS row_count'],
])
    test(`Sampled examples preserve ${measure?.name ?? 'row count'} aggregation semantics`, () => {
        const schema = exampleSchema([
            {
                name: 'events',
                rowEstimate: '18446744073709551615',
                samplingKey: 'intHash64(id)',
                orderBy: 'tuple(day, id)',
                columns: [
                    { name: 'day', type: 'Nullable(Date32)' },
                    { name: 'country', type: 'String' },
                    ...(measure ? [measure] : []),
                ],
            },
        ]);
        const examples = sqlExamplesFor({ id: 'production', dataSource: 'clickhouse' }, schema);
        const time = examples.find(example => example.category === 'timeSeries');
        const category = examples.find(example => example.category === 'aggregation');
        assert.ok(time.sql.includes(expected));
        assert.match(time.sql, /SAMPLE 100000/);
        assert.match(time.sql, /`day` >= today\(\) - INTERVAL 29 DAY/);
        assert.match(time.description, /sample/);
        assert.match(category.sql, /sum\(_sample_factor\) AS row_count/);
        assert.match(category.sql, /SAMPLE 100000/);
    });

test('Coordinate examples bound geographic values and take dimensions from the same table', () => {
    const schema = exampleSchema([
        {
            name: 'smaller',
            rowEstimate: '9007199254740992',
            samplingKey: 'id',
            columns: [{ name: 'country', type: 'String' }],
        },
        {
            name: 'larger',
            rowEstimate: '9007199254740993',
            samplingKey: 'id',
            columns: [
                { name: 'lat', type: 'Nullable(Float64)' },
                { name: 'lng', type: 'Float64' },
                { name: 'channel', type: 'String' },
                { name: 'country', type: 'String' },
            ],
        },
    ]);
    const examples = sqlExamplesFor({ id: 'production', dataSource: 'clickhouse' }, schema);
    const geo = examples.find(example => example.id.startsWith('cloud-geo-coordinates'));
    assert.match(geo.sql, /FROM `analytics`\.`larger` SAMPLE 100000/);
    assert.match(geo.sql, /`lat` BETWEEN -90 AND 90/);
    assert.match(geo.sql, /`lng` BETWEEN -180 AND 180/);
    assert.match(geo.sql, /LIMIT 500$/);
    assert.equal(geo.category, 'operations');
    assert.equal(geo.chart.kind, 'geography');
    assert.ok(isGeographyConfig(geo.chart.geography));
    assert.deepEqual(geo.chart.geography.source, {
        mode: 'coordinates',
        longitude: 0,
        latitude: 1,
    });
    assert.ok(examples.every(example => helpCategories.includes(example.category)));
    const result = {
        columns: [
            { name: 'longitude', type: 'Float64' },
            { name: 'latitude', type: 'Nullable(Float64)' },
        ],
        rows: [[13.405, 52.52]],
    };
    const selection = prepareChartSelection(result, geo.chart);
    assert.ok(selection.geography);
    assert.equal(
        prepareGeoFeatures(result.rows, result.columns, selection.geography).totalFeatures,
        1,
    );
    assert.deepEqual(
        examples
            .filter(example => example.category === 'aggregation')
            .map(example => example.dataset)
            .sort(),
        ['analytics.larger', 'analytics.smaller'],
    );
});
