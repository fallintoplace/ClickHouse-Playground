import { readFile, appendFile } from 'node:fs/promises';
import { compareReports, comparisonMarkdown } from './lib/compare.mjs';

const [baselinePath, candidatePath, ...rest] = process.argv.slice(2);
const allowPartial = rest.length === 1 && rest[0] === '--allow-partial';
if (!baselinePath || !candidatePath || (rest.length && !allowPartial)) {
    console.error(
        'Usage: npm run bench:compare -- <baseline.json> <candidate.json> [--allow-partial]',
    );
    process.exitCode = 1;
} else {
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
    const candidate = JSON.parse(await readFile(candidatePath, 'utf8'));
    const results = compareReports(baseline, candidate);
    if (baseline.environment?.node !== candidate.environment?.node)
        console.warn('Node versions differ; timings may not be comparable.');
    if (baseline.environment?.cpuModel !== candidate.environment?.cpuModel)
        console.warn('CPU models differ; timings may not be comparable.');
    const comparableCount = results.filter(result => result.comparable).length;
    const incomparableCount = results.length - comparableCount;
    if (!comparableCount) {
        console.error('No matching comparable benchmark scenarios.');
        process.exitCode = 1;
    } else if (incomparableCount && !allowPartial) {
        console.error(
            incomparableCount +
                ' benchmark scenario(s) are not comparable; use --allow-partial to opt in.',
        );
        process.exitCode = 1;
    }
    const summary = comparisonMarkdown(results);
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY)
        await appendFile(process.env.GITHUB_STEP_SUMMARY, summary, 'utf8');
}
