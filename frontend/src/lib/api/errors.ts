/**
 * API レスポンスのエラーを表す共通例外。
 * HTTP エラー（4xx / 5xx）とネットワークエラーを統一的に扱う。
 */
export class ApiError extends Error {
  /**
   * HTTP ステータスコード。
   * - 200-599: HTTP ステータス
   * - 0: ネットワークエラー（fetch 自体が失敗した場合）
   */
  readonly status: number;

  /**
   * バックエンドが返した JSON body。
   * - レスポンスが JSON としてパース可能な場合はその値
   * - パース失敗時は null
   * - ネットワークエラー時は null
   */
  readonly body: unknown;

  /**
   * ApiError を生成する。
   *
   * @param status - HTTP ステータスコード（0 = ネットワークエラー）
   * @param message - エラーメッセージ（バックエンドの `error` フィールドまたは HTTP ステータス文言）
   * @param body - バックエンドが返した JSON body（省略可、デフォルト null）
   */
  constructor(status: number, message: string, body: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;

    // Error サブクラスのプロトタイプチェーンを正しく設定（TypeScript の問題回避）
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}
