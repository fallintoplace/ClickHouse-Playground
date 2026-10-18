import { useCallback, useRef, useState } from 'react';
import type { WorkspaceFeedback } from './useWorkspaceNotifications';

export type DraftFeedbackSource = 'save' | 'restore';
export type DraftFeedback = WorkspaceFeedback & { source: DraftFeedbackSource };
export type CompleteDraftFeedback = (feedback?: WorkspaceFeedback) => boolean;
type FeedbackBySource = Partial<Record<DraftFeedbackSource, WorkspaceFeedback>>;

function isDraftFeedbackSource(value: string): value is DraftFeedbackSource {
    return value === 'save' || value === 'restore';
}

export function useDraftFeedback(activeDraftId: string) {
    const [byDraft, setByDraft] = useState<Record<string, FeedbackBySource>>({});
    const attempts = useRef(new Map<string, number>());
    const nextAttempt = useRef(0);
    const begin = useCallback(
        (draftId: string, source: DraftFeedbackSource): CompleteDraftFeedback => {
            const key = `${draftId}:${source}`;
            const attempt = ++nextAttempt.current;
            attempts.current.set(key, attempt);
            return feedback => {
                if (attempts.current.get(key) !== attempt) return false;
                setByDraft(current => ({
                    ...current,
                    [draftId]: { ...current[draftId], [source]: feedback },
                }));
                return true;
            };
        },
        [],
    );
    const clearInfo = useCallback((draftId: string) => {
        setByDraft(current => {
            if (!Object.values(current[draftId] ?? {}).some(feedback => feedback?.tone === 'info'))
                return current;
            return {
                ...current,
                [draftId]: Object.fromEntries(
                    Object.entries(current[draftId] ?? {}).filter(
                        ([, feedback]) => feedback?.tone !== 'info',
                    ),
                ),
            };
        });
    }, []);
    const dismiss = useCallback(
        (source: DraftFeedbackSource) => {
            const key = `${activeDraftId}:${source}`;
            attempts.current.delete(key);
            setByDraft(current => {
                if (!current[activeDraftId]?.[source]) return current;
                const next = { ...current[activeDraftId] };
                delete next[source];
                return { ...current, [activeDraftId]: next };
            });
        },
        [activeDraftId],
    );
    const feedback: DraftFeedback[] = Object.entries(byDraft[activeDraftId] ?? {}).flatMap(
        ([source, feedback]) =>
            feedback && isDraftFeedbackSource(source) ? [{ ...feedback, source }] : [],
    );
    return { feedback, begin, clearInfo, dismiss };
}
