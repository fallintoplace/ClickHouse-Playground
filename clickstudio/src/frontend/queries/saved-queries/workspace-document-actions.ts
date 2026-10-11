import type { Dispatch, SetStateAction } from 'react';
import type { QueryDocument } from '../../../shared/queries/saved-queries/types';
import { message, post, RequestError } from '../../api/client';
import { checkpoint, type Draft, type WorkspaceState } from '../editor/drafts/workspace-state';
import type { useWorkspaceExecution } from '../execution/useWorkspaceExecution';
import { sameSavedContent } from './draft-save';
import { documentFailureNotice } from '../../workspace/layout/notifications/workspace-notification-policy';
import type { useWorkspaceNotifications } from '../../workspace/layout/notifications/useWorkspaceNotifications';
import type {
    CompleteDraftFeedback,
    useDraftFeedback,
} from '../../workspace/layout/notifications/useDraftFeedback';
import type { WorkspacePanelController } from '../../workspace/layout/panels/useWorkspacePanels';
import type { useWorkspaceData } from '../../workspace/useWorkspaceData';

export function createDocumentFailureReporter({
    workspaceRef,
    setWorkspace,
    setError,
    panels,
}: {
    workspaceRef: import('react').RefObject<WorkspaceState>;
    setWorkspace: Dispatch<SetStateAction<WorkspaceState>>;
    setError: ReturnType<typeof useWorkspaceNotifications>['setError'];
    panels: Pick<WorkspacePanelController, 'revealPanelTemporarily'>;
}) {
    return (
        draft: Pick<Draft, 'id' | 'name'>,
        operation: 'save' | 'restore',
        caught: unknown,
        complete: CompleteDraftFeedback,
    ) => {
        const failure = documentFailureNotice(
            draft.name,
            operation,
            caught instanceof RequestError
                ? {
                      status: caught.status,
                      code: caught.detail.code,
                  }
                : {},
        );
        if (!complete({ ...failure, detail: message(caught) })) return;
        if (workspaceRef.current.activeId !== draft.id)
            setError(failure.message, {
                ...failure,
                detail: message(caught),
                context: `draft:${draft.id}:${operation}`,
                action: workspaceRef.current.tabs.some(item => item.id === draft.id)
                    ? {
                          label: 'Open tab',
                          onSelect: () => {
                              if (!workspaceRef.current.tabs.some(item => item.id === draft.id))
                                  return;
                              setWorkspace(current => ({ ...current, activeId: draft.id }));
                              panels.revealPanelTemporarily('query', draft.id);
                          },
                      }
                    : undefined,
            });
    };
}

