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
| GET | `/elements` | 元素一覧取得 | なし |
| GET | `/elements/:id` | 元素詳細取得 | なし |

### GET `/elements`
```
Query params:
  category?: string   // 分類フィルター
  period?:   number   // 周期フィルター
  q?:        string   // キーワード検索（記号・名前）

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
      "atomicWeight": 1.008
    },
    ...
  ]
}
```

---

## ゲーム `/api/v1/game`

| メソッド | パス | 説明 | 認証 |
|---------|------|------|------|
| GET | `/game/questions` | 問題セット取得（10問） | 🔒 |
| POST | `/game/sessions` | ゲーム結果を保存 | 🔒 |
| GET | `/game/sessions` | ゲーム履歴一覧 | 🔒 |

### GET `/game/questions`
```
Query params:
  mode: GameMode  // 必須（例: "SYMBOL_TO_NAME_LV1"）

Response 200:
{
  "questions": [
    {
      "elementId": 1,
      "question": "H",          // 出題テキスト（記号 or 名前）
      "choices": [              // 4択の選択肢（シャッフル済み）
        { "elementId": 1, "text": "水素" },
        { "elementId": 6, "text": "炭素" },
        { "elementId": 8, "text": "酸素" },
        { "elementId": 7, "text": "窒素" }
      ]
    },
    ...  // 10問分
  ]
}

// ※ 正解情報はサーバーサイドで管理。クライアントに正解を渡さない
// ※ セッションIDをサーバー側で発行しセッションに紐づける
```

### POST `/game/sessions`
```
Request:
{
  "mode": "SYMBOL_TO_NAME_LV1",
  "answers": [
    {
      "elementId": 1,
      "chosenElementId": 1,   // ユーザーが選んだ選択肢のelementId
      "answerTimeSec": 5
    },
    ...
  ]
}

// ※ スコア計算・正誤判定はすべてサーバーサイドで実施

Response 200:
{
  "sessionId": "cuid",
  "correctCount": 8,
  "totalScore": 1250,
  "maxStreak": 5,
  "results": [
    {
      "elementId": 1,
      "isCorrect": true,
      "correctAnswer": "水素",
      "yourAnswer": "水素",
      "score": 125
    },
    ...
  ]
}
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
      "addedAt": "2026-05-01T00:00:00Z"
    },
    ...
  ]
}
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
  "error": "エラーメッセージ（日本語）"
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
    let errorBody: { error?: string } | null = null;
    try {
      errorBody = await response.json();
    } catch {
      // JSON パース失敗 = HTML レスポンス（502/504 等）
      // null を使う（空オブジェクト {} は使わない）
    }
    
    // ステップ 3: バックエンドのメッセージを優先
    const message = errorBody?.error || 'エラーが発生しました';
    throw new ApiError(response.status, message);
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

---

## ランキング `/api/v1/ranking`

| メソッド | パス | 説明 | 認証 |
|---------|------|------|------|
| GET | `/ranking/weekly` | 週間ランキング（上位50件） | なし |
| GET | `/ranking/alltime` | 全期間ランキング（上位50件） | なし |

### GET `/ranking/weekly`
```
Response 200:
{
  "ranking": [
    {
      "rank": 1,
      "username": "taro123",
      "weeklyScore": 15000,
      "totalGames": 30
    },
    ...
  ],
  "myRank": 42         // ログイン時のみ。未ログインは null
}
```

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

---

## ランキング `/api/v1/ranking`
