# API設計書

> ベースURL: `/api/v1`
> 認証が必要なエンドポイントには `🔒` を付与
> 管理者専用エンドポイントには `👑` を付与

---

## 全API共通レスポンスヘッダー

Hono API が生成する正常・エラー・404・CORS preflight レスポンスには、以下のセキュリティヘッダーを付与する。

| ヘッダー                            | 値                                                                                | 適用環境       |
| ----------------------------------- | --------------------------------------------------------------------------------- | -------------- |
| `Content-Security-Policy`           | `default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'` | 全環境         |
| `X-Frame-Options`                   | `DENY`                                                                            | 全環境         |
| `X-Content-Type-Options`            | `nosniff`                                                                         | 全環境         |
| `Referrer-Policy`                   | `strict-origin-when-cross-origin`                                                 | 全環境         |
| `Permissions-Policy`                | `camera=(), microphone=(), geolocation=()`                                        | 全環境         |
| `Cross-Origin-Resource-Policy`      | `same-origin`                                                                     | 全環境         |
| `X-XSS-Protection`                  | `0`                                                                               | 全環境         |
| `X-Permitted-Cross-Domain-Policies` | `none`                                                                            | 全環境         |
| `Strict-Transport-Security`         | `max-age=31536000; includeSubDomains`                                             | productionのみ |

- `X-Powered-By` は削除する。
- development/testではHSTSを付与しない。
- API用CSPはJSONレスポンスを対象とし、Vercel/SvelteKitが返すHTMLのCSPを代替しない。
- Cloudflare、リバースプロキシ、CDN等がHonoの外側で生成する502/504等のレスポンスは、このミドルウェアの保証対象外とする。
- CORSの許可origin、credentials、許可method・headerは既存契約を維持し、セキュリティヘッダーをCORS allowlistの代替にしない。
- productionの `FRONTEND_URL` は必須で、HTTP(S)のorigin形式だけを許可する。未設定・空文字・path/query/認証情報付きURLはapp構築時に拒否し、development/testだけ `http://localhost:5174` へfallbackする。
- Hono appでrouteが一致しない場合は404と `{ "error": "エンドポイントが見つかりません" }` を返す。
- Hono app内の未捕捉例外は500と `{ "error": "サーバーエラーが発生しました" }` を返し、内部の例外messageやstack traceをresponseへ含めない。server logにもraw例外を出さず、固定イベント名だけを記録する。

### account data完全削除の公開状態

- 本文に記載する本人退会・管理者強制退会・削除後auth・admin v1互換は、現行branchで実装済みのAPI契約である。
- staging/productionでのmigration・API/UI確認・legacy cleanupは未実行であり、本番適用済みとは扱わない。
- T1Bのprivacy・監査内部ID保持・backup/削除replay・本番cleanup体制が承認されるまで、物理削除backendの本番公開、production cleanup、contract migrationを行わない。

---

## 認証 `/api/v1/auth`

| メソッド | パス                    | 説明                                   | 認証   |
| -------- | ----------------------- | -------------------------------------- | ------ |
| POST     | `/auth/register`        | ユーザー登録                           | なし   |
| POST     | `/auth/verify-email`    | メール認証                             | なし   |
| POST     | `/auth/login`           | ログイン                               | なし   |
| POST     | `/auth/refresh`         | アクセストークン更新                   | Cookie |
| POST     | `/auth/logout`          | ログアウト（リフレッシュトークン削除） | 🔒     |
| POST     | `/auth/forgot-password` | パスワードリセットメール送信           | なし   |
| POST     | `/auth/reset-password`  | パスワードリセット実行                 | なし   |

### パスワード入力の共通方針

- 新しくbcryptハッシュとして保存する `/auth/register` の `password`、`/auth/reset-password` の `password`、`PATCH /users/me` の `newPassword` は、正規化後のUTF-8表現で72バイト以内とする。
- 73バイト以上は400バリデーションエラーとし、`details[].message` は「パスワードはUTF-8で72バイト以内にしてください」とする。
- `details[].path` は登録・リセットでは `["password"]`、パスワード変更では `["newPassword"]` とする。
- 照合用のログイン `password`、パスワード変更・アカウント削除の `currentPassword` には72バイト上限を適用しない。既存ユーザー互換性のため、正規化後の完全な値を比較する。
- バイト数は文字数ではなくUTF-8表現で数える。ASCII、日本語、絵文字のいずれも72バイトは受理し、73バイトは新規保存値として拒否する。

### POST `/auth/register`

```
Request:
{
  "username": "taro123",
  "email": "taro@example.com",
  "password": "Pass1234!"
}

Response 201:
{
  "message": "確認メールを送信しました"
}

Error:
400 バリデーションエラー
409 メールアドレスまたはユーザー名が既に使用されている
429 リクエストが多すぎます。しばらく待ってから再試行してください
503 一時的に利用できません。しばらく待ってから再試行してください
```

- 物理削除後はemail・usernameのunique値が解放されるため、同じ値で新しいUser IDを発行して再登録できる。旧User ID・学習履歴・監査内部IDとは自動的に関連付けない。
- cleanup前のlegacy soft-deleted rowが残る移行期間は、同じemail・usernameの再登録を403で拒否する。cleanup完了後は通常の新規登録として201を返す。

### POST `/auth/login`

```
Request:
{
  "email": "taro@example.com",
  "password": "Pass1234!"
}

Response 200:
{
  "accessToken": "eyJhb...",
  "user": {
    "id": "cuid",
    "username": "taro123",
    "role": "USER"
  }
}
Set-Cookie: refreshToken=xxx; HttpOnly; SameSite=Strict; Path=/api/v1/auth

※ production環境では`Secure`も付与する。

Error:
401 メールアドレスまたはパスワードが正しくありません
401 しばらく後に再試行してください
403 アカウントが停止されています
403 メールアドレスが確認されていません
409 アカウント情報が変更されました。再試行してください
429 リクエストが多すぎます。しばらく待ってから再試行してください
503 一時的に利用できません。しばらく待ってから再試行してください
```

監査ログ:

