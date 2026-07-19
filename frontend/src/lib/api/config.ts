/**
 * API 設定の一元管理
 *
 * このファイルで API ベース URL やその他の API 関連設定を管理する。
 * 複数のファイルで同じ設定を重複して定義しないこと。
 */

import { parseApiBaseUrl } from './base-url';

/**
 * API ベース URL（環境変数から取得）
 *
 * VITE_API_BASE_URL には `/api/v1` まで含める。
 * 例: "http://localhost:3000/api/v1"
 *
 * 開発環境だけは未設定時に空文字列へフォールバックして警告する。
 * production build/runtimeでは未設定・不正値を拒否する。
 */
export const API_BASE_URL = parseApiBaseUrl(import.meta.env.VITE_API_BASE_URL, {
  allowMissing: import.meta.env.DEV,
  requireHttps: false
});

/**
 * 開発環境で VITE_API_BASE_URL 未設定を早期検知する
 *
 * 本番ビルドでコンソールに出続けないよう import.meta.env.DEV で限定する。
 * 各ファイルで個別に警告を出すのではなく、この設定ファイル読み込み時に一度だけ警告する。
 */
if (import.meta.env.DEV && !import.meta.env.VITE_API_BASE_URL) {
  console.warn(
    '[API Config] VITE_API_BASE_URL が設定されていません。\n' +
      'API リクエストが失敗する可能性があります。\n' +
      '.env ファイルに VITE_API_BASE_URL を設定してください。\n' +
      '例: VITE_API_BASE_URL="http://localhost:3000/api/v1"'
  );
}
