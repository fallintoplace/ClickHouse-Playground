import { useEffect, useState } from 'react';
import { Button } from '../../../ui/components/primitives';
import { Icon } from '../../../ui/components/icons';
import { createSqlShareLink } from './sql-share-link';

export function SqlShareButton({
    draftId,
    sql,
    name,
    disabled,
    onError,
}: {
    draftId: string;
    sql: string;
    name: string;
    disabled: boolean;
    onError: (detail: string) => void;
}) {
    const [shared, setShared] = useState<{ id: string; sql: string; name: string }>();
    const copied = shared?.id === draftId && shared.sql === sql && shared.name === name;
    useEffect(() => {
        if (!shared) return;
        const timer = window.setTimeout(() => setShared(undefined), 1600);
        return () => window.clearTimeout(timer);
    }, [shared]);

    const copyShareLink = async () => {
        try {
            const link = createSqlShareLink(sql, name, window.location.href);
            if (!navigator.clipboard?.writeText)
                throw new Error('Clipboard access requires HTTPS or localhost.');
            await navigator.clipboard.writeText(link);
            setShared({ id: draftId, sql, name });
        } catch (error) {
            onError(error instanceof Error ? error.message : 'Could not copy the SQL link.');
        }
    };

    return (
        <Button
            variant="ghost"
            className="toolbar-small sql-share-button"
            data-testid="share-sql"
            data-copied={copied ? 'true' : undefined}
            aria-label={copied ? 'Link copied' : 'Share SQL'}
            title={
                copied
                    ? 'Link copied to clipboard'
                    : 'Copy a SQL-only link. Anyone with the link can read the SQL.'
            }
            data-footer-help="Copy a shareable link to the SQL text only. No results or credentials are shared."
            disabled={!sql.trim() || disabled}
            onClick={() => void copyShareLink()}
        >
            <Icon name={copied ? 'check' : 'link'} />
        </Button>
    );
}
