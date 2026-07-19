export type ParseApiBaseUrlOptions = {
  allowMissing: boolean;
  requireHttps: boolean;
};

const MISSING_API_BASE_URL_MESSAGE = 'VITE_API_BASE_URLが設定されていません';
const INVALID_API_BASE_URL_MESSAGE = 'VITE_API_BASE_URLの形式が不正です';
const HTTPS_REQUIRED_MESSAGE = 'Preview・productionのVITE_API_BASE_URLにはHTTPS URLが必要です';

/**
 * API base URLを環境境界で検証・正規化する。
 *
 * raw値はerrorへ含めず、credential・query・fragment・契約外pathを拒否する。
 */
export function parseApiBaseUrl(
  value: string | undefined,
  options: ParseApiBaseUrlOptions
): string {
  const normalizedValue = value?.trim() ?? '';

  if (!normalizedValue) {
    if (options.allowMissing) {
      return '';
    }
    throw new Error(MISSING_API_BASE_URL_MESSAGE);
  }

  let url: URL;
  try {
    url = new URL(normalizedValue);
  } catch {
    throw new Error(INVALID_API_BASE_URL_MESSAGE);
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/api/v1'
  ) {
    throw new Error(INVALID_API_BASE_URL_MESSAGE);
  }

  if (options.requireHttps && url.protocol !== 'https:') {
    throw new Error(HTTPS_REQUIRED_MESSAGE);
  }

  return url.href;
}
