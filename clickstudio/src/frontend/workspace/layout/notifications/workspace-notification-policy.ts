import { WORKSPACE_NOTIFICATION_TIMEOUT_MS } from './useWorkspaceNotifications.js';

export function documentFailureNotice(
    name: string,
    operation: 'save' | 'restore',
    error: { status?: number; code?: string },
) {
    if (error.code === 'REVISION_CONFLICT') {
        return {
            message: `“${name}” changed elsewhere. Review the latest version before ${operation === 'save' ? 'saving' : 'restoring'}.`,
            tone: 'warning' as const,
            timeoutMs: WORKSPACE_NOTIFICATION_TIMEOUT_MS,
        };
    }
    if (error.status && error.status >= 400 && error.status < 500 && error.status !== 408) {
        return {
            message: `Couldn’t ${operation} “${name}”. Your edits are still in the draft.`,
            tone: 'error' as const,
            timeoutMs: WORKSPACE_NOTIFICATION_TIMEOUT_MS,
        };
    }
    return {
        message: `Couldn’t confirm the ${operation} of “${name}”. Check its saved version.`,
        tone: 'warning' as const,
        timeoutMs: WORKSPACE_NOTIFICATION_TIMEOUT_MS,
    };
}
