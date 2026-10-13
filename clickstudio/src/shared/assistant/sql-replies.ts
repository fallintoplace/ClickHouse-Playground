import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Code, Nodes } from 'mdast';
import type { ProposalContent } from './types.js';
import { lexSql } from '../sql/sql.js';
import { isRecord, isStringArray } from '../common/values.js';
import { FINDING_SEVERITIES } from './actions.js';
import { assistantAnswerContent, assistantReplyText } from './answers.js';

type SqlBlock = { sql: string; from: number; to: number };
const sqlLanguages = /^(?:sql|clickhouse|postgresql|postgres|mysql|sqlite|tsql)$/i;

function closedCodeBlock(node: Code, text: string, quoteDepth = 0): string | undefined {
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    if (from === undefined || to === undefined) return undefined;
    const source = text.slice(from, to);
    const opening = /^(`{3,}|~{3,})[^\r\n]*(?:\r\n|\n|\r)/.exec(source);
    const closing = /(?:\r\n|\n|\r)([ \t>]*)(`{3,}|~{3,})[ \t]*$/.exec(source);
    if (
        !opening ||
        !closing ||
        closing[1]!.split('>').length - 1 !== quoteDepth ||
        opening[1]![0] !== closing[2]![0] ||
        closing[2]!.length < opening[1]!.length
    )
        return undefined;
    const body = source.slice(opening[0].length, closing.index);
    if (body.split(/\r\n|\n|\r/).length !== node.value.split(/\r\n|\n|\r/).length) return undefined;
    return node.position?.start.column === 1 ? body : node.value;
}

function sqlBlocks(text: string): SqlBlock[] {
    const blocks: SqlBlock[] = [];
    let incomplete = false;
    const visit = (node: Nodes, quoteDepth = 0) => {
        if (node.type === 'code' && sqlLanguages.test(node.lang ?? '')) {
            const sql = closedCodeBlock(node, text, quoteDepth);
            if (sql === undefined) incomplete = true;
            const from = node.position?.start.offset;
            const to = node.position?.end.offset;
            if (sql?.trim() && from !== undefined && to !== undefined)
                blocks.push({ sql, from, to });
        }
        if ('children' in node)
            node.children.forEach(child =>
                visit(child, quoteDepth + Number(node.type === 'blockquote')),
            );
    };
    visit(fromMarkdown(text));
    return incomplete ? [] : blocks;
}

export function normalizeAssistantContent(content: ProposalContent): ProposalContent {
    if (content.sql !== null) return content;
    const blocks = sqlBlocks(content.summary);
    if (!blocks.length) return content;
    let summary = content.summary;
    for (const block of [...blocks].reverse())
        summary = summary.slice(0, block.from) + summary.slice(block.to);
    summary = summary.trim();
    return {
        ...content,
        sql: blocks
            .map((block, index) => {
                if (index === blocks.length - 1) return block.sql;
                try {
                    const last = lexSql(block.sql).at(-1);
                    if (last?.kind === 'symbol' && last.text === ';') return block.sql;
                } catch {}
                return `${block.sql}\n;`;
            })
            .join('\n\n'),
        summary: summary || 'Proposed SQL.',
    };
}

function replyCandidate(value: unknown): unknown {
    let candidate = value;
    if (typeof value === 'string') {
        const tree = fromMarkdown(value);
        const block = tree.children.length === 1 ? tree.children[0] : undefined;
        const encoded =
            block?.type === 'code' && /^json$/i.test(block.lang ?? '')
                ? closedCodeBlock(block, value)
                : value;
        if (encoded !== undefined) {
            try {
                candidate = JSON.parse(encoded);
            } catch {}
        }
    }
    return candidate;
}

export function assistantReplyContent(value: unknown): ProposalContent {
    const candidate = replyCandidate(value);
    if (
        isRecord(candidate) &&
        (typeof candidate.sql === 'string' ||
            (typeof candidate.summary === 'string' && candidate.summary.length > 0))
    ) {
        const content = assistantAnswerContent(assistantReplyText(candidate));
        content.sql = typeof candidate.sql === 'string' ? candidate.sql : null;
        if (typeof candidate.summary === 'string') content.summary = candidate.summary;
        for (const key of ['assumptions', 'tables', 'caveats'] as const)
            if (isStringArray(candidate[key])) content[key] = candidate[key];
        if (typeof candidate.clarification === 'string')
            content.clarification = candidate.clarification;
        if (Array.isArray(candidate.sources))
            content.sources = candidate.sources.flatMap(source =>
                isRecord(source) &&
                typeof source.title === 'string' &&
                typeof source.url === 'string'
                    ? [{ title: source.title, url: source.url }]
                    : [],
            );
        if (Array.isArray(candidate.findings))
            content.findings = candidate.findings.flatMap(finding => {
                if (
                    !isRecord(finding) ||
                    typeof finding.message !== 'string' ||
                    typeof finding.evidence !== 'string'
                )
                    return [];
                const severity = FINDING_SEVERITIES.find(value => value === finding.severity);
                return severity
                    ? [{ severity, message: finding.message, evidence: finding.evidence }]
                    : [];
            });
        return normalizeAssistantContent(content);
    }
    return normalizeAssistantContent(assistantAnswerContent(assistantReplyText(value)));
}
