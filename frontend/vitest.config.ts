import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

export default defineConfig({
    plugins: [svelte()],
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: []
    },
    resolve: {
        alias: {
            $lib: resolve(__dirname, './src/lib'),
            $app: resolve(__dirname, './node_modules/@sveltejs/kit/src/runtime/app')
        }
    }
});
