import { useCallback, useRef, useState } from 'react';

export const WORKSPACE_NOTIFICATION_TIMEOUT_MS = 8000 as const;

export type WorkspaceFeedback = Readonly<{
    message: string;
    tone: 'error' | 'warning' | 'info';
    detail?: string;
    retry?: () => void;
}>;

export type ToastOptions = Readonly<{
    tone?: 'error' | 'warning';
    timeoutMs?: typeof WORKSPACE_NOTIFICATION_TIMEOUT_MS;
    context?: string;
    detail?: string;
    action?: { label: string; onSelect: () => void };
}>;

export type WorkspaceToastMessage = Readonly<{
    id: number;
    message: string;
    tone: 'error' | 'warning';
    timeoutMs: typeof WORKSPACE_NOTIFICATION_TIMEOUT_MS;
    context?: string;
    detail?: string;
    action?: ToastOptions['action'];
}>;

export function useWorkspaceNotifications() {
    const [toast, setToast] = useState<WorkspaceToastMessage>();
    const nextId = useRef(0);
    const setError = useCallback((message: string, options: ToastOptions = {}) => {
        if (!message) {
            setToast(undefined);
            return;
        }
        const notification = {
            message,
            tone: options.tone ?? 'error',
            timeoutMs: WORKSPACE_NOTIFICATION_TIMEOUT_MS,
            context: options.context,
            detail: options.detail,
            action: options.action,
        };
        const id = ++nextId.current;
        setToast(current =>
            current?.message === message &&
            current.context === notification.context &&
            current.tone === notification.tone &&
            current.timeoutMs === notification.timeoutMs
                ? current
                : { ...notification, id },
        );
    }, []);
    const dismissToast = useCallback(() => setToast(undefined), []);
    const clearToast = useCallback((context: string) => {
        setToast(current => (current?.context === context ? undefined : current));
    }, []);
    return { toast, setError, dismissToast, clearToast };
}
