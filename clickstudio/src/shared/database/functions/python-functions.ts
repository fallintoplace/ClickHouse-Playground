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
        label: 'String similarity',
        name: 'py_similarity',
        arguments: [
            { name: 'a', type: 'String' },
            { name: 'b', type: 'String' },
        ],
        returnType: 'Float64',
        requirements: '',
        source: 'from difflib import SequenceMatcher\n\ndef transform(a, b):\n    return SequenceMatcher(None, a, b).ratio()\n',
    },
    {
        label: 'Double',
        name: 'python_double',
        arguments: [{ name: 'value', type: 'Int64' }],
        returnType: 'Int64',
        requirements: '',
        source: 'def transform(value):\n    return value * 2\n',
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
        label: 'Normalize text',
        name: 'py_normalize_text',
        arguments: [{ name: 'text', type: 'String' }],
        returnType: 'String',
        requirements: '',
        source: 'def transform(text):\n    return text.strip().casefold()\n',
    },
    {
        label: 'Word count',
        name: 'py_word_count',
        arguments: [{ name: 'text', type: 'String' }],
        returnType: 'UInt64',
        requirements: '',
        source: 'def transform(text):\n    return len(text.split())\n',
    },
    {
        label: 'Round number',
        name: 'py_round_number',
        arguments: [
            { name: 'value', type: 'Float64' },
            { name: 'digits', type: 'Int32' },
        ],
        returnType: 'Float64',
        requirements: '',
        source: 'def transform(value, digits):\n    return round(value, digits)\n',
    },
    {
        label: 'ISO weekday',
        name: 'py_iso_weekday',
        arguments: [{ name: 'date_text', type: 'String' }],
        returnType: 'Int32',
        requirements: '',
        source: 'from datetime import date\n\ndef transform(date_text):\n    return date.fromisoformat(date_text).isoweekday()\n',
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