- 認証成功と、serviceが`AuthError`として判定した認証・アカウント状態の失敗を内部DBへ記録する。入力検証失敗、rate limit、想定外の内部エラーは記録対象外。
- 成功時は `LOGIN / SUCCESS` と内部user ID・roleを保存する。失敗時は `LOGIN / FAILURE`、actor/targetを`null`、理由を共通code `AUTHENTICATION_FAILED` とする。
- email、username、password、token、Cookie、Authorization、request/response body、IP、User-Agent、raw errorは保存しない。
- 成功監査はlogin状態更新・refresh token保存と同一transactionで記録し、監査保存失敗時は全体をrollbackして500を返す。失敗監査はbest-effortで、保存失敗時も元の401/403/409を維持する。
- password検証後にアカウント状態やroleが変わった場合に古い状態で成功させないよう、成功transaction内で状態を再確認する。再確認直後の競合は条件付き更新で検出し、409で再試行を求める。
- 物理削除後の旧資格情報と、cleanup前に残るlegacy soft-deleted rowは、存在しないaccountと同じ401・汎用messageを返す。削除済み専用messageでaccount状態を外部へ開示しない。

### POST `/auth/refresh`

- HttpOnly Cookieのrefresh tokenをsha256 hashで検索し、旧token削除と新token作成を同一transactionで実行する。
- User物理削除時はrefresh token rowもDB cascadeで削除されるため、旧Cookieによるrefreshは401を返す。
- token不存在・期限切れ・形式不正・単回使用済みの場合は、`/api/v1/auth` と `/api/v1/auth/refresh` の両PathのCookieを削除する。

Error:

- 401: リフレッシュトークンがありません / リフレッシュトークンの形式が不正です / 無効なリフレッシュトークンです / リフレッシュトークンの有効期限が切れています
- 403: アカウントが停止されています
- 500: サーバーエラーが発生しました

### POST `/auth/forgot-password`

- メールアドレスの存在有無を外部へ漏らさない既存responseを維持する。
- User物理削除後の旧メールアドレスと、cleanup前に残るlegacy soft-deleted rowは、どちらも200を返してreset token作成・メール送信を行わない。
- 申請操作は監査DBの対象外。内部例外時もraw error objectを出力せず、固定event名だけを運用ログへ記録する。
- rate limit超過時は429、rate limit store障害時は503を返し、この場合はメール送信処理を開始しない。

### POST `/auth/reset-password`

Request:

    {
      "token": "64文字のhexトークン",
      "password": "NewPass1!"
    }

Response 200:

    {
      "message": "パスワードをリセットしました"
    }

- `password` は強度要件とUTF-8・72バイト上限に従う。
- 72バイト超過を含む入力検証失敗時は、トークン検索・パスワード更新・トークン削除を開始しない。
- 成功時だけ `PASSWORD_RESET / SUCCESS` を、password更新・reset token削除・refresh token削除と同一transactionで記録する。
- actorは`null`、targetはtoken recordから特定した内部user IDとする。無効・期限切れ・使用済みtokenによる失敗は監査対象外。
- password、password hash、reset token、token hash、request body、raw errorは保存しない。

Error:

- 400: バリデーションエラー / トークンの有効期限が切れています / 無効または期限切れのトークンです
- 404: 無効なトークンです
- 429: リクエストが多すぎます。しばらく待ってから再試行してください
- 500: サーバーエラーが発生しました
- 503: 一時的に利用できません。しばらく待ってから再試行してください

---

## 元素 `/api/v1/elements`

| メソッド | パス            | 説明         | 認証 |
| -------- | --------------- | ------------ | ---- |
| GET      | `/elements`     | 元素一覧取得 | 任意 |
| GET      | `/elements/:id` | 元素詳細取得 | なし |

### GET `/elements`

```
Headers:
  Authorization: "Bearer <accessToken>"  // 任意。ログイン時のみ指定し、習得状態を付与

Query params:
  category?: string   // 分類フィルター（trim 後に完全一致）
  period?:   number   // 周期フィルター（1〜7 の整数）
  q?:        string   // キーワード検索（番号・記号・日本語名・英語名）

Search behavior:
  - q / category / period は AND 条件で組み合わせる
  - q の内部では id / symbol / nameJa / nameEn を OR 条件で検索する
  - id は文字列化した原子番号の部分一致（例: q=1 で 1, 10-19, 100-118 等）
  - symbol / nameEn は大文字小文字を区別しない部分一致
  - nameJa は日本語文字列の部分一致
  - category は完全一致。不明な分類は 400 ではなく 0 件
  - period が 1〜7 の整数でない場合は 400

Response 200:
{
  "elements": [
    {
      "id": 1,
      "symbol": "H",
      "nameJa": "水素",
      "nameEn": "Hydrogen",
      "category": "非金属",
      "period": 1,
      "group": 1,
      "atomicWeight": 1.008,
      "etymology": "ラテン語 hydrogenium に由来",
      "masteryStatus": "mastered"  // ログイン時のみ付与
    },
    ...
  ]
}

masteryStatus:
  "unlearned"  // 未学習: 回答履歴なし
  "learning"   // 学習中: 回答履歴あり、直近2回連続正解ではない
  "mastered"   // 習得: 直近2回連続正解

Error:
400 バリデーションエラー（period が 1〜7 の整数でない等）
401 Authorization ヘッダー形式不正・トークン無効
500 サーバーエラー
```

### GET `/elements/:id`

```
Path params:
  id: number  // 元素ID（1〜118 の10進整数）

Response 200:
{
  "element": {
    "id": 1,
    "symbol": "H",
    "nameJa": "水素",
    "nameEn": "Hydrogen",
    "category": "非金属",
    "period": 1,
    "group": 1,
    "atomicWeight": 1.008,
    "etymology": "ラテン語 hydrogenium に由来"
  }
}

Error:
400 バリデーションエラー（id が 1〜118 の10進整数でない）
404 元素が見つからない
500 サーバーエラー
```

---

## ゲーム `/api/v1/game`

| メソッド | パス                        | 説明                   | 認証 |
| -------- | --------------------------- | ---------------------- | ---- |
| GET      | `/game/questions`           | 問題セット取得（10問） | 🔒   |
| POST     | `/game/sessions`            | ゲーム結果を保存       | 🔒   |
| GET      | `/game/sessions`            | ゲーム履歴一覧         | 🔒   |
| GET      | `/game/sessions/:sessionId` | ゲーム結果詳細取得     | 🔒   |

### GET `/game/questions`

