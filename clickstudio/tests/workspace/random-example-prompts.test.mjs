import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createRandomExamplePicker,
    RANDOM_EXAMPLE_PROMPTS,
} from '../../.workspace-build/src/frontend/assistant/proposals/random-example-prompts.js';

test('Random examples offer twenty distinct business questions with runnable sample data', () => {
    assert.equal(RANDOM_EXAMPLE_PROMPTS.length, 20);
    assert.equal(new Set(RANDOM_EXAMPLE_PROMPTS).size, 20);
    for (const prompt of RANDOM_EXAMPLE_PROMPTS) {
        assert.match(
            prompt,
            /Include a small, realistic sample dataset so I can run the example\./,
        );
        assert.match(
            prompt,
            /Make the example safe to rerun; adding more sample data each time is fine\.$/,
        );
        assert.doesNotMatch(
            prompt,
            /\b(?:CREATE TABLE|INSERT INTO|SELECT|JOIN|GROUP BY|ASOF|windowFunnel|arrayJoin|argMax|quantile)\b/i,
        );
        assert.doesNotMatch(prompt, /^Create a ClickHouse table/);
    }
});

for (const value of [0, 0.5, 0.9999999999999999]) {
    test(`Random examples visit every topic before repeating with random value ${value}`, () => {
        const next = createRandomExamplePicker(() => value);
        let previous;
        for (let cycle = 0; cycle < 5; cycle++) {
            const prompts = Array.from({ length: 20 }, () => next());
            assert.deepEqual(new Set(prompts), new Set(RANDOM_EXAMPLE_PROMPTS));
            assert.notEqual(prompts[0], previous);
            previous = prompts.at(-1);
        }
    });
}

test('Random examples avoid a repeat when the next shuffle ends with the previous topic', () => {
    let randomValue = 0;
    const next = createRandomExamplePicker(() => randomValue);
    const firstCycle = Array.from({ length: 20 }, () => next());
    // This shuffle would otherwise put the previous topic first in the next cycle.
    randomValue = 1 / 19;
    const secondCycle = Array.from({ length: 20 }, () => next());
    assert.notEqual(secondCycle[0], firstCycle.at(-1));
    assert.deepEqual(new Set(secondCycle), new Set(RANDOM_EXAMPLE_PROMPTS));
});

test('Random example pickers produce different orders and keep independent decks', () => {
    const first = createRandomExamplePicker(() => 0);
    const second = createRandomExamplePicker(() => 0.9999999999999999);
    const firstCycle = Array.from({ length: 20 }, () => first());
    const secondCycle = Array.from({ length: 20 }, () => second());
    assert.notDeepEqual(firstCycle, secondCycle);
    assert.deepEqual(new Set(firstCycle), new Set(secondCycle));
    const third = createRandomExamplePicker(() => 0);
    assert.deepEqual(
        Array.from({ length: 20 }, () => third()),
        firstCycle,
    );
});
