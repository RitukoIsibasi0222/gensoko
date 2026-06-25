# API設計書

> ベースURL: `/api/v1`
> 認証が必要なエンドポイントには `🔒` を付与
> 管理者専用エンドポイントには `👑` を付与

---

## 認証 `/api/v1/auth`

| メソッド | パス | 説明 | 認証 |
|---------|------|------|------|
| POST | `/auth/register` | ユーザー登録 | なし |
| POST | `/auth/verify-email` | メール認証 | なし |
| POST | `/auth/login` | ログイン | なし |
| POST | `/auth/refresh` | アクセストークン更新 | Cookie |
| POST | `/auth/logout` | ログアウト（リフレッシュトークン削除） | 🔒 |
| POST | `/auth/forgot-password` | パスワードリセットメール送信 | なし |
| POST | `/auth/reset-password` | パスワードリセット実行 | なし |

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
```

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
Set-Cookie: refreshToken=xxx; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth/refresh

Error:
401 メールアドレスまたはパスワードが正しくありません
403 アカウントがロックされています
403 メール認証が完了していません
```

---

## 元素 `/api/v1/elements`

| メソッド | パス | 説明 | 認証 |
|---------|------|------|------|
| GET | `/elements` | 元素一覧取得 | 任意 |
| GET | `/elements/:id` | 元素詳細取得 | なし |

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

| メソッド | パス | 説明 | 認証 |
|---------|------|------|------|
| GET | `/game/questions` | 問題セット取得（10問） | 🔒 |
| POST | `/game/sessions` | ゲーム結果を保存 | 🔒 |
| GET | `/game/sessions` | ゲーム履歴一覧 | 🔒 |
| GET | `/game/sessions/:sessionId` | ゲーム結果詳細取得 | 🔒 |

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

| メソッド | パス | 説明 | 認証 |
|---------|------|------|------|
| GET | `/weak` | 苦手リスト取得 | 🔒 |
| DELETE | `/weak/:elementId` | 苦手リストから削除 | 🔒 |

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

**ステータスコード一覧**:

| コード | 意味 | 使用例 |
|--------|------|--------|
| 400 | Bad Request | バリデーションエラー・リクエスト形式不正 |
| 401 | Unauthorized | 認証失敗・トークン無効・アカウントロック |
| 403 | Forbidden | 権限不足・メール未確認 |
| 404 | Not Found | リソースが存在しない |
| 409 | Conflict | メールアドレス重複・ユーザー名重複 |
| 429 | Too Many Requests | レート制限超過 |
| 500 | Internal Server Error | サーバー内部エラー |
| 502 | Bad Gateway | サーバーダウン（リバースプロキシ） |
| 504 | Gateway Timeout | サーバータイムアウト |

**重要**: 502/504 を含むエラー時は **非 JSON**（HTML、プレーンテキスト等）が返る可能性があります。

---

### Fetch API のベストプラクティス

#### パターン 1: 基本的なエラーハンドリング

```typescript
import { API_BASE_URL } from '$lib/api/config';
import { ApiError } from '$lib/api/errors';

async function callApi() {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password: password.trim() }),
    credentials: 'include' // HttpOnly Cookie 用
  });

  // ステップ 1: response.ok を最初にチェック
  if (!response.ok) {
    // ステップ 2: JSON パースを try-catch で囲む（502/504 対策）
    let errorBody: { error?: string; details?: { message: string }[] } | null = null;
    try {
      errorBody = await response.json();
    } catch {
      // JSON パース失敗 = 非 JSON レスポンス（HTML、プレーンテキスト等）
      // null を使う（空オブジェクト {} は使わない）
    }
    
    // ステップ 3: details[0].message を優先（400 バリデーションエラー時の具体的な Zod メッセージを使用）
    const message = errorBody?.details?.[0]?.message ?? errorBody?.error ?? 'エラーが発生しました';
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
      return '入力内容を確認してください';
    case 401:
      // バックエンドが具体的な理由を返す場合は fallback を優先
      // 例: "メールアドレスまたはパスワードが正しくありません"
      //      "アカウントがロックされています。しばらく後に再試行してください"
      return fallback;
    case 403:
      // 例: "メールアドレスが確認されていません"
      return fallback;
    case 404:
      return 'リソースが見つかりません';
    case 409:
      // 例: "メールアドレスは既に使用されています"
      return fallback;
    case 429:
      return 'しばらく待ってから再試行してください';
    case 500:
      return 'サーバーエラーが発生しました';
    default:
      return fallback || 'エラーが発生しました';
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
  if (!normalizedEmail) return 'メールアドレスを入力してください';
  if (!normalizedPassword) return 'パスワードを入力してください';

  // 形式チェック（正規化済みの値を使う）
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(normalizedEmail)) {
    return 'メールアドレスの形式が正しくありません';
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
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: email.trim(),    // バリデーションと同じ
      password: password.trim() // バリデーションと同じ
    })
  });
}
```

**重要**: バリデーションで `trim()` した値をチェックするなら、送信時も `trim()` した値を送る。

---

### よくある実装ミスと修正方法

| ミス | 問題 | 修正方法 |
|------|------|----------|
| JSON パースを先にする | 502/504 で例外が発生 | `response.ok` を先にチェック |
| エラー時の JSON パースを try-catch しない | 非 JSON レスポンスで例外 | try-catch で囲む |
| バックエンドのメッセージを上書き | 具体的なエラー理由が失われる | `fallback` を優先する |
| バリデーションと送信で異なる値を使う | サーバー側で認証失敗 | 両方で `trim()` した値を使う |
| 存在しないステータスコードをハンドリング | 到達不能コード | `backend/src/services/auth.service.ts` を確認 |
| 環境変数を各ファイルで重複定義 | 方針がズレる | `$lib/api/config.ts` で一元管理 |

---

## ユーザー `/api/v1/users`

| メソッド | パス | 説明 | 認証 |
|---------|------|------|------|
| GET | `/users/me` | 自分のプロフィール取得 | 🔒 |
| PATCH | `/users/me` | ユーザー名・パスワード変更 | 🔒 |
| DELETE | `/users/me` | アカウント削除 | 🔒 |
| GET | `/users/me/stats` | 自分の統計取得 | 🔒 |

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

| メソッド | パス | 説明 | 認証 |
|---------|------|------|------|
| GET | `/ranking/weekly` | 週間ランキング（上位50件・自分の順位） | 任意 |
| GET | `/ranking/alltime` | 全期間ランキング（上位50件・自分の順位） | 任意 |

認証:
- 未ログインでも閲覧可能
- `Authorization: Bearer <accessToken>` がある場合のみ `myRank` を返す
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

| メソッド | パス | 説明 | 認証 |
|---------|------|------|------|
| GET | `/admin/users` | ユーザー一覧 | 👑 |
| GET | `/admin/users/:id` | ユーザー詳細 | 👑 |
| PATCH | `/admin/users/:id/status` | アカウント停止・解除 | 👑 |
| PATCH | `/admin/users/:id/role` | ロール変更 | 👑 |
| DELETE | `/admin/users/:id` | 強制退会 | 👑 |
| GET | `/admin/stats` | サービス全体の統計 | 👑 |

### PATCH `/admin/users/:id/status`
```
Request:
{
  "isActive": false   // false=停止, true=解除
}

Response 200:
{
  "message": "アカウントを停止しました"
}
```
