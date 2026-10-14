import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { unzipSync } from 'fflate';
import { PYTHON_FUNCTION_TEMPLATES } from '../../.core-build/src/shared/database/functions/python-functions.js';
import { pythonUdfArtifact } from '../../.core-build/src/shared/database/functions/python-udf-package.js';

test('Token counter works with only main.py present and runtime vocabulary downloads disabled', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'tokenizer-main-only-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const vocabulary = new Uint8Array(await readFile('public/udf-assets/o200k_base.tiktoken'));
    const files = unzipSync(
        await pythonUdfArtifact(PYTHON_FUNCTION_TEMPLATES[2], async () => vocabulary),
    );
    const script = join(directory, 'scripts', 'main.py');
    const cache = join(directory, 'reference-cache');
    await mkdir(join(directory, 'scripts'));
    await mkdir(cache);
    await writeFile(script, files['main.py']);
    await writeFile(join(cache, 'fb374d419588a4632f3f557e76b4b70aebbca790'), vocabulary);
    const wrapper = `import io, json, os, runpy, socket, sys
import tiktoken
import tiktoken.load

os.environ["TIKTOKEN_CACHE_DIR"] = sys.argv[2]
reference = tiktoken.get_encoding("o200k_base")
texts = ["", "Hello world", "Xin chào, hôm nay bạn thế nào?", "你好，世界！", "👋🌍🚀", "<|endoftext|>", "<|endofprompt|>", "line\\n\\ttab\\\\path\\x00", "cafe\\u0301", "We're testing 12345!", " " * 1000]
rows = [{"text": text} for text in texts]
expected = [len(reference.encode_ordinary(row["text"])) for row in rows]

def forbidden(*args, **kwargs):
    raise AssertionError("Runtime attempted a vocabulary download or cache lookup")

tiktoken.get_encoding = forbidden
tiktoken.encoding_for_model = forbidden
tiktoken.load.read_file_cached = forbidden
socket.socket.connect = forbidden
output = io.StringIO()
sys.stdout = output
sys.stdin = io.StringIO(str(len(rows)) + "\\n" + "".join(json.dumps(row) + "\\n" for row in rows))
runpy.run_path(sys.argv[1], run_name="__main__")
actual = [int(json.loads(line)["result"]) for line in output.getvalue().splitlines()]
assert actual == expected, (actual, expected)
sys.stdout = sys.__stdout__
print(json.dumps({"cases": len(rows), "hello_world": actual[1]}))
`;
    const result = spawnSync('python3', ['-c', wrapper, script, cache], {
        cwd: directory,
        encoding: 'utf8',
        timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { cases: 11, hello_world: 2 });
    assert.equal(result.stderr, '');
});

test('Existing cache-based authored sources still run offline when the ZIP is extracted', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'tokenizer-legacy-cache-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const template = {
        ...PYTHON_FUNCTION_TEMPLATES[2],
        source: 'import os\nfrom pathlib import Path\nimport tiktoken\n\nos.environ["TIKTOKEN_CACHE_DIR"] = str(Path(__file__).parent / "tiktoken_cache")\n\ndef transform(text):\n    return len(tiktoken.get_encoding("o200k_base").encode_ordinary(text))\n',
    };
    const files = unzipSync(
        await pythonUdfArtifact(
            template,
            async () => new Uint8Array(await readFile('public/udf-assets/o200k_base.tiktoken')),
        ),
    );
    for (const [name, bytes] of Object.entries(files)) {
        const path = join(directory, name);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, bytes);
    }
    const wrapper = `import runpy, socket, sys
import tiktoken.load

def forbidden(*args, **kwargs):
    raise AssertionError("Runtime attempted a vocabulary download")

tiktoken.load.read_file = forbidden
socket.socket.connect = forbidden
runpy.run_path(sys.argv[1], run_name="__main__")
`;
    const result = spawnSync('python3', ['-c', wrapper, join(directory, 'main.py')], {
        input: '1\n{"text":"Hello world"}\n',
        cwd: directory,
        encoding: 'utf8',
        timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { result: '2' });
    assert.equal(result.stderr, '');
});
