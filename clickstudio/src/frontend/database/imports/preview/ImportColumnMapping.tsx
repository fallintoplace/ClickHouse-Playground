import { NativeTable } from '../../../ui/components/NativeTable';
import { SelectControl } from '../../../ui/components/SelectControl';
import { ImportMappingError } from './ImportMappingError';
import { type ImportPreview } from '../state/import-wizard-model';
import type { useImportWizardController } from '../useImportWizardController';

export function ImportColumnMapping({
    preview,
    liveMappingIssue,
    destinationColumns,
    fields,
    setFields,
    setMapping,
    setError,
}: {
    preview: ImportPreview;
    liveMappingIssue: { source: string; message: string } | undefined;
    destinationColumns: ReturnType<typeof useImportWizardController>['destinationColumns'];
    fields: ReturnType<typeof useImportWizardController>['fields'];
    setFields: ReturnType<typeof useImportWizardController>['setFields'];
    setMapping: ReturnType<typeof useImportWizardController>['setMapping'];
    setError: ReturnType<typeof useImportWizardController>['setError'];
}) {
    return (
        <div className="import-column-map">
            <NativeTable className="w-full min-w-[540px] border-collapse text-left text-xs">
                <thead>
                    <tr>
                        <th>FROM FILE</th>
                        <th>TO TABLE</th>
                        <th>TYPE</th>
                    </tr>
                </thead>
                <tbody>
                    {preview.columns.map((source, sourceIndex) => {
                        const sourceIssue =
                            liveMappingIssue?.source === source ? liveMappingIssue : undefined;
                        const issueId = sourceIssue
                            ? `import-mapping-error-${sourceIndex}`
                            : undefined;
                        const destinationType = destinationColumns.find(
                            column => column.name === fields[source],
                        )?.type;
                        return (
                            <tr key={source}>
                                <th scope="row" data-overflow-title={source}>
                                    <code className="import-source-column-name">{source}</code>
                                </th>
                                <td>
                                    <div className="import-mapping-control">
                                        <SelectControl
                                            className="select-control-field"
                                            label={`Map ${source} to destination`}
                                            aria-invalid={sourceIssue ? true : undefined}
                                            aria-describedby={issueId}
                                            value={fields[source] ?? ''}
                                            searchable
                                            options={[
                                                { value: '', label: 'Skip column' },
                                                ...destinationColumns.map(column => ({
                                                    value: column.name,
                                                    label: column.name,
                                                })),
                                            ]}
                                            onChange={value => {
                                                setFields(current => ({
                                                    ...current,
                                                    [source]: value,
                                                }));
                                                setMapping(undefined);
                                                setError('');
                                            }}
                                        />
                                        {sourceIssue && issueId && (
                                            <ImportMappingError
                                                id={issueId}
                                                source={source}
                                                message={sourceIssue.message}
                                            />
                                        )}
                                    </div>
                                </td>
                                <td className="import-column-type-cell">
                                    <span
                                        className="import-column-type"
                                        data-overflow-title={destinationType ?? '—'}
                                    >
                                        {destinationType ?? '—'}
                                    </span>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </NativeTable>
        </div>
    );
}
