import type { Run, Script } from '../../../shared/queries/execution/types.js';
import { statementOutcome } from './statement-outcome.js';

export type ResultStatement = Pick<
    Script['statements'][number],
    'sql' | 'runId' | 'status' | 'error'
>;

export const statementStatusLabels: Record<ResultStatement['status'], string> = {
    pending: 'Pending',
    queued: 'Queued',
    running: 'Running',
    succeeded: 'Succeeded',
    truncated: 'Truncated',
    failed: 'Failed',
    cancelled: 'Cancelled',
    timed_out: 'Timed out',
    interrupted: 'Interrupted',
    skipped: 'Skipped',
};

export function statementDetails(statement: ResultStatement, run?: Run, includeColumns = false) {
    const current = run?.status === statement.status ? run : undefined;
    const error = current?.error ?? statement.error;
    if (error) return `${error.code}: ${error.message}`;
    const status = statement.status;
    if (status === 'pending' || status === 'queued') return 'Waiting to run';
    if (status === 'running') return 'Running';
    if (current && (status === 'succeeded' || status === 'truncated')) {
        const details = [statementOutcome(current)];
        if (includeColumns && current.columns.length > 0)
            details.push(
                `${current.columns.length} ${current.columns.length === 1 ? 'column' : 'columns'}`,
            );
        details.push(`${Math.round(current.elapsedMs)} ms`);
        return details.join(' · ');
    }
    return includeColumns && status === 'succeeded' ? '' : statementStatusLabels[status];
}

export function statementNotice(statement: ResultStatement, run?: Run) {
    const notices: string[] = [];
    if (statement.status === 'truncated') notices.push('Result truncated');
    const warnings = run?.status === statement.status ? run.warnings.length : 0;
    if (warnings > 0) notices.push(`${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`);
    return notices.join(' · ');
}
