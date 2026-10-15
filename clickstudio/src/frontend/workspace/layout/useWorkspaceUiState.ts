import { useCallback, useRef, useState } from 'react';
import type { QueryDocument } from '../../../shared/queries/saved-queries/types';
import type { HelpPanelSection } from '../../help/WorkspaceHelpPanel';
import type { ExperienceLevel } from '../../ui/copy';
import type { Draft } from '../../queries/editor/drafts/workspace-state';
import { useFailedQueryErrors } from '../../queries/execution/useFailedQueryErrors';
import type { BusyAction, Inspector } from '../workspace-types';
import { useWorkspaceNotifications } from './notifications/useWorkspaceNotifications';
import { useDraftFeedback } from './notifications/useDraftFeedback';
import { canOpenInspector } from './panels/inspector-navigation';

function useWorkspaceHelpState() {
    const [helpPanelOpen, setHelpPanelOpen] = useState(false);
    const [observabilityOpen, setObservabilityOpen] = useState(false);
    const [helpPanelSection, setHelpPanelSection] = useState<HelpPanelSection>('examples');
    const helpPanelOpenerRef = useRef<HTMLButtonElement | null>(null);
    const openHelpPanel = useCallback((section: HelpPanelSection, opener: HTMLButtonElement) => {
        helpPanelOpenerRef.current = opener;
        setHelpPanelSection(section);
        setHelpPanelOpen(true);
    }, []);
    const closeHelpPanel = useCallback((restoreFocus = true) => {
        setHelpPanelOpen(false);
        if (restoreFocus) window.requestAnimationFrame(() => helpPanelOpenerRef.current?.focus());
    }, []);
    const openHelp = useCallback(
        (opener: HTMLButtonElement) => openHelpPanel('examples', opener),
        [openHelpPanel],
    );

    return {
        helpPanelOpen,
        helpPanelSection,
        setHelpPanelSection,
        closeHelpPanel,
        setObservabilityOpen,
        observabilityOpen,
        openHelp,
    };
}

export function useWorkspaceUiState({
    experience,
    active,
}: {
    experience: ExperienceLevel;
    active: Pick<Draft, 'id'>;
}) {
    const [inspectorsByExperience, setInspectorsByExperience] = useState<
        Record<ExperienceLevel, Inspector>
    >({
        beginner: 'assistant',
        expert: 'schema',
    });
    const experienceRef = useRef(experience);
    experienceRef.current = experience;
    const inspector = inspectorsByExperience[experience];
    const setInspector = useCallback((next: Inspector) => {
        if (!canOpenInspector(next, experienceRef.current === 'expert')) return;
        setInspectorsByExperience(current => ({ ...current, [experienceRef.current]: next }));
    }, []);
    const inspectorRef = useRef(inspector);
    inspectorRef.current = inspector;
    const [compactViewport, setCompactViewport] = useState(
        () => window.matchMedia('(max-width: 850px)').matches,
    );
    const [drawerOpen, setDrawerOpen] = useState(
        () => experience === 'expert' && !window.matchMedia('(max-width: 850px)').matches,
    );
    const [importOpen, setImportOpen] = useState(false),
        [exportOpen, setExportOpen] = useState(false);
    const [restoreRevisionConfirmation, setRestoreRevisionConfirmation] = useState<QueryDocument>();
    const {
        helpPanelOpen,
        helpPanelSection,
        setHelpPanelSection,
        closeHelpPanel,
        setObservabilityOpen,
        observabilityOpen,
        openHelp,
    } = useWorkspaceHelpState();
    const [busy, setBusy] = useState<BusyAction>('');
    const [cancelling, setCancelling] = useState(false);
    const { toast, setError, dismissToast, clearToast } = useWorkspaceNotifications();
    const {
        feedback: draftFeedback,
        begin: beginDraftFeedback,
        clearInfo: clearDraftFeedbackInfo,
    } = useDraftFeedback(active.id);
    const {
        error: failedQueryError,
        clear: clearFailedQueryError,
        record: storeFailedQueryError,
    } = useFailedQueryErrors(active.id);
    const [search, setSearch] = useState('');
    return {
        busy,
        setError,
        clearToast,
        beginDraftFeedback,
        clearDraftFeedbackInfo,
        draftFeedback,
        toast,
        dismissToast,
        setSearch,
        setInspector,
        setDrawerOpen,
        inspector,
        setCompactViewport,
        failedQueryError,
        compactViewport,
        setBusy,
        setCancelling,
        clearFailedQueryError,
        storeFailedQueryError,
        inspectorRef,
        setRestoreRevisionConfirmation,
        drawerOpen,
        search,
        cancelling,
        setImportOpen,
        setExportOpen,
        helpPanelOpen,
        helpPanelSection,
        setHelpPanelSection,
        closeHelpPanel,
        setObservabilityOpen,
        observabilityOpen,
        importOpen,
        exportOpen,
        restoreRevisionConfirmation,
        openHelp,
    };
}
