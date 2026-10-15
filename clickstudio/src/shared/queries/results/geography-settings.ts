import { isRecord } from '../../common/values.js';

export type GeoSource =
    | { mode: 'geometry'; column: number }
    | { mode: 'coordinates'; longitude: number; latitude: number };

export interface GeographyConfig {
    source: GeoSource;
    sourceColumnNames?: string[];
    label?: number;
    measure?: number;
    swapCoordinates: boolean;
}

const columnIndex = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 499;

export function isGeographyConfig(value: unknown): value is GeographyConfig {
    if (
        !isRecord(value) ||
        !isRecord(value.source) ||
        typeof value.swapCoordinates !== 'boolean' ||
        (value.label !== undefined && !columnIndex(value.label)) ||
        (value.measure !== undefined && !columnIndex(value.measure))
    )
        return false;
    const source = value.source;
    if (
        value.sourceColumnNames !== undefined &&
        (!Array.isArray(value.sourceColumnNames) ||
            value.sourceColumnNames.length !== (source.mode === 'geometry' ? 1 : 2) ||
            !value.sourceColumnNames.every(name => typeof name === 'string'))
    )
        return false;
    return source.mode === 'geometry'
        ? columnIndex(source.column)
        : source.mode === 'coordinates' &&
              columnIndex(source.longitude) &&
              columnIndex(source.latitude) &&
              source.longitude !== source.latitude;
}

export function copyGeographyConfig(config: GeographyConfig): GeographyConfig {
    return {
        source:
            config.source.mode === 'geometry'
                ? { mode: 'geometry', column: config.source.column }
                : {
                      mode: 'coordinates',
                      longitude: config.source.longitude,
                      latitude: config.source.latitude,
                  },
        ...(config.label === undefined ? {} : { label: config.label }),
        ...(config.sourceColumnNames === undefined
            ? {}
            : { sourceColumnNames: [...config.sourceColumnNames] }),
        ...(config.measure === undefined ? {} : { measure: config.measure }),
        swapCoordinates: config.swapCoordinates,
    };
}
