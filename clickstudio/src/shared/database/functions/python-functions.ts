import { z } from 'zod';
import { parser as pythonParser } from '@lezer/python';
import { quoteIdentifier, quoteStringLiteral } from '../../sql/sql.js';
import { TOKENIZER_SOURCE } from './python-tokenizer.js';

export const PYTHON_SCALAR_TYPES = [
    'String',
    'Bool',
    'Int32',
    'Int64',
    'UInt64',
    'Float64',
] as const;
export const pythonScalarSchema = z.enum(PYTHON_SCALAR_TYPES);
export type PythonScalar = z.infer<typeof pythonScalarSchema>;
const nameSchema = z
    .string()
    .regex(
        /^[A-Za-z][A-Za-z0-9_]{0,127}$/,
        'Use a letter first, then letters, numbers or underscores.',
    );
export const pythonArgumentSchema = z.object({ name: nameSchema, type: pythonScalarSchema });
export const pythonDraftSchema = z
    .object({
        name: nameSchema,
        arguments: z.array(pythonArgumentSchema).min(1).max(16),
        returnType: pythonScalarSchema,
        source: z.string().trim().min(1).max(128_000),
        requirements: z.string().max(16_000),
    })
    .refine(
        value =>
            new Set(value.arguments.map(argument => argument.name)).size === value.arguments.length,
        'Argument names must be unique.',
    );
export type PythonFunctionDraft = z.infer<typeof pythonDraftSchema>;
export function pythonSourceIssue(draft: PythonFunctionDraft): string {
    const tree = pythonParser.parse(draft.source);
    let invalid = false;
    tree.iterate({
        enter(node) {
            if (node.type.isError) invalid = true;
        },
    });
    if (invalid) return 'Fix the Python syntax before packaging.';
    const definitions = [
        ...tree.topNode.getChildren('FunctionDefinition'),
        ...tree.topNode
            .getChildren('DecoratedStatement')
            .flatMap(node => node.getChildren('FunctionDefinition')),
    ];
    const definition = definitions.find(node => {
        const name = node.getChild('VariableName');
        return name && draft.source.slice(name.from, name.to) === 'transform';
    });
    if (!definition || definition.getChild('async'))
        return 'Define a synchronous top-level transform function.';
    const parameters = definition.getChild('ParamList');
    const names: string[] = [];
    let start = false;
    let variadic = false;
    for (let node = parameters?.firstChild; node; node = node.nextSibling) {
        if (node.name === '(' || node.name === ',') start = true;
        else if (node.name === '*' || node.name === '**') variadic = true;
        else if (start && node.name === 'VariableName') {
            names.push(draft.source.slice(node.from, node.to));
            start = false;
        }
    }
    if (
        names.length !== draft.arguments.length ||
        names.some((name, index) => name !== draft.arguments[index]?.name) ||
        variadic
    )
        return 'transform parameters must match the argument names and order.';
    return '';
}
export const executableArgumentSchema = z.object({ name: z.string(), type: z.string().min(1) });
export const executableFunctionSchema = z.object({
    name: z.string(),
    createQuery: z.string(),
    arguments: z.array(executableArgumentSchema).optional(),
    returnType: z.string().optional(),
});
export type ExecutableFunction = z.infer<typeof executableFunctionSchema>;
export const executableCatalogSchema = z.object({ functions: z.array(executableFunctionSchema) });

export const PYTHON_FUNCTION_TEMPLATES = [
    {
        label: 'Count Unicode graphemes',
        name: 'py_grapheme_count',
        arguments: [{ name: 'text', type: 'String' }],
        returnType: 'UInt64',
        requirements: 'regex==2026.9.29\n',
        source: 'import regex\n\ndef transform(text):\n    return len(regex.findall(r"\\X", text))\n',
    },
    {
        label: 'Compare semantic versions',
        name: 'py_semver_compare',
        arguments: [
            { name: 'left', type: 'String' },
            { name: 'right', type: 'String' },
        ],
        returnType: 'Int32',
        requirements: '',
        source: String.raw`import re

_VERSION = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)

def _parse(version):
    match = _VERSION.fullmatch(version)
    if match is None:
        raise ValueError("Invalid semantic version")
    core = match.group(1, 2, 3)
    prerelease = match.group(4)
    identifiers = prerelease.split(".") if prerelease else None
    if identifiers and any(
        part.isdigit() and len(part) > 1 and part.startswith("0")
        for part in identifiers
    ):
        raise ValueError("Numeric prerelease identifiers cannot have leading zeroes")
    return core, identifiers

def _compare_numeric(left, right):
    if len(left) != len(right):
        return 1 if len(left) > len(right) else -1
    return (left > right) - (left < right)

def _compare_identifier(left, right):
    if left == right:
        return 0
    if left.isdigit() and right.isdigit():
        return _compare_numeric(left, right)
    if left.isdigit():
        return -1
    if right.isdigit():
        return 1
    return (left > right) - (left < right)

def transform(left, right):
    left_core, left_pre = _parse(left)
    right_core, right_pre = _parse(right)
    for left_part, right_part in zip(left_core, right_core):
        result = _compare_numeric(left_part, right_part)
        if result:
            return result
    if left_pre is None or right_pre is None:
        return 0 if left_pre is right_pre else (1 if left_pre is None else -1)
    for left_part, right_part in zip(left_pre, right_pre):
        result = _compare_identifier(left_part, right_part)
        if result:
            return result
    return (len(left_pre) > len(right_pre)) - (len(left_pre) < len(right_pre))
`,
    },
    {
        label: 'LLM token count',
        name: 'count_tokens',
        arguments: [{ name: 'text', type: 'String' }],
        returnType: 'UInt64',
        requirements: 'tiktoken==0.14.0\n',
        source: TOKENIZER_SOURCE,
    },
    {
        label: 'Format phone number as E.164',
        name: 'py_phone_to_e164',
        arguments: [
            { name: 'phone', type: 'String' },
            { name: 'region', type: 'String' },
        ],
        returnType: 'String',
        requirements: 'phonenumbers==9.0.41\n',
        source: 'import phonenumbers\n\ndef transform(phone, region):\n    try:\n        parsed = phonenumbers.parse(phone.strip(), region.strip().upper())\n    except phonenumbers.NumberParseException:\n        return ""\n    if not phonenumbers.is_valid_number(parsed):\n        return ""\n    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)\n',
    },
    {
        label: 'Extract email domain',
        name: 'py_email_domain',
        arguments: [{ name: 'address', type: 'String' }],
        returnType: 'String',
        requirements: '',
        source: 'from email.utils import parseaddr\n\ndef transform(address):\n    _, parsed = parseaddr(address)\n    local, separator, domain = parsed.rpartition("@")\n    if not separator or not local or not domain:\n        return ""\n    try:\n        return domain.encode("idna").decode("ascii").lower()\n    except UnicodeError:\n        return ""\n',
    },
] satisfies Array<PythonFunctionDraft & { label: string }>;

