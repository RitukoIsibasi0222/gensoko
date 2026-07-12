# セキュリティ仕様書

---

## SEC-001: パスワード

### 要件
- 最低8文字以上
- 英大文字・英小文字・数字・記号（`!@#$%^&*`など）を各1文字以上含む
- メールアドレス・ユーザー名と同一の文字列は禁止
- 新しくbcryptハッシュとして保存するパスワードは、正規化後のUTF-8表現で72バイト以内

### ハッシュ化
- アルゴリズム: **bcryptjs**（Node.js用のnpmパッケージ）
- コストファクター: `12`（サーバー負荷を考慮して調整）
- DBにはハッシュのみ保存（平文パスワードは保存しない）

### bcrypt入力長制限

- bcryptjsはUTF-8変換後の先頭72バイトだけをハッシュ対象とするため、72バイトを超える入力をそのままハッシュしてはならない。
- 通常登録、パスワードリセット、パスワード変更の新しいパスワード、管理者作成CLIへ同じ上限を適用する。
- バックエンドでは共通の `strongPasswordSchema` で検証し、さらに共通ハッシュ関数でもbcryptへ渡す直前に拒否する。
- 73バイト以上の場合は「パスワードはUTF-8で72バイト以内にしてください」を返し、DB更新やメール送信などの副作用を開始しない。
- フロントエンドでも `TextEncoder` によるUTF-8バイト数で検証する。文字数やJavaScriptの `string.length` では判定しない。
- ASCII、日本語、絵文字、混在文字列について、UTF-8で72バイトを受理し73バイトを拒否する境界値テストを維持する。

### 既存ユーザーとの照合互換性

- DBのbcryptハッシュから、登録時の元パスワードが72バイトを超えていたかは判別できない。
- ログイン、パスワード変更時の `currentPassword`、アカウント削除時の `currentPassword` には72バイト上限を適用しない。
- 照合用入力は正規化後の完全な値をbcrypt比較へ渡し、既存の72バイト超パスワード利用者が本人確認を継続できるようにする。
- 新しいパスワードは既存ハッシュとも比較する。既存の72バイト超パスワードの先頭72バイトとbcrypt上同一になる値への変更は拒否する。
- パスワード変更はユーザーIDと照合時の旧ハッシュを条件に更新し、並行要求で先に変更されていた場合は409で拒否する。競合側ではrefresh token削除や成功監査を行わない。

---

## SEC-002: 認証

> **hono/jwt** を使用します。
> Vercel（フロントエンド）と Cloudflare Workers（API）が別ドメインのため、Cookie方式は使えずトークン方式を採用します。

### hono/jwtトークン認証フロー
| 項目 | 値 |
|------|----|
| 認証方式 | Bearer Token（Personal Access Token） |
| トークン保存場所 | SvelteKitのメモリ（Svelteストア）+ `sessionStorage` |
| トークン送信方法 | リクエストヘッダー `Authorization: Bearer <token>` |
| トークン有効期限 | 7日（DBで管理。ログアウト時に即時削除） |

### トークンの保管について
```
✅ sessionStorage: タブを閉じると消えるため比較的安全
❌ localStorage: XSS攻撃でトークンが盗まれるリスクがあるため使用禁止
❌ URLパラメーター: ログに残るため使用禁止
```

> ⚠️ `sessionStorage` はXSSへの完全な対策ではないため、CSPヘッダーによる
> XSS防止（SEC-006）と組み合わせて使います。

### ログアウト
- `POST /api/v1/auth/logout` → HonoサイドでDBのトークンを削除
- SvelteKit側のストアと `sessionStorage` もクリア

---

## SEC-003: 認可（ロールベースアクセス制御）

### ロール定義

| ロール | 権限 |
|--------|------|
| `user` | 自分のデータの読み書き、ゲームプレイ、ランキング閲覧 |
| `admin` | `user`の全権限 ＋ 管理者APIへのアクセス |

### 認可チェックのルール
- すべての保護APIは**JWTの検証**をミドルウェアで実施
- 管理者APIは**`role === "admin"`チェック**を追加実施
- 自分以外のユーザーデータへのアクセスは `userId` の一致チェックで拒否（管理者を除く）

---

## SEC-004: ブルートフォース対策

### ログイン失敗ロック
- ログイン失敗 **5回** で **15分間**アカウントをロック
- ロック中は「しばらく時間をおいてお試しください」と表示（残り時間は開示しない）

### レート制限
| エンドポイント | 制限 |
|--------------|------|
| 認証系API（ログイン・登録・パスワードリセット） | **10分間で10リクエスト**まで（IP単位。ログイン・メール送信系は対象メールアドレス単位も併用） |
| `POST /game/sessions` | **1分間で20リクエスト**まで（ユーザーID + IP単位） |
| 一般API | **1分間で60リクエスト**まで（IP単位） |

