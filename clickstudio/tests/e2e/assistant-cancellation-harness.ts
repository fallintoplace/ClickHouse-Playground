export {};

declare global {
    interface Window {
        assistantCancellationHarness: {
            acceptConcurrently: () => Promise<{
                sql: string;
                turns: { applied: boolean | undefined; sql: string | null; decision: string }[];
            }>;
            acceptAfterChange: (change: 'edit' | 'close' | 'unmount') => Promise<{
                sql: string[];
                applied: boolean | undefined;
                review: string;
            }>;
            cancelRequest: (mode: 'ask' | 'repair' | 'run') => Promise<{
                busy: boolean;
                phase: string | undefined;
                statuses: string[];
            }>;
            continueWhilePreparing: (mode: 'run' | 'ask' | 'repair') => Promise<{
                busy: boolean;
                phase: string | undefined;
                statuses: string[];
                otherChatBusy: boolean;
                originalTurns: {
                    contextSql: string;
                    runId?: string;
                    runContext?: { evidenceSql?: string; error?: string };
                }[];
                sql: string;
            }>;
        };
    }
}
