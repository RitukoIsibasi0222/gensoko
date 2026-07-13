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

すべての非除外 `/api/v1/*` は一般API制限を消費し、次の対象では専用制限も追加で消費する。

| Policy ID | 対象 | 制限 | キー | store障害時 |
|---|---|---:|---|---|
| `GENERAL_API_IP` | healthとOPTIONSを除く `/api/v1/*` | 60回/60秒 | IP | fail-open |
| `AUTH_IP` | register/login/forgot-password/reset-passwordで共有 | 10回/600秒 | IP | fail-closed |
| `AUTH_EMAIL` | register/login/forgot-passwordの操作ごと | 10回/600秒 | 操作 + 正規化メールアドレスのHMAC | fail-closed |
| `ACCOUNT_IP` | パスワード変更・アカウント削除 | 10回/600秒 | IP | fail-closed |
| `ACCOUNT_USER` | パスワード変更・アカウント削除 | 10回/600秒 | 認証済みユーザーIDのHMAC | fail-closed |
| `GAME_QUESTIONS_IP` | `GET /game/questions` | 30回/60秒 | IP | fail-open |
| `GAME_SUBMIT_IP` | `POST /game/sessions` | 20回/60秒 | IP | fail-closed |
| `GAME_SUBMIT_USER` | `POST /game/sessions` | 20回/60秒 | 認証済みユーザーIDのHMAC | fail-closed |

- `/`、`/api/v1/health`、すべての `OPTIONS` はHonoのレート制限から除外する。
- `POST /game/sessions` のIPとユーザーID、パスワード変更・アカウント削除のIPとユーザーIDは、複合キー1個ではなく独立した2つのバケットとして評価する。
- 同じmiddleware段階の複数バケットはすべて試行として消費する。いずれかが超過した場合は最大の待ち時間を返し、store障害と超過が混在した場合はfail-closedの503を優先する。
- 認証系のメールアドレスはZod検証後にレート制限専用として `trim().toLowerCase()` を1回だけ行い、操作scope付きのHMACへ変換する。認証・DB保存時のメールアドレス仕様は変更しない。
- 生のIP、メールアドレス、ユーザーID、HMAC digest、body、token、Cookie、Authorizationをrate limit storeやログへ保存しない。
- productionではCloudflareが付与した単一の `CF-Connecting-IP` だけを検証して使用し、`X-Forwarded-For` と `X-Real-IP` は信頼しない。IPv6は同一 `/64` を同じactorとして扱う。
- IP resolverまたはHMAC生成が失敗した場合はキー取得不能として扱い、raw errorを記録せずpolicyのfail-open / fail-closedを適用する。

### 本番環境での実装方針

- Cloudflare WAF Rate Limiting Rulesは、Honoより高い閾値で大量アクセスを先に遮断する粗いエッジ防御とする。
- Honoはroute、検証済みメールアドレス、認証済みユーザーIDを使う正確なアプリケーション制限を担当する。
- Honoのproduction storeにはSQLite-backed Durable Objectを必須とし、プロセス内memory storeへ暗黙fallbackしない。memory storeはdevelopment/testだけで使用する。
- 制限超過時は `429`、日本語JSON、`Retry-After` を返す。
- sensitive policyのstore障害時は `503` と `Retry-After: 60` を返す。一般APIとquestionsはfail-openし、固定イベントだけを記録する。
- WAFが返すedge responseはHonoのJSON/CORS契約に含めない。フロントエンドは非JSONやnetwork errorでも既定メッセージを表示する。

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
- `includeSubDomains` が対象にするのは、HSTSを返したAPIホストの配下である。例えば `api.example.com` から返した場合、`example.com` や `www.example.com` には遡及せず、`*.api.example.com` に適用される。
- HSTS preload は採用しない。本番有効化前に、実際に応答するAPIホストとその配下の全ホストがHTTPS対応済みであることを確認する。確認できない場合は `includeSubDomains` を有効化したままリリースしない。
- HSTSはブラウザに記憶され、コードをrevertしても即時解除できない。緊急時はHTTPSで `max-age=0` を返すが、既に到達不能になった配下ホストには解除responseを届けられないため、事前確認を必須のリリースゲートとする。

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
- 未知のパスは404と `{ "error": "エンドポイントが見つかりません" }`、未捕捉例外は500と `{ "error": "サーバーエラーが発生しました" }` を返す。例外メッセージ、stack trace、内部パス、接続情報はclient responseへ含めない。
- 未捕捉例外を `console.error` へraw objectのまま渡さず、固定イベント名だけを記録する。安全な詳細情報を扱う構造化ログは、SEC-008の別タスクで許可fieldとredactionを定義してから導入する。

