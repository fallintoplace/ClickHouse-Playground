import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { pythonAdapter } from '../../.core-build/src/shared/database/functions/python-udf-package.js';

const fixture = {
    name: 'fixture',
    arguments: [{ name: 'value', type: 'Int64' }],
    returnType: 'Int64',
    requirements: '',
    source: 'def transform(value):\n    return value * 2\n',
};
function run(input, patch = {}, embeddedAssets = {}) {
    return spawnSync(
        'python3',
        [
            '-c',
            '__file__ = "/scripts/main.py"\n' +
                pythonAdapter({ ...fixture, ...patch }, embeddedAssets),
        ],
        { input, encoding: 'utf8', timeout: 1500 },
    );
}
test('Embedded assets preserve arbitrary bytes without filesystem access', () => {
    const result = run(
        '2\n{"value":1}\n{"value":2}\n',
        {
            returnType: 'String',
            source: 'def transform(value):\n    return read_asset("data.bin").hex()\n',
        },
        { 'data.bin': new Uint8Array([0, 9, 10, 13, 34, 39, 92, 127, 128, 255]) },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split('\n').map(JSON.parse), [
        { result: '00090a0d22275c7f80ff' },
        { result: '00090a0d22275c7f80ff' },
    ]);
});
test('Missing embedded assets fail explicitly without trying a file path', () => {
    const result = run('1\n{"value":1}\n', {
        source: 'def transform(value):\n    return len(read_asset("missing.bin"))\n',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Bundled asset is unavailable: missing.bin/);
    assert.equal(result.stdout, '');
});
test('Adapter handles multiple chunks and 64-bit integers without precision loss', () => {
    const result = run('2\n{"value":"21"}\n{"value":-2}\n0\n1\n{"value":"4611686018427387903"}\n');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split('\n').map(JSON.parse), [
        { result: '42' },
        { result: '-4' },
        { result: '9223372036854775806' },
    ]);
});
test('Adapter preserves escaping, Unicode, multiline text and user diagnostics', () => {
    const value = 'こんにちは 🐍 "quote"\nline\ttab\\path\u0000';
    const result = run(`1\n${JSON.stringify({ value })}\n`, {
        arguments: [{ name: 'value', type: 'String' }],
        returnType: 'String',
        source: 'print("startup")\ndef transform(value):\n    print("diagnostic")\n    return value\n',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { result: value });
    assert.match(result.stderr, /startup\ndiagnostic/);
});
for (const [type, value] of [
    ['String', 'hello'],
    ['Bool', true],
    ['Bool', false],
    ['Int32', -2147483648],
    ['Int64', '-9223372036854775808'],
    ['UInt64', '18446744073709551615'],
    ['Float64', 1.25],
]) {
    test(`Adapter validates ${type} scalar round trips`, () => {
        const result = run(`1\n${JSON.stringify({ value })}\n`, {
            arguments: [{ name: 'value', type }],
            returnType: type,
            source: 'def transform(value):\n    return value\n',
        });
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(JSON.parse(result.stdout), { result: value });
    });
}
for (const input of [
    'bad\n',
    '-1\n',
    '1\n',
    '1\n{"value":1}',
    '1\nnot-json\n',
    '1\n{}\n',
    '1\n{"value":true}\n',
    '1\n{"value":1.5}\n',
    '1\n{"value":"9223372036854775808"}\n',
    '1\n{"value":null}\n',
]) {
    test(`Adapter fails malformed or incompatible input ${JSON.stringify(input)}`, () =>
        assert.notEqual(run(input).status, 0));
}
for (const expression of ['None', 'True', '1.5', '2**63', '"42"']) {
    test(`Adapter rejects invalid Int64 return ${expression}`, () => {
        const result = run('1\n{"value":1}\n', {
            source: `def transform(value):\n    return ${expression}\n`,
        });
        assert.notEqual(result.status, 0);
        assert.equal(result.stdout, '');
    });
}
test('Exceptions and non-finite floats fail without fabricated output', () => {
    for (const source of [
        'def transform(value):\n    raise ValueError("fixture failure")\n',
        'def transform(value):\n    return float("nan")\n',
    ]) {
        const result = run('1\n{"value":1}\n', { source, returnType: 'Float64' });
        assert.notEqual(result.status, 0);
        assert.equal(result.stdout, '');
    }
});
test('Missing transform and incompatible arity fail before processing rows', () => {
    for (const source of ['value = 1', 'def transform(a, b):\n    return a\n'])
        assert.notEqual(run('', { source }).status, 0);
});
test('A long-lived worker flushes each chunk before EOF and accepts split pipe writes', async t => {
    const child = spawn('python3', ['-c', '__file__ = "main.py"\n' + pythonAdapter(fixture)], {
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    t.after(() => {
        child.kill();
    });
    const errors = [];
    child.stderr.on('data', data => errors.push(data.toString()));
    const closed = once(child, 'close');
    const first = once(child.stdout, 'data');
    child.stdin.write('1\n{"val');
    child.stdin.write('ue":"21"}\n');
    assert.match(String((await first)[0]), /42/);
    const second = once(child.stdout, 'data');
    child.stdin.write('1\n{"value":"22"}\n');
    assert.match(String((await second)[0]), /44/);
    child.stdin.end();
    assert.equal((await closed)[0], 0, errors.join(''));
});
test('Known hanging fixture is terminated by the test harness', () => {
    const result = run('1\n{"value":1}\n', {
        source: 'def transform(value):\n    while True:\n        pass\n',
    });
    assert.equal(result.error?.code, 'ETIMEDOUT');
    assert.equal(result.stdout, '');
});
