import { isRecord } from '../../common/values.js';
import { lexSql, quoteIdentifier, quoteStringLiteral } from '../../sql/sql.js';

export type SqlFunctionInput = { name: string; parameters: string[]; expression: string };
export type SqlFunction = { name: string; createQuery: string; parameters: string[] };
export type SqlFunctionDropInput = { name: string; confirmation: string };
export type SqlFunctionDrop = { name: string };
export type FunctionCatalog = {
    functions: SqlFunction[];
    canCreate: boolean;
    createReason: string;
    canDrop: boolean;
    dropReason: string;
};
export const SQL_FUNCTION_ARGUMENT_OPTIONS = [
    { value: 'string', label: 'String' },
    { value: 'integer', label: 'Integer' },
    { value: 'float', label: 'Float' },
    { value: 'boolean', label: 'Boolean' },
    { value: 'array', label: 'Array' },
    { value: 'map', label: 'Map' },
    { value: 'null', label: 'Null' },
    { value: 'json', label: 'JSON (advanced)' },
] as const;
export type FunctionArgumentKind = (typeof SQL_FUNCTION_ARGUMENT_OPTIONS)[number]['value'];
export type FunctionArgument = {
    value: string;
    kind: FunctionArgumentKind;
    valueKind?: Exclude<FunctionArgumentKind, 'null'>;
};

export const SQL_FUNCTION_TEMPLATES = [
    {
        name: 'udf_array_remove_at',
        label: 'Remove array item',
        description: 'Remove an item at a 1-based position, keeping the remaining items in order.',
        parameters: ['items', 'index'],
        expression:
            'arrayFilter((value, position) -> position != index, items, arrayEnumerate(items))',
        arguments: [
            { value: '[10, 20, 30, 40]', kind: 'array' },
            { value: '2', kind: 'integer' },
        ],
    },
    {
        name: 'udf_map_remove',
        label: 'Remove map key',
        description: 'Remove every entry matching a key, keeping the other map entries.',
        parameters: ['entries', 'key'],
        expression: 'mapFilter((entry_key, value) -> entry_key != key, entries)',
        arguments: [
            { value: '[["a", 10], ["b", 20], ["c", 30]]', kind: 'map' },
            { value: 'b', kind: 'string' },
        ],
    },
] satisfies Array<
    SqlFunctionInput & {
        label: string;
        description: string;
        arguments: FunctionArgument[];
    }
>;

export const SQL_FUNCTION_CREATION_TEMPLATES = [
    ...SQL_FUNCTION_TEMPLATES.map(({ name, label, parameters, expression }) => ({
        name,
        label,
        parameters,
        expression,
    })),
    {
        name: 'udf_array_every_nth',
        label: 'Keep every Nth array item',
        parameters: ['items', 'step'],
        expression:
            'arrayFilter((item, position) -> position % step = 0, items, arrayEnumerate(items))',
    },
    {
        name: 'udf_round_significant',
        label: 'Round to significant digits',
        parameters: ['value', 'digits'],
        expression:
            'if(value = 0, value, round(value, toInt32(digits - 1 - floor(log10(abs(value))))))',
    },
    {
        name: 'udf_normalize_whitespace',
        label: 'Normalize whitespace',
        parameters: ['text'],
        expression: "trimBoth(replaceRegexpAll(text, '[[:space:]]+', ' '))",
    },
] satisfies Array<SqlFunctionInput & { label: string }>;

const identifier = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

export function sqlFunctionNameIssue(name: string): string {
    return identifier.test(name)
        ? ''
        : 'Use a function name with letters, numbers and underscores.';
}

export function createSqlFunctionQuery(input: SqlFunctionInput): string {
    const nameIssue = sqlFunctionNameIssue(input.name);
    if (nameIssue) throw new Error(nameIssue);
    if (
        !input.parameters.length ||
        input.parameters.length > 16 ||
        input.parameters.some(parameter => !identifier.test(parameter)) ||
        new Set(input.parameters).size !== input.parameters.length
    )
        throw new Error('Enter 1–16 unique parameter names.');
    const expression = input.expression.trim();
    if (!expression || expression.length > 8192)
        throw new Error('Enter an expression of up to 8,192 characters.');
    const tokens = lexSql(expression);
    if (!tokens.length || tokens.some(token => token.kind === 'symbol' && token.text === ';'))
        throw new Error('Enter one SQL expression without statement separators.');
    const terminator = /--[^\n]*$/.test(expression.slice(tokens.at(-1)!.to)) ? '\n;' : ';';
    return `CREATE FUNCTION ${quoteIdentifier(input.name)} AS (${input.parameters.map(quoteIdentifier).join(', ')}) -> ${expression}${terminator}`;
}

