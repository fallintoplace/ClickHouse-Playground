import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { PYTHON_FUNCTION_TEMPLATES } from '../../.core-build/src/shared/database/functions/python-functions.js';

function run(template, cases) {
    const source = `${template.source}
import json, sys

results = []
for arguments in json.load(sys.stdin):
    try:
        results.append(transform(*arguments))
    except Exception as error:
        results.append(type(error).__name__)
print(json.dumps(results))
`;
    const result = spawnSync('python3', ['-c', source], {
        input: JSON.stringify(cases),
        encoding: 'utf8',
        timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
}

function hasPythonModule(name) {
    return spawnSync('python3', ['-c', `import ${name}`], { encoding: 'utf8' }).status === 0;
}

test('Semantic version template follows core, prerelease, and build metadata precedence', () => {
    const template = PYTHON_FUNCTION_TEMPLATES.find(item => item.name === 'py_semver_compare');
    assert.ok(template);
    assert.deepEqual(
        run(template, [
            ['1.0.0-alpha.1', '1.0.0-alpha.beta'],
            ['1.0.0-alpha', '1.0.0-alpha.1'],
            ['1.0.0-beta.2', '1.0.0-beta.11'],
            ['1.0.0-rc.1', '1.0.0'],
            ['1.0.0+build.1', '1.0.0+build.2'],
            ['2.0.0', '1.99.99'],
            ['1.0.0-01', '1.0.0'],
            ['01.0.0', '1.0.0'],
            [`${'9'.repeat(5000)}.0.0`, `${'8'.repeat(5000)}.0.0`],
        ]),
        [-1, -1, -1, -1, 0, 1, 'ValueError', 'ValueError', 1],
    );
});

test('Email domain template handles display names, IDNs, and malformed addresses', () => {
    const template = PYTHON_FUNCTION_TEMPLATES.find(item => item.name === 'py_email_domain');
    assert.ok(template);
    assert.deepEqual(
        run(template, [
            ['Ada Lovelace <ada@Example.COM>'],
            ['ada@bücher.de'],
            ['not-an-email'],
            ['@example.com'],
            ['ada@'],
            [''],
        ]),
        ['example.com', 'xn--bcher-kva.de', '', '', '', ''],
    );
});

test('Python templates that need packages declare them in requirements', () => {
    assert.equal(
        PYTHON_FUNCTION_TEMPLATES.find(item => item.name === 'py_grapheme_count')?.requirements,
        'regex==2026.9.29\n',
    );
    assert.equal(
        PYTHON_FUNCTION_TEMPLATES.find(item => item.name === 'py_phone_to_e164')?.requirements,
        'phonenumbers==9.0.41\n',
    );
});

test('Unicode grapheme count handles combining marks, flags, and joined emoji', t => {
    if (!hasPythonModule('regex')) {
        t.skip('regex is installed from the template requirements');
        return;
    }
    const template = PYTHON_FUNCTION_TEMPLATES.find(item => item.name === 'py_grapheme_count');
    assert.ok(template);
    assert.deepEqual(
        run(template, [[''], ['abc'], ['e\u0301'], ['🇵🇱'], ['👍🏽'], ['👩‍👩‍👧‍👦']]),
        [0, 3, 1, 1, 1, 1],
    );
});

test('Phone formatter handles international input and invalid values', t => {
    if (!hasPythonModule('phonenumbers')) {
        t.skip('phonenumbers is installed from the template requirements');
        return;
    }
    const template = PYTHON_FUNCTION_TEMPLATES.find(item => item.name === 'py_phone_to_e164');
    assert.ok(template);
    assert.deepEqual(
        run(template, [
            ['+1 650-253-0000', 'us'],
            ['020 7031 3000', 'gb'],
            ['not a phone', 'US'],
            ['', ''],
        ]),
        ['+16502530000', '+442070313000', '', ''],
    );
});
