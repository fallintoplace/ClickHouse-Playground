export const WORKSPACE_PANEL_IDS = ['query', 'results'] as const;
export type WorkspacePanelId = (typeof WORKSPACE_PANEL_IDS)[number];
export type WorkspacePanelState = {
    collapsed: boolean;
};
export type WorkspacePanelLayout = {
    version: 1;
    splitRatio: number;
    query: WorkspacePanelState;
    results: WorkspacePanelState;
};

export const WORKSPACE_LAYOUT_STORAGE_KEY = 'clickstudio:workspace-layout:v1';
export const PANEL_SPLIT_MIN = 0.25;
export const PANEL_SPLIT_MAX = 0.75;

const finite = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);
const clamp = (value: number, minimum: number, maximum: number) =>
    Math.min(Math.max(value, minimum), maximum);

export function clampPanelSplitRatio(value: number): number {
    return clamp(value, PANEL_SPLIT_MIN, PANEL_SPLIT_MAX);
}

function panelState(value: unknown): WorkspacePanelState {
    if (!value || typeof value !== 'object') return { collapsed: false };
    const candidate = value as Partial<WorkspacePanelState>;
    return { collapsed: candidate.collapsed === true };
}

export function defaultWorkspacePanelLayout(): WorkspacePanelLayout {
    return {
        version: 1,
        splitRatio: 0.54,
        query: {
            collapsed: false,
        },
        results: {
            collapsed: false,
        },
    };
}

export function recoverWorkspacePanelLayout(raw: string | null): WorkspacePanelLayout {
    if (!raw) return defaultWorkspacePanelLayout();
    try {
        const candidate = JSON.parse(raw) as {
            splitRatio?: unknown;
            query?: unknown;
            results?: unknown;
        };
        return {
            version: 1,
            splitRatio: finite(candidate.splitRatio)
                ? clampPanelSplitRatio(candidate.splitRatio)
                : 0.54,
            query: panelState(candidate.query),
            results: panelState(candidate.results),
        };
    } catch {
        return defaultWorkspacePanelLayout();
    }
}
