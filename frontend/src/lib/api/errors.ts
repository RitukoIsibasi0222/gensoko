/**
 * API レスポンスのエラーを表す共通例外。
 * HTTP エラー（4xx / 5xx）とネットワークエラーを統一的に扱う。
 */
export class ApiError extends Error {
  /**
   * HTTP ステータスコード。
   * - 通常は 400-599（HTTP エラー）または 0（ネットワークエラー）を想定
   * - ただし実装では範囲チェックをしていないため、任意の number が設定可能
   */
  readonly status: number;

  /**
   * バックエンドが返した JSON body。
   * - レスポンスが JSON としてパース可能な場合はその値
   * - パース失敗時は null
   * - ネットワークエラー時は null
   */
  readonly body: unknown | null;

  /**
   * ApiError を生成する。
   *
   * @param status - HTTP ステータスコード（通常は 400-599 または 0）
   * @param message - エラーメッセージ（バックエンドの `error` フィールドまたは HTTP ステータス文言）
   * @param body - バックエンドが返した JSON body（省略可、デフォルト null）
   */
  constructor(status: number, message: string, body: unknown | null = null) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.body = body;

    // Error サブクラスのプロトタイプチェーンを正しく設定（サブクラス化にも対応）
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