```
Query params:
  mode: GameMode  // 必須（例: "SYMBOL_TO_NAME_LV1"）

Response 200:
{
  "questionSetId": "cuid",
  "expiresAt": "2026-06-20T12:30:00.000Z",
  "questions": [
    {
      "questionId": "q1",
      "prompt": "H",            // 出題テキスト（記号 or 名前）
      "choices": [              // 4択の選択肢（正解位置はランダム）
        { "choiceId": "1", "text": "水素" },
        { "choiceId": "6", "text": "炭素" },
        { "choiceId": "8", "text": "酸素" },
        { "choiceId": "7", "text": "窒素" }
      ]
    },
    ...  // 10問分
  ]
}

// ※ 正解情報（correctChoiceId / 判定用 elementId）は GameQuestionSet.questions に保存し、クライアントに渡さない
// ※ questionSetId は POST /game/sessions に渡し、サーバー側で正誤判定する

Error:
400 error: バリデーションエラー（details に ゲームモードが正しくありません）
401 error: 認証が必要です / トークンが無効です / ユーザーが見つかりません
403 error: アカウントが停止されています / メールアドレスが確認されていません / アカウントがロックされています
409 error: 苦手モードを始めるには、苦手元素が5件以上必要です
429 error: リクエストが多すぎます。しばらく待ってから再試行してください
500 error: サーバーエラーが発生しました
```

### POST `/game/sessions`

```
Request:
{
  "questionSetId": "cuid",
  "mode": "SYMBOL_TO_NAME_LV1",
  "answers": [
    {
      "questionId": "q1",
      "chosenChoiceId": "1",  // ユーザーが選んだ choiceId。時間切れ時は null
      "answerTimeSec": 5
    },
    ...
  ],
  "durationSec": 72
}

Request validation:
  questionSetId: string  // 必須、trim 後に空文字不可
  mode: GameMode         // 必須、GET /game/questions で取得した mode と一致
  answers: array         // 必須、保存済み question 数と一致、questionId 重複不可
  questionId: string     // 必須、保存済み questionId と一致
  chosenChoiceId: string | null  // null は時間切れ。string は保存済み choiceId と一致
  answerTimeSec: number  // 0〜15 の整数
  durationSec: number    // 0〜1800 の整数

Response 201:
{
  "sessionId": "cuid",
  "mode": "SYMBOL_TO_NAME_LV1",
  "correctCount": 8,
  "totalCount": 10,
  "totalScore": 800,
  "maxStreak": 5,
  "durationSec": 72,
  "playedAt": "2026-06-20T12:35:00.000Z",
  "results": [
    {
      "questionId": "q1",
      "elementId": 1,
      "prompt": "H",
      "chosenChoiceId": "1",
      "isCorrect": true,
      "correctAnswer": "水素",
      "yourAnswer": "水素",
      "answerTimeSec": 5,
      "score": 100
    },
    {
      "questionId": "q2",
      "elementId": 2,
      "prompt": "He",
      "chosenChoiceId": null,
      "isCorrect": false,
      "correctAnswer": "ヘリウム",
      "yourAnswer": null,
      "answerTimeSec": 15,
      "score": 0
    },
    ...
  ]
}

Score:
  - 正解: 100
  - 不正解・時間切れ: 0
  - answerTimeSec は保存・表示用。クライアント申告値のため score には使わない
  - maxStreak は保存済み GameQuestionSet.questions の順序で計算

// ※ このレスポンスを /game/result の表示元にする
// ※ フロントエンドではスコア・正誤・連続正解を計算せず、サーバーが返した結果を表示する
// ※ クライアントは isCorrect / score / correctChoiceId / elementId を送信しない
// ※ 成功時は GameQuestionSet を削除し、二重送信を防ぐ

Error:
400 error: バリデーションエラー（details に 問題セットIDが正しくありません / ゲームモードが正しくありません / 回答形式が正しくありません / 回答時間が正しくありません） / 回答形式が正しくありません
401 error: 認証が必要です / トークンが無効です / ユーザーが見つかりません
403 error: アカウントが停止されています / メールアドレスが確認されていません / アカウントがロックされています
404 error: 問題セットが見つかりません
409 error: 問題セットの有効期限が切れています。もう一度ゲームを開始してください / 問題セットのゲームモードが一致しません / 問題セットはすでに送信済みです
429 error: リクエストが多すぎます。しばらく待ってから再試行してください
500 error: サーバーエラーが発生しました
503 error: 一時的に利用できません。しばらく待ってから再試行してください
```

### GET `/game/sessions`

```
Query params:
  limit?: number  // 1〜50 の整数。未指定・空文字は 20
  cursor?: string // 前回 response の nextCursor。trim 後に空文字は 400
  mode?: GameMode // 未指定なら全モード

Response 200:
{
  "sessions": [
    {
      "sessionId": "cuid",
      "mode": "SYMBOL_TO_NAME_LV1",
      "correctCount": 8,
      "totalCount": 10,
      "totalScore": 800,
      "maxStreak": 5,
      "durationSec": 72,
      "playedAt": "2026-06-20T12:35:00.000Z"
    }
  ],
  "nextCursor": "cuid-or-null"
}

Pagination:
  - 並び順は playedAt desc, id desc
  - nextCursor は次ページがある場合だけ、最後に表示した sessionId
  - cursor が存在しない、または本人のセッションでない場合は 400
  - 一覧は summary のみを返し、回答詳細 results は返さない

Error:
400 error: バリデーションエラー（details に 取得件数が正しくありません / カーソルが正しくありません / ゲームモードが正しくありません）
401 error: 認証が必要です / トークンが無効です / ユーザーが見つかりません
403 error: アカウントが停止されています / メールアドレスが確認されていません / アカウントがロックされています
429 error: リクエストが多すぎます。しばらく待ってから再試行してください
500 error: サーバーエラーが発生しました
```

### GET `/game/sessions/:sessionId`

```
Path params:
  sessionId: string  // 必須、trim 後に空文字不可

Response 200:
{
  "sessionId": "cuid",
  "mode": "SYMBOL_TO_NAME_LV1",
  "correctCount": 8,
  "totalCount": 10,
  "totalScore": 800,
  "maxStreak": 5,
  "durationSec": 72,
  "playedAt": "2026-06-20T12:35:00.000Z",
  "results": [
    {
      "questionId": "q1",
      "elementId": 1,
      "prompt": "H",
      "chosenChoiceId": "1",
      "isCorrect": true,
      "correctAnswer": "水素",
      "yourAnswer": "水素",
      "answerTimeSec": 5,
      "score": 100
    },
    {
      "questionId": "q2",
      "elementId": 2,
      "prompt": "He",
      "chosenChoiceId": null,
      "isCorrect": false,
      "correctAnswer": "ヘリウム",
      "yourAnswer": null,
      "answerTimeSec": 15,
      "score": 0
    },
    ...
  ]
}

// ※ /game/result?sessionId=... の再読み込み・直接アクセス時の表示元にする
// ※ POST /game/sessions の 201 response と同じ表示用形式を返す
// ※ フロントエンドではスコア・正誤・連続正解を計算せず、サーバーが返した結果を表示する
// ※ sessionId が存在しない場合と他ユーザー所有の場合はいずれも 404 とし、存在有無を漏らさない

Error:
400 error: バリデーションエラー（details に セッションIDが正しくありません）
401 error: 認証が必要です / トークンが無効です / ユーザーが見つかりません
403 error: アカウントが停止されています / メールアドレスが確認されていません / アカウントがロックされています
404 error: ゲーム結果が見つかりません
429 error: リクエストが多すぎます。しばらく待ってから再試行してください
500 error: サーバーエラーが発生しました
```

