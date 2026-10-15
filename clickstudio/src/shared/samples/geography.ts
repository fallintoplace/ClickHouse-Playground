import type { Result } from '../queries/results/types.js';
import { NYC_AFTER_DARK_PREVIEW, NYC_AFTER_DARK_SQL } from './nyc-after-dark.js';

export type GeoHelpCity = {
    city: string;
    longitude: number;
    latitude: number;
    events: number;
    previewLabel?: 'left' | 'right';
};

export const GEO_HELP_CITIES: GeoHelpCity[] = [
    {
        city: 'San Francisco',
        longitude: -122.4194,
        latitude: 37.7749,
        events: 240,
        previewLabel: 'right',
    },
    { city: 'Vancouver', longitude: -123.1207, latitude: 49.2827, events: 160 },
    { city: 'New York', longitude: -74.006, latitude: 40.7128, events: 420 },
    { city: 'Mexico City', longitude: -99.1332, latitude: 19.4326, events: 290 },
    {
        city: 'São Paulo',
        longitude: -46.6333,
        latitude: -23.5505,
        events: 180,
        previewLabel: 'right',
    },
    { city: 'Buenos Aires', longitude: -58.3816, latitude: -34.6037, events: 230 },
    { city: 'Santiago', longitude: -70.6693, latitude: -33.4489, events: 135 },
    { city: 'Reykjavík', longitude: -21.9426, latitude: 64.1466, events: 92 },
    { city: 'London', longitude: -0.1276, latitude: 51.5072, events: 350 },
    { city: 'Berlin', longitude: 13.405, latitude: 52.52, events: 330, previewLabel: 'right' },
    { city: 'Rome', longitude: 12.4964, latitude: 41.9028, events: 220 },
    { city: 'Istanbul', longitude: 28.9784, latitude: 41.0082, events: 190 },
    { city: 'Cape Town', longitude: 18.4241, latitude: -33.9249, events: 155 },
    { city: 'Nairobi', longitude: 36.8219, latitude: -1.2921, events: 205 },
    { city: 'Dubai', longitude: 55.2708, latitude: 25.2048, events: 315 },
    { city: 'Mumbai', longitude: 72.8777, latitude: 19.076, events: 285 },
    { city: 'Bangkok', longitude: 100.5018, latitude: 13.7563, events: 175 },
    { city: 'Singapore', longitude: 103.8198, latitude: 1.3521, events: 360, previewLabel: 'left' },
    { city: 'Tokyo', longitude: 139.6917, latitude: 35.6895, events: 440 },
    { city: 'Sydney', longitude: 151.2093, latitude: -33.8688, events: 250 },
];

const quoteSqlString = (value: string) => `'${value.replace(/'/g, "''")}'`;

const citySql = GEO_HELP_CITIES.map(({ city, longitude, latitude, events }, index) => {
    const select = index === 0 ? 'SELECT' : 'UNION ALL SELECT';
    const cityAlias = index === 0 ? ' AS city' : '';
    const locationAlias = index === 0 ? ' AS location' : '';
    const eventsAlias = index === 0 ? ' AS events' : '';
    return `${select} ${quoteSqlString(city)}${cityAlias}, (${longitude}, ${latitude})::Point${locationAlias}, ${events}${eventsAlias}`;
}).join('\n');

const flightRoutes = [
    {
        route: 'San Francisco → Tokyo',
        from: [-122.4194, 37.7749],
        to: [139.6917, 35.6895],
        passengers: 8400,
    },
    {
        route: 'New York → London',
        from: [-74.006, 40.7128],
        to: [-0.1276, 51.5072],
        passengers: 7200,
    },
    {
        route: 'London → Singapore',
        from: [-0.1276, 51.5072],
        to: [103.8198, 1.3521],
        passengers: 6100,
    },
    {
        route: 'Cape Town → Dubai',
        from: [18.4241, -33.9249],
        to: [55.2708, 25.2048],
        passengers: 3900,
    },
    {
        route: 'São Paulo → New York',
        from: [-46.6333, -23.5505],
        to: [-74.006, 40.7128],
        passengers: 4600,
    },
    {
        route: 'Dubai → Nairobi',
        from: [55.2708, 25.2048],
        to: [36.8219, -1.2921],
        passengers: 2800,
    },
    {
        route: 'Singapore → Sydney',
        from: [103.8198, 1.3521],
        to: [151.2093, -33.8688],
        passengers: 5200,
    },
    {
        route: 'Vancouver → Mexico City',
        from: [-123.1207, 49.2827],
        to: [-99.1332, 19.4326],
        passengers: 3100,
    },
] as const;

const flightRouteSql = flightRoutes
    .map(({ route, from, to, passengers }, index) => {
        const select = index === 0 ? 'SELECT' : 'UNION ALL SELECT';
        const routeAlias = index === 0 ? ' AS route' : '';
        const pathAlias = index === 0 ? ' AS path' : '';
        const passengerAlias = index === 0 ? ' AS passengers' : '';
        return `${select} ${quoteSqlString(route)}${routeAlias}, [(${from[0]}, ${from[1]}), (${to[0]}, ${to[1]})]::LineString${pathAlias}, ${passengers}${passengerAlias}`;
    })
    .join('\n');

export const GEO_HELP_PREVIEW_ROWS: Record<string, Pick<Result, 'columns' | 'rows'>> = {
    'clickhouse-geo-cities': {
        columns: [
            { name: 'city', type: 'String' },
            { name: 'location', type: 'Point' },
            { name: 'events', type: 'UInt16' },
        ],
        rows: GEO_HELP_CITIES.map(city => [
            city.city,
            [city.longitude, city.latitude],
            city.events,
        ]),
    },
    'clickhouse-geo-flight-routes': {
        columns: [
            { name: 'route', type: 'String' },
            { name: 'path', type: 'LineString' },
            { name: 'passengers', type: 'UInt16' },
        ],
        rows: flightRoutes.map(route => [
            route.route,
            [[...route.from], [...route.to]],
            route.passengers,
        ]),
    },
    'nyc-taxi-after-dark': NYC_AFTER_DARK_PREVIEW,
};

export const GEO_HELP_SQL = {
    'clickhouse-geo-cities': citySql,
    'clickhouse-geo-flight-routes': flightRouteSql,
    'nyc-taxi-after-dark': NYC_AFTER_DARK_SQL,
};

const normalizedSql = (sql: string) =>
    sql.trim().replace(/;$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
const sampleIdBySql = new Map(
    Object.entries(GEO_HELP_SQL).map(([id, sql]) => [normalizedSql(sql), id]),
);

/** Match known sample SQL only; arbitrary queries continue through the fixture fallback. */
export function geoSampleResult(sql: string): Pick<Result, 'columns' | 'rows'> | undefined {
    const id = sampleIdBySql.get(normalizedSql(sql));
    return id ? GEO_HELP_PREVIEW_ROWS[id] : undefined;
}
