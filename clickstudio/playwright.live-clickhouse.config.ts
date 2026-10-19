import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const webPort = Number(process.env.CLICKSTUDIO_WEB_PORT ?? 5173);
const apiPort = Number(process.env.CLICKSTUDIO_API_PORT ?? 8080);
const baseURL = 'http://localhost:' + webPort;

export default defineConfig({
    testDir: './tests/e2e',
    testMatch: '**/live-clickhouse-soak.spec.ts',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    forbidOnly: Boolean(process.env.CI),
    timeout: 8 * 60_000,
    reporter: [
        ['line'],
        ['html', { open: 'never' }],
        ['json', { outputFile: 'test-results/live-clickhouse.json' }],
    ],
    projects: [{ name: 'chromium-live-clickhouse', use: { browserName: 'chromium' } }],
    use: {
        baseURL,
        viewport: { width: 1280, height: 720 },
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    webServer: {
        command: 'npm run dev',
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
            DEMO_MODE: 'false',
            HOST: '127.0.0.1',
            CLICKSTUDIO_TOKEN: '',
            CLICKSTUDIO_API_PORT: String(apiPort),
            CLICKSTUDIO_WEB_PORT: String(webPort),
            APP_ORIGIN: baseURL,
            OPENAI_API_KEY: '',
            DATA_DIR: mkdtempSync(join(tmpdir(), 'clickstudio-live-soak-')),
        },
    },
});
