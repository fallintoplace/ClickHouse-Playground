import assert from 'node:assert/strict';
import test from 'node:test';
import {
    exportCsv,
    heatmapCellKey,
    prepareHeatmap,
    previewResultCell,
} from '../../.core-build/src/shared/queries/results/results.js';

function keyForLabels(prepared, xLabel, yLabel) {
    const xIndex = prepared.xLabels.indexOf(xLabel);
    const yIndex = prepared.yLabels.indexOf(yLabel);
    return heatmapCellKey(prepared.xKeys[xIndex], prepared.yKeys[yIndex]);
}

test('Result cell previews are bounded while full strings remain available elsewhere', () => {
    const value = '😀'.repeat(200);
    const preview = previewResultCell(value);
    assert.ok(preview.length <= 180);
    assert.ok(preview.endsWith('…'));
    assert.equal(preview.slice(0, -1).length % 2, 0);
});

test('Result cell previews summarize nested values without walking every child', () => {
    assert.equal(
        previewResultCell({
            first: 'value',
            second: [1, 2, { hidden: 'value' }],
            third: null,
            extra: true,
        }),
        '{"first": "value", "second": [1, 2, Object], "third": NULL, …}',
    );
});

test('Heatmap sums duplicate X/Y cells from retained rows', () => {
    const prepared = prepareHeatmap(
        [
            ['Mon', '10:00', 5],
            ['Mon', '10:00', 7],
            ['Tue', '10:00', 3],
        ],
        1,
        0,
        2,
    );
    assert.equal(prepared.tooLarge, false);
    assert.equal(prepared.combinedRows, 1);
    assert.equal(prepared.cells.get(keyForLabels(prepared, '10:00', 'Mon')), 12);
    assert.equal(prepared.cells.get(keyForLabels(prepared, '10:00', 'Tue')), 3);
    assert.equal(prepared.maximum, 12);
});

test('Heatmap keeps returned NULL cells distinct from missing groups', () => {
    const prepared = prepareHeatmap([['Mon', '10:00', null]], 1, 0, 2);
    const key = keyForLabels(prepared, '10:00', 'Mon');
    assert.equal(prepared.present.has(key), true);
    assert.equal(prepared.cells.has(key), false);
});

test('Heatmap cell keys cannot collide on separator-like data', () => {
    assert.notEqual(heatmapCellKey('a\u0000b', 'c'), heatmapCellKey('a', 'b\u0000c'));
});

test('Heatmap category keys distinguish values with the same display label', () => {
    const prepared = prepareHeatmap(
        [
            [1, 'group', 4],
            ['1', 'group', 5],
        ],
        0,
        1,
        2,
    );
    assert.deepEqual(prepared.xLabels, ['1', '1']);
    assert.notEqual(prepared.xKeys[0], prepared.xKeys[1]);
    assert.equal(prepared.cells.get(heatmapCellKey(prepared.xKeys[0], prepared.yKeys[0])), 4);
    assert.equal(prepared.cells.get(heatmapCellKey(prepared.xKeys[1], prepared.yKeys[0])), 5);
});

test('Heatmap stops scanning once the rendered grid exceeds its cell budget', () => {
    const poison = [];
    Object.defineProperty(poison, 0, {
        get() {
            throw new Error('rows after the limit must not be inspected');
        },
    });
    const prepared = prepareHeatmap(
        [['x1', 'y1', 1], ['x2', 'y1', 1], ['x1', 'y2', 1], ['x3', 'y2', 1], poison],
        0,
        1,
        2,
        4,
    );
    assert.equal(prepared.tooLarge, true);
    assert.ok(prepared.xLabels.length * prepared.yLabels.length <= 4);
    assert.equal(prepared.processedRows, 3);
});

test('CSV export preserves numeric type handling, spreadsheet safety and structured values', () => {
    const columns = [
        { name: '=header', type: 'String' },
        { name: 'number', type: 'LowCardinality(Nullable(Int64))' },
        { name: 'price', type: 'Nullable(Decimal(10, 2))' },
        { name: 'text', type: 'Nullable(String)' },
        { name: 'payload', type: 'JSON' },
    ];
    const rows = [
        [' =SUM(A1)', '-42', '+3.50', 'say "hello",\nworld', { x: [1, 2] }],
        [null, null, '-7.25', '\t@cmd', [1, null]],
        ['-42', 7, 9, 'safe', null],
    ];
    const originalRows = structuredClone(rows);

    assert.equal(
        exportCsv({ columns, rows }),
        [
            "'=header,number,price,text,payload",
            '\' =SUM(A1),-42,+3.50,"say ""hello"",\nworld","{""x"":[1,2]}"',
            ',,-7.25,\'\t@cmd,"[1,null]"',
            "'-42,7,9,safe,",
        ].join('\r\n'),
    );
    assert.deepEqual(rows, originalRows);
});

