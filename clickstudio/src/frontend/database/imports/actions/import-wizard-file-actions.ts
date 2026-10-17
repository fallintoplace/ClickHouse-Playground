import {
    MAX_IMPORT_FILE_BYTES,
    IMPORT_PREVIEW_ROWS,
    IMPORT_FILE_SIZE_LABEL,
} from '../../../../shared/database/imports/limits';
import type { Dispatch, SetStateAction } from 'react';
import type { Json } from '../../../../shared/common/values';
import { apiResponses, post } from '../../../api/client';
import { DEMO_IMPORT_SAMPLE_CSV, parseImportFile } from '../../../api/samples/demo-import-data';
import { CREATE_CLOUD_TABLE_TARGET, type CloudImportColumn } from '../state/cloud-import';
import {
    fileFormat,
    type BusyAction,
    type ImportFormat,
    type ImportJob,
    type ImportMapping,
    type ImportPreview,
    type Step,
} from '../state/import-wizard-model';
import { importFailureMessage } from '../state/import-failure-message';

type ImportWizardFileActionContext = {
    browserDemoImport: boolean;
    browserCloudImport: boolean;
    target: string;
    file?: File;
    format?: ImportFormat;
    busy: BusyAction;
    setFile: Dispatch<SetStateAction<File | undefined>>;
    setFormat: Dispatch<SetStateAction<ImportFormat | undefined>>;
    setPreview: Dispatch<SetStateAction<ImportPreview | undefined>>;
    setMapping: Dispatch<SetStateAction<ImportMapping | undefined>>;
    setFields: Dispatch<SetStateAction<Record<string, string>>>;
    setCloudRows: Dispatch<SetStateAction<Record<string, Json>[]>>;
    setCreateColumns: Dispatch<SetStateAction<CloudImportColumn[]>>;
    setCreateTableName: Dispatch<SetStateAction<string>>;
    setJob: Dispatch<SetStateAction<ImportJob | undefined>>;
    setError: Dispatch<SetStateAction<string>>;
    setGenerateId: Dispatch<SetStateAction<boolean>>;
    setStep: Dispatch<SetStateAction<Step>>;
    setBusy: Dispatch<SetStateAction<BusyAction>>;
    setTarget: Dispatch<SetStateAction<string>>;
    setLastExistingTarget: Dispatch<SetStateAction<string>>;
};

export function createImportWizardFileActions(context: ImportWizardFileActionContext) {
    const {
        browserDemoImport,
        browserCloudImport,
        target,
        file,
        format,
        busy,
        setFile,
        setFormat,
        setPreview,
        setMapping,
        setFields,
        setCloudRows,
        setCreateColumns,
        setCreateTableName,
        setJob,
        setError,
        setGenerateId,
        setStep,
        setBusy,
        setTarget,
        setLastExistingTarget,
    } = context;

    function chooseFile(next?: File) {
        setFile(next);
        setTarget('');
        setLastExistingTarget('');
        setPreview(undefined);
        setMapping(undefined);
        setFields({});
        setCloudRows([]);
        setCreateColumns([]);
        if (browserCloudImport && target === CREATE_CLOUD_TABLE_TARGET) setCreateTableName('');
        setJob(undefined);
        setError('');
        setGenerateId(true);
        if (!next) {
            setFormat(undefined);
            return;
        }
        const nextFormat = fileFormat(next);
        setFormat(nextFormat);
        if (!nextFormat) setError('Choose a .csv, .json, .ndjson, or .jsonl file.');
        else if (next.size > MAX_IMPORT_FILE_BYTES)
            setError(`This file is larger than the ${IMPORT_FILE_SIZE_LABEL} import limit.`);
    }

    async function previewSelectedFile(nextFile: File, nextFormat: ImportFormat) {
        if (nextFile.size > MAX_IMPORT_FILE_BYTES || busy) return;
        setBusy('preview');
        setError('');
        try {
            const source = await nextFile.text();
            let next: ImportPreview;
            if (browserCloudImport) {
                const parsed = parseImportFile(source, nextFormat);
                if (!parsed.rows.length) throw new Error('The input contains no data rows.');
                setCloudRows(parsed.rows);
                next = {
                    id: crypto.randomUUID(),
                    name: nextFile.name.slice(0, 128),
                    format: nextFormat,
                    columns: parsed.columns,
                    rows: parsed.rows.slice(0, IMPORT_PREVIEW_ROWS),
                    rowCount: parsed.rows.length,
                };
            } else {
                setCloudRows([]);
                next = await post(
                    '/imports/preview',
                    {
                        name: nextFile.name,
                        source,
                        format: nextFormat,
                    },
                    apiResponses.isImportPreview,
                );
            }
            setPreview(next);
            setStep('mapping');
            setError('');
        } catch (caught) {
            setError(importFailureMessage(caught));
        } finally {
            setBusy('');
        }
    }

    async function previewFile() {
        if (!file || !format || file.size > MAX_IMPORT_FILE_BYTES || busy) return;
        await previewSelectedFile(file, format);
    }

    async function previewSampleFile() {
        if (!browserDemoImport || busy) return;
        const sample = new File([DEMO_IMPORT_SAMPLE_CSV], 'interview-marketing-snapshot.csv', {
            type: 'text/csv',
        });
        setFile(sample);
        setTarget('');
        setLastExistingTarget('');
        setFields({});
        setFormat('csv');
        setError('');
        await previewSelectedFile(sample, 'csv');
    }

    return { chooseFile, previewFile, previewSampleFile };
}
