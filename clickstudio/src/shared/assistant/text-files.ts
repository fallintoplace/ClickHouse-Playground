export const MAX_ASSISTANT_TEXT_FILE_COUNT = 12;
export const MAX_ASSISTANT_TEXT_FILE_BYTES = 100_000;
export const MAX_ASSISTANT_TOTAL_TEXT_FILE_BYTES = 100_000;
export const ASSISTANT_TEXT_FILE_EXTENSIONS = ['csv', 'txt', 'sql'] as const;

export interface AssistantTextFile {
    name: string;
    content: string;
}

export function isAssistantTextFileName(name: string): boolean {
    return ASSISTANT_TEXT_FILE_EXTENSIONS.some(extension =>
        name.toLowerCase().endsWith(`.${extension}`),
    );
}
