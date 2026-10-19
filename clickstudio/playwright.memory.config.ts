import { defineConfig } from '@playwright/test';
import previewConfig from './playwright.preview.config.js';

export default defineConfig(previewConfig, {
    testMatch: 'memory-soak.spec.ts',
    timeout: 120_000,
    workers: 1,
    projects: [{ name: 'chromium-memory', use: { browserName: 'chromium' } }],
});
