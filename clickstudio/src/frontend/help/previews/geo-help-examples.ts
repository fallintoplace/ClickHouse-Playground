import type { SqlExample } from '../examples/sql-examples.js';
import { GEO_HELP_SQL } from '../../../shared/samples/geography.js';
export { GEO_HELP_CITIES } from '../../../shared/samples/geography.js';
export type { GeoHelpCity } from '../../../shared/samples/geography.js';

export const GEO_HELP_EXAMPLE: SqlExample = {
    id: 'clickhouse-geo-cities',
    name: 'Native Point cities',
    description:
        'Compare event volume across 20 global cities using native ClickHouse Point values.',
    dataset: 'ClickHouse Geo',
    category: 'operations',
    sql: GEO_HELP_SQL['clickhouse-geo-cities'],
    chart: {
        kind: 'geography',
        x: 0,
        ys: [2],
        title: 'Global city event volume',
        geography: {
            source: { mode: 'geometry', column: 1 },
            sourceColumnNames: ['location'],
            label: 0,
            measure: 2,
            swapCoordinates: false,
        },
    },
    featuredOrder: 9,
};

export const GEO_HELP_EXAMPLES: SqlExample[] = [
    GEO_HELP_EXAMPLE,
    {
        id: 'clickhouse-geo-flight-routes',
        name: 'Intercontinental flight paths',
        description:
            'Compare passenger volume across eight routes as native ClickHouse LineString values.',
        dataset: 'ClickHouse Geo',
        category: 'operations',
        sql: GEO_HELP_SQL['clickhouse-geo-flight-routes'],
        chart: {
            kind: 'geography',
            x: 0,
            ys: [2],
            title: 'Intercontinental flight paths',
            geography: {
                source: { mode: 'geometry', column: 1 },
                sourceColumnNames: ['path'],
                label: 0,
                measure: 2,
                swapCoordinates: false,
            },
        },
        featuredOrder: 10,
    },
    {
        id: 'clickhouse-geo-delivery-zones',
        name: 'Colorful delivery zones',
        description:
            'Map four delivery regions and compare their order volume with native Polygon values.',
        dataset: 'ClickHouse Geo',
        category: 'operations',
        sql: GEO_HELP_SQL['clickhouse-geo-delivery-zones'],
        chart: {
            kind: 'geography',
            x: 0,
            ys: [2],
            title: 'Delivery orders by region',
            geography: {
                source: { mode: 'geometry', column: 1 },
                sourceColumnNames: ['coverage'],
                label: 0,
                measure: 2,
                swapCoordinates: false,
            },
        },
        featuredOrder: 11,
    },
];
