import type { Copy } from '../../../../ui/copy';

type ObjectTypeCopy = Copy['common']['objectTypes'];
type ObjectTypeCopyKey = keyof ObjectTypeCopy;

const OBJECT_TYPE_COPY_KEYS = new Map<string, ObjectTypeCopyKey>([
    ['Dictionary', 'dictionary'],
    ['SharedMergeTree', 'sharedMergeTree'],
    ['MaterializedView', 'materializedView'],
]);

export function objectTypeLabel(type: string, objectTypes: ObjectTypeCopy): string {
    const key = OBJECT_TYPE_COPY_KEYS.get(type);
    return key ? objectTypes[key].label : type;
}

export function objectTypeFooterHelp(
    type: string,
    objectTypes: ObjectTypeCopy,
): string | undefined {
    const key = OBJECT_TYPE_COPY_KEYS.get(type);
    if (!key) return undefined;

    const presentation = objectTypes[key];
    return `${presentation.label}: ${presentation.definition}`;
}