---

## 苦手リスト `/api/v1/weak`

| メソッド | パス               | 説明               | 認証 |
| -------- | ------------------ | ------------------ | ---- |
| GET      | `/weak`            | 苦手リスト取得     | 🔒   |
| DELETE   | `/weak/:elementId` | 苦手リストから削除 | 🔒   |

### GET `/weak`

```
Response 200:
{
  "weakElements": [
    {
      "elementId": 26,
      "symbol": "Fe",
      "nameJa": "鉄",
      "missCount": 3,
      "addedAt": "2026-05-01T00:00:00.000Z"
    },
    ...
  ]
}

Error:
401 error: 認証が必要です / トークンが無効です / ユーザーが見つかりません
403 error: アカウントが停止されています / メールアドレスが確認されていません / アカウントがロックされています
500 error: サーバーエラーが発生しました
```

※ `GET /weak` は `/game` の苦手件数表示・苦手モード開始可否判定に利用する。

### DELETE `/weak/:elementId`

```
Path params:
  elementId: 1から118の整数

Response 200:
{
  "message": "苦手リストから削除しました"
}

Error:
400 error: バリデーションエラー（details に 元素IDは1から118の整数で指定してください）
401 error: 認証が必要です / トークンが無効です / ユーザーが見つかりません
403 error: アカウントが停止されています / メールアドレスが確認されていません / アカウントがロックされています
404 error: 苦手元素が見つかりません
500 error: サーバーエラーが発生しました
```

---

## クライアント実装ガイドライン

> このセクションはフロントエンド開発者向けのガイドラインです。
> バックエンド API を呼び出す際のベストプラクティスをまとめています。

### エラーレスポンスの共通仕様

**すべてのエラーレスポンス**は `error` フィールドを必ず含みます：

**基本形式**:

```json
{
  "error": "エラーメッセージ（文字列）"
}
```

**バリデーションエラー時** (400):

```json
{
  "error": "バリデーションエラー",
  "details": [
    {
      "code": "too_small",
      "minimum": 8,
      "message": "パスワードは8文字以上にしてください",
      "path": ["password"]
    }
  ]
}
```

> **注意**: `details` フィールドはバリデーションエラー時にのみ追加されます（Zod の Issue 配列）。
> その他のエラー（401/403/404等）は基本形式のみです。
> パスワードのUTF-8・72バイト上限違反も同じ形式で返し、`message` と `path` は上記「パスワード入力の共通方針」に従います。

**ステータスコード一覧**:

| コード | 意味                  | 使用例                                   |
| ------ | --------------------- | ---------------------------------------- |
| 400    | Bad Request           | バリデーションエラー・リクエスト形式不正 |
| 401    | Unauthorized          | 認証失敗・トークン無効・アカウントロック |
| 403    | Forbidden             | 権限不足・メール未確認                   |
| 404    | Not Found             | リソースが存在しない                     |
| 409    | Conflict              | メールアドレス重複・ユーザー名重複       |
| 429    | Too Many Requests     | レート制限超過                           |
| 500    | Internal Server Error | サーバー内部エラー                       |
| 502    | Bad Gateway           | サーバーダウン（リバースプロキシ）       |
| 503    | Service Unavailable   | sensitive APIのレート制限store障害       |
| 504    | Gateway Timeout       | サーバータイムアウト                     |

#### レート制限の共通レスポンス

