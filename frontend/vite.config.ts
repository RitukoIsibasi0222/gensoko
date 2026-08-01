import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';

import { parseApiBaseUrl } from './src/lib/api/base-url';

export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    const environment = loadEnv(mode, process.cwd(), 'VITE_');
    const vercelEnvironment = process.env.VERCEL_ENV;

    parseApiBaseUrl(environment.VITE_API_BASE_URL, {
      allowMissing: false,
      requireHttps: vercelEnvironment === 'preview' || vercelEnvironment === 'production'
    });
  }

  return {
    plugins: [tailwindcss(), sveltekit()],
    server: {
      port: 5174,
      strictPort: true
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: [],
      exclude: [...configDefaults.exclude, 'e2e/**/*.spec.ts']
    }
  };
});
