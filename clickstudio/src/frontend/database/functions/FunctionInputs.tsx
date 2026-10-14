import { useId, useState } from 'react';
import {
    SQL_FUNCTION_TEMPLATES,
    type FunctionArgument,
    type SqlFunction,
} from '../../../shared/database/functions/sql-functions';
import { PYTHON_SCALAR_TYPES } from '../../../shared/database/functions/python-functions';
import { SelectControl } from '../../ui/components/SelectControl';

function FunctionInputFormat({
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
                type === undefined ? `${parameter} input format` : `Test argument ${index + 1} type`
            }
            value={type ?? argument.kind}
            options={
                type === undefined
                    ? [
                          { value: 'json', label: 'JSON' },
                          { value: 'map', label: 'Map entries' },
                      ]
                    : PYTHON_SCALAR_TYPES.map(type => ({ value: type, label: type }))
            }
            onChange={value => {
                if (type === undefined)
                    onChange(index, { ...argument, kind: value === 'map' ? 'map' : 'json' });
                else onTypeChange?.(index, value);
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
                let describedBy;
                if (!types)
                    describedBy =
                        argument.kind === 'map' ? `${id}-map-hint-${index}` : `${id}-input-hint`;
                return (
                    <div key={`${index}:${parameter}`} className="sql-function-argument">
                        <label htmlFor={`${id}-argument-${index}`}>{parameter}</label>
                        <FunctionInputFormat
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
                            rows={Math.min(6, argument.value.split('\n').length)}
                            spellCheck={false}
                            value={argument.value}
                            onChange={event =>
                                onChange(index, { ...argument, value: event.target.value })
                            }
                        />
                        {argument.kind === 'map' && (
                            <small
                                id={`${id}-map-hint-${index}`}
                                className="sql-function-input-hint"
                            >
                                Key / value pairs: [[key, value], …].
                            </small>
                        )}
                    </div>
                );
            })}
            {!types && (
                <small id={`${id}-input-hint`} className="sql-function-input-hint">
                    JSON values: "text", [1, 2, 3], true or null.
                </small>
            )}
        </>
    );
}

function defaultFunctionArgument(type?: string): FunctionArgument {
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
