import type { Inspector } from '../../workspace-types';

export function inspectorLabel(value: Inspector): string {
    return {
        schema: 'Schema explorer',
        reference: 'Reference',
        documents: 'Saved queries',
        revisions: 'Version history',
        details: 'Run details',
        profile: 'Query profile',
        pipeline: 'Pipeline',
        parser: 'ClickHouse parser',
        assistant: 'AI copilot',
    }[value];
}
