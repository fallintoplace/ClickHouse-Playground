import { useId, useMemo, useState } from 'react';
import type { NativeParseResult, NativeParserStatus } from '../../../../shared/sql/parser';
import { buildSqlFlow } from './sql-flow';
import { AnalyzerTreeView } from './AnalyzerTreeView';
import { AstGraph } from '../../editor/parser/AstGraph';
import { PipelineGraph } from './PipelineGraph';
import { ScrollEdgeFrame } from '../../../ui/components/ScrollEdgeShadows';
import type { Copy } from '../../../ui/copy';

export type StructureView = 'flow' | 'ast' | 'analyzer';

export type SqlFlowModeTabsProps = {
    copy: Copy['common'];
    mode: StructureView;
    onModeChange: (mode: StructureView) => void;
    parseResult?: NativeParseResult;
    parserStatus: NativeParserStatus;
    analyzerAvailable: boolean;
    analyzerUnavailableReason?: string;
};

function nativeAstAvailability(
    copy: Copy['common'],
    parserStatus: NativeParserStatus,
    parseResult: NativeParseResult | undefined,
) {
    const available = Boolean(parserStatus === 'ready' && !parseResult?.error && parseResult?.ast);
    let unavailableReason: string;

    switch (parserStatus) {
        case 'loading':
            unavailableReason = copy.sqlFlowParserStarting;
            break;
        case 'unavailable':
            unavailableReason = copy.sqlFlowParserUnavailable;
            break;
        default:
            unavailableReason =
                parseResult?.error?.message ?? parseResult?.ast_error ?? copy.sqlAstUnavailable;
            break;
    }

    return { available, unavailableReason };
}

export function SqlFlowModeTabs({
    copy,
    mode,
    onModeChange,
    parseResult,
    parserStatus,
    analyzerAvailable,
    analyzerUnavailableReason,
}: SqlFlowModeTabsProps) {
    const ast = nativeAstAvailability(copy, parserStatus, parseResult);
    const descriptionId = useId();

    return (
        <div className="sql-flow-mode-tabs" role="group" aria-label={copy.sqlStructure}>
            <button
                type="button"
                aria-label={copy.sqlFlowLogicalMode}
                aria-describedby={`${descriptionId}-flow`}
                data-footer-help={copy.sqlFlowLogicalModeDescription}
                aria-pressed={mode === 'flow'}
                className={mode === 'flow' ? 'is-active' : ''}
                onClick={() => onModeChange('flow')}
            >
                <span className="sql-flow-mode-name">{copy.sqlFlowLogicalMode}</span>
                <span id={`${descriptionId}-flow`} className="sr-only">
                    {copy.sqlFlowLogicalModeDescription}
                </span>
            </button>
            <button
                type="button"
                aria-label={copy.sqlFlowNativeAst}
                aria-describedby={`${descriptionId}-ast`}
                data-footer-help={copy.sqlFlowNativeAstDescription}
                aria-pressed={mode === 'ast'}
                className={mode === 'ast' ? 'is-active' : ''}
                disabled={!ast.available && mode !== 'ast'}
                title={!ast.available ? ast.unavailableReason : undefined}
                onClick={() => onModeChange('ast')}
            >
                <span className="sql-flow-mode-name">{copy.sqlFlowNativeAst}</span>
                <span id={`${descriptionId}-ast`} className="sr-only">
                    {copy.sqlFlowNativeAstDescription}
                </span>
            </button>
            <button
                type="button"
                aria-label={copy.sqlFlowAnalyzer}
                aria-describedby={`${descriptionId}-analyzer`}
                data-footer-help={copy.sqlFlowAnalyzerDescription}
                aria-pressed={mode === 'analyzer'}
                className={mode === 'analyzer' ? 'is-active' : ''}
                disabled={!analyzerAvailable}
                title={!analyzerAvailable ? analyzerUnavailableReason : undefined}
                onClick={() => onModeChange('analyzer')}
            >
                <span className="sql-flow-mode-name">{copy.sqlFlowAnalyzer}</span>
                <span id={`${descriptionId}-analyzer`} className="sr-only">
                    {copy.sqlFlowAnalyzerDescription}
                </span>
            </button>
        </div>
    );
}

export type SqlFlowViewProps = {
    copy: Copy['common'];
    sql: string;
    sourceOffset: number;
    connectionId: string;
    parameters: Record<string, string>;
    analyzerAvailable: boolean;
    analyzerUnavailableReason?: string;
    parseResult?: NativeParseResult;
    parserStatus: NativeParserStatus;
    parseDurationMs?: number;
    mode?: StructureView;
    onModeChange?: (mode: StructureView) => void;
    showHeading?: boolean;
    showModeTabs?: boolean;
    onRevealRange: (from: number, to: number) => void;
};

