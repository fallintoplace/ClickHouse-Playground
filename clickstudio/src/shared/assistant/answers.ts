import type { ProposalContent } from './types.js';
import { isRecord } from '../common/values.js';

export function assistantAnswerContent(answer: string): ProposalContent {
    return {
        sql: null,
        summary: answer,
        assumptions: [],
        tables: [],
        caveats: [],
        clarification: null,
        findings: [],
    };
}

export function assistantReplyText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (isRecord(value)) {
        for (const key of ['summary', 'output_text', 'content'])
            if (typeof value[key] === 'string' && value[key]) return value[key];
    }
    return JSON.stringify(value, null, 2) ?? String(value);
}
