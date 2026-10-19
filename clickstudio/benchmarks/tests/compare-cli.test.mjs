import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('comparison CLI refuses incomplete overlaps unless explicitly allowed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'clickstudio-bench-'));
    try {
        const baselinePath = join(directory, 'before.json');
        const candidatePath = join(directory, 'after.json');
        const baseline = {
            schemaVersion: 1,
            benchmarks: [{ id: 'shared', medianMs: 10, unitsPerOperation: 100 }],
        };
        const candidate = {
            schemaVersion: 1,
            benchmarks: [
                { id: 'shared', medianMs: 9, unitsPerOperation: 100 },
                { id: 'missing-in-baseline', medianMs: 1, unitsPerOperation: 100 },
            ],
        };
        await Promise.all([
            writeFile(baselinePath, JSON.stringify(baseline)),
            writeFile(candidatePath, JSON.stringify(candidate)),
        ]);
        const command = fileURLToPath(new URL('../compare.mjs', import.meta.url));
        const args = [command, baselinePath, candidatePath];
        const strict = spawnSync(process.execPath, args, { encoding: 'utf8' });
        assert.equal(strict.status, 1);
        assert.match(strict.stderr, /not comparable/);
        assert.match(strict.stdout, /Missing from baseline/);

        const partial = spawnSync(process.execPath, [...args, '--allow-partial'], {
            encoding: 'utf8',
        });
        assert.equal(partial.status, 0, partial.stderr);
        assert.match(partial.stdout, /-10\.0%/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