### CORS

- 許可オリジンを**ホワイトリスト**で管理（`*` ワイルドカード禁止）
- 許可値は環境変数 `FRONTEND_URL` から読み込む。HTTP(S)のorigin形式だけを許可し、path、query、hash、認証情報付きURLは起動時に拒否する
- 開発環境: `http://localhost:5174`
- 本番環境: 公開ドメインのみ。`FRONTEND_URL` は必須とし、未設定・空文字ならapp構築時にfail-fastする
- localhostへのfallbackはdevelopment/testだけに限定し、CORSと認証メールURLで同じ共通設定を使う
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

### DB監査ログの保持・cleanup

- セキュリティ上重要な操作はPostgreSQLの`audit_logs`へ保存し、通常のアプリケーションログと分離する
- 暫定保持期間は365日とし、runtimeのsource of truthは`AUDIT_LOG_RETENTION_DAYS`とする
- 正式な保持期間、承認者、通知先、backup/PITRを確認するまで`AUDIT_LOG_CLEANUP_ENABLED=false`を維持する
- cleanup対象は`occurredAt < cutoff`だけとし、cutoffと同時刻のrowは保持する
- 1batch 500件、1回最大10,000件、最大8分の固定上限を設け、上限到達後も残件があれば定期batchを失敗させる
- cleanupの運用ログには件数、cutoff、実行時間、期限超過有無だけを記録し、監査ログID、`actorId`、`targetId`、メール、username、生DB error、`DATABASE_URL`を含めない
- cleanup自身は新しい`AuditLog`を作成しない

### 退会後の監査内部ID

- `actorId`・`targetId`はUser relationを持たない内部IDであり、User row削除後も監査rowの保持期間中は維持する暫定方針とする
- 内部IDはインシデント・管理者操作の相関調査だけに利用し、公開API・UIへ返さない
- 監査rowのcleanup時に内部IDもrowごと削除し、無期限には保持しない
- HMAC化、退会時null化、個別legal holdが必要な場合はschema・migration・鍵管理を含む別設計を行う
- この例外保持はプライバシー責任者またはプロダクトオーナーの承認前に本番有効化しない

---

## SEC-009: 個人情報

- 収集する個人情報: **メールアドレス** と **ユーザー名** のみ（最小限）
- プライバシーポリシーページを設置（公開前に必須）
- アカウント削除時に個人情報・学習データを完全削除することを目標要件とする
- 現在の本人退会・管理者強制退会はsoft deleteであり、Userのメール・username・学習データが残るため、この目標要件は未達である
- physical deleteまたは匿名化、学習データ削除範囲、既存soft-deleted userの移行は、監査ログ内部IDの期間限定保持とは分離した本番公開前ブロッカーとして扱う
- 監査内部IDを例外保持する正式期間・目的・問い合わせ先は、承認後にプライバシーポリシーへ記載する

---

## SEC-010: 依存関係管理

- `npm audit` を定期実行し高リスクの脆弱性を即時対応
- Dependabotまたは同等のツールで自動的に脆弱性を検知
- 本番環境での `devDependencies` のインストール禁止
