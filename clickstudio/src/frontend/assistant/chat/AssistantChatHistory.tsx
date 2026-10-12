import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { MAX_ASSISTANT_CHAT_TITLE_LENGTH, type AssistantChat } from './assistant-chat-state';
import { Button, Spinner } from '../../ui/components/primitives';
import { Icon } from '../../ui/components/icons';

export type AssistantChatHistoryProps = {
    chats: readonly AssistantChat[];
    activeChatId: string;
    onNewChat: () => void;
    onSelectChat: (chatId: string) => void;
    onRenameChat: (chatId: string, title: string) => void;
    onDeleteChat: (chatId: string) => void;
};

export function AssistantChatHistory({
    chats,
    activeChatId,
    onNewChat,
    onSelectChat,
    onRenameChat,
    onDeleteChat,
}: AssistantChatHistoryProps) {
    const historyRef = useRef<HTMLDivElement>(null);
    const historyTriggerRef = useRef<HTMLButtonElement>(null);
    const selectButtonsRef = useRef(new Map<string, HTMLButtonElement>());
    const [historyOpen, setHistoryOpen] = useState(false);
    const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [search, setSearch] = useState('');
    const activeChat = chats.find(chat => chat.id === activeChatId);
    const orderedChats = [...chats].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
    );
    const visibleChats = orderedChats.filter(chat =>
        chat.title.toLowerCase().includes(search.trim().toLowerCase()),
    );

    useEffect(() => {
        if (!historyOpen) return;
        const closeOnOutsidePointer = (event: PointerEvent) => {
            if (event.target instanceof Node && !historyRef.current?.contains(event.target)) {
                setHistoryOpen(false);
                setRenamingChatId(null);
            }
        };
        document.addEventListener('pointerdown', closeOnOutsidePointer);
        return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
    }, [historyOpen]);

    const focusHistoryTrigger = () =>
        window.requestAnimationFrame(() => historyTriggerRef.current?.focus());
    const closeHistory = () => {
        setHistoryOpen(false);
        setRenamingChatId(null);
    };
    const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Escape' || !historyOpen) return;
        event.preventDefault();
        event.stopPropagation();
        if (renamingChatId) {
            const chatId = renamingChatId;
            setRenamingChatId(null);
            setRenameValue('');
            window.requestAnimationFrame(() => selectButtonsRef.current.get(chatId)?.focus());
        } else {
            setHistoryOpen(false);
            historyTriggerRef.current?.focus();
        }
    };
    const selectChat = (chatId: string) => {
        onSelectChat(chatId);
        closeHistory();
        setSearch('');
        focusHistoryTrigger();
    };
    const startRename = (chatId: string, title: string) => {
        setRenameValue(title);
        setRenamingChatId(chatId);
    };
    const cancelRename = (chatId: string) => {
        setRenamingChatId(null);
        setRenameValue('');
        window.requestAnimationFrame(() => selectButtonsRef.current.get(chatId)?.focus());
    };
    const saveRename = (chatId: string) => {
        if (!renameValue.trim()) return;
        onRenameChat(chatId, renameValue);
        setRenamingChatId(null);
        setRenameValue('');
        window.requestAnimationFrame(() => selectButtonsRef.current.get(chatId)?.focus());
    };
    const deleteChat = (chatId: string) => {
        onDeleteChat(chatId);
        focusHistoryTrigger();
    };

    return (
        <div
            className="assistant-chat-toolbar"
            onKeyDown={handleKeyDown}
            onBlur={event => {
                const nextFocus = event.relatedTarget;
                if (!(nextFocus instanceof Node) || !historyRef.current?.contains(nextFocus))
                    closeHistory();
            }}
        >
            <div className="assistant-chat-switcher" ref={historyRef}>
                <button
                    ref={historyTriggerRef}
                    type="button"
                    className="button-base button-secondary assistant-chat-history-trigger"
                    aria-label={`Chat history: ${activeChat?.title ?? 'New chat'}`}
                    aria-expanded={historyOpen}
                    aria-controls="assistant-chat-history"
                    onClick={() => {
                        setHistoryOpen(open => !open);
                        setRenamingChatId(null);
                    }}
                    title={activeChat?.title ?? 'New chat'}
                >
                    <span>{activeChat?.title ?? 'New chat'}</span>
                    <Icon name="chevron" />
                </button>
                <div
                    id="assistant-chat-history"
                    className="assistant-chat-history-popover"
                    role="region"
                    aria-label="Chat history"
                    hidden={!historyOpen}
                >
                    <div className="assistant-chat-history-heading">
                        <strong>Recent chats</strong>
                        <span>{chats.length}</span>
                    </div>
                    {orderedChats.length > 8 && (
                        <label className="assistant-chat-search">
                            <Icon name="search" />
                            <input
                                type="search"
                                aria-label="Search conversations"
                                placeholder="Search conversations"
                                value={search}
                                onChange={event => setSearch(event.target.value)}
                            />
                        </label>
                    )}
                    <ul className="assistant-chat-history-list" aria-label="Conversations">
                        {visibleChats.map(chat => (
                            <li
                                className={`assistant-chat-history-item${chat.id === activeChatId ? ' is-active' : ''}`}
                                key={chat.id}
                            >
                                {renamingChatId === chat.id ? (
                                    <form
                                        className="assistant-chat-rename-inline"
                                        aria-label={`Rename ${chat.title}`}
                                        onSubmit={event => {
                                            event.preventDefault();
                                            saveRename(chat.id);
                                        }}
                                    >
                                        <input
                                            autoFocus
                                            aria-label={`New name for ${chat.title}`}
                                            value={renameValue}
                                            maxLength={MAX_ASSISTANT_CHAT_TITLE_LENGTH}
                                            onFocus={event => event.currentTarget.select()}
                                            onChange={event => setRenameValue(event.target.value)}
                                            onKeyDown={event => {
                                                if (event.key === 'Escape') {
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    cancelRename(chat.id);
                                                }
                                            }}
                                        />
                                        <Button
                                            variant="primary"
                                            type="submit"
                                            aria-label="Save conversation name"
                                            title="Save name"
                                            disabled={!renameValue.trim()}
                                        >
                                            <Icon name="check" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            aria-label="Cancel renaming"
                                            title="Cancel"
                                            onClick={() => cancelRename(chat.id)}
                                        >
                                            <Icon name="close" />
                                        </Button>
                                    </form>
                                ) : (
                                    <div className="assistant-chat-history-row">
                                        <button
                                            ref={element => {
                                                if (element)
                                                    selectButtonsRef.current.set(chat.id, element);
                                                else selectButtonsRef.current.delete(chat.id);
                                            }}
                                            type="button"
                                            className="assistant-chat-history-select"
                                            aria-current={
                                                chat.id === activeChatId ? 'page' : undefined
                                            }
                                            onClick={() => selectChat(chat.id)}
                                            title={chat.title}
                                        >
                                            <span>{chat.title}</span>
                                            {chat.turns.some(turn => turn.status === 'pending') && (
                                                <Spinner label="Generating response" />
                                            )}
                                            {chat.id === activeChatId && (
                                                <>
                                                    <span className="sr-only">
                                                        Current conversation
                                                    </span>
                                                    <Icon name="check" />
                                                </>
                                            )}
                                        </button>
                                        <div className="assistant-chat-row-actions">
                                            <Button
                                                variant="ghost"
                                                className="assistant-chat-row-action"
                                                aria-label={`Rename ${chat.title}`}
                                                title="Rename chat"
                                                onClick={() => startRename(chat.id, chat.title)}
                                            >
                                                <Icon name="rename" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                className="assistant-chat-row-action is-delete"
                                                aria-label={`Delete ${chat.title}`}
                                                title="Delete chat"
                                                onClick={() => deleteChat(chat.id)}
                                            >
                                                <Icon name="trash" />
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </li>
                        ))}
                        {!visibleChats.length && (
                            <li className="assistant-chat-history-empty">No matching chats.</li>
                        )}
                    </ul>
                </div>
            </div>
            <Button
                variant="secondary"
                className="assistant-new-chat-button"
                onClick={() => {
                    closeHistory();
                    setSearch('');
                    onNewChat();
                    focusHistoryTrigger();
                }}
            >
                <Icon name="plus" />
                New chat
            </Button>
        </div>
    );
}
