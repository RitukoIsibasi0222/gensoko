import { loadEnv } from 'vite';

const VERCEL_BUILD_MODE = 'production';

/**
 * build:previewのvite buildと同じmode・rootから公開API URLを読み込む。
 *
 * @param {string} frontendRoot
 * @returns {string}
 */
export function loadExpectedApiUrl(frontendRoot) {
  const environment = loadEnv(VERCEL_BUILD_MODE, frontendRoot, 'VITE_');
  return environment.VITE_API_BASE_URL?.trim() ?? '';
}
