export {};

declare global {
    interface Window {
        dialogFocusHarness: {
            update: () => void;
        };
    }
}