test('CSV export treats cells beyond the declared columns as text', () => {
    assert.equal(
        exportCsv({
            columns: [{ name: 'metric', type: 'Nullable(UInt64)' }],
            rows: [['-2', '=1+1']],
        }),
        "metric\r\n-2,'=1+1",
    );
});

test('CSV export handles empty results without adding extra row breaks', () => {
    assert.equal(exportCsv({ columns: [], rows: [] }), '');
    assert.equal(exportCsv({ columns: [{ name: 'value', type: 'String' }], rows: [] }), 'value');
});

test('CSV export keeps quoting after commas and formula prefixes after whitespace', () => {
    assert.equal(
        exportCsv({
            columns: [
                { name: 'text', type: 'String' },
                { name: 'amount', type: 'Nullable(Int64)' },
            ],
            rows: [
                ['before, then "after"', '-42'],
                [' \t\r\n+cmd,"quoted"', '12'],
                ['simple', '1,2'],
            ],
        }),
        [
            'text,amount',
            '"before, then ""after""",-42',
            `"' \t\r\n+cmd,""quoted""",12`,
            'simple,"1,2"',
        ].join('\r\n'),
    );
});

test('CSV export matches original escaping across mixed punctuation', () => {
    const characters = [
        ' ',
        '\t',
        '\r',
        '\n',
        '=',
        '+',
        '-',
        '@',
        '"',
        ',',
        'x',
        '\u2028',
        '😀',
    ];
    let seed = 0x1234abcd;
    const next = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed;
    };
    const randomCell = length => {
        let cell = '';
        for (let index = 0; index < length; index++) {
            cell += characters[next() % characters.length];
        }
        return cell;
    };
    const rows = Array.from({ length: 1024 }, (_, index) => [
        randomCell(index % 36),
        randomCell(5 + (index % 23)),
    ]);
    const originalCell = (value, numeric) => {
        let cell = value;
        if (!numeric && /^[\t\r\n ]*[=+\-@]/.test(cell)) cell = "'" + cell;
        return /[",\r\n]/.test(cell) ? '"' + cell.replace(/"/g, '""') + '"' : cell;
    };
    const expected = [
        'text,number',
        ...rows.map(
            ([text, number]) => originalCell(text, false) + ',' + originalCell(number, true),
        ),
    ].join('\r\n');
    assert.equal(
        exportCsv({
            columns: [
                { name: 'text', type: 'String' },
                { name: 'number', type: 'Int64' },
            ],
            rows,
        }),
        expected,
    );
});

test('CSV export preserves protected large-cell previews', () => {
    const largeCell = {
        __clickstudioLargeCell: 'token',
        id: '123e4567-e89b-12d3-a456-426614174000',
        bytes: 128,
        serializedBytes: 128,
        fingerprint: 'a'.repeat(64),
        preview: ' =SUM("A1",B1)',
        valueType: 'text',
    };
    assert.equal(
        exportCsv({
            columns: [{ name: 'preview', type: 'String' }],
            rows: [[largeCell]],
            largeCellToken: 'token',
        }),
        `preview\r\n"' =SUM(""A1"",B1)"`,
    );
});

test('CSV export keeps long text fast without changing escaping', () => {
    const long = 'abc123'.repeat(512);
    const short = 'x'.repeat(32);
    const beyondCutoff = 'x'.repeat(33);
    const rows = [
        [long, '42'],
        [' \t=SUM(A1)' + long, '-3'],
        [long + ',"tail"\r\nnext', '7'],
        [short, '2'],
        [beyondCutoff, '3'],
    ];
    assert.equal(
        exportCsv({
            columns: [
                { name: 'text', type: 'String' },
                { name: 'number', type: 'Nullable(Int64)' },
            ],
            rows,
        }),
        [
            'text,number',
            long + ',42',
            "' \t=SUM(A1)" + long + ',-3',
            '"' + long + ',""tail""\r\nnext",7',
            short + ',2',
            beyondCutoff + ',3',
        ].join('\r\n'),
    );
});
