import { useEffect, useRef } from 'react';
import { readSqlShareHash } from './sql-share-link';
import type { ToastOptions } from '../../../workspace/layout/notifications/useWorkspaceNotifications';

type OpenSqlDraft = (name: string, sql: string, run: boolean) => { draftId: string } | undefined;
type ReportError = (message: string, options?: ToastOptions) => void;

export function useSqlShareImport(openSqlDraft: OpenSqlDraft, setError: ReportError) {
    const attemptedShareHash = useRef('');
    useEffect(() => {
        const importShare = () => {
            const hash = window.location.hash;
            if (!hash.startsWith('#sqlz=') || attemptedShareHash.current === hash) return;
            attemptedShareHash.current = hash;
            const clearHash = () =>
                window.history.replaceState(
                    window.history.state,
                    '',
                    window.location.pathname + window.location.search,
                );
            try {
                const shared = readSqlShareHash(hash);
                if (shared && openSqlDraft(shared.name, shared.sql, false)) clearHash();
            } catch (error) {
                clearHash();
                setError('Could not open shared SQL.', {
                    tone: 'warning',
                    detail: error instanceof Error ? error.message : 'Invalid SQL share link.',
                });
            }
        };
        importShare();
        window.addEventListener('hashchange', importShare);
        return () => window.removeEventListener('hashchange', importShare);
    }, [openSqlDraft, setError]);
}