export function sqlFunctionParameters(createQuery: string): string[] {
    const match = /\bAS\s*(?:\(([^()]*)\)|(`?[A-Za-z_][A-Za-z0-9_]*`?))\s*->/i.exec(createQuery);
    if (!match) return [];
    const parameters = (match[1] ?? match[2]!)
        .split(',')
        .map(value => value.trim().replace(/^`(\w+)`$/, '$1'));
    return parameters.every(value => identifier.test(value)) ? parameters : [];
}

export function isSqlFunction(value: unknown): value is SqlFunction {
    return (
        isRecord(value) &&
        typeof value.name === 'string' &&
        typeof value.createQuery === 'string' &&
        Array.isArray(value.parameters) &&
        value.parameters.every(parameter => typeof parameter === 'string')
    );
}

export function isFunctionCatalog(value: unknown): value is FunctionCatalog {
    return (
        isRecord(value) &&
        Array.isArray(value.functions) &&
        value.functions.every(isSqlFunction) &&
        typeof value.canCreate === 'boolean' &&
        typeof value.createReason === 'string' &&
        typeof value.canDrop === 'boolean' &&
        typeof value.dropReason === 'string'
    );
}

export function isSqlFunctionDrop(value: unknown): value is SqlFunctionDrop {
    return isRecord(value) && typeof value.name === 'string';
}

function literal(value: unknown, depth = 0): string {
    if (depth > 4) throw new Error('Use inputs nested at most four levels deep.');
    if (value === null) return 'NULL';
    if (typeof value === 'string') return quoteStringLiteral(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        Math.abs(value) <= Number.MAX_SAFE_INTEGER
    )
        return String(value);
    if (Array.isArray(value) && value.length <= 100)
        return `[${value.map(item => literal(item, depth + 1)).join(', ')}]`;
    throw new Error(
        'Use JSON strings, safe numbers, booleans, null or arrays with up to 100 items.',
    );
}

export function functionArgumentSql(argument: FunctionArgument): string {
    if (argument.kind === 'null') return 'NULL';
    if (argument.value.length > 8192) throw new Error('Keep each input under 8,192 characters.');
    if (argument.kind === 'string') return quoteStringLiteral(argument.value);
    const input = argument.value.trim();
    if (argument.kind === 'integer') {
        if (!/^[+-]?\d+$/.test(input)) throw new Error('Enter a whole number, e.g. 42.');
        const value = BigInt(input);
        if (value < -(2n ** 63n) || value > 2n ** 64n - 1n)
            throw new Error(
                'Enter an integer between -9223372036854775808 and 18446744073709551615.',
            );
        return String(value);
    }
    if (argument.kind === 'float') {
        if (
            !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(input) ||
            !Number.isFinite(Number(input))
        )
            throw new Error('Enter a finite decimal number, e.g. 3.14 or 1e3.');
        return `CAST(${quoteStringLiteral(input)}, 'Float64')`;
    }
    if (argument.kind === 'boolean') {
        if (input !== 'true' && input !== 'false') throw new Error('Enter true or false.');
        return input;
    }
    if (!['json', 'array', 'map'].includes(argument.kind))
        throw new Error('Choose a supported input type.');
    let value: unknown;
    try {
        value = JSON.parse(argument.value);
    } catch {
        throw new Error('Enter valid JSON. Check quotes, commas, and brackets.');
    }
    if (argument.kind === 'json') return literal(value);
    if (argument.kind === 'array') {
        if (!Array.isArray(value)) throw new Error('Enter a JSON array, e.g. [1, 2, 3].');
        return literal(value);
    }
    if (
        !Array.isArray(value) ||
        !value.length ||
        value.length > 100 ||
        !value.every(pair => Array.isArray(pair) && pair.length === 2)
    )
        throw new Error('Enter a map as [[key, value], …] with 1–100 entries.');
    return `map(${value.flatMap(pair => pair.map((item: unknown) => literal(item))).join(', ')})`;
}

export function changeFunctionArgumentKind(
    argument: FunctionArgument,
    kind: FunctionArgumentKind,
): FunctionArgument {
    if (kind === 'null')
        return {
            value: argument.value,
            kind,
            valueKind: argument.kind === 'null' ? argument.valueKind : argument.kind,
        };
    const previousKind = argument.kind === 'null' ? argument.valueKind : argument.kind;
    let value = argument.value;
    if (previousKind === 'string' && kind === 'json') value = JSON.stringify(value);
    else if (previousKind === 'json' && kind === 'string') {
        try {
            const parsed: unknown = JSON.parse(value);
            if (typeof parsed === 'string') value = parsed;
        } catch {
            return { value, kind };
        }
    }
    return { value, kind };
}

export function testSqlFunctionQuery(fn: SqlFunction, arguments_: FunctionArgument[]): string {
    if (!fn.parameters.length || arguments_.length !== fn.parameters.length)
        throw new Error('Enter one input for every function parameter.');
    const call = `${quoteIdentifier(fn.name)}(${arguments_.map(functionArgumentSql).join(', ')})`;
    return `SELECT ${call} AS result, toJSONString(result) AS result_json;`;
}
