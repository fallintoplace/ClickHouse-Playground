import type { SchemaColumn } from '../../../shared/database/schema/types.js';
import { ImportMappingError, mapImportRows } from '../../../shared/database/imports/mapping.js';

function insertRowType(type: string) {
    let baseType = type.trim();
    let nullable = false;
    while (true) {
        const wrapper = baseType.match(/^(Nullable|LowCardinality)\((.*)\)$/);
        if (!wrapper) return { baseType, nullable };
        nullable ||= wrapper[1] === 'Nullable';
        baseType = wrapper[2]!.trim();
    }
}

export function isOptionalInsertRowColumn(column: Pick<SchemaColumn, 'type' | 'defaultKind'>) {
    return Boolean(column.defaultKind) || insertRowType(column.type).nullable;
}

function isCalendarDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isDateTime(value: string) {
    const parts = value.match(
        /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):?(\d{2}))?$/,
    );
    if (!parts) return false;
    return (
        isCalendarDate(parts[1]!) &&
        Number(parts[2]) < 24 &&
        Number(parts[3]) < 60 &&
        Number(parts[4]) < 60 &&
        Number(parts[5] ?? 0) < 24 &&
        Number(parts[6] ?? 0) < 60
    );
}

function fieldError(column: SchemaColumn, value: string): string | undefined {
    const text = value.trim();
    const { baseType } = insertRowType(column.type);
    const dateType = /^Date(?:32)?$/.test(baseType);
    const dateTimeType = /^DateTime(?:64)?(?:\(.*\))?$/.test(baseType);
    if (!text && (dateType || dateTimeType || /^(?:UInt|Int)\d+$/.test(baseType)))
        return 'Enter a value.';
    try {
        mapImportRows([{ [column.name]: value }], [column.name], { [column.name]: column.name }, [
            column,
        ]);
    } catch (caught) {
        if (!(caught instanceof ImportMappingError) || caught.code !== 'IMPORT_VALUE_TYPE')
            throw caught;
        if (!/^[+-]?\d+$/.test(text)) return 'Enter a number.';
        if (baseType.startsWith('UInt') && text.startsWith('-'))
            return 'Enter zero or a positive whole number.';
        return `Value is outside the ${baseType} range.`;
    }
    if (dateType && !isCalendarDate(text)) return 'Enter a valid date in YYYY-MM-DD format.';
    if (dateTimeType && !isDateTime(text))
        return 'Enter a valid date and time in YYYY-MM-DD HH:mm:ss format.';
    return undefined;
}

export function insertRowValidationErrors(
    columns: readonly SchemaColumn[],
    included: Record<string, boolean>,
    values: Record<string, string>,
) {
    const errors = new Map<string, string>();
    for (const column of columns) {
        if (isOptionalInsertRowColumn(column) && included[column.name] !== true) continue;
        const value = Object.hasOwn(values, column.name) ? (values[column.name] ?? '') : '';
        const error = fieldError(column, value);
        if (error) errors.set(column.name, error);
    }
    return errors;
}

export function insertRowValuePlaceholder(column: Pick<SchemaColumn, 'type'>) {
    const { baseType } = insertRowType(column.type);
    if (/^Date(?:32)?$/.test(baseType)) return 'YYYY-MM-DD';
    if (/^DateTime(?:64)?(?:\(|$)/.test(baseType)) return 'YYYY-MM-DD HH:mm:ss';
    return 'Value';
}
