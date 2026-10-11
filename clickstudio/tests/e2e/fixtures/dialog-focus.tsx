import type {} from '../focus-harness.js';
import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useDialogFocus } from '../../../src/frontend/ui/focus/useDialogFocus.js';
import { AssistantChatHistory } from '../../../src/frontend/assistant/chat/AssistantChatHistory.js';

function ChatHistoryHarness() {
    const [chats, setChats] = useState(() =>
        Array.from({ length: 9 }, (_, index) => ({
            id: `chat-${index}`,
            title: `Conversation ${index}`,
            createdAt: '2026-10-10T00:00:00.000Z',
            updatedAt: '2026-10-10T00:00:00.000Z',
            turns: [],
        })),
    );
    const [activeChatId, setActiveChatId] = useState('chat-0');
    return (
        <AssistantChatHistory
            chats={chats}
            activeChatId={activeChatId}
            onNewChat={() => setActiveChatId('')}
            onSelectChat={setActiveChatId}
            onRenameChat={(id, title) =>
                setChats(current =>
                    current.map(chat => (chat.id === id ? { ...chat, title } : chat)),
                )
            }
            onDeleteChat={id => setChats(current => current.filter(chat => chat.id !== id))}
        />
    );
}

function NestedDialog({ close }: { close: () => void }) {
    const root = useRef<HTMLElement>(null);
    useDialogFocus(root, { onClose: close });
    return (
        <section ref={root} role="dialog" aria-label="Nested focus dialog" tabIndex={-1}>
            <button onClick={close}>Close nested dialog</button>
        </section>
    );
}

function Harness() {
    const root = useRef<HTMLElement>(null);
    const [open, setOpen] = useState(false);
    const [nested, setNested] = useState(false);
    const [version, setVersion] = useState(0);
    const [closedVersion, setClosedVersion] = useState<number>();
    const close = () => {
        setClosedVersion(version);
        setOpen(false);
    };
    useDialogFocus(root, { open, onClose: close });
    window.dialogFocusHarness = { update: () => flushSync(() => setVersion(value => value + 1)) };
    return (
        <>
            <button onClick={() => setOpen(true)}>Open focus dialog</button>
            <output aria-label="Closed version">{closedVersion}</output>
            <ChatHistoryHarness />
            {open && (
                <section ref={root} role="dialog" aria-label="Focus dialog" tabIndex={-1}>
                    <button disabled>Disabled action</button>
                    <button hidden>Hidden action</button>
                    <button style={{ visibility: 'hidden' }}>Invisible action</button>
                    <div inert>
                        <button>Inert action</button>
                    </div>
                    <button tabIndex={-1}>Programmatic action</button>
                    <button>First action</button>
                    <label>
                        <input type="radio" name="focus-test" value="one" /> One
                    </label>
                    <label>
                        <input type="radio" name="focus-test" value="two" defaultChecked /> Two
                    </label>
                    <label>
                        Keep typing
                        <input
                            onKeyDown={event => {
                                if (event.key === 'Escape') event.preventDefault();
                            }}
                        />
                    </label>
                    <label>
                        <input type="radio" name="" defaultChecked /> Ungrouped one
                    </label>
                    <label>
                        <input type="radio" name="" defaultChecked /> Ungrouped two
                    </label>
                    <button onClick={() => setNested(true)}>Open nested dialog</button>
                    <button onClick={close}>Last action</button>
                    {nested && <NestedDialog close={() => setNested(false)} />}
                </section>
            )}
        </>
    );
}

createRoot(document.getElementById('focus-harness')!).render(<Harness />);
