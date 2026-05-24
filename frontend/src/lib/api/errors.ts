/**
 * HTTP エラーレスポンスのボディ形式。
 * - `error`   : バックエンドが返す単一のエラーメッセージ
 * - `details` : Zod バリデーションエラー時の詳細（details[0].message を優先して使う）
 */
export type ErrorBody = { error?: string; details?: { message: string }[] } | null;

/**
 * HTTP エラーレスポンスのボディを JSON としてパースする。
 * パースに失敗した場合（502/504 等の非 JSON レスポンス）は null を返す。
 *
 * @param response - fetch の Response（!response.ok であること）
 * @returns パース結果、またはパース失敗時は null
 */
export async function parseErrorBody(response: Response): Promise<ErrorBody> {
  try {
    return (await response.json()) as ErrorBody;
  } catch {
    // 非 JSON レスポンス（502/504 等）
    return null;
  }
}

/**
 * HTTP エラーレスポンスのボディを解析して ApiError を throw する。
 * `response.ok === false` の場合に呼び出すこと。
 *
 * @param response - fetch の Response（!response.ok であること）
 * @param defaultMessage - メッセージが取得できない場合のフォールバック（省略時: 'エラーが発生しました'）
 */
export async function parseErrorResponse(
  response: Response,
  defaultMessage = 'エラーが発生しました'
): Promise<never> {
  const body = await parseErrorBody(response);
  const message = body?.details?.[0]?.message ?? body?.error ?? defaultMessage;
  throw new ApiError(response.status, message, body);
}

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
