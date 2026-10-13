import { useId } from 'react';
import type { SchemaColumn } from '../../../shared/database/schema/types';
import { insertRowValuePlaceholder, isOptionalInsertRowColumn } from './insert-row-validation';

type FieldCallbacks = {
    onValueChange: (name: string, value: string) => void;
    onIncludeChange: (name: string, included: boolean) => void;
    onFieldBlur: (name: string) => void;
};

type Props = FieldCallbacks & {
    columns: readonly SchemaColumn[];
    included: Record<string, boolean>;
    values: Record<string, string>;
    errors: ReadonlyMap<string, string>;
};

export function InsertRowFields({ columns, included, values, errors, ...callbacks }: Props) {
    return columns.map(column => (
        <InsertRowField
            key={column.name}
            column={column}
            included={included[column.name] ?? false}
            value={values[column.name] ?? ''}
            error={errors.get(column.name)}
            {...callbacks}
        />
    ));
}

function InsertRowField({
    column,
    included,
    value,
    error,
    onValueChange,
    onIncludeChange,
    onFieldBlur,
}: FieldCallbacks & {
    column: SchemaColumn;
    included: boolean;
    value: string;
    error: string | undefined;
}) {
    const id = useId();
    const optional = isOptionalInsertRowColumn(column);
    const disabled = optional && !included;
    return (
        <div className={`insert-row-column${error ? ' is-invalid' : ''}`}>
            <div className="min-w-0">
                <label htmlFor={id} className="insert-row-column-name block truncate text-xs">
                    {column.name}
                </label>
                <code className="insert-row-column-meta">
                    {column.type}
                    {column.defaultKind ? ` · ${column.defaultKind}` : ''}
                </code>
            </div>
            <div className="insert-row-column-control">
                <div className="insert-row-column-value-entry">
                    {optional && (
                        <label className="insert-row-include flex shrink-0 items-center gap-1.5">
                            <input
                                type="checkbox"
                                checked={included}
                                onChange={event =>
                                    onIncludeChange(column.name, event.target.checked)
                                }
                            />
                            Include
                        </label>
                    )}
                    <input
                        id={id}
                        name={column.name}
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? `${id}-error` : undefined}
                        disabled={disabled}
                        value={value}
                        onChange={event => onValueChange(column.name, event.target.value)}
                        onBlur={() => onFieldBlur(column.name)}
                        placeholder={disabled ? 'Use default' : insertRowValuePlaceholder(column)}
                        className="insert-row-column-value min-w-0 flex-1 border border-[var(--line)] font-mono text-xs"
                    />
                </div>
                {error && (
                    <p id={`${id}-error`} role="alert" className="insert-row-column-error">
                        {error}
                    </p>
                )}
            </div>
        </div>
    );
}
