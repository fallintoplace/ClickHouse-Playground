import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import type { ExperienceLevel } from '../ui/styles/appearance-types';

function currentExperience(): ExperienceLevel {
    const path = window.location.pathname;
    return path === '/experimental' || path === '/experimental/' ? 'expert' : 'beginner';
}

export function useWorkspaceRoute() {
    const [experience, setExperience] = useState(currentExperience);

    useEffect(() => {
        const update = () => setExperience(currentExperience());
        window.addEventListener('popstate', update);
        return () => window.removeEventListener('popstate', update);
    }, []);

    const returnToWorkspace = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
        if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
        )
            return;
        event.preventDefault();
        const url = new URL(window.location.href);
        url.pathname = '/';
        window.history.pushState(window.history.state, '', url);
        setExperience('beginner');
    }, []);

    return {
        experience,
        standardHref: `/${window.location.search}${window.location.hash}`,
        returnToWorkspace,
    };
}