export function SqlFlowView({
    copy,
    sql,
    sourceOffset,
    parseResult,
    parserStatus,
    parseDurationMs,
    mode: controlledMode,
    onModeChange,
    showHeading = true,
    showModeTabs = true,
    connectionId,
    parameters,
    analyzerAvailable,
    analyzerUnavailableReason,
    onRevealRange,
}: SqlFlowViewProps) {
    const [localMode, setLocalMode] = useState<StructureView>('flow');
    const view = controlledMode ?? localMode;
    const changeMode = (mode: StructureView) => {
        if (controlledMode === undefined) setLocalMode(mode);
        onModeChange?.(mode);
    };
    const model = useMemo(
        () => buildSqlFlow(sql, parseResult, sourceOffset),
        [sql, parseResult, sourceOffset],
    );
    const duration = parseDurationMs === undefined ? undefined : `${parseDurationMs.toFixed(1)} ms`;
    let parserLabel: string;

    if (view === 'analyzer') {
        parserLabel = copy.queryTreeServer;
    } else if (parserStatus === 'loading') {
        parserLabel = copy.sqlFlowParserStarting;
    } else if (parserStatus === 'unavailable') {
        parserLabel = copy.sqlFlowParserUnavailable;
    } else if (model.mode === 'native AST') {
        parserLabel = copy.sqlFlowNativeAst;
    } else {
        parserLabel = copy.sqlFlowKeywordEstimate;
    }
    const ast = nativeAstAvailability(copy, parserStatus, parseResult);

    return (
        <ScrollEdgeFrame<HTMLElement> className="sql-flow-view-frame">
            {ref => {
                const getSelectionHint = () => {
                    switch (view) {
                        case 'ast':
                            return copy.sqlAstClickNode;

                        case 'analyzer':
                            return copy.queryTreeClickNode;

                        default:
                            return copy.sqlFlowClickStage;
                    }
                };
                return (
                    <section
                        ref={ref}
                        className="sql-flow-view"
                        aria-label={copy.visualizeSqlStructure}
                    >
                        {showHeading && (
                            <header className="sql-flow-heading">
                                <div>
                                    <span className="eyebrow">
                                        {copy.sqlStructure.toUpperCase()}
                                    </span>
                                    <h3>{copy.sqlFlowTitle}</h3>
                                    <p>{getSelectionHint()}</p>
                                </div>
                                <span
                                    className={`sql-flow-parser-state ${view === 'analyzer' || model.mode === 'native AST' ? 'is-native' : ''}`}
                                >
                                    <span className="status-light" />
                                    {parserLabel}
                                    {duration && view !== 'analyzer' && model.mode === 'native AST'
                                        ? ` · ${duration}`
                                        : ''}
                                </span>
                            </header>
                        )}
                        {showModeTabs && (
                            <SqlFlowModeTabs
                                copy={copy}
                                mode={view}
                                onModeChange={changeMode}
                                parseResult={parseResult}
                                parserStatus={parserStatus}
                                analyzerAvailable={analyzerAvailable}
                                analyzerUnavailableReason={analyzerUnavailableReason}
                            />
                        )}
                        {view === 'flow' && model.parserError && (
                            <div className="sql-flow-parse-note" role="status">
                                {model.mode === 'native AST'
                                    ? copy.sqlFlowAstDetail
                                    : copy.sqlFlowSqlDetail}
                                {model.parserError}
                            </div>
                        )}
                        {!sql.trim() ? (
                            <div className="pipeline-graph-empty">{copy.sqlFlowEmpty}</div>
                        ) : (
                            <>
                                {view === 'ast' &&
                                    (ast.available ? (
                                        <AstGraph ast={parseResult!.ast} copy={copy} />
                                    ) : (
                                        <div className="pipeline-graph-empty" role="status">
                                            {ast.unavailableReason}
                                        </div>
                                    ))}
                                {view === 'flow' && (
                                    <PipelineGraph
                                        copy={copy}
                                        pipeline={model.pipeline}
                                        graphKind="sql-flow"
                                        heading={
                                            model.mode === 'native AST'
                                                ? copy.sqlFlowNativeHeading
                                                : copy.sqlFlowFallbackHeading
                                        }
                                        subheading={showHeading ? copy.sqlFlowGraphHint : ''}
                                        onSelectNode={node => {
                                            const range = model.sourceRanges.get(node.id);
                                            if (range) onRevealRange(range.from, range.to);
                                        }}
                                    />
                                )}
                                <AnalyzerTreeView
                                    active={view === 'analyzer'}
                                    available={analyzerAvailable}
                                    unavailableReason={analyzerUnavailableReason}
                                    connectionId={connectionId}
                                    sql={sql}
                                    parameters={parameters}
                                    copy={copy}
                                />
                            </>
                        )}
                    </section>
                );
            }}
        </ScrollEdgeFrame>
    );
}
