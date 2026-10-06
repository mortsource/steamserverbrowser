import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const mock = (file: string): string => fileURLToPath(new URL(`./mocks/${file}`, import.meta.url));

export default defineConfig({
    resolve: {
        alias: {
            '@steambrew/client': mock('steambrew_client.ts'),
            'maplibre-gl': mock('maplibre_gl.ts'),
        },
    },
    test: {
        include: ['./test_*.ts'],
        setupFiles: ['./setup.ts'],
    },
});
