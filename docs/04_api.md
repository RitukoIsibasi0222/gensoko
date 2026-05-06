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

## 共通エラーレスポンス形式

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "ログインが必要です"
  }
}
```

| コード | HTTPステータス | 意味 |
|--------|---------------|------|
| `BAD_REQUEST` | 400 | 入力値エラー |
| `UNAUTHORIZED` | 401 | 未認証 |
| `FORBIDDEN` | 403 | 権限なし |
| `NOT_FOUND` | 404 | リソースが存在しない |
| `CONFLICT` | 409 | 重複エラー |
| `RATE_LIMITED` | 429 | リクエスト過多 |
| `INTERNAL_ERROR` | 500 | サーバーエラー |
