import { useEffect, useRef } from 'react';
import type { WorkspaceState } from '../drafts/workspace-state';
import type { SqlEditorSessions } from './editor-session';

export function useSqlEditorSessions(workspace: WorkspaceState): SqlEditorSessions {
    const sessions = useRef<SqlEditorSessions>(new Map()).current;
    useEffect(() => {
        const ids = new Set(
            [...workspace.tabs, ...(workspace.closedTabs ?? [])].map(draft => draft.id),
        );
        for (const id of sessions.keys()) {
            if (!ids.has(id)) sessions.delete(id);
        }
    }, [sessions, workspace.tabs, workspace.closedTabs]);
    return sessions;
}
