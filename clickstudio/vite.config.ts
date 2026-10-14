import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import {
    MAX_ASSISTANT_TOTAL_IMAGE_BYTES,
    MAX_VERCEL_ASSISTANT_TOTAL_IMAGE_BYTES,
} from './src/shared/assistant/images.js';
const webPort = Number(process.env.CLICKSTUDIO_WEB_PORT ?? 5173);
const apiPort = Number(process.env.CLICKSTUDIO_API_PORT ?? 8080);
export default defineConfig({
    root: fileURLToPath(new URL('./src/frontend/app', import.meta.url)),
    publicDir: fileURLToPath(new URL('./public', import.meta.url)),
    plugins: [react(), tailwindcss()],
    define: {
        __ASSISTANT_MAX_TOTAL_IMAGE_BYTES__: JSON.stringify(
            process.env.CLICKSTUDIO_VERCEL_BUILD === '1'
                ? MAX_VERCEL_ASSISTANT_TOTAL_IMAGE_BYTES
                : MAX_ASSISTANT_TOTAL_IMAGE_BYTES,
        ),
    },
    server: {
        port: webPort,
        strictPort: true,
        // Match HTTP API URLs without proxying frontend request modules.
        proxy: { '^/api(?:/|$)': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } },
    },
    build: {
        outDir: fileURLToPath(new URL('./dist/frontend', import.meta.url)),
        emptyOutDir: true,
        target: 'es2022',
    },
});
