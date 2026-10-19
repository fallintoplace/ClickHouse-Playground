import type { useWorkspaceData } from '../../workspace/useWorkspaceData';
import type { useWorkspaceUiState } from '../../workspace/layout/useWorkspaceUiState';
import type { Draft } from '../editor/drafts/workspace-state';
import type { useWorkspaceTabs } from '../editor/tabs/useWorkspaceTabs';
import { useWorkspaceDocumentSave } from './useWorkspaceDocumentSave';
import {
    createRevisionRestorer,
    type createDocumentFailureReporter,
} from './workspace-document-actions';

export function useWorkspaceDocumentActions({
    active,
    busy,
    reviewingSql,
    connectionId,
    workspaceRef,
    inspectorRef,
    perform,
    updateDraft,
    setSavingDraftIds,
    setDocuments,
    beginDraftFeedback,
    clearToast,
    loadDocumentRevisions,
    update,
    updateTabRename,
    setRestoreRevisionConfirmation,
    data,
    reportDocumentFailure,
}: Omit<Parameters<typeof useWorkspaceDocumentSave>[0], 'onFailure'> & {
    update: (id: string, change: (draft: Draft) => Draft) => void;
    updateTabRename: ReturnType<typeof useWorkspaceTabs>['finishTabRename'];
    setRestoreRevisionConfirmation: ReturnType<
        typeof useWorkspaceUiState
    >['setRestoreRevisionConfirmation'];
    data: ReturnType<typeof useWorkspaceData>;
    reportDocumentFailure: ReturnType<typeof createDocumentFailureReporter>;
}) {
    const saveDraft = useWorkspaceDocumentSave({
        active,
        reviewingSql,
        busy,
        connectionId,
        workspaceRef,
        inspectorRef,
        perform,
        updateDraft,
        setSavingDraftIds,
        setDocuments,
        loadDocumentRevisions,
        beginDraftFeedback,
        clearToast,
        onFailure: (draft, caught, complete) =>
            reportDocumentFailure(draft, 'save', caught, complete),
    });
    const finishTabRename = (
        id: string,
        value: string,
        restoreFocus = false,
        saveAfterRename = true,
    ) => {
        const renamedDraft = updateTabRename(id, value, restoreFocus);
        if (saveAfterRename && renamedDraft) void saveDraft(renamedDraft);
    };
    const restoreDocumentRevision = createRevisionRestorer({
        perform,
        workspaceRef,
        setRestoreRevisionConfirmation,
        update,
        data,
        beginDraftFeedback,
        clearToast,
        reportDocumentFailure,
    });
    return { saveDraft, finishTabRename, restoreDocumentRevision };
}
