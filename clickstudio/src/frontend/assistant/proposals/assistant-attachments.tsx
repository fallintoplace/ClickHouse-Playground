import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import {
    MAX_ASSISTANT_IMAGE_BYTES,
    MAX_ASSISTANT_IMAGE_COUNT,
} from '../../../shared/assistant/images';
import {
    isAssistantTextFileName,
    MAX_ASSISTANT_TEXT_FILE_COUNT,
    MAX_ASSISTANT_TOTAL_TEXT_FILE_BYTES,
} from '../../../shared/assistant/text-files';
import { Icon } from '../../ui/components/icons';

const maxTotalImageBytes = __ASSISTANT_MAX_TOTAL_IMAGE_BYTES__;
const maxTotalImageMegabytes = maxTotalImageBytes / 1_000_000;
const maxTotalImageLabel = Number.isInteger(maxTotalImageMegabytes)
    ? `${maxTotalImageMegabytes}`
    : maxTotalImageMegabytes.toFixed(1);

export type AssistantImageAttachment = {
    id: string;
    name: string;
    size: number;
    dataUrl: string;
};

export type AssistantTextFileAttachment = {
    id: string;
    name: string;
    size: number;
    content: string;
};

type AssistantAttachment = {
    id: string;
    name: string;
    icon: 'image' | 'reference';
};

export function assistantImageMimeType(file: Pick<File, 'name' | 'type'>): string | undefined {
    const type = file.type.toLowerCase();
    if (type === 'image/png' || type === 'image/jpeg' || type === 'image/webp') return type;
    if (type === 'image/jpg') return 'image/jpeg';
    if (type.startsWith('image/')) return undefined;

    const extension = file.name.toLowerCase().split('.').at(-1);
    if (extension === 'png') return 'image/png';
    if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
    if (extension === 'webp') return 'image/webp';
    return undefined;
}

export function isAssistantImageFile(file: Pick<File, 'name' | 'type'>): boolean {
    return (
        file.type.toLowerCase().startsWith('image/') ||
        /\.(?:png|jpe?g|webp|gif|bmp|avif|heic)$/i.test(file.name)
    );
}

function attachmentName(file: File, fallback: string): string {
    const name = file.name.replace(/[\\/]/g, '').trim();
    const extension = name.match(/\.(?:csv|txt|sql)$/i)?.[0] ?? '';
    return name.length <= 100
        ? name || fallback
        : `${name.slice(0, 100 - extension.length)}${extension}`;
}

export function readAssistantImage(file: File, mimeType: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') resolve(reader.result);
            else reject(new Error('Could not read this image. Try copying it again.'));
        };
        reader.onerror = () =>
            reject(new Error('Could not read this image. Try copying it again.'));
        reader.onabort = () =>
            reject(new Error('Could not read this image. Try copying it again.'));
        const source =
            file.type.toLowerCase() === mimeType ? file : new Blob([file], { type: mimeType });
        reader.readAsDataURL(source);
    });
}

async function readAssistantTextFile(file: File): Promise<string> {
    const bytes = await file.arrayBuffer();
    let content: string;
    try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        throw new Error(`${file.name} must be a UTF-8 text file.`);
    }
    if (content.includes('\0')) throw new Error(`${file.name} is not a text file.`);
    return content;
}

function pasteClipboardText(
    event: ClipboardEvent<HTMLTextAreaElement>,
    onQuestionChange: (question: string) => void,
) {
    const pastedText = event.clipboardData.getData('text/plain');
    if (!pastedText) return;
    const input = event.currentTarget;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const nextQuestion = input.value.slice(0, start) + pastedText + input.value.slice(end);
    onQuestionChange(nextQuestion);
    requestAnimationFrame(() => {
        input.setSelectionRange(start + pastedText.length, start + pastedText.length);
    });
}

