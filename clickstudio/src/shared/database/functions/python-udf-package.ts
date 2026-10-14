import { gzipSync, strToU8, zipSync } from 'fflate';
import {
    pythonCloudDefinition,
    pythonDraftSchema,
    type PythonFunctionDraft,
} from './python-functions.js';

function encodeAsset(bytes: Uint8Array): string {
    const compressed = gzipSync(bytes);
    let binary = '';
    for (let offset = 0; offset < compressed.length; offset += 32768)
        binary += String.fromCharCode(...compressed.subarray(offset, offset + 32768));
    return btoa(binary);
}

export function pythonAdapter(
    input: PythonFunctionDraft,
    embeddedAssets: Record<string, Uint8Array> = {},
): string {
    const draft = pythonDraftSchema.parse(input);
    const assets = Object.fromEntries(
        Object.entries(embeddedAssets).map(([name, bytes]) => [name, encodeAsset(bytes)]),
    );
    return `import base64
import contextlib
import gzip
import inspect
import json
import math
import re
import sys

SOURCE = ${JSON.stringify(draft.source)}
ARGUMENTS = json.loads(${JSON.stringify(JSON.stringify(draft.arguments))})
RETURN_TYPE = ${JSON.stringify(draft.returnType)}
ASSETS = json.loads(${JSON.stringify(JSON.stringify(assets))})

def read_asset(name):
    if name not in ASSETS:
        raise FileNotFoundError("Bundled asset is unavailable: " + name)
    return gzip.decompress(base64.b64decode(ASSETS[name], validate=True))

def scalar(value, kind, output=False):
    if kind == "String":
        if not isinstance(value, str):
            raise TypeError("Expected String")
        return value
    if kind == "Bool":
        if type(value) is bool:
            return value
        if not output and type(value) is int and value in (0, 1):
            return bool(value)
        raise TypeError("Expected Bool")
    if kind == "Float64":
        if type(value) not in (int, float) or not math.isfinite(value):
            raise TypeError("Expected finite Float64")
        return float(value)
    if not output and isinstance(value, str) and re.fullmatch(r"-?[0-9]+", value):
        value = int(value)
    if type(value) is not int:
        raise TypeError("Expected " + kind)
    bounds = {"Int32": (-(2**31), 2**31-1), "Int64": (-(2**63), 2**63-1), "UInt64": (0, 2**64-1)}
    low, high = bounds[kind]
    if not low <= value <= high:
        raise ValueError("Value outside " + kind + " range")
    return str(value) if output and kind in ("Int64", "UInt64") else value

def main():
    wire = sys.stdout
    namespace = {"__name__": "udf", "__file__": __file__, "read_asset": read_asset}
    with contextlib.redirect_stdout(sys.stderr):
        exec(compile(SOURCE, "user_function.py", "exec"), namespace)
        transform = namespace.get("transform")
        if not callable(transform):
            raise TypeError("Define a callable transform function")
        inspect.signature(transform).bind(*([None] * len(ARGUMENTS)))
    while True:
        header = sys.stdin.readline()
        if header == "":
            return
        if not re.fullmatch(r"[0-9]+\\n", header):
            raise ValueError("Invalid chunk header")
        count = int(header)
        for _ in range(count):
            line = sys.stdin.readline()
            if not line.endswith("\\n"):
                raise EOFError("Incomplete input row")
            row = json.loads(line)
            if not isinstance(row, dict) or set(row) != {arg["name"] for arg in ARGUMENTS}:
                raise ValueError("Input row does not match function signature")
            values = [scalar(row[arg["name"]], arg["type"]) for arg in ARGUMENTS]
            with contextlib.redirect_stdout(sys.stderr):
                result = scalar(transform(*values), RETURN_TYPE, output=True)
            wire.write(json.dumps({"result": result}, ensure_ascii=True, allow_nan=False) + "\\n")
        wire.flush()

if __name__ == "__main__":
    main()
`;
}

export function pythonFunctionXml(input: PythonFunctionDraft): string {
    const draft = pythonDraftSchema.parse(input);
    const arguments_ = draft.arguments
        .map(
            argument =>
                `    <argument><name>${argument.name}</name><type>${argument.type}</type></argument>`,
        )
        .join('\n');
    return `<clickhouse>\n  <function>\n    <name>${draft.name}</name>\n    <type>executable_pool</type>\n${arguments_}\n    <return_type>${draft.returnType}</return_type>\n    <return_name>result</return_name>\n    <format>JSONEachRow</format>\n    <command>python3 /var/lib/clickhouse/user_scripts/${draft.name}/main.py</command>\n    <execute_direct>0</execute_direct>\n    <send_chunk_header>1</send_chunk_header>\n    <pool_size>3</pool_size>\n    <max_command_execution_time>10</max_command_execution_time>\n  </function>\n</clickhouse>\n`;
}

export function pythonPackageFiles(
    input: PythonFunctionDraft,
    embeddedAssets: Record<string, Uint8Array> = {},
): Record<string, string> {
    const draft = pythonDraftSchema.parse(input);
    return {
        'main.py': pythonAdapter(draft, embeddedAssets),
        'function.json': JSON.stringify(pythonCloudDefinition(draft), null, 2) + '\n',
        'function.xml': pythonFunctionXml(draft),
        ...(draft.requirements.trim()
            ? { 'requirements.txt': draft.requirements.trim() + '\n' }
            : {}),
    };
}

export function pythonUdfZip(
    draft: PythonFunctionDraft,
    assets: Record<string, Uint8Array> = {},
    embeddedAssets: Record<string, Uint8Array> = {},
): Uint8Array<ArrayBuffer> {
    return zipSync({
        ...Object.fromEntries(
            Object.entries(pythonPackageFiles(draft, embeddedAssets)).map(([name, value]) => [
                name,
                strToU8(value),
            ]),
        ),
        ...assets,
    });
}

export const TOKENIZER_ASSET = 'o200k_base.tiktoken';
export const TOKENIZER_SHA256 = '446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d';
const tokenizerUrl = `https://openaipublic.blob.core.windows.net/encodings/${TOKENIZER_ASSET}`;
const tokenizerLicense = `MIT License

Copyright (c) 2022 OpenAI, Shantanu Jain

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
const hex = (value: ArrayBuffer) =>
    Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join('');

export async function pythonUdfArtifact(
    draft: PythonFunctionDraft,
    loadAsset: () => Promise<Uint8Array<ArrayBuffer>> = async () => {
        const response = await fetch(`/udf-assets/${TOKENIZER_ASSET}`, {
            signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error('The bundled tokenizer vocabulary is unavailable.');
        return new Uint8Array(await response.arrayBuffer());
    },
) {
    if (!/^tiktoken(?:[=<>!~\s]|$)/m.test(draft.requirements)) return pythonUdfZip(draft);
    const bytes = await loadAsset();
    if (
        bytes.length > 4_000_000 ||
        hex(await crypto.subtle.digest('SHA-256', bytes)) !== TOKENIZER_SHA256
    )
        throw new Error('Tokenizer vocabulary integrity check failed.');
    const cacheKey = hex(await crypto.subtle.digest('SHA-1', strToU8(tokenizerUrl)));
    return pythonUdfZip(
        draft,
        {
            [`tiktoken_cache/${cacheKey}`]: bytes,
            'tiktoken-LICENSE.txt': strToU8(tokenizerLicense),
        },
        { [TOKENIZER_ASSET]: bytes },
    );
}