### 本番環境での実装方針
- Cloudflare 側のエッジ制限で大量アクセスを先に遮断する
- Hono のレート制限ミドルウェアでも同じ対象を制御し、ユーザーID単位の制限とテストを担保する
- Cloudflare Workers のインスタンス内メモリだけに依存しない
- 制限超過時は `429` と日本語エラー（例: `リクエストが多すぎます。しばらく待ってから再試行してください`）を返す

---

## SEC-005: メール認証

### 登録フロー
1. ランダムなトークン（`crypto.randomBytes(32)`）を生成
2. トークンのハッシュをDBに保存（平文は保存しない）
3. 認証URLをメールで送信（有効期限: **24時間**）
4. URLアクセス時にトークンを検証し `emailVerified = true` に更新
5. 使用済みトークンは即時削除

### パスワードリセット
1. 登録メールアドレスに対してリセットURL送信
2. トークン有効期限: **1時間**
3. リセット完了後、そのユーザーの**全リフレッシュトークンを無効化**

---

## SEC-006: 通信セキュリティ

### HTTPS・HSTS

- HTTP から HTTPS へのリダイレクトは Cloudflare/Vercel 等の配信基盤で設定する。Hono API ミドルウェアはリダイレクトを担当しない。
- Hono API は `NODE_ENV=production` の場合だけ `Strict-Transport-Security: max-age=31536000; includeSubDomains` を付与する。
- ローカルの development/test は HTTP で動作するため HSTS を付与しない。
- HSTS preload は採用しない。本番有効化前に、対象ドメインと全サブドメインが HTTPS 対応済みであることを確認する。

### Hono API のセキュリティヘッダー

Hono が生成する正常・エラー・404・CORS preflight レスポンスへ、以下を共通付与する。

```
Content-Security-Policy: default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cross-Origin-Resource-Policy: same-origin
X-XSS-Protection: 0
X-Permitted-Cross-Domain-Policies: none
```

- `X-Powered-By` は削除する。
- API JSON では不要な `Cross-Origin-Opener-Policy`、`Cross-Origin-Embedder-Policy`、`Origin-Agent-Cluster`、`X-DNS-Prefetch-Control`、`X-Download-Options` は付与しない。
- この CSP は JSON API を deny-by-default にするための設定であり、Vercel/SvelteKit が返す HTML の script・style・image を制御しない。フロントエンド HTML の CSP は別の配信設定で実装する。

### CORS

- 許可オリジンを**ホワイトリスト**で管理（`*` ワイルドカード禁止）
- 許可値は環境変数 `FRONTEND_URL` から読み込む
- 開発環境: `http://localhost:5174`
- 本番環境: 公開ドメインのみ
- credentials、`Content-Type`、`Authorization` の既存許可設定を維持する

### CSRF対策
- リフレッシュトークンCookieの `SameSite=Strict` で対策
- 状態変更APIはすべてJSONボディを必須とし、フォームからの直接送信を防ぐ

---

## SEC-007: 入力バリデーション・サニタイズ

### バリデーションルール

| フィールド | ルール |
|-----------|--------|
| ユーザー名 | 3〜20文字、`[a-zA-Z0-9_]` のみ（正規表現で検証） |
| メールアドレス | RFC準拠形式 |
| パスワード | SEC-001の要件 |

### XSS対策
- ユーザー入力はDBへの保存前にサーバーサイドでサニタイズ
- フロントエンドはReactの自動エスケープを活用（`dangerouslySetInnerHTML`は使用しない）

### SQLインジェクション対策
- **Prisma ORM**のプリペアドステートメントのみ使用
- 生SQL（`$queryRaw`）は使用しない

---

## SEC-008: ログ・監査

### システムエラー監視
- 本番環境の `500` 系エラーは Sentry 等のエラートラッキング、または構造化ログで検知する
- ログには `requestId` / `method` / `path` / `status` / `durationMs` / `environment` を含める
- エラー通知は開発者が即時確認できる通知先に送る
- パスワード・トークン・Cookie・メールアドレスなどの秘密情報や個人情報は送信しない

### ログに記録する操作
- ログイン成功 / 失敗
- パスワード変更
- メール認証
- 管理者によるユーザー操作（停止・削除・ロール変更）

### ログの取り扱い
- ログに**パスワード・トークン・個人情報**は含めない
- ログはサーバー外（ログ収集サービス）に保存

---

## SEC-009: 個人情報

- 収集する個人情報: **メールアドレス** と **ユーザー名** のみ（最小限）
- プライバシーポリシーページを設置（公開前に必須）
- アカウント削除時は全個人情報・学習データを完全削除

---

## SEC-010: 依存関係管理

- `npm audit` を定期実行し高リスクの脆弱性を即時対応
- Dependabotまたは同等のツールで自動的に脆弱性を検知
- 本番環境での `devDependencies` のインストール禁止
