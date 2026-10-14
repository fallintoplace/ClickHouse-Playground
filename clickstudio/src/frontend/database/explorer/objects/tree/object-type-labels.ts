type ObjectTypePresentation = {
    label: string;
    definition: string;
};

const OBJECT_TYPE_PRESENTATIONS = new Map<string, ObjectTypePresentation>([
    [
        'Dictionary',
        {
            label: 'Dictionary',
            definition:
                'A lookup table backed by a ClickHouse dictionary. You can query it like a regular table.',
        },
    ],
    [
        'SharedMergeTree',
        {
            label: 'Shared MergeTree',
            definition:
                'A MergeTree table that stores data in shared object storage for ClickHouse Cloud.',
        },
    ],
    [
        'MaterializedView',
        {
            label: 'Materialized View',
            definition: 'Stores the results of a saved query in a table.',
        },
    ],
]);

export function objectTypeLabel(type: string): string {
    return OBJECT_TYPE_PRESENTATIONS.get(type)?.label ?? type;
}

export function objectTypeFooterHelp(type: string): string | undefined {
    const presentation = OBJECT_TYPE_PRESENTATIONS.get(type);
    return presentation ? `${type}: ${presentation.definition}` : undefined;
}
