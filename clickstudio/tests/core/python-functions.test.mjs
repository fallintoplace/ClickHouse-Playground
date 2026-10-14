import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { readFile } from 'node:fs/promises';
import {
    PYTHON_FUNCTION_TEMPLATES,
    PYTHON_SCALAR_TYPES,
    pythonDraftSchema,
    pythonCloudDefinition,
    pythonArgumentSql,
    pythonSourceIssue,
    testPythonFunctionQuery,
} from '../../.core-build/src/shared/database/functions/python-functions.js';
import {
    pythonPackageFiles,
    pythonUdfZip,
    pythonUdfArtifact,
    pythonFunctionXml,
} from '../../.core-build/src/shared/database/functions/python-udf-package.js';

const draft = PYTHON_FUNCTION_TEMPLATES[1];

test('Python signatures accept only the six scalar types and distinct named arguments', () => {
    assert.deepEqual(PYTHON_SCALAR_TYPES, [
        'String',
        'Bool',
        'Int32',
        'Int64',
        'UInt64',
        'Float64',
    ]);
    for (const template of PYTHON_FUNCTION_TEMPLATES)
        assert.equal(pythonDraftSchema.safeParse(template).success, true);
    for (const patch of [
        { name: '_bad' },
        { name: '1bad' },
        { name: 'bad;DROP' },
        { name: 'x'.repeat(129) },
        { arguments: [] },
        { arguments: Array(17).fill({ name: 'x', type: 'String' }) },
        {
            arguments: [
                { name: 'x', type: 'Int64' },
                { name: 'x', type: 'String' },
            ],
        },
        { arguments: [{ name: '_x', type: 'String' }] },
        { arguments: [{ name: 'x', type: 'Nullable(String)' }] },
        { returnType: 'Array(String)' },
        { source: ' ' },
        { source: 'a'.repeat(128001) },
        { requirements: 'x'.repeat(16001) },
    ])
        assert.equal(pythonDraftSchema.safeParse({ ...draft, ...patch }).success, false);
});

test('Cloud definition and self-hosted XML agree with the generated chunk protocol', () => {
    const definition = pythonCloudDefinition(draft);
    assert.equal(definition.runtime, 'python3.11');
    assert.equal(definition.sendChunkHeader, true);
    assert.equal(definition.format, 'JSONEachRow');
    assert.equal(definition.returnName, 'result');
    assert.equal(definition.sandboxType, 'basic');
    assert.equal(definition.deterministic, false);
    assert.equal(definition.poolSize, 3);
    assert.equal(definition.maxCommandExecutionTime, 10);
    assert.match(
        pythonFunctionXml(draft),
        /<command>python3 \/var\/lib\/clickhouse\/user_scripts\/python_double\/main.py<\/command>/,
    );
    assert.match(pythonFunctionXml(draft), /<send_chunk_header>1<\/send_chunk_header>/);
    assert.throws(() => pythonFunctionXml({ ...draft, name: '</name>' }));
});

test('Python authoring catches syntax and transform signature errors without running Python', () => {
    for (const source of [
        'def transform(:',
        'def other(value):\n    return value',
        'async def transform(value):\n    return value',
        'def transform(other):\n    return other',
        'def transform(*value):\n    return 1',
    ])
        assert.notEqual(pythonSourceIssue({ ...draft, source }), '');
    assert.equal(pythonSourceIssue(draft), '');
    for (const source of [
        'fallback = 1\ndef transform(value=fallback):\n    return value',
        'def transform(value="*/"):\n    return value',
        'from functools import cache\n@cache\ndef transform(value: int):\n    return value',
    ])
        assert.equal(pythonSourceIssue({ ...draft, source }), '');
    assert.throws(
        () => pythonCloudDefinition({ ...draft, source: 'def other(value):\n    return value' }),
        /transform/,
    );
});

test('ZIP opens with main.py at the root and optional requirements, without management fields', () => {
    for (const requirements of ['', 'some-library==1.0\n']) {
        const files = unzipSync(pythonUdfZip({ ...draft, requirements }));
        assert.deepEqual(
            Object.keys(files).sort(),
            [
                'function.json',
                'function.xml',
                'main.py',
                ...(requirements ? ['requirements.txt'] : []),
            ].sort(),
        );
        assert.match(strFromU8(files['main.py']), /def main\(\):/);
        const definition = JSON.parse(strFromU8(files['function.json']));
        assert.equal(definition.functionName, draft.name);
        assert.equal('uploadId' in definition, false);
        assert.equal('keySecret' in definition, false);
        if (requirements) assert.equal(strFromU8(files['requirements.txt']), requirements);
    }
    assert.equal('requirements.txt' in pythonPackageFiles(draft), false);
});

test('Typed SQL inputs preserve full integer ranges and quote strings without SQL injection', () => {
    for (const [type, values] of [
        ['Int32', ['-2147483648', '2147483647']],
        ['Int64', ['-9223372036854775808', '9223372036854775807']],
        ['UInt64', ['0', '18446744073709551615']],
    ])
        for (const value of values)
            assert.equal(pythonArgumentSql(type, value), `CAST('${value}', '${type}')`);
    for (const [type, value] of [
        ['Int32', '2147483648'],
        ['Int64', '9223372036854775808'],
        ['UInt64', '-1'],
        ['UInt64', '18446744073709551616'],
        ['Int64', '1.0'],
        ['Float64', 'Infinity'],
        ['Float64', '0x10'],
        ['Float64', '0b10'],
        ['Float64', ' '],
        ['Bool', '1'],
    ])
        assert.throws(() => pythonArgumentSql(type, value));
    assert.equal(pythonArgumentSql('Bool', 'true'), "CAST('true', 'Bool')");
    assert.equal(pythonArgumentSql('Float64', '1.25e-2'), "CAST('1.25e-2', 'Float64')");
    assert.equal(
        pythonArgumentSql('String', "hello'\n\\world"),
        "CAST('hello\\'\n\\\\world', 'String')",
    );
    assert.match(
        testPythonFunctionQuery('python_double', [{ type: 'Int64', value: '21' }]),
        /`python_double`\(CAST\('21', 'Int64'\)\)/,
    );
    assert.match(
        testPythonFunctionQuery('_installed', [{ type: 'Int64', value: '21' }]),
        /`_installed`/,
    );
    assert.throws(() => testPythonFunctionQuery('valid', []));
    assert.throws(() => pythonArgumentSql('String', 'a'.repeat(8193)));
});

test('Token counter packages a verified offline vocabulary and rejects corrupt data', async () => {
    const template = PYTHON_FUNCTION_TEMPLATES[2];
    const files = unzipSync(
        await pythonUdfArtifact(
            template,
            async () => new Uint8Array(await readFile('public/udf-assets/o200k_base.tiktoken')),
        ),
    );
    assert.equal(Object.keys(files).filter(name => name.startsWith('tiktoken_cache/')).length, 1);
    assert.match(strFromU8(files['main.py']), /TIKTOKEN_CACHE_DIR/);
    assert.match(strFromU8(files['tiktoken-LICENSE.txt']), /MIT License/);
    await assert.rejects(
        pythonUdfArtifact(template, async () => new Uint8Array([1])),
        /integrity/,
    );
    const plain = await pythonUdfArtifact(draft, async () => {
        throw new Error('Unexpected asset load');
    });
    assert.ok(unzipSync(plain)['main.py']);
});
