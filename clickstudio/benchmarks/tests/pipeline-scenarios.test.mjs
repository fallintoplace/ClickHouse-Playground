import assert from 'node:assert/strict';
import test from 'node:test';
import { pipelineScenarios } from '../pipeline-scenarios.mjs';

test('core query result pipelines produce correct output and close capped sources', async () => {
    const scenarios = pipelineScenarios();
    assert.deepEqual(
        scenarios.map(scenario => scenario.id),
        [
            'pipeline/first-page/1000-rows-20-columns',
            'pipeline/csv-export/5000-rows-40-columns',
            'pipeline/row-cap/100000-input-1000-retained',
        ],
    );
    for (const scenario of scenarios) {
        assert.equal(scenario.async, true);
        assert.ok(scenario.unitsPerOperation > 0);
        scenario.verify(await scenario.run());
        // Re-running a fixture must not keep state from the preceding sample.
        scenario.verify(await scenario.run());
    }
});
