import { defineConfig } from '@playwright/test';
import e2eConfig from './playwright.config.js';

// Use the full local API server, not the static preview. Route interception
// supplies deterministic result payloads while the real browser UI renders.
export default defineConfig({
    ...e2eConfig,
    testMatch: '**/large-results-soak.spec.ts',
    testIgnore: [],
    workers: 1,
    retries: 0,
    timeout: 6 * 60_000,
    projects: [{ name: 'chromium-large-results', use: { browserName: 'chromium' } }],
});
