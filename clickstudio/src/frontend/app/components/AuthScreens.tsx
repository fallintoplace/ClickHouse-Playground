import { Button, Spinner } from '../../ui/components/primitives';
import { Icon } from '../../ui/components/icons';
import { copy } from '../../ui/copy';

export function SessionLoadingScreen({
    sessionError,
    onRetry,
}: {
    sessionError: string;
    onRetry: () => void;
}) {
    return (
        <main className="auth-screen">
            <section className="auth-card animate-enter">
                <Brand />
                <span className="eyebrow mt-8">{copy.auth.privateWorkspace}</span>
                <h1>{sessionError ? copy.auth.unavailable : copy.auth.opening}</h1>
                {sessionError ? (
                    <>
                        <p>{sessionError}</p>
                        <Button variant="primary" onClick={onRetry}>
                            {copy.auth.retry}
                        </Button>
                    </>
                ) : (
                    <div className="splash-status">
                        <Spinner />
                        <p>{copy.auth.opening}</p>
                    </div>
                )}
            </section>
        </main>
    );
}

export function LoginScreen({
    sessionError,
    token,
    busy,
    onTokenChange,
    onLogin,
}: {
    sessionError: string;
    token: string;
    busy: boolean;
    onTokenChange: (token: string) => void;
    onLogin: () => void;
}) {
    return (
        <main className="auth-screen">
            <form
                className="auth-card animate-enter"
                onSubmit={event => {
                    event.preventDefault();
                    onLogin();
                }}
            >
                <Brand />
                <span className="eyebrow mt-8">{copy.auth.privateWorkspace}</span>
                <h1>{copy.auth.title}</h1>
                <p>{copy.auth.description}</p>
                <label className="field-label">
                    {copy.auth.token}
                    <input
                        className="field-input mt-2"
                        type="password"
                        autoComplete="current-password"
                        value={token}
                        onChange={event => onTokenChange(event.target.value)}
                        autoFocus
                    />
                </label>
                {sessionError && <div className="callout callout-error">{sessionError}</div>}
                <Button
                    variant="primary"
                    type="submit"
                    disabled={busy || !token}
                    className="mt-4 w-full"
                >
                    {busy ? copy.auth.opening : copy.auth.open}
                    <span className="button-arrow">↗</span>
                </Button>
                <div className="auth-footnote">
                    <Icon name="lock" /> {copy.auth.credentialsNotice}
                </div>
            </form>
        </main>
    );
}

export function Brand() {
    return (
        <div className="brand-lockup">
            <svg
                className="brand-symbol"
                viewBox="0 0 150 150"
                role="img"
                aria-label="ClickHouse"
                fill="var(--brand-logo)"
            >
                <path d="M27,25.7c0-.6.5-1.2,1.2-1.2h8.8c.6,0,1.2.5,1.2,1.2v97.7c0,.6-.5,1.2-1.2,1.2h-8.8c-.6,0-1.2-.5-1.2-1.2V25.7Z" />
                <path d="M49.2,25.7c0-.6.5-1.2,1.2-1.2h8.8c.6,0,1.2.5,1.2,1.2v97.7c0,.6-.5,1.2-1.2,1.2h-8.8c-.6,0-1.2-.5-1.2-1.2V25.7Z" />
                <path d="M71.4,25.7c0-.6.5-1.2,1.2-1.2h8.8c.6,0,1.2.5,1.2,1.2v97.7c0,.6-.5,1.2-1.2,1.2h-8.8c-.6,0-1.2-.5-1.2-1.2V25.7Z" />
                <path d="M93.6,25.7c0-.6.5-1.2,1.2-1.2h8.8c.6,0,1.2.5,1.2,1.2v97.7c0,.6-.5,1.2-1.2,1.2h-8.8c-.6,0-1.2-.5-1.2-1.2V25.7Z" />
                <path d="M115.9,64.6c0-.6.5-1.2,1.2-1.2h8.8c.6,0,1.2.5,1.2,1.2v19.9c0,.6-.5,1.2-1.2,1.2h-8.8c-.6,0-1.2-.5-1.2-1.2V64.6Z" />
            </svg>
            <span className="brand-name">
                Click<span>House</span>
                <small>CLICKHOUSE WORKSPACE</small>
            </span>
        </div>
    );
}
