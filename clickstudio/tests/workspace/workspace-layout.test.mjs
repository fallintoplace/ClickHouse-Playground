import assert from 'node:assert/strict';
import test from 'node:test';
import {
    clampPanelSplitRatio,
    defaultWorkspacePanelLayout,
    recoverWorkspacePanelLayout,
} from '../../.workspace-build/src/frontend/workspace/layout/workspace-layout.js';

test('saved collapsed panel preferences survive recovery', () => {
    const recovered = recoverWorkspacePanelLayout(
        JSON.stringify({
            query: { collapsed: true },
            results: { collapsed: false },
        }),
    );
    assert.deepEqual(recovered, {
        version: 1,
        splitRatio: 0.54,
        query: { collapsed: true },
        results: { collapsed: false },
    });
});

for (const mode of ['docked', 'floating', 'maximized'])
    test(`saved ${mode} panels retain their preferences without obsolete window state`, () => {
        const recovered = recoverWorkspacePanelLayout(
            JSON.stringify({
                version: 1,
                splitRatio: 0.63,
                query: {
                    mode,
                    collapsed: true,
                    geometry: { x: 3000, y: -20, width: 650, height: 400 },
                },
                results: { mode, collapsed: false, geometry: null },
            }),
        );
        assert.deepEqual(recovered, {
            version: 1,
            splitRatio: 0.63,
            query: { collapsed: true },
            results: { collapsed: false },
        });
        assert.deepEqual(recoverWorkspacePanelLayout(JSON.stringify(recovered)), recovered);
    });

for (const raw of [null, '', '{broken', 'null', '[]', 'true', '17', '"layout"'])
    test(`missing or malformed storage ${JSON.stringify(raw)} uses the default layout`, () => {
        assert.deepEqual(recoverWorkspacePanelLayout(raw), defaultWorkspacePanelLayout());
    });

for (const value of [null, false, 1, 'true', {}, { collapsed: 'true' }, { collapsed: 1 }])
    test(`malformed panel state ${JSON.stringify(value)} leaves the panel expanded`, () => {
        const recovered = recoverWorkspacePanelLayout(
            JSON.stringify({ query: value, results: value }),
        );
        assert.equal(recovered.query.collapsed, false);
        assert.equal(recovered.results.collapsed, false);
    });

for (const raw of ['null', '"0.63"', 'true', '{}', '1e400', '-1e400', '"NaN"'])
    test(`invalid saved split ratio ${raw} uses the default`, () => {
        const recovered = recoverWorkspacePanelLayout(`{"splitRatio":${raw}}`);
        assert.equal(recovered.splitRatio, 0.54);
    });

test('saved split ratios are clamped without resetting collapsed panels', () => {
    for (const [value, expected] of [
        [-1, 0.25],
        [0.6, 0.6],
        [2, 0.75],
    ]) {
        const recovered = recoverWorkspacePanelLayout(
            JSON.stringify({ splitRatio: value, query: { collapsed: true } }),
        );
        assert.equal(recovered.splitRatio, expected);
        assert.equal(recovered.query.collapsed, true);
        assert.equal(recovered.results.collapsed, false);
    }
});

test('split ratio stays useful for both docked panels', () => {
    assert.equal(clampPanelSplitRatio(-1), 0.25);
    assert.equal(clampPanelSplitRatio(0.6), 0.6);
    assert.equal(clampPanelSplitRatio(2), 0.75);
});