export const PYTHON_FUNCTION_CUSTOM_DRAFT: PythonFunctionDraft = {
    name: '',
    arguments: [{ name: 'value', type: 'String' }],
    returnType: 'String',
    requirements: '',
    source: 'def transform(value):\n    return value\n',
};

export function pythonCloudDefinition(draft: PythonFunctionDraft) {
    const value = pythonDraftSchema.parse(draft);
    const issue = pythonSourceIssue(value);
    if (issue) throw new Error(issue);
    return {
        functionName: value.name,
        arguments: value.arguments,
        returnType: value.returnType,
        returnName: 'result',
        runtime: 'python3.11',
        type: 'executable_pool',
        format: 'JSONEachRow',
        sendChunkHeader: true,
        poolSize: 3,
        maxCommandExecutionTime: 10,
        commandReadTimeout: 10000,
        commandWriteTimeout: 10000,
        sandboxType: 'basic',
        deterministic: false,
    } as const;
}

export function pythonArgumentSql(type: PythonScalar, value: string): string {
    pythonScalarSchema.parse(type);
    if (value.length > 8192) throw new Error('Keep each input under 8,192 characters.');
    if (type === 'String') return `CAST(${quoteStringLiteral(value)}, 'String')`;
    value = value.trim();
    if (type === 'Bool') {
        if (!['true', 'false'].includes(value)) throw new Error('Enter true or false.');
    } else if (type === 'Float64') {
        if (
            !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) ||
            !Number.isFinite(Number(value))
        )
            throw new Error('Enter a finite number.');
    } else {
        if (!/^-?\d+$/.test(value)) throw new Error(`Enter a whole number for ${type}.`);
        const integer = BigInt(value);
        const minimum = type === 'UInt64' ? 0n : -(2n ** (type === 'Int32' ? 31n : 63n));
        const maximum =
            type === 'Int32' ? 2n ** 31n - 1n : 2n ** 64n / (type === 'Int64' ? 2n : 1n) - 1n;
        if (integer < minimum || integer > maximum)
            throw new Error(`Input is outside ${type} range.`);
    }
    return `CAST(${quoteStringLiteral(value)}, '${type}')`;
}

export function testPythonFunctionQuery(
    name: string,
    arguments_: Array<{ type: string; value: string }>,
) {
    z.string().min(1).max(1024).parse(name);
    if (arguments_.length > 16) throw new Error('Enter at most 16 arguments.');
    const inputs = arguments_.map(argument => {
        const type = pythonScalarSchema.safeParse(argument.type);
        if (!type.success)
            throw new Error(
                `The tester does not support ${argument.type}. Call this function in the SQL editor.`,
            );
        return pythonArgumentSql(type.data, argument.value);
    });
    return `SELECT ${quoteIdentifier(name)}(${inputs.join(', ')}) AS result, toJSONString(result) AS result_json;`;
}

export const managedVersionSchema = z.object({
    name: z.string(),
    version: z.number().int().positive(),
    status: z.enum(['building', 'error', 'ready']),
    error: z.string().nullable(),
    arguments: z.array(z.object({ name: z.string(), type: z.string() })),
    returnType: z.string(),
});
export type ManagedPythonVersion = z.infer<typeof managedVersionSchema>;
export const pythonDeploymentSchema = z.object({
    attemptId: z.string().optional(),
    uploadId: z.string().optional(),
    name: z.string(),
    serviceId: z.string(),
    serviceName: z.string(),
    phase: z.enum(['published', 'unknown', 'attached', 'checked', 'failed']),
    version: z.number().int().positive().optional(),
    message: z.string(),
});
export type PythonDeployment = z.infer<typeof pythonDeploymentSchema>;
export const pythonCapabilitySchema = z.object({
    available: z.boolean(),
    reason: z.string(),
    serviceId: z.string().optional(),
    serviceName: z.string().optional(),
});
export const pythonStatusSchema = z.object({
    versions: z.array(managedVersionSchema),
    attachment: z.object({ version: z.number().int().positive(), status: z.string() }).optional(),
    operation: pythonDeploymentSchema.optional(),
});
