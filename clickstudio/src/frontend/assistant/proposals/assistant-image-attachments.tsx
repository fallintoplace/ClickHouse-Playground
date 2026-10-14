import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import {
    MAX_ASSISTANT_IMAGE_BYTES,
    MAX_ASSISTANT_IMAGE_COUNT,
} from '../../../shared/assistant/images';
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

export function useAssistantImageAttachments(
    activeChatId: string,
    onQuestionChange: (question: string) => void,
) {
    const [images, setImages] = useState<AssistantImageAttachment[]>([]);
    const [isReading, setIsReading] = useState(false);
    const [error, setError] = useState('');
    const readingRef = useRef(false);
    const generationRef = useRef(0);

    useEffect(() => {
        generationRef.current++;
        readingRef.current = false;
        setImages([]);
        setIsReading(false);
        setError('');
    }, [activeChatId]);

    const clear = () => {
        setImages([]);
        setError('');
    };
    const remove = (id: string) => {
        setImages(current => current.filter(image => image.id !== id));
        setError('');
    };
    const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
        const files = Array.from(event.clipboardData.items)
            .filter(item => item.kind === 'file')
            .map(item => item.getAsFile())
            .filter((file): file is File => file !== null && isAssistantImageFile(file));
        if (!files.length) return;
        event.preventDefault();

        const pastedText = event.clipboardData.getData('text/plain');
        const input = event.currentTarget;
        if (pastedText) {
            const start = input.selectionStart;
            const end = input.selectionEnd;
            const nextQuestion = input.value.slice(0, start) + pastedText + input.value.slice(end);
            onQuestionChange(nextQuestion);
            requestAnimationFrame(() => {
                input.setSelectionRange(start + pastedText.length, start + pastedText.length);
            });
        }

        if (readingRef.current) {
            setError('Wait for the pasted images to finish loading.');
            return;
        }
        const mimeTypes = files.map(assistantImageMimeType);
        if (mimeTypes.some(type => !type)) {
            setError('Paste a PNG, JPEG, or WebP image.');
            return;
        }
        if (files.some(file => file.size === 0)) {
            setError('This image is empty. Copy it again and paste it here.');
            return;
        }
        if (files.some(file => file.size > MAX_ASSISTANT_IMAGE_BYTES)) {
            setError('Each image must be at most 2 MB.');
            return;
        }
        if (images.length + files.length > MAX_ASSISTANT_IMAGE_COUNT) {
            setError(`Attach at most ${MAX_ASSISTANT_IMAGE_COUNT} images.`);
            return;
        }
        const totalBytes =
            images.reduce((total, image) => total + image.size, 0) +
            files.reduce((total, file) => total + file.size, 0);
        if (totalBytes > maxTotalImageBytes) {
            setError(`Attached images must total at most ${maxTotalImageLabel} MB.`);
            return;
        }

        const generation = generationRef.current;
        readingRef.current = true;
        setIsReading(true);
        setError('');
        void Promise.all(
            files.map(async (file, index) => {
                const mimeType = mimeTypes[index]!;
                const name = file.name.trim().slice(0, 100) || `image-${index + 1}`;
                return {
                    id: crypto.randomUUID(),
                    name,
                    size: file.size,
                    dataUrl: await readAssistantImage(file, mimeType),
                } satisfies AssistantImageAttachment;
            }),
        )
            .then(pastedImages => {
                if (generationRef.current === generation)
                    setImages(current => [...current, ...pastedImages]);
            })
            .catch(caught => {
                if (generationRef.current === generation)
                    setError(
                        caught instanceof Error
                            ? caught.message
                            : 'Could not read this image. Try copying it again.',
                    );
            })
            .finally(() => {
                if (generationRef.current === generation) {
                    readingRef.current = false;
                    setIsReading(false);
                }
            });
    };

    return { images, isReading, error, clear, remove, onPaste };
}

export function AssistantImageAttachments({
    images,
    isReading,
    onRemove,
}: {
    images: readonly AssistantImageAttachment[];
    isReading: boolean;
    onRemove: (id: string) => void;
}) {
    const [expandedImageIds, setExpandedImageIds] = useState('');
    const imageSetKey = images.map(image => image.id).join('|');
    const expanded = images.length > 5 && expandedImageIds === imageSetKey;
    return (
        <div className="assistant-image-attachments" role="group" aria-label="Attached images">
            {images.slice(0, expanded ? images.length : 5).map(image => (
                <span className="assistant-image-chip" key={image.id} title={image.name}>
                    <Icon name="image" />
                    <span>{image.name}</span>
                    <button
                        type="button"
                        className="assistant-image-chip-remove"
                        aria-label={`Remove ${image.name}`}
                        title={`Remove ${image.name}`}
                        onClick={() => onRemove(image.id)}
                    >
                        <Icon name="close" />
                    </button>
                </span>
            ))}
            {images.length > 5 && (
                <button
                    type="button"
                    className="assistant-image-more"
                    aria-expanded={expanded}
                    onClick={() => setExpandedImageIds(expanded ? '' : imageSetKey)}
                >
                    {expanded ? 'Show less' : `+${images.length - 5} more`}
                </button>
            )}
            {isReading && (
                <span className="assistant-image-attachment-status" role="status">
                    Adding images…
                </span>
            )}
        </div>
    );
}