export function useAssistantAttachments(
    activeChatId: string,
    onQuestionChange: (question: string) => void,
) {
    const [images, setImages] = useState<AssistantImageAttachment[]>([]);
    const [files, setFiles] = useState<AssistantTextFileAttachment[]>([]);
    const [isReading, setIsReading] = useState(false);
    const [error, setError] = useState('');
    const readingRef = useRef(false);
    const generationRef = useRef(0);

    useEffect(() => {
        generationRef.current++;
        readingRef.current = false;
        setImages([]);
        setFiles([]);
        setIsReading(false);
        setError('');
    }, [activeChatId]);

    const clear = () => {
        setImages([]);
        setFiles([]);
        setError('');
    };
    const remove = (id: string) => {
        setImages(current => current.filter(image => image.id !== id));
        setFiles(current => current.filter(file => file.id !== id));
        setError('');
    };
    const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
        const pastedFiles = Array.from(event.clipboardData.items)
            .filter(item => item.kind === 'file')
            .map(item => item.getAsFile())
            .filter((file): file is File => file !== null);
        if (!pastedFiles.length) return;
        event.preventDefault();
        pasteClipboardText(event, onQuestionChange);

        if (readingRef.current) {
            setError('Wait for the pasted files to finish loading.');
            return;
        }

        const imageFiles = pastedFiles.filter(isAssistantImageFile);
        const textFiles = pastedFiles.filter(file => isAssistantTextFileName(file.name));
        if (imageFiles.length + textFiles.length !== pastedFiles.length) {
            setError('Paste a PNG, JPEG, WebP, CSV, TXT, or SQL file.');
            return;
        }
        const mimeTypes = imageFiles.map(assistantImageMimeType);
        if (mimeTypes.some(type => !type)) {
            setError('Paste a PNG, JPEG, or WebP image.');
            return;
        }
        if (imageFiles.some(file => file.size === 0)) {
            setError('This image is empty. Copy it again and paste it here.');
            return;
        }
        if (textFiles.some(file => file.size === 0)) {
            setError('This text file is empty.');
            return;
        }
        if (imageFiles.some(file => file.size > MAX_ASSISTANT_IMAGE_BYTES)) {
            setError('Each image must be at most 2 MB.');
            return;
        }
        if (images.length + imageFiles.length > MAX_ASSISTANT_IMAGE_COUNT) {
            setError(`Attach at most ${MAX_ASSISTANT_IMAGE_COUNT} images.`);
            return;
        }
        if (files.length + textFiles.length > MAX_ASSISTANT_TEXT_FILE_COUNT) {
            setError(`Attach at most ${MAX_ASSISTANT_TEXT_FILE_COUNT} text files.`);
            return;
        }
        const totalImageBytes =
            images.reduce((total, image) => total + image.size, 0) +
            imageFiles.reduce((total, file) => total + file.size, 0);
        if (totalImageBytes > maxTotalImageBytes) {
            setError(`Attached images must total at most ${maxTotalImageLabel} MB.`);
            return;
        }
        const totalTextFileBytes =
            files.reduce((total, file) => total + file.size, 0) +
            textFiles.reduce((total, file) => total + file.size, 0);
        if (totalTextFileBytes > MAX_ASSISTANT_TOTAL_TEXT_FILE_BYTES) {
            setError('Attached text files must total at most 100 KB.');
            return;
        }

        const generation = generationRef.current;
        readingRef.current = true;
        setIsReading(true);
        setError('');
        void Promise.all([
            Promise.all(
                imageFiles.map(async (file, index) => ({
                    id: crypto.randomUUID(),
                    name: attachmentName(file, `image-${index + 1}`),
                    size: file.size,
                    dataUrl: await readAssistantImage(file, mimeTypes[index]!),
                })),
            ),
            Promise.all(
                textFiles.map(async (file, index) => ({
                    id: crypto.randomUUID(),
                    name: attachmentName(file, `text-${index + 1}.txt`),
                    size: file.size,
                    content: await readAssistantTextFile(file),
                })),
            ),
        ])
            .then(([pastedImages, pastedTextFiles]) => {
                if (generationRef.current === generation) {
                    setImages(current => [...current, ...pastedImages]);
                    setFiles(current => [...current, ...pastedTextFiles]);
                }
            })
            .catch(caught => {
                if (generationRef.current === generation)
                    setError(
                        caught instanceof Error
                            ? caught.message
                            : 'Could not read this file. Try copying it again.',
                    );
            })
            .finally(() => {
                if (generationRef.current === generation) {
                    readingRef.current = false;
                    setIsReading(false);
                }
            });
    };

    return { images, files, isReading, error, clear, remove, onPaste };
}

export function AssistantAttachments({
    images,
    files,
    isReading,
    onRemove,
}: {
    images: readonly AssistantImageAttachment[];
    files: readonly AssistantTextFileAttachment[];
    isReading: boolean;
    onRemove: (id: string) => void;
}) {
    const [expandedAttachmentIds, setExpandedAttachmentIds] = useState('');
    const attachments: AssistantAttachment[] = [
        ...images.map(({ id, name }) => ({ id, name, icon: 'image' as const })),
        ...files.map(({ id, name }) => ({ id, name, icon: 'reference' as const })),
    ];
    const attachmentSetKey = attachments.map(attachment => attachment.id).join('|');
    const expanded = attachments.length > 5 && expandedAttachmentIds === attachmentSetKey;
    return (
        <div className="assistant-image-attachments" role="group" aria-label="Attached files">
            {attachments.slice(0, expanded ? attachments.length : 5).map(attachment => (
                <span className="assistant-image-chip" key={attachment.id} title={attachment.name}>
                    <Icon name={attachment.icon} />
                    <span>{attachment.name}</span>
                    <button
                        type="button"
                        className="assistant-image-chip-remove"
                        aria-label={`Remove ${attachment.name}`}
                        title={`Remove ${attachment.name}`}
                        onClick={() => onRemove(attachment.id)}
                    >
                        <Icon name="close" />
                    </button>
                </span>
            ))}
            {attachments.length > 5 && (
                <button
                    type="button"
                    className="assistant-image-more"
                    aria-expanded={expanded}
                    onClick={() => setExpandedAttachmentIds(expanded ? '' : attachmentSetKey)}
                >
                    {expanded ? 'Show less' : `+${attachments.length - 5} more`}
                </button>
            )}
            {isReading && (
                <span className="assistant-image-attachment-status" role="status">
                    Adding files…
                </span>
            )}
        </div>
    );
}
