import { Button } from '../../ui/components/primitives';
import { Icon } from '../../ui/components/icons';
import type { WorkspaceHelpPanelProps } from '../workspace-help-types';
import { HelpSectionHeading } from '../HelpSectionHeading';

export function AssistantHelpPreview({
    copy,
    onClose,
    onOpenAssistant,
}: Pick<WorkspaceHelpPanelProps, 'copy' | 'onClose' | 'onOpenAssistant'>) {
    return (
        <>
            <HelpSectionHeading
                eyebrow="AI ASSISTANT"
                title={copy.helpAssistantTitle}
                description={copy.helpAssistantDescription}
            />
            <div className="workspace-help-assistant-scroll">
                <div className="workspace-help-assistant-demo">
                    <header className="workspace-help-assistant-demo-heading">
                        <span className="eyebrow">A QUICK EXAMPLE</span>
                        <span className="workspace-help-assistant-demo-tag">DEMO</span>
                    </header>
                    <div className="workspace-help-assistant-demo-steps">
                        <article>
                            <span className="workspace-help-assistant-step">
                                <b>01</b> ASK
                            </span>
                            <p className="workspace-help-assistant-prompt">
                                {copy.helpAssistantExamplePrompt}
                            </p>
                        </article>
                        <article>
                            <span className="workspace-help-assistant-step">
                                <b>02</b> REVIEW
                            </span>
                            <p>{copy.helpAssistantExampleContext}</p>
                            <small>The preview shows the context gathered for this request.</small>
                        </article>
                        <article>
                            <span className="workspace-help-assistant-step">
                                <b>03</b> PROPOSAL
                            </span>
                            <p>{copy.helpAssistantExampleProposal}</p>
                        </article>
                    </div>
                    <div className="workspace-help-assistant-sql">
                        <span className="eyebrow">EXAMPLE SQL</span>
                        <pre>
                            <code>{copy.helpAssistantExampleSql}</code>
                        </pre>
                    </div>
                    <div className="workspace-help-assistant-footer">
                        <span>Open the assistant to use your current SQL draft.</span>
                        <Button
                            variant="secondary"
                            onClick={() => {
                                onClose(false);
                                onOpenAssistant();
                            }}
                        >
                            <Icon name="assistant" />
                            {copy.helpOpenAssistant}
                        </Button>
                    </div>
                </div>
                <p className="workspace-help-assistant-data">{copy.helpAssistantDataDescription}</p>
            </div>
        </>
    );
}
