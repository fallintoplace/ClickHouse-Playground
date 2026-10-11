import { useCallback, useRef, useState } from 'react';
import type { QueryDocument } from '../../../shared/queries/saved-queries/types';
import { useScopedValue } from '../../browser/useScopedValue';
import type { HelpPanelSection } from '../../help/WorkspaceHelpPanel';
import type { ExperienceLevel } from '../../translations/i18n';
import type { Draft } from '../../queries/editor/drafts/workspace-state';
import { useFailedQueryErrors } from '../../queries/execution/useFailedQueryErrors';
import type { BusyAction, Inspector } from '../workspace-types';
import {
    useWorkspaceNotifications,
    type WorkspaceFeedback,
} from './notifications/useWorkspaceNotifications';

function useWorkspaceHelpState() {
    const [helpPanelOpen, setHelpPanelOpen] = useState(false);
    const [observabilityOpen, setObservabilityOpen] = useState(false);
    const [helpPanelSection, setHelpPanelSection] = useState<HelpPanelSection>('tour');
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
        (opener: HTMLButtonElement) => openHelpPanel('tour', opener),
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
        beginner: 'schema',
        expert: 'schema',
    });
    const experienceRef = useRef(experience);
    experienceRef.current = experience;
    const inspector = inspectorsByExperience[experience];
    const setInspector = useCallback((next: Inspector) => {
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
    const [draftFeedback, setDraftFeedback] = useScopedValue<WorkspaceFeedback | undefined>(
        active.id,
    );
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
        setDraftFeedback,
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