export function createRevisionRestorer({
    perform,
    workspaceRef,
    setRestoreRevisionConfirmation,
    update,
    data,
    beginDraftFeedback,
    clearToast,
    reportDocumentFailure,
}: {
    perform: ReturnType<typeof useWorkspaceExecution>['perform'];
    workspaceRef: import('react').RefObject<WorkspaceState>;
    setRestoreRevisionConfirmation: import('react').Dispatch<
        import('react').SetStateAction<QueryDocument | undefined>
    >;
    update: (id: string, change: (draft: Draft) => Draft) => void;
    beginDraftFeedback: ReturnType<typeof useDraftFeedback>['begin'];
    clearToast: ReturnType<typeof useWorkspaceNotifications>['clearToast'];
    reportDocumentFailure: (
        draft: Pick<Draft, 'id' | 'name'>,
        operation: 'save' | 'restore',
        caught: unknown,
        complete: CompleteDraftFeedback,
    ) => void;
    data: Pick<
        ReturnType<typeof useWorkspaceData>,
        | 'revisionsDocumentId'
        | 'documentRevisions'
        | 'documents'
        | 'setDocuments'
        | 'loadDocumentRevisions'
    >;
}) {
    const {
        revisionsDocumentId,
        documentRevisions,
        documents,
        setDocuments,
        loadDocumentRevisions,
    } = data;

    return (revision: QueryDocument, confirmed = false) => {
        const target = workspaceRef.current.tabs.find(
            item => item.id === workspaceRef.current.activeId,
        );
        let complete: CompleteDraftFeedback = () => false;
        void perform(
            async () => {
                const draft = workspaceRef.current.tabs.find(item => item.id === target?.id);
                complete = beginDraftFeedback(target?.id ?? `document:${revision.id}`, 'restore');
                if (!draft?.serverId || draft.serverId !== revision.id)
                    throw new Error('Open the saved query before restoring one of its versions.');
                const latestSaved =
                    revisionsDocumentId === draft.serverId
                        ? documentRevisions[0]
                        : documents.find(document => document.id === draft.serverId);
                if (!latestSaved || latestSaved.deletedAt)
                    throw new Error(
                        'The latest saved version could not be checked. Refresh saved queries and try again.',
                    );
                const hasUnsavedChanges =
                    draft.baseRevision !== latestSaved.revision ||
                    !sameSavedContent(draft, latestSaved);
                if (hasUnsavedChanges && !confirmed) {
                    setRestoreRevisionConfirmation(revision);
                    return;
                }
                const restoreBase: QueryDocument = {
                    ...latestSaved,
                    name: draft.name,
                    sql: draft.sql,
                    parameters: { ...draft.parameters },
                    chart: { ...draft.chart, ys: [...draft.chart.ys] },
                    runId: draft.activeRunId,
                    parentDocumentId: draft.parentDocumentId,
                    kind: draft.kind,
                    metric: draft.metric
                        ? {
                              ...draft.metric,
                              dimensions: [...draft.metric.dimensions],
                              sourceColumns: [...draft.metric.sourceColumns],
                          }
                        : undefined,
                    dependencies: [...draft.dependencies],
                };
                const restored = await post<QueryDocument>(
                    `/documents/${encodeURIComponent(draft.serverId)}/restore-revision`,
                    {
                        revision: revision.revision,
                        baseRevision: latestSaved.revision,
                    },
                );
                const currentDraft = workspaceRef.current.tabs.find(item => item.id === draft.id);
                const editedDuringRestore = Boolean(
                    currentDraft && !sameSavedContent(currentDraft, restoreBase),
                );
                update(draft.id, current =>
                    editedDuringRestore
                        ? { ...current, baseRevision: restored.revision }
                        : {
                              ...checkpoint(
                                  current,
                                  `Before restoring Version ${revision.revision}`,
                              ),
                              name: restored.name,
                              sql: restored.sql,
                              baseRevision: restored.revision,
                              parameters: { ...restored.parameters },
                              chart: { ...restored.chart, ys: [...restored.chart.ys] },
                              parentRunId: undefined,
                              parentDocumentId: restored.parentDocumentId,
                              kind: restored.kind,
                              metric: restored.metric
                                  ? {
                                        ...restored.metric,
                                        dimensions: [...restored.metric.dimensions],
                                        sourceColumns: [...restored.metric.sourceColumns],
                                    }
                                  : undefined,
                              dependencies: [...restored.dependencies],
                              from: 0,
                              to: 0,
                          },
                );
                setDocuments(current => [
                    restored,
                    ...current.filter(document => document.id !== restored.id),
                ]);
                clearToast(`draft:${draft.id}:restore`);
                complete({
                    tone: 'info',
                    message: editedDuringRestore
                        ? `Restored Version ${revision.revision} as Version ${restored.revision}. Edits made during restore are still in your draft.`
                        : `Restored Version ${revision.revision} as Version ${restored.revision}.`,
                });
                void loadDocumentRevisions(restored.id);
            },
            'save',
            caught => {
                reportDocumentFailure(
                    target ?? { id: `document:${revision.id}`, name: revision.name },
                    'restore',
                    caught,
                    complete,
                );
            },
        );
    };
}