Honoがレート制限超過を検出した場合は、次のレスポンスを返します。

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 42
Content-Type: application/json
```

```json
{
  "error": "リクエストが多すぎます。しばらく待ってから再試行してください"
}
```

- `Retry-After` は現在の固定windowがリセットされるまでの秒数を切り上げた0以上の整数です。
- 複数バケットが超過した場合は、失敗したバケットのうち最大の待ち時間を返します。
- 成功レスポンスへ `RateLimit` / `RateLimit-*` ヘッダーは付けません。一般・専用・edgeの残回数を単一の値で正確に表せないためです。

sensitive policyでレート制限storeが利用できない場合は、処理を継続せず次を返します。

```http
HTTP/1.1 503 Service Unavailable
Retry-After: 60
Content-Type: application/json
```

```json
{
  "error": "一時的に利用できません。しばらく待ってから再試行してください"
}
```

| 対象                             | 一般制限      | 専用制限                         |
| -------------------------------- | ------------- | -------------------------------- |
| register/login/forgot-password   | 60回/60秒・IP | 10回/600秒・共有IP + 操作別email |
| reset-password                   | 60回/60秒・IP | 10回/600秒・共有IP               |
| password変更・account削除        | 60回/60秒・IP | 10回/600秒・IP + user            |
| `GET /game/questions`            | 60回/60秒・IP | 30回/60秒・IP                    |
| `POST /game/sessions`            | 60回/60秒・IP | 20回/60秒・IP + 20回/60秒・user  |
| その他の `/api/v1/*`             | 60回/60秒・IP | なし                             |
| `/`、`/api/v1/health`、`OPTIONS` | 対象外        | なし                             |

- email制限はZod検証成功後に適用します。不正JSON・不正emailはIPバケットだけを消費します。
- `POST /game/sessions` は専用IP制限、認証、専用user制限、Zod検証の順です。未認証リクエストはIPバケットを消費しますがuserバケットを消費しません。
- `GET /game/sessions` と `GET /game/sessions/:sessionId` はgame submit専用バケットを消費しません。
- IP resolverまたはHMAC生成が失敗した場合は、raw errorを返さずキー取得不能としてpolicyのfail-open / fail-closedを適用します。
- Cloudflare WAFがHono到達前に返すedge responseは、このJSON・CORS・`Retry-After`契約の保証対象外です。クライアントは非JSONレスポンスやnetwork errorでも既定メッセージを表示してください。

**重要**: 502/504 を含むエラー時は **非 JSON**（HTML、プレーンテキスト等）が返る可能性があります。

---

### Fetch API のベストプラクティス

#### パターン 1: 基本的なエラーハンドリング

```typescript
import { API_BASE_URL } from "$lib/api/config";
import { ApiError } from "$lib/api/errors";

async function callApi() {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim(), password: password.trim() }),
    credentials: "include", // HttpOnly Cookie 用
  });

  // ステップ 1: response.ok を最初にチェック
  if (!response.ok) {
    // ステップ 2: JSON パースを try-catch で囲む（502/504 対策）
    let errorBody: { error?: string; details?: { message: string }[] } | null =
      null;
    try {
      errorBody = await response.json();
    } catch {
      // JSON パース失敗 = 非 JSON レスポンス（HTML、プレーンテキスト等）
      // null を使う（空オブジェクト {} は使わない）
    }

    // ステップ 3: details[0].message を優先（400 バリデーションエラー時の具体的な Zod メッセージを使用）
    const message =
      errorBody?.details?.[0]?.message ??
      errorBody?.error ??
      "エラーが発生しました";
    throw new ApiError(response.status, message, errorBody);
  }

  // 正常系: response.ok が true なら JSON が返る
  return await response.json();
}
```

**なぜこの順序が重要か**:

- **502/504 等サーバーダウン時は非 JSON（HTML、プレーンテキスト等）が返る可能性がある** → JSON パースで例外が発生
- `response.ok` を先にチェックすれば、エラー時も安全に JSON パースできる
- バックエンドが返す具体的なエラーメッセージ（例: 「メールアドレスが確認されていません」）を上書きしない

---

#### パターン 2: ステータスコード別の処理

```typescript
function toJpMessage(status: number, fallback: string): string {
  switch (status) {
    case 400:
      return "入力内容を確認してください";
    case 401:
      // バックエンドが具体的な理由を返す場合は fallback を優先
      // 例: "メールアドレスまたはパスワードが正しくありません"
      //      "アカウントがロックされています。しばらく後に再試行してください"
      return fallback;
    case 403:
      // 例: "メールアドレスが確認されていません"
      return fallback;
    case 404:
      return "リソースが見つかりません";
    case 409:
      // 例: "メールアドレスは既に使用されています"
      return fallback;
    case 429:
      return fallback;
    case 503:
      return fallback;
    case 500:
      return "サーバーエラーが発生しました";
    default:
      return fallback || "エラーが発生しました";
  }
}

// 使用例
try {
  await callApi();
} catch (error) {
  if (error instanceof ApiError) {
    const message = toJpMessage(error.status, error.message);
    toastStore.error(message);
  }
}
```

---

#### パターン 3: バリデーションと送信の一貫性

```typescript
function validate(): string | null {
  // 正規化した値を作成
  const normalizedEmail = email.trim();
  const normalizedPassword = password.trim();

  // 空欄チェック
  if (!normalizedEmail) return "メールアドレスを入力してください";
  if (!normalizedPassword) return "パスワードを入力してください";

  // 形式チェック（正規化済みの値を使う）
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(normalizedEmail)) {
    return "メールアドレスの形式が正しくありません";
  }

  return null;
}

async function handleSubmit() {
  // バリデーション
  const error = validate();
  if (error) {
    errorMessage = error;
    return;
  }

  // 送信時も同じように trim した値を使う
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: email.trim(), // バリデーションと同じ
      password: password.trim(), // バリデーションと同じ
    }),
  });
}
```

**重要**: バリデーションで `trim()` した値をチェックするなら、送信時も `trim()` した値を送る。

---

### よくある実装ミスと修正方法

| ミス                                      | 問題                         | 修正方法                                      |
| ----------------------------------------- | ---------------------------- | --------------------------------------------- |
| JSON パースを先にする                     | 502/504 で例外が発生         | `response.ok` を先にチェック                  |
| エラー時の JSON パースを try-catch しない | 非 JSON レスポンスで例外     | try-catch で囲む                              |
| バックエンドのメッセージを上書き          | 具体的なエラー理由が失われる | `fallback` を優先する                         |
| バリデーションと送信で異なる値を使う      | サーバー側で認証失敗         | 両方で `trim()` した値を使う                  |
| 存在しないステータスコードをハンドリング  | 到達不能コード               | `backend/src/services/auth.service.ts` を確認 |
| 環境変数を各ファイルで重複定義            | 方針がズレる                 | `$lib/api/config.ts` で一元管理               |

---

## ユーザー `/api/v1/users`

| メソッド | パス              | 説明                       | 認証 |
| -------- | ----------------- | -------------------------- | ---- |
| GET      | `/users/me`       | 自分のプロフィール取得     | 🔒   |
| PATCH    | `/users/me`       | ユーザー名・パスワード変更 | 🔒   |
| DELETE   | `/users/me`       | アカウント削除             | 🔒   |
| GET      | `/users/me/stats` | 自分の統計取得             | 🔒   |

### GET `/users/me`

Headers:

- `Authorization: Bearer <accessToken>`

Response 200:

    {
      "user": {
        "id": "cuid",
        "username": "taro123",
        "email": "taro@example.com",
        "role": "USER",
        "createdAt": "2026-05-01T00:00:00.000Z"
      }
    }

Response fields:

- user.id: ユーザーID
- user.username: ユーザー名
- user.email: メールアドレス
- user.role: `"USER"` または `"ADMIN"`
- user.createdAt: 登録日時

Error:
401 error: 認証が必要です / トークンが無効です / ユーザーが見つかりません（認証ミドルウェアで検出した場合）
403 error: アカウントが停止されています / メールアドレスが確認されていません / アカウントがロックされています / ユーザーが見つかりません（サービス層で検出した場合）
500 error: サーバーエラーが発生しました

### PATCH `/users/me`

Headers:

- `Authorization: Bearer <accessToken>`
- `Content-Type: application/json`

ユーザー名変更 Request:

    {
      "username": "new_name_123"
    }

ユーザー名変更 Response 200:

    {
      "message": "ユーザー名を変更しました",
      "user": {
        "id": "cuid",
        "username": "new_name_123",
        "role": "USER"
      }
    }

パスワード変更 Request:

    {
      "currentPassword": "OldPass1!",
      "newPassword": "NewPass1!"
    }

パスワード変更 Response 200:

    {
      "message": "パスワードを変更しました"
    }

Cookie:

- パスワード変更成功時は既存 refresh token を DB から削除し、`refreshToken` Cookie を削除する
- 削除対象 Cookie path: `/api/v1/auth`, `/api/v1/auth/refresh`
- 変更後は再ログインが必要

監査ログ:

- password変更成功時だけ `PASSWORD_CHANGE / SUCCESS` を、password更新・refresh token削除と同一transactionで記録する。
- actor/targetには認証済みユーザーの内部IDとroleだけを保存し、password、password hash、token、Cookie、request bodyは保存しない。
- username変更、入力検証失敗、現在password不一致、認証middlewareでの拒否は監査対象外。

Validation:

- `username` は username schema に従う
- `currentPassword` は空文字不可。既存ユーザー照合値のためUTF-8・72バイト上限は適用しない
- `newPassword` は strong password schema とUTF-8・72バイト上限に従う
- `newPassword` が既存ハッシュとbcrypt上同一になる場合は拒否する。既存の72バイト超パスワードの先頭72バイトへの変更も同一として扱う
- `username` と `currentPassword/newPassword` を混在させた payload は 400
- username 変更は同じ username の場合も 200 で現在値を返す

Error:
400 error: バリデーションエラー / 現在のパスワードが正しくありません / 新しいパスワードは現在のパスワードと異なるものにしてください
401 error: 認証が必要です / トークンが無効です / ユーザーが見つかりません（認証ミドルウェアで検出した場合）
403 error: アカウントが停止されています / メールアドレスが確認されていません / アカウントがロックされています / ユーザーが見つかりません（サービス層で検出した場合）
409 error: このユーザー名は既に使用されています / パスワードが既に変更されています。再ログインしてください
429 error: リクエストが多すぎます。しばらく待ってから再試行してください（パスワード変更時）
500 error: サーバーエラーが発生しました
503 error: 一時的に利用できません。しばらく待ってから再試行してください（パスワード変更時）

### DELETE `/users/me`

Headers:

- `Authorization: Bearer <accessToken>`
- `Content-Type: application/json`

Request:

    {
      "currentPassword": "Pass1234!"
    }

Validation:

- `currentPassword` は空文字不可
- 既存ユーザー照合値のためUTF-8・72バイト上限は適用せず、正規化後の完全な値を比較する

Response 200:

    {
      "message": "アカウントを削除しました"
    }

Deletion behavior:

- bcrypt照合後、Serializable transaction内でUser・password hash・利用状態を再確認する
- Userを物理削除し、refresh token、password reset token、email verification token、学習データなどの所有rowはDB cascadeで削除する
- 最後の利用可能な管理者は409で保護する
- User削除と`USER_ACCOUNT_DELETE / SUCCESS`監査を同じtransactionへ保存する。成功監査は内部User IDと削除前roleだけを保持する
- 成功時は `refreshToken` Cookie を `/api/v1/auth` と `/api/v1/auth/refresh` の両方で削除する

Error:
400 error: バリデーションエラー / 現在のパスワードが正しくありません
401 error: 認証が必要です / トークンが無効です / ユーザーが見つかりません（認証ミドルウェアで検出した場合）
403 error: アカウントが停止されています / メールアドレスが確認されていません / アカウントがロックされています
409 error: 最後の管理者は退会できません / アカウントの状態が変更されています。再ログインしてください / 同時操作により退会できませんでした。再試行してください
429 error: リクエストが多すぎます。しばらく待ってから再試行してください
500 error: サーバーエラーが発生しました
503 error: 一時的に利用できません。しばらく待ってから再試行してください

### GET /users/me/stats

Headers:

- `Authorization: Bearer <accessToken>`

Response 200:

    {
      "stats": {
        "totalGames": 12,
        "totalCorrect": 91,
        "totalAnswered": 120,
        "averageAccuracyRate": 76,
        "masteredCount": 18,
        "currentStreak": 5,
        "weeklyScore": 2400,
        "allTimeScore": 9200,
        "lastActiveDate": "2026-06-20T00:00:00.000Z",
        "updatedAt": "2026-06-20T12:35:00.000Z"
      },
      "recentAccuracyTrend": [
        {
          "sessionId": "cuid",
          "playedAt": "2026-06-20T12:35:00.000Z",
          "correctCount": 8,
          "totalCount": 10,
          "accuracyRate": 80
        }
      ]
    }

Empty response 200:

    {
      "stats": {
        "totalGames": 0,
        "totalCorrect": 0,
        "totalAnswered": 0,
        "averageAccuracyRate": 0,
        "masteredCount": 0,
        "currentStreak": 0,
        "weeklyScore": 0,
        "allTimeScore": 0,
        "lastActiveDate": null,
        "updatedAt": null
      },
      "recentAccuracyTrend": []
    }

Response fields:

- stats.totalGames: 累計ゲーム回数。0 以上の整数
- stats.totalCorrect: 累計正解数。0 以上かつ stats.totalAnswered 以下の整数
- stats.totalAnswered: 累計回答数。0 以上の整数
- stats.averageAccuracyRate: totalCorrect / totalAnswered の整数パーセント。0〜100。totalAnswered が 0 の場合は 0
- stats.masteredCount: 習得済み元素数。0 以上の整数
- stats.currentStreak: 現在の連続ログイン日数。0 以上の整数
- stats.weeklyScore: 週間スコア。0 以上の整数
- stats.allTimeScore: 全期間スコア。0 以上の整数
- stats.lastActiveDate: 最終アクティブ日。未記録なら null
- stats.updatedAt: 統計更新日時。未記録なら null
- recentAccuracyTrend: 直近10ゲームの正答率推移。古い順に返す
- recentAccuracyTrend[].correctCount: ゲームごとの正解数。0 以上かつ totalCount 以下の整数
- recentAccuracyTrend[].totalCount: ゲームごとの回答数。0 以上の整数
- recentAccuracyTrend[].accuracyRate: ゲームごとの正答率。0〜100 の整数。totalCount が 0 の場合は 0
- 保存済みデータに不整合がある場合も、レスポンスでは上記の範囲に正規化して返す

Error:
401 error: 認証が必要です / トークンが無効です / ユーザーが見つかりません（認証ミドルウェアで検出した場合）
403 error: アカウントが停止されています / メールアドレスが確認されていません / アカウントがロックされています / ユーザーが見つかりません（サービス層で検出した場合）
500 error: サーバーエラーが発生しました

---

## ランキング `/api/v1/ranking`

| メソッド | パス               | 説明                                     | 認証 |
| -------- | ------------------ | ---------------------------------------- | ---- |
| GET      | `/ranking/weekly`  | 週間ランキング（上位50件・自分の順位）   | 任意 |
| GET      | `/ranking/alltime` | 全期間ランキング（上位50件・自分の順位） | 任意 |

認証:

- 未ログインでも閲覧可能
- `myRank` フィールドは常に返す。`Authorization: Bearer <accessToken>` がある場合のみ順位を算出し、未ログイン・ランキング対象外の場合は `null` を返す
- Authorization ヘッダー形式不正・token 無効時は 401

ランキング対象:

- `UserStats.totalGames > 0`
- `User.isActive = true`
- `User.deletedAt = null`
- 同点は同順位。次順位はスキップする（例: 1位、1位、3位）

### GET `/ranking/weekly`

Response 200:

    {
      "ranking": [
        {
          "rank": 1,
          "username": "taro123",
          "weeklyScore": 15000,
          "totalGames": 30,
          "accuracyRate": 86
        }
      ],
      "myRank": 42
    }

### GET `/ranking/alltime`

Response 200:

    {
      "ranking": [
        {
          "rank": 1,
          "username": "hanako",
          "allTimeScore": 92000,
          "totalGames": 180,
          "accuracyRate": 91
        }
      ],
      "myRank": null
    }

Response fields:

- ranking: 最大50件
- ranking[].rank: score 降順の順位。同点は同順位
- ranking[].username: 表示名
- ranking[].weeklyScore: 週間ランキングレスポンス（`GET /ranking/weekly`）で返すスコア。0 以上の整数
- ranking[].allTimeScore: 全期間ランキングレスポンス（`GET /ranking/alltime`）で返すスコア。0 以上の整数
- ranking[].totalGames: 累計ゲーム回数。0 以上の整数
- ranking[].accuracyRate: totalCorrect / totalAnswered の整数パーセント。0〜100。totalAnswered が 0 の場合は 0
- myRank: ログイン済みユーザーの順位。未ログイン、統計なし、未プレイ、ランキング対象外なら null

Error:
401 error: 認証形式が正しくありません / トークンが無効です
500 error: サーバーエラーが発生しました

---

## 管理者 `/api/v1/admin`

| メソッド | パス                      | 説明                 | 認証 |
| -------- | ------------------------- | -------------------- | ---- |
| GET      | `/admin/users`            | ユーザー一覧         | 👑   |
| GET      | `/admin/users/:id`        | ユーザー詳細         | 👑   |
| PATCH    | `/admin/users/:id/status` | アカウント停止・解除 | 👑   |
| PATCH    | `/admin/users/:id/role`   | ロール変更           | 👑   |
| DELETE   | `/admin/users/:id`        | 強制退会             | 👑   |
| GET      | `/admin/stats`            | サービス全体の統計   | 👑   |

### 共通仕様

全 endpoint は `authMiddleware` と `adminMiddleware` を通す。
レスポンスには `passwordHash`、refresh token、email verification token、password reset token などの機密情報を含めない。

account data完全削除への移行中も、旧frontendとのv1互換を次のとおり維持する。

- 一覧・詳細・status/role mutationのdeprecated `deletedAt` は、DB値を公開せず常に `null` を返す。
- deprecated `status=deleted` は入力として受理するが、200で `users: []`, `nextCursor: null` を返す。
- statsのdeprecated `users.deleted` は常に `0` を返し、`users.total` とgame/learning statsは現在保持中のUserとその所有dataだけを集計する。
- legacy soft-deleted userは一覧へ含めず、詳細は物理削除済みUserと同じ404を返す。mutationの移行用409判定はcontract migrationまで維持する。

共通エラー:

```text
400 error: バリデーションエラー
401 error: 認証が必要です / トークンが無効です / ユーザーが見つかりません
403 error: 管理者権限が必要です / アカウントが停止されています / メールアドレスが確認されていません / アカウントがロックされています
409 error: 同時操作により処理できませんでした。再試行してください
500 error: サーバーエラーが発生しました
```

最後の管理者保護で数える「利用可能な管理者」は、以下をすべて満たすユーザーとする。

- `role = ADMIN`
- `isActive = true`
- `deletedAt = null`
- `emailVerified = true`
- `lockedUntil = null` または現在時刻以前

停止・ロール変更・強制退会の mutation は Serializable transaction で実行し、同時操作の競合が解消できない場合は 409 `同時操作により処理できませんでした。再試行してください` を返す。

監査ログ:

- 状態変更、ロール変更、強制退会は、操作ごとのaction・result・actor内部ID/roleを記録する。停止と解除は別actionとして記録する。
- target内部IDはDBで対象ユーザーを確認できた場合だけ保存する。対象不存在やtransaction競合など対象を確認できない失敗では、未検証のpath入力を保存せず`targetType`と`targetId`を`null`にする。
- 成功監査は本体変更と同じSerializable transaction内へ含める。P2034 retry時もcommitされた最終transactionの1件だけが残る。
- serviceで判定した対象不存在・自己操作・最後の管理者保護・対象状態競合・retry枯渇は、安全な分類codeで1件だけbest-effort記録する。
- 入力検証失敗、401/403のmiddleware拒否、一覧・詳細・統計など参照系APIは監査対象外。
- email、username、変更前後のUser object、request/response、token、raw errorなどの個人情報・秘密情報は保存しない。監査ログの閲覧・更新・削除APIは今回追加しない。

### GET `/admin/users`

Query params:

| パラメータ | 型                                     | 既定値 | 説明                                                                    |
| ---------- | -------------------------------------- | ------ | ----------------------------------------------------------------------- |
| `limit`    | number                                 | 20     | 1〜100。未指定または空文字は20                                          |
| `cursor`   | string                                 | なし   | 前回レスポンスの `nextCursor`。trim 後空文字は400                       |
| `q`        | string                                 | なし   | `username` / `email` の部分一致。trim 後100文字以内。空文字は未指定扱い |
| `role`     | `"USER" \| "ADMIN"`                    | なし   | ロール filter                                                           |
| `status`   | `"active" \| "suspended" \| "deleted"` | なし   | 状態 filter。`deleted` はdeprecated互換入力                             |

Response 200:

```ts
{
  users: [
    {
      id: string,
      username: string,
      email: string,
      role: "USER" | "ADMIN",
      emailVerified: boolean,
      isActive: boolean,
      deletedAt: string | null,
      lockedUntil: string | null,
      lastLoginAt: string | null,
      createdAt: string,
      updatedAt: string,
      stats: {
        totalGames: number,
        accuracyRate: number,
        weeklyScore: number,
        allTimeScore: number
      }
    }
  ],
  nextCursor: string | null
}
```

Status filter:

- `active`: `isActive = true` かつ `deletedAt = null`
- `suspended`: `isActive = false` かつ `deletedAt = null`
- 未指定: legacy soft-deleted userを除く現在保持中のUser
- `deleted`: deprecated互換として200の空一覧、`nextCursor = null`

Sort:

- `createdAt desc`, `id desc`

Error:

```text
400 error: バリデーションエラー / カーソルが正しくありません
```

### GET `/admin/users/:id`

Path params:

| パラメータ | 型     | 説明                            |
| ---------- | ------ | ------------------------------- |
| `id`       | string | ユーザーID。trim 後に空文字不可 |

Response 200:

```ts
{
  user: {
    id: string,
    username: string,
    email: string,
    role: "USER" | "ADMIN",
    emailVerified: boolean,
    isActive: boolean,
    deletedAt: string | null,
    loginFailCount: number,
    lockedUntil: string | null,
    lastLoginAt: string | null,
    createdAt: string,
    updatedAt: string,
    stats: {
      totalGames: number,
      totalCorrect: number,
      totalAnswered: number,
      accuracyRate: number,
      masteredCount: number,
      currentStreak: number,
      weeklyScore: number,
      allTimeScore: number,
      lastActiveDate: string | null,
      updatedAt: string | null
    }
  }
}
```

Error:

```text
404 error: ユーザーが見つかりません
```

### PATCH `/admin/users/:id/status`

Path params:

| パラメータ | 型     | 説明                            |
| ---------- | ------ | ------------------------------- |
| `id`       | string | ユーザーID。trim 後に空文字不可 |

Request:

```ts
{
  isActive: boolean;
}
```

Response 200:

```ts
{
  message: "アカウントを停止しました" | "アカウント停止を解除しました",
  user: {
    id: string,
    username: string,
    email: string,
    role: "USER" | "ADMIN",
    emailVerified: boolean,
    isActive: boolean,
    deletedAt: string | null,
    lockedUntil: string | null,
    lastLoginAt: string | null,
    createdAt: string,
    updatedAt: string
  }
}
```

Rules:

- 自分自身は停止/解除できない。
- 利用可能な管理者が0人になる停止は409。
- 削除済みユーザーの停止/解除は409。
- 停止時は `isActive=false`, `lockedUntil=null` にし、refresh token / password reset token / email verification token を削除する。
- 解除時は `isActive=true`, `lockedUntil=null` にする。token は再発行しない。

Error:

```text
404 error: ユーザーが見つかりません
409 error: 自分自身には実行できません / 最後の管理者は変更できません / 削除済みユーザーは変更できません / 同時操作により処理できませんでした。再試行してください
```

### PATCH `/admin/users/:id/role`

Path params:

| パラメータ | 型     | 説明                            |
| ---------- | ------ | ------------------------------- |
| `id`       | string | ユーザーID。trim 後に空文字不可 |

Request:

```ts
{
  role: "USER" | "ADMIN";
}
```

Response 200:

```ts
{
  message: "ロールを変更しました",
  user: {
    id: string,
    username: string,
    email: string,
    role: "USER" | "ADMIN",
    emailVerified: boolean,
    isActive: boolean,
    deletedAt: string | null,
    lockedUntil: string | null,
    lastLoginAt: string | null,
    createdAt: string,
    updatedAt: string
  }
}
```

Rules:

- 自分自身の role は変更できない。
- 利用可能な管理者が0人になる降格は409。
- 停止済み・削除済みユーザーの role は変更できない。
- `ADMIN` に昇格できるのは `emailVerified=true`, `isActive=true`, `deletedAt=null` のユーザーのみ。
- 認可は DB の最新 role を参照するため、ロール変更は次リクエストから反映される。
- ロール変更時に refresh token は削除しない。

Error:

```text
404 error: ユーザーが見つかりません
409 error: 自分自身には実行できません / 最後の管理者は変更できません / 停止中または削除済みのユーザーは変更できません / メール認証済みで有効なユーザーのみ管理者にできます / 同時操作により処理できませんでした。再試行してください
```

### DELETE `/admin/users/:id`

Path params:

| パラメータ | 型     | 説明                            |
| ---------- | ------ | ------------------------------- |
| `id`       | string | ユーザーID。trim 後に空文字不可 |

Response 200:

```ts
{
  message: "ユーザーを強制退会しました";
}
```

Rules:

- Serializable transaction内でactorを再取得し、現在も利用可能なADMINであることを確認する。
- actorが降格・停止・メール未確認・lock・削除済みの場合は、target取得前に409で中止する。
- Userを物理削除し、認証・学習データなどの所有rowはDB cascadeで削除する。
- User削除と`ADMIN_USER_FORCE_DELETE / SUCCESS`監査を同じtransactionへ保存する。
- 自分自身は強制退会できない。
- 利用可能な管理者が0人になる強制退会は409。
- 物理削除済みまたはcleanup済みのユーザーは404。移行中に残るlegacy soft-deleted userは409。
- actor状態競合の失敗監査には、未確認のtarget IDを保存しない。

Error:

```text
400 error: バリデーションエラー / ユーザーIDが正しくありません
401 error: 認証が必要です / トークンが無効です
403 error: 管理者権限が必要です
404 error: ユーザーが見つかりません
409 error: 自分自身には実行できません / 最後の管理者は変更できません / 管理者の状態が変更されています。再ログインしてください / ユーザーは既に削除されています / 同時操作により処理できませんでした。再試行してください
429 error: リクエストが多すぎます。しばらく待ってから再試行してください
500 error: サーバーエラーが発生しました
```

### GET `/admin/stats`

Response 200:

```ts
{
  users: {
    total: number,
    active: number,
    suspended: number,
    deleted: number,
    admins: number,
    emailVerified: number
  },
  games: {
    totalSessions: number,
    totalAnswered: number,
    averageAccuracyRate: number
  },
  learning: {
    totalWeakElements: number,
    totalMasteredCount: number
  }
}
```

Aggregation:

- `users.total` はlegacy soft-deleted userを除く現在保持中のUserを `user.count` で数える。
- `users.deleted` はdeprecated v1互換値として常に `0` を返す。
- `active` / `suspended` / `admins` / `emailVerified` も現在保持中のUserだけを数える。`admins` は利用可能な管理者数ではなく、表示用の `role=ADMIN` 件数。
- `games.totalSessions` は現在保持中のUserに属する `gameSession.count` を使う。
- `games.totalAnswered` と `games.averageAccuracyRate` は現在保持中のUserに属する `userStats.aggregate` の `totalAnswered` / `totalCorrect` 合計から算出する。
- `learning.totalWeakElements` は現在保持中のUserに属する `weakElement.count` を使う。
- `learning.totalMasteredCount` は現在保持中のUserに属する `userStats.aggregate` の `masteredCount` 合計から算出する。
- これらは現在保持中のdataの運用統計であり、退会者を含むhistorical KPIではない。
