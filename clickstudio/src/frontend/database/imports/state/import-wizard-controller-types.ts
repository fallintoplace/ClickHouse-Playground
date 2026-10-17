import type { Dispatch, SetStateAction } from 'react';
import type { Schema } from '../../../../shared/database/schema/types';
import type { CloudImportColumn } from './cloud-import';
import type {
    BusyAction,
    ImportJob,
    ImportMapping,
    PendingImport,
    Step,
} from './import-wizard-model';

export type ImportActionSetters = {
    setJob: Dispatch<SetStateAction<ImportJob | undefined>>;
    setStep: Dispatch<SetStateAction<Step>>;
    setBusy: Dispatch<SetStateAction<BusyAction>>;
    setError: Dispatch<SetStateAction<string>>;
    setMapping: Dispatch<SetStateAction<ImportMapping | undefined>>;
    setTargets: Dispatch<SetStateAction<string[]>>;
    setSchema: Dispatch<SetStateAction<Schema | undefined>>;
    setTarget: Dispatch<SetStateAction<string>>;
    setLastExistingTarget: Dispatch<SetStateAction<string>>;
    setFields: Dispatch<SetStateAction<Record<string, string>>>;
    setRecoveryState: Dispatch<SetStateAction<'checking' | 'ready' | 'failed'>>;
    setRecoverableJobs: Dispatch<SetStateAction<ImportJob[]>>;
    setPendingImport: Dispatch<SetStateAction<PendingImport | undefined>>;
    setImportUnavailable: Dispatch<SetStateAction<string>>;
    setCreateColumns: Dispatch<SetStateAction<CloudImportColumn[]>>;
    setCreateTableName: Dispatch<SetStateAction<string>>;
    setGenerateId: Dispatch<SetStateAction<boolean>>;
};
