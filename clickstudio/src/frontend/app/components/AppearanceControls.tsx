import { themeOptions, type Copy } from '../../ui/copy';
import { Icon } from '../../ui/components/icons';

export function renderAppearanceControls({
    copy,
    experience,
    standardHref,
    returnToWorkspace,
    theme,
    setTheme,
}: {
    copy: Copy;
    experience: 'beginner' | 'expert';
    standardHref: string;
    returnToWorkspace: (event: import('react').MouseEvent<HTMLAnchorElement>) => void;
    theme: 'click-dark' | 'click-light';
    setTheme: import('react').Dispatch<
        import('react').SetStateAction<'click-dark' | 'click-light'>
    >;
}) {
    return (
        <div className="topbar-control-rail">
            {experience === 'expert' && (
                <div className="experimental-workspace-status">
                    <span>{copy.app.expert}</span>
                    <a href={standardHref} onClick={returnToWorkspace}>
                        Back to workspace
                    </a>
                </div>
            )}
            <div className="topbar-preferences">
                <div className="experience-switch theme-switch">
                    <div
                        className="theme-mode-control"
                        role="radiogroup"
                        aria-label={copy.app.theme}
                    >
                        {themeOptions(copy).map(option => (
                            <label
                                key={option.value}
                                className={`theme-mode-option ${theme === option.value ? 'is-active' : ''}`}
                                title={option.label}
                            >
                                <input
                                    type="radio"
                                    name="clickstudio-theme"
                                    value={option.value}
                                    checked={theme === option.value}
                                    aria-label={option.label}
                                    onChange={() => setTheme(option.value)}
                                />
                                <Icon
                                    name={option.value === 'click-dark' ? 'moon' : 'sun'}
                                    className="theme-mode-icon"
                                />
                            </label>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
