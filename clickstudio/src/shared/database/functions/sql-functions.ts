import { isRecord } from '../../common/values.js';
import { lexSql, quoteIdentifier, quoteStringLiteral } from '../../sql/sql.js';

export type SqlFunctionInput = { name: string; parameters: string[]; expression: string };
export type SqlFunction = { name: string; createQuery: string; parameters: string[] };
export type FunctionCatalog = {
    functions: SqlFunction[];
    canCreate: boolean;
    createReason: string;
};
export type FunctionArgument = { value: string; kind: 'json' | 'map' };

export const SQL_FUNCTION_TEMPLATES = [
    {
        name: 'udf_array_remove_at',
        label: 'Remove array item',
        description: 'Remove an item at a 1-based position, keeping the remaining items in order.',
        parameters: ['items', 'index'],
        expression:
            'arrayFilter((value, position) -> position != index, items, arrayEnumerate(items))',
        arguments: [
            { value: '[10, 20, 30, 40]', kind: 'json' },
            { value: '2', kind: 'json' },
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
            { value: '"b"', kind: 'json' },
        ],
    },
] satisfies Array<
    SqlFunctionInput & {
        label: string;
        description: string;
        arguments: FunctionArgument[];
    }
>;

const identifier = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

export function createSqlFunctionQuery(input: SqlFunctionInput): string {
    if (!identifier.test(input.name))
        throw new Error('Use a function name with letters, numbers and underscores.');
    if (
        !input.parameters.length ||
        input.parameters.length > 16 ||
        input.parameters.some(parameter => !identifier.test(parameter)) ||
        new Set(input.parameters).size !== input.parameters.length
    )
        throw new Error('Enter 1–16 unique parameter names, separated by commas.');
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
        typeof value.createReason === 'string'
    );
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
    if (argument.value.length > 8192) throw new Error('Keep each input under 8,192 characters.');
    const value: unknown = JSON.parse(argument.value);
    if (argument.kind === 'json') return literal(value);
    if (
        !Array.isArray(value) ||
        !value.length ||
        value.length > 100 ||
        !value.every(pair => Array.isArray(pair) && pair.length === 2)
    )
        throw new Error('Enter a map as [[key, value], …] with 1–100 entries.');
    return `map(${value.flatMap(pair => pair.map((item: unknown) => literal(item))).join(', ')})`;
}

export function testSqlFunctionQuery(fn: SqlFunction, arguments_: FunctionArgument[]): string {
    if (!fn.parameters.length || arguments_.length !== fn.parameters.length)
        throw new Error('Enter one input for every function parameter.');
    const call = `${quoteIdentifier(fn.name)}(${arguments_.map(functionArgumentSql).join(', ')})`;
    return `SELECT ${call} AS result, toJSONString(result) AS result_json;`;
}
