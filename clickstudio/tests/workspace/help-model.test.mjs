import assert from 'node:assert/strict';
import test from 'node:test';
import { copy as english } from '../../.workspace-build/src/frontend/ui/copy.js';
import {
    categoryLabel,
    chartLabel,
    exampleText,
    helpSections,
} from '../../.workspace-build/src/frontend/help/workspace-help-model.js';

const copy = english.common;

test('experimental help topics stay grouped after the standard help topics', () => {
    const sections = helpSections(copy);
    const experimental = sections
        .filter(section => section.experimental)
        .map(section => section.id);
    const firstExperimentalIndex = sections.findIndex(section => section.experimental);

    assert.deepEqual(experimental, [
        'reference',
        'query',
        'explain',
        'storage',
        'dependencies',
        'compare',
    ]);
    assert.ok(firstExperimentalIndex > 0);
    assert.ok(sections.slice(0, firstExperimentalIndex).every(section => !section.experimental));
    assert.ok(sections.slice(firstExperimentalIndex).every(section => section.experimental));
    assert.equal(sections[firstExperimentalIndex].id, 'reference');
});

test('Standard help keeps only core topics in navigation and tours', () => {
    const sections = helpSections(copy, false);
    assert.deepEqual(
        sections.map(section => section.id),
        ['tour', 'examples', 'workflows', 'assistant'],
    );
    assert.ok(sections.every(section => !section.experimental));
    assert.equal(sections[0].description, copy.helpStandardTourDescription);
    assert.equal(helpSections(copy, true)[0].description, copy.helpTourDescription);
});

test('example category labels use English and custom labels', () => {
    const labels = [
        ['all', copy.allExamples],
        ['featured', 'Featured'],
        ['business', 'Business'],
        ['observability', 'Observability'],
        ['operations', 'Operations'],
        ['engineering', 'Engineering'],
        ['markets', 'Markets'],
        ['cities', 'Cities'],
        ['openSource', 'Open source'],
        ['internet', 'Internet'],
        ['datasets', 'Datasets'],
        ['writeOperations', copy.exampleWriteOperations],
        ['basics', copy.exampleBasics],
        ['aggregation', copy.exampleAggregation],
        ['timeSeries', copy.exampleTimeSeries],
        ['charts', copy.exampleCharts],
        ['clickhouse', copy.exampleClickHouse],
        ['schema', copy.exampleSchema],
    ];

    for (const [category, expected] of labels) {
        assert.equal(categoryLabel(category, copy), expected, category);
    }
});

test('chart labels cover every chart kind and unknown kinds', () => {
    const labels = [
        ['table', copy.exampleChartTable],
        ['number', copy.exampleChartNumber],
        ['line', copy.exampleChartLine],
        ['bar', copy.exampleChartBar],
        ['scatter', copy.exampleChartScatter],
        ['heatmap', copy.exampleChartHeatmap],
        ['candlestick', copy.exampleChartCandlestick],
        ['unknown', copy.chart],
    ];

    for (const [kind, expected] of labels) {
        assert.equal(chartLabel({ chart: { kind } }, copy), expected, kind);
    }
});

test('schema examples use table copy while other examples preserve their text', () => {
    assert.deepEqual(
        exampleText(
            { id: 'events', name: 'Preview events', description: 'ignored', category: 'schema' },
            copy,
        ),
        {
            name: 'Preview events',
            description: copy.exampleReadRows,
        },
    );
    assert.deepEqual(
        exampleText(
            { id: 'events', name: 'events', description: 'ignored', category: 'schema' },
            copy,
        ),
        {
            name: 'Preview events',
            description: copy.exampleReadRows,
        },
    );
    assert.deepEqual(
        exampleText(
            {
                id: 'clickhouse-server-version',
                name: 'Server version',
                description: 'Read the version',
                category: 'clickhouse',
            },
            copy,
        ),
        {
            name: 'Server version',
            description: 'Read the version',
        },
    );
    assert.deepEqual(
        exampleText(
            {
                id: 'unknown-example',
                name: 'Unknown example',
                description: 'No translation',
                category: 'basics',
            },
            copy,
        ),
        {
            name: 'Unknown example',
            description: 'No translation',
        },
    );
});
