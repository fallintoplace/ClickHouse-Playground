import { useId, useState } from 'react';
import {
    SQL_FUNCTION_ARGUMENT_OPTIONS,
    SQL_FUNCTION_TEMPLATES,
    changeFunctionArgumentKind,
    type FunctionArgument,
    type FunctionArgumentKind,
    type SqlFunction,
} from '../../../shared/database/functions/sql-functions';
import { PYTHON_SCALAR_TYPES } from '../../../shared/database/functions/python-functions';
import { SelectControl } from '../../ui/components/SelectControl';

const inputHints: Record<FunctionArgumentKind, string> = {
    string: 'Plain text; quotes are not needed.',
    integer: 'Whole number, e.g. 42.',
    float: 'Decimal number, e.g. 3.14 or 1e3.',
    boolean: 'true or false.',
    array: 'JSON array, e.g. [1, 2, 3] or ["a", "b"].',
    map: 'Key / value pairs: [[key, value], …].',
    null: 'No value is needed.',
    json: 'JSON value: "text", 42, [1, 2, 3], true or null.',
};

function FunctionInputType({
    parameter,
    index,
    argument,
    type,
    onChange,
    onTypeChange,
}: {
    parameter: string;
    index: number;
    argument: FunctionArgument;
    type?: string;
    onChange: (index: number, argument: FunctionArgument) => void;
    onTypeChange?: (index: number, type: string) => void;
}) {
    if (type !== undefined && !onTypeChange)
        return (
            <code className="sql-function-argument-type" title={type}>
                {type}
            </code>
        );
    return (
        <SelectControl
            className="select-control-field sql-function-type-control"
            label={
                type === undefined ? `${parameter} input type` : `Test argument ${index + 1} type`
            }
            value={type ?? argument.kind}
            options={
                type === undefined
                    ? SQL_FUNCTION_ARGUMENT_OPTIONS.map(option => option)
                    : PYTHON_SCALAR_TYPES.map(type => ({ value: type, label: type }))
            }
            onChange={value => {
                if (type === undefined) {
                    const option = SQL_FUNCTION_ARGUMENT_OPTIONS.find(
                        option => option.value === value,
                    );
                    if (option) onChange(index, changeFunctionArgumentKind(argument, option.value));
                } else onTypeChange?.(index, value);
            }}
        />
    );
}

export function FunctionInputs({
    parameters,
    arguments_,
    onChange,
    types,
    onTypeChange,
}: {
    parameters: string[];
    arguments_: FunctionArgument[];
    onChange: (index: number, argument: FunctionArgument) => void;
    types?: string[];
    onTypeChange?: (index: number, type: string) => void;
}) {
    const id = useId();
    return (
        <>
            {parameters.map((parameter, index) => {
                const argument = arguments_[index]!;
                const describedBy = types ? undefined : `${id}-input-hint-${index}`;
                const isNull = !types && argument.kind === 'null';
                return (
                    <div key={`${index}:${parameter}`} className="sql-function-argument">
                        <label htmlFor={`${id}-argument-${index}`}>{parameter}</label>
                        <FunctionInputType
                            parameter={parameter}
                            index={index}
                            argument={argument}
                            type={types?.[index]}
                            onChange={onChange}
                            onTypeChange={onTypeChange}
                        />
                        <textarea
                            id={`${id}-argument-${index}`}
                            aria-describedby={describedBy}
                            rows={isNull ? 1 : Math.min(6, argument.value.split('\n').length)}
                            spellCheck={false}
                            disabled={isNull}
                            value={isNull ? 'NULL' : argument.value}
                            onChange={event =>
                                onChange(index, { ...argument, value: event.target.value })
                            }
                        />
                        {!types && (
                            <small id={describedBy} className="sql-function-input-hint">
                                {inputHints[argument.kind]}
                            </small>
                        )}
                    </div>
                );
            })}
        </>
    );
}

function defaultFunctionArgument(type?: string): FunctionArgument {
    if (type === undefined) return { value: '', kind: 'string' };
    let value = '0';
    if (type === 'String') value = '';
    else if (type === 'Bool') value = 'false';
    return { value, kind: 'json' };
}

function initialFunctionArguments(fn: SqlFunction, types?: string[]): FunctionArgument[] {
    const template = types
        ? undefined
        : SQL_FUNCTION_TEMPLATES.find(
              template =>
                  template.name === fn.name &&
                  template.parameters.length === fn.parameters.length &&
                  template.parameters.every(
                      (parameter, index) => parameter === fn.parameters[index],
                  ),
          );
    return fn.parameters.map(
        (_, index) => template?.arguments[index] ?? defaultFunctionArgument(types?.[index]),
    );
}

export function useFunctionArguments(fn: SqlFunction, types?: string[]) {
    const signature = JSON.stringify([fn.name, fn.parameters, types]);
    const [state, setState] = useState(() => ({
        signature,
        name: fn.name,
        parameters: fn.parameters,
        values: initialFunctionArguments(fn, types),
    }));
    const initial = initialFunctionArguments(fn, types);
    const values =
        state.signature === signature
            ? state.values
            : initial.map((value, index) => {
                  if (state.name !== fn.name) return value;
                  const name = fn.parameters[index];
                  const occurrence = fn.parameters
                      .slice(0, index)
                      .filter(parameter => parameter === name).length;
                  const matches = state.parameters.flatMap((parameter, at) =>
                      parameter === name ? [at] : [],
                  );
                  return state.values[matches[occurrence] ?? -1] ?? value;
              });
    if (state.signature !== signature)
        setState({ signature, name: fn.name, parameters: fn.parameters, values });
    return {
        signature,
        values,
        change: (index: number, next: FunctionArgument) =>
            setState({
                signature,
                name: fn.name,
                parameters: fn.parameters,
                values: values.map((argument, at) => (at === index ? next : argument)),
            }),
    };
}
