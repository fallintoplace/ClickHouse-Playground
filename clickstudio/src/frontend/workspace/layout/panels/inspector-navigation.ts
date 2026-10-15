import type { IconName } from '../../../ui/components/icons.js';
import type { Inspector } from '../../workspace-types.js';

type PrimaryInspector = 'schema' | 'assistant';
type InspectorCopyKey = 'objects' | 'reference' | 'assistant' | 'queries';

export type PrimaryInspectorDestination = Readonly<{
    group: 'primary';
    id: PrimaryInspector;
    icon: IconName;
    copyKey: InspectorCopyKey;
    expertOnly?: boolean;
}>;

export type SecondaryInspectorDestination = Readonly<{
    group: 'more';
    id: Exclude<Inspector, PrimaryInspector>;
    icon: IconName;
    copyKey?: 'reference' | 'queries';
    expertOnly?: boolean;
    requiresRun?: boolean;
    railSection?: 'browse' | 'execution';
}>;

type InspectorNavigationDestination = PrimaryInspectorDestination | SecondaryInspectorDestination;

export const INSPECTOR_NAVIGATION: readonly InspectorNavigationDestination[] = [
    { group: 'primary', id: 'schema', icon: 'schema', copyKey: 'objects' },
    { group: 'primary', id: 'assistant', icon: 'assistant', copyKey: 'assistant' },
    {
        group: 'more',
        id: 'reference',
        icon: 'reference',
        copyKey: 'reference',
        expertOnly: true,
    },
    {
        group: 'more',
        id: 'documents',
        icon: 'documents',
        copyKey: 'queries',
        expertOnly: true,
        railSection: 'browse',
    },
    { group: 'more', id: 'revisions', icon: 'history', expertOnly: true },
    {
        group: 'more',
        id: 'details',
        icon: 'details',
        expertOnly: true,
        requiresRun: true,
        railSection: 'execution',
    },
    { group: 'more', id: 'parser', icon: 'parser', expertOnly: true, railSection: 'execution' },
];

export const PRIMARY_INSPECTOR_NAVIGATION = INSPECTOR_NAVIGATION.filter(
    (item): item is PrimaryInspectorDestination => item.group === 'primary',
);

export function primaryInspectorNavigation(
    expert: boolean,
): readonly PrimaryInspectorDestination[] {
    return PRIMARY_INSPECTOR_NAVIGATION.filter(item => !item.expertOnly || expert);
}

export function inspectorRailNavigation(expert: boolean): readonly PrimaryInspectorDestination[] {
    return primaryInspectorNavigation(expert).filter(item => expert || item.id === 'schema');
}

export function canOpenInspector(inspector: Inspector, expert: boolean): boolean {
    return expert || inspector === 'assistant' || inspector === 'schema';
}

export const EXPERT_BROWSE_NAVIGATION = INSPECTOR_NAVIGATION.filter(
    (item): item is SecondaryInspectorDestination =>
        item.group === 'more' && item.railSection === 'browse',
);

export const EXPERT_EXECUTION_NAVIGATION = INSPECTOR_NAVIGATION.filter(
    (item): item is SecondaryInspectorDestination =>
        item.group === 'more' && item.railSection === 'execution',
);

export function inspectorMoreNavigation(
    expert: boolean,
    hasRun: boolean,
): readonly SecondaryInspectorDestination[] {
    return INSPECTOR_NAVIGATION.filter(
        (item): item is SecondaryInspectorDestination =>
            item.group === 'more' && (!item.expertOnly || expert) && (!item.requiresRun || hasRun),
    );
}
