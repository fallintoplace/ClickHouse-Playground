import { useCallback } from 'react';
import type { RefObject } from 'react';
import type { NativeParserStatus } from '../../../shared/sql/parser';
import type { WorkspaceFormatter } from '../../workspace/workspace-types';
import type { EditorHandle } from './components/SqlEditor';
import type { Draft } from './drafts/workspace-state';

export function useWorkspaceSqlFormatter(
    active: Pick<Draft, 'id' | 'sql'>,
    editor: RefObject<EditorHandle | null>,
    nativeParserStatus: NativeParserStatus,
    reviewingSql = false,
) {
    return useCallback(
        async (formatter: WorkspaceFormatter) => {
            if (reviewingSql) return;
            const target = editor.current;
            const sourceSql = target?.snapshot().sql ?? active.sql;
            const applyBuiltIn = () => {
                if (editor.current === target) target?.formatBuiltIn(sourceSql);
            };
            if (formatter === 'builtin') {
                applyBuiltIn();
                return;
            }
            if (nativeParserStatus !== 'ready') return;
            const result = await target?.formatNative();
            if (result === 'unavailable' || result === 'fallback') applyBuiltIn();
        },
        [active.sql, editor, nativeParserStatus, reviewingSql],
    );
}
