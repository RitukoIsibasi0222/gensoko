# セキュリティヘッダーミドルウェア 実装計画

> 設計者ロール: シニアフルスタックエンジニア / Web セキュリティエンジニア

## 背景・目的

`docs/05_progress.md` フェーズ11の「セキュリティヘッダーミドルウェア（CSP/HSTS/X-Frame-Options/nosniff等）」を実装する。Hono API の正常・エラー・404・CORS preflight レスポンスへ一貫した防御ヘッダーを付与し、ヘッダー値、環境差、CORS との共存、将来の Cloudflare Workers 配置時の責務を明文化する。

本計画は API レスポンスの防御を対象とする。Vercel/SvelteKit が返す HTML に対する CSP は Hono API の CSP では代替できないため、両者を明確に分離する。

## レビュー結果と改善方針

### この計画のまま実装すべきではない理由

レビュー対象として提示された内容は計画書作成用プロンプトであり、同パスの既存計画書は存在しなかった。また、既存セキュリティ仕様は HTML 向け CSP と API 向けヘッダーを区別しておらず、Hono 4.12.17 の `secureHeaders()` 既定値は Gensoko の既存仕様とも一致しない。ミドルウェア順序、HSTS の環境差、実配線のテスト方法を確定しないまま実装すると、preflight への付与漏れ、意図しない既定値、フロントエンドを保護したという誤認が発生する。

### DB の整合性と負荷

- 指摘内容: DB 変更、DB query、index 追加は不要。
- 根拠: **確認できた事実** — 対象は HTTP レスポンス後処理であり、`backend/src/middleware/security/index.ts` は未実装のスタブである。既存 Prisma model の読み書きは要件に含まれない。
- 影響・リスク: DB 変更を含めると、不要な migration、データ影響、ロールバック作業が増える。
- 改善案: schema、migration、unique、nullable、cascade、relation、index は変更しない。DB 変更が必要になった場合は計画逸脱として実装を止めて再レビューする。
- 優先度: High

- 指摘内容: N+1・query 負荷・同時実行競合について重大な問題なし。
- 根拠: **確認できた事実** — ミドルウェアは固定ヘッダーをレスポンスへ設定するだけで、DB・外部 API を呼ばない。
- 影響・リスク: リクエストごとに小さなヘッダー設定処理は発生するが、DB 負荷は増えない。
- 改善案: 設定はミドルウェア生成時に確定し、リクエストごとに環境変数や設定を再計算しない。
- 優先度: Low

### API・コードの整合性

- 指摘内容: Hono の既定値をそのまま採用すると既存仕様と不一致になる。
- 根拠: **確認できた事実** — Hono 4.12.17 の `secureHeaders()` は既定で HSTS `max-age=15552000; includeSubDomains`、`X-Frame-Options: SAMEORIGIN`、CORP `same-origin`、COOP `same-origin` 等を付与する一方、CSP は明示設定しない。`docs/02_security.md` は HSTS 31536000 秒、`X-Frame-Options: DENY` を要求する。
- 影響・リスク: 仕様とテストがずれ、Hono 更新時に暗黙のヘッダーが変化する可能性がある。
- 改善案: `hono/secure-headers` は利用するが、採用する全項目を明示し、値をテストで固定する。
- 優先度: High

- 指摘内容: API 用 CSP とフロントエンド HTML 用 CSP が混同されている。
- 根拠: **確認できた事実** — `docs/02_security.md` の CSP は `script-src`、`style-src` を含む HTML 文書向けだが、現在の Hono は JSON API、Vercel/SvelteKit は別オリジンの画面配信元として計画されている。
- 影響・リスク: API に CSP を付けただけで SvelteKit 画面の XSS 対策が完了したと誤認する。逆に HTML 向けの `'unsafe-inline'` を API へ無意味に許可する。
- 改善案: API は `default-src 'none'` を基準にした deny-by-default CSP とする。SvelteKit/Vercel の HTML CSP は非スコープとして明記し、デプロイ設計または別タスクで扱う。
- 優先度: High

- 指摘内容: セキュリティミドルウェアの登録順が未確定。
- 根拠: **確認できた事実** — 現在の `backend/src/index.ts` は logger の後に CORS を登録する。Hono の CORS は preflight を早期終了できるため、security を CORS より内側へ置くと preflight へ到達しない可能性がある。
- 影響・リスク: `OPTIONS` だけセキュリティヘッダーが欠落する。
- 改善案: `logger -> security headers -> CORS -> routes` の順を固定し、app-level test で preflight を検証する。
- 優先度: High

- 指摘内容: `backend/src/index.ts` は import 時に `serve()` を実行し、実際のグローバル配線をテストしにくい。
- 根拠: **確認できた事実** — Hono app は export されず、同ファイル末尾でサーバーを起動している。
- 影響・リスク: ミドルウェア単体テストが通っても、本番 app への登録漏れや順序ミスを検出できない。
- 改善案: `createApp()` を `backend/src/app.ts` へ分離し、`index.ts` は Node server 起動だけを担当する。unit test と app-level test を分ける。
- 優先度: High

- 指摘内容: HSTS の適用条件とロールバック制約が不足している。
- 根拠: **確認できた事実** — ローカルは HTTP、将来本番は Cloudflare Workers の HTTPS を予定し、既存仕様は `includeSubDomains` を要求する。**推測・要確認** — 本番で利用する全サブドメインが常時 HTTPS かは現リポジトリから確定できない。
- 影響・リスク: HTTPS 未対応サブドメインを長期間利用不能にし得る。ブラウザが記憶した HSTS はコードを戻しても即時には解除できない。
- 改善案: HSTS は `isProduction` が true の app だけで有効にし、preload は採用しない。本番有効化前に対象ドメインと全サブドメインの HTTPS 対応をリリースゲートで確認する。
- 優先度: High

- 指摘内容: 認証仕様書には本件外の既存不一致がある。
- 根拠: **確認できた事実** — `docs/02_security.md` は refresh token に Cookie を使わない記述を含む一方、`docs/04_api.md` と現行実装は HttpOnly Cookie を使う。また SEC-006 の開発 CORS origin は 3000 と書かれているが、実装は `FRONTEND_URL=http://localhost:5174` である。
- 影響・リスク: セキュリティレビュー時に誤った前提を参照する可能性がある。
- 改善案: 本タスクでは SEC-006 の CORS 記述を実装に合わせる。認証方式全体の文書不一致は別タスクとして記録し、本ミドルウェア実装で認証・Cookie を変更しない。
- 優先度: Medium

### UI / A11Y

- 指摘内容: UI・DOM を変更しないため、フォーム、ARIA、focus、keyboard 操作に直接の変更はない。
- 根拠: **確認できた事実** — 対象は backend のレスポンスヘッダーで、frontend component は変更対象ではない。
- 影響・リスク: API 用 CSP では画面の A11Y も XSS も直接改善しない。誤った CORP/CORS 設定で API 通信が失敗すると、既存画面の loading/error 状態に影響し得る。
- 改善案: A11Y の重大な問題なし。既存 UI を変更せず、ブラウザ smoke test でログイン、公開 API、エラー表示が退行しないことを確認する。
- 優先度: Medium

### テストの妥当性

- 指摘内容: ヘッダー存在確認だけでは不足する。
- 根拠: **確認できた事実** — Hono の既定値と Gensoko の期待値が異なる。現在 security middleware のテストは存在しない。
- 影響・リスク: `SAMEORIGIN` と `DENY`、HSTS 15552000 秒と 31536000 秒の差を見逃す。
- 改善案: 採用ヘッダーは値を完全一致で検証し、CSP は必須 directive を固定する。非採用ヘッダーの欠如も検証する。
- 優先度: High

- 指摘内容: 正常系以外の適用範囲が不足している。
- 根拠: **確認できた事実** — グローバルミドルウェア要件は全レスポンスだが、既存計画は存在せず、404・401・500・preflight の保証がない。
- 影響・リスク: 攻撃者が利用しやすいエラー応答だけ防御が抜ける。
- 改善案: unit test で 200・500、app-level test で health 200・404・401・許可/未許可 origin の OPTIONS を検証する。
- 優先度: High

## スコープ

- Hono 標準 `secureHeaders` を利用した Gensoko 専用ミドルウェア。
- API 用 CSP、HSTS、X-Frame-Options、nosniff、Referrer-Policy、Permissions-Policy と関連防御ヘッダー。
- development/test と production の HSTS 差分。
- `logger -> security -> CORS -> routes` のグローバル配線。
- app factory 分離による実配線テスト。
- 未知404・未捕捉500を既存の日本語JSONエラー契約へ統一するグローバルハンドラー。
- 正常、404、401、500、CORS preflight のテスト。
- `docs/02_security.md`、`docs/04_api.md`、`docs/05_progress.md` の整合。

## 非スコープ

- Prisma schema、migration、seed、DB データ、index の変更。
- 既存endpointのrequest/response body、status、認証・認可、rate limit の変更。例外として、Hono既定だった未知404・未捕捉500だけを既存API仕様の日本語JSON形式へ統一する。
- frontend component、store、API client、画面 A11Y の変更。
- Vercel/SvelteKit が返す HTML の CSP・security headers 実装。
- HTTP から HTTPS への 301 redirect。Cloudflare/Vercel の edge 設定で扱う。
- HSTS preload 登録。
- CSP report endpoint、Reporting API、Sentry 等の導入。
- Cloudflare Workers adapter への移行。
- `docs/02_security.md` の認証方式全体の改訂。

## 現状調査結果

### 確認できた事実

- `docs/plans/security-headers/plan.md` は本計画作成前に存在しなかった。
- `docs/05_progress.md` フェーズ11に対象タスクが未完了で存在する。
- `backend/src/middleware/security/index.ts` は `// TODO: implement` のみである。
- `backend/src/index.ts` は logger と CORS を全パスへ適用するが、security middleware を登録していない。
- CORS origin は共通 `getFrontendUrl()` で解決する。productionでは `FRONTEND_URL` が必須、development/testでは未設定時に `http://localhost:5174`、credentialsはtrueである。
- backend は Hono 4.12.17 を利用し、`hono/secure-headers` を追加依存なしで import できる。
- Hono `secureHeaders` は downstream 完了後に `ctx.res.headers.set()` するため、中央ポリシーで同名ヘッダーを上書きできる。
- Hono compose は downstream error を app error handler の Response へ変換して外側 middleware に戻すため、security を外側に置けば 500 にも付与できる。
- backend は Node server 起動と Hono app 構築が `index.ts` に同居している。
- ローカルは backend 3000、frontend 5174 の別 origin である。
- 将来デプロイは Vercel frontend と Cloudflare Workers API を予定しているが、まだ未実装である。
- セキュリティヘッダーは DB・入力値・ユーザー権限を参照しない。

### 推測・要確認

- 本番の API domain と全サブドメインが常時 HTTPS で利用できるかは、デプロイ前確認が必要。
- Cloudflare/Vercel 側で同じヘッダーを追加するかは、現時点の設定ファイルから確認できない。
- CORP `same-origin` は通常の CORS mode fetch を妨げない想定だが、実ブラウザで frontend 5174 -> API 3000 の通信を確認する。
- Cloudflare Workers 移行時は `process.env.NODE_ENV` ではなく Worker binding 等から `isProduction` を注入する可能性がある。

## 前提条件・依存関係

### 既存の公開インターフェース

- `secureHeaders(options): MiddlewareHandler` — Hono 4.12.17 の標準セキュリティヘッダーミドルウェア。
- `cors(options): MiddlewareHandler` — `FRONTEND_URL` と credentials を使う既存 CORS。
- `AppVariables` — Hono app の Variables 型。
- `app.request()` — server 起動なしで app-level request を行う既存テスト方式。

### 重要な制約

- security は CORS より先に登録する。
- Hono の既定値へ暗黙依存せず、採用・非採用を options で明示する。
- request/response body、status、Cookie、CORS allowlist を変更しない。
- HSTS は production のみ。preload は付けない。
- API 用 CSP を frontend HTML 用 CSP として説明しない。
- 同じヘッダーを route ごとに設定しない。
- ESM の相対 import は `.js` 拡張子を付ける。
- 追加 npm package は導入しない。

## セキュリティヘッダー仕様

| ヘッダー | 最終方針 | 適用環境 | 根拠・注意点 |
|---|---|---|---|
| `Content-Security-Policy` | `default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'` | 全環境 | JSON API は script/style/image を配信しない。HTML 用の `'self'` / `'unsafe-inline'` は採用しない |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | production のみ | 既存 SEC-006 と一致。preload は採用しない。全サブドメイン HTTPS をリリースゲートにする |
| `X-Frame-Options` | `DENY` | 全環境 | CSP `frame-ancestors 'none'` と併用し旧ブラウザも防御 |
| `X-Content-Type-Options` | `nosniff` | 全環境 | JSON の MIME sniffing を防止 |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | 全環境 | cross-origin では path/query を送らない |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | 全環境 | API response では効果が限定的だが既存仕様を維持 |
| `Cross-Origin-Resource-Policy` | `same-origin` | 全環境 | `no-cors` 読み込みを抑止。CORS mode fetch は実ブラウザで共存確認 |
| `Cross-Origin-Opener-Policy` | 付与しない | 全環境 | API JSON は top-level document ではない |
| `Cross-Origin-Embedder-Policy` | 付与しない | 全環境 | cross-origin isolation は要件外 |
| `Origin-Agent-Cluster` | 付与しない | 全環境 | API JSON に不要 |
| `X-XSS-Protection` | `0` | 全環境 | 旧 XSS auditor を無効化し CSP へ寄せる |
| `X-Permitted-Cross-Domain-Policies` | `none` | 全環境 | legacy cross-domain policy を拒否 |
| `X-DNS-Prefetch-Control` | 付与しない | 全環境 | API JSON では不要 |
| `X-Download-Options` | 付与しない | 全環境 | IE 固有で API 要件外 |
| `X-Powered-By` | 削除 | 全環境 | 実装情報の不要な露出を避ける |

## 対象ファイル一覧

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/app.ts` | 新規 | Hono app factory、middleware 順序、route 登録、共通404/500 handler、production CORS fail-fastを集約 |
| `backend/src/app.test.ts` | 新規 | 実配線、health、404/500 JSON、401、preflight、CORS 共存を検証 |
| `backend/src/index.ts` | 修正 | `createApp()` を呼び Node server 起動だけを担当 |
| `backend/src/lib/config.ts` | 新規 | CORS・認証メールで共有するFRONTEND_URL解決、origin検証、production fail-fast |
| `backend/src/lib/config.test.ts` | 新規 | production必須・development fallback・NODE_ENV判定・不正URL境界を検証 |
| `backend/src/middleware/security/index.ts` | 修正 | 明示設定した security headers middlewareを実装 |
| `backend/src/middleware/security/security.test.ts` | 新規 | header 値、環境差、200/500、上書き方針を検証 |
| `backend/src/services/auth.service.ts` | 修正 | 認証メールURLを共通FRONTEND_URL設定へ統一 |
| `backend/.env.example` | 修正 | `NODE_ENV` と HSTS production 判定を説明 |
| `docker-compose.yml` | 修正 | ローカル backend の `NODE_ENV=development` を明示 |
| `docs/02_security.md` | 修正 | API header 仕様、frontend CSP との責務境界、CORS 開発 origin を修正 |
| `docs/04_api.md` | 修正 | 全 API 共通レスポンスヘッダーを追記 |
| `docs/05_progress.md` | 修正 | 実装中・完了状態と計画書リンクを更新 |
| `docs/plans/security-headers/plan.md` | 修正 | checkbox、実態差分、実装完了記録を更新 |

計画時点で frontend、Prisma、package lock の変更は想定しない。実装で変更した場合は対象ファイル表と `## 実装完了` に理由を記録する。

## 実装方針

1. `createSecurityHeadersMiddleware({ isProduction })` が Gensoko の明示設定を Hono `secureHeaders()` へ渡す。
2. HSTS option だけ `isProduction` で文字列または false を切り替え、それ以外は環境間で同一にする。
3. `createApp({ isProduction })` は logger、security、CORS、health、route の順に構築する。
4. Node entry の `index.ts` は `process.env.NODE_ENV === "production"` を一度評価し `createApp()` へ注入する。
5. 将来 Worker entry を追加するときも、Worker 固有環境から `isProduction` を注入し middleware 本体を再利用する。
6. route 個別のヘッダー設定や独自 `c.header()` の重複は作らない。

## 公開インターフェース案

```typescript
export type SecurityHeadersOptions = {
  isProduction: boolean;
};

export function createSecurityHeadersMiddleware(
  options: SecurityHeadersOptions,
): MiddlewareHandler;

export type CreateAppOptions = {
  isProduction: boolean;
};

export function createApp(options: CreateAppOptions): Hono<{
  Variables: AppVariables;
}>;
```

`isProduction` は必須引数とし、production 判定の暗黙 fallback を middleware 内に持ち込まない。起動 entry と test が適用環境を明示する。

## ミドルウェア適用順序

```text
request
  -> logger
  -> security headers
  -> CORS
  -> route / notFound / error handler
response
  <- CORS headers
  <- security headers
  <- logger
```

- security を CORS より外側に置き、CORS が早期応答する `OPTIONS` にも付与する。
- security は downstream 後に中央設定を `set` し、route が誤って同名ヘッダーを設定しても中央ポリシーを優先する。
- logger の位置と既存ログ挙動は維持する。

## DB 変更方針

- DB schema、migration、index、unique、nullable、cascade、relation は変更しない。
- DB query、transaction、raw SQL、seed は追加しない。
- DB 変更が必要になった場合は本タスクを止め、expand/contract、migrate deploy、既存データ、rollback、Playwright を含む再計画を行う。

## API 変更方針

- endpoint、method、認証、request body、既存route handlerのresponse body・status code・エラーメッセージは変更しない。
- Hono既定の未知404と未捕捉500だけは、`docs/04_api.md`の共通契約に合わせて日本語JSONへ統一し、内部例外情報をclientへ返さない。server logにもraw例外を出さず固定イベント名だけを記録する。
- 全 API 共通の response header 契約だけを追加する。
- 200/201/400/401/403/404/409/429/500 と preflight に同じ非 HSTS header を付与する。
- HSTS は production response のみに付与する。
- CORS の `Access-Control-Allow-Origin` は `FRONTEND_URL`、credentials は true を維持する。
- productionでは `FRONTEND_URL` を必須とし、未設定・空文字ならapp構築時にfail-fastする。development/testだけlocalhostへfallbackする。
- `FRONTEND_URL` はHTTP(S)のorigin形式に限定し、path、query、hash、認証情報付きURLを拒否する。末尾slashだけは標準originへ正規化する。
- セキュリティヘッダーを CORS allowlist の代替にしない。

## UI / A11Y 方針

- frontend ファイルは変更しない。
- label、ARIA、focus、keyboard、loading、error、empty state の既存挙動を維持する。
- API 用 CSP は SvelteKit HTML の script/style を制約しないことを文書化する。
- 手動確認で公開画面、ログイン、認証エラーを確認し、CORS 失敗により画面が恒久 loading にならないこと、既存 error が支援技術向けに表示されることを回帰確認する。

## テスト方針

### Red

1. `security.test.ts` を先に作成し、未実装状態で header assertion が失敗することを確認する。
2. `app.test.ts` を作成し、実 app に middleware が未登録で失敗することを確認する。
3. Red では期待した failure を記録し、無関係な既存 test failure と区別する。

### Green

1. Hono `secureHeaders()` を明示 options でラップする。
2. app factory を分離して security を CORS より前へ登録する。
3. security unit test と app-level test を通す。
4. 全 backend test で既存 status/body/Cookie/CORS の回帰がないことを確認する。

### Refactor

1. header 値、CSP directive、production 判定の重複を除く。
2. test helper は必要最小限に留める。
3. JSDoc、型、設定値、docs、test の完全一致を確認する。
4. Prettier 適用後に lint、build、test を再実行する。

## リリース・移行方針

1. DB migration とデータ移行は不要。
2. production 有効化前に、実際にHSTSを返すAPI hostと、そのhost配下で `includeSubDomains` の対象になる全hostがHTTPS対応済みか確認する。親domainや兄弟hostには遡及しない。
3. 対象hostを確認できない場合は、`includeSubDomains` を有効にしたままproductionへ出さない。
4. Cloudflare 側に同名ヘッダーがある場合、app と edge のどちらを正本にするか決め、値の二重定義を解消する。
5. backend を deploy し、health、404、401、preflight の response header を本番相当 URL で確認する。
6. frontend から公開 API と Cookie/Authorization を使う認証 API の smoke test を行う。
7. SvelteKit/Vercel の HTML CSP は別設定であることをリリース記録に残す。

## ロールバック方針

- app/middleware/docs は実装コミットを revert して戻す。
- app factory 分離に問題がある場合は Node entry を直前の app 構築へ戻せる。DB rollback は不要。
- CSP、X-Frame-Options、nosniff、Referrer-Policy、Permissions-Policy、CORP はレスポンス変更を戻せば次回 request から解除される。
- HSTS はブラウザにキャッシュされるため、コード rollback だけでは即時解除できない。`max-age=0` response を HTTPS で配信する手順を緊急 rollback に含めるが、到達済みブラウザやサブドメインへの影響が即時完全解消しないことを明記する。
- HTTPS未対応になった配下hostには `max-age=0` を届けられないため、緊急解除手順は事前inventory確認の代替にならない。
- preload は採用しないため、preload list からの削除手続きは不要。

## リスクと対策

| リスク | 影響 | 対策 |
|---|---|---|
| API CSP を frontend CSP と誤認 | 画面 XSS 対策の未実装を見逃す | docs で責務分離し、frontend CSP を別タスク化 |
| Hono 既定値の変化 | version update で header が変わる | 全 option を明示し exact test |
| security を CORS の内側へ登録 | preflight だけ付与漏れ | middleware 順序固定、OPTIONS test |
| HSTS includeSubDomains | HTTPS 未対応 subdomain が利用不能 | production gate、preload 不採用、rollback 手順 |
| CORP と cross-origin frontend | API response が browser で block | CORS test と実ブラウザ smoke test |
| edge と app の二重設定 | 複数値・運用責務不明 | production header 確認、正本を一つにする |
| app factory 分離の route 登録漏れ | endpoint 404 | 全 route prefix の smoke test、既存全 test |
| header test が存在だけ確認 | 誤った値を見逃す | exact value / directive test |
| 500 だけ付与漏れ | error response の防御欠落 | synthetic throw test |
| 認証文書の既存不一致 | 本件へ不要な認証変更を混入 | 本件では変更せず別 issue として記録 |

## 作業手順

1. 対象 plan、conventions、editing guide、security/API docs、Hono 実装・型を再確認する。
2. `docs/05_progress.md` の対象を `[-]` にする。
3. `security.test.ts` と `app.test.ts` を先に作成し Red を確認する。
4. `createSecurityHeadersMiddleware()` を実装する。
5. `createApp()` を分離し、security を CORS より前へ登録する。
6. Node entry から production 判定を注入する。
7. Green を確認し、重複を Refactor する。
8. `.env.example` と compose の環境説明を更新する。
9. `docs/02_security.md` と `docs/04_api.md` を実装値へ合わせる。
10. backend format、lint、format:check、build、全 test を実行する。
11. Docker で health、404、401、OPTIONS と frontend API 疎通を手動確認する。
12. 対象ファイル表、checkbox、実装完了セクションを実態へ合わせる。
13. `docs/05_progress.md` を `[x]` にし、変更種別ごとに commit、push、PR を作成する。

## タスクリスト

| ID | 内容 | 対象ファイル | 完了条件 | 優先度 |
|---|---|---|---|---|
| T1 | 既存仕様・Hono 実装・環境差を再確認 | docs、backend、Hono package | 事実・要確認事項・実装方針が確定 | High |
| T2 | 進捗を実装中へ更新 | `docs/05_progress.md` | 対象タスクが `[-]` | High |
| T3 | security unit test を Red で追加 | `security.test.ts` | exact header、production 差、200/500 の期待失敗を確認 | High |
| T4 | app-level test を Red で追加 | `app.test.ts` | health/404/401/OPTIONS/CORS の期待失敗を確認 | High |
| T5 | security middleware を実装 | `middleware/security/index.ts` | 明示 options と環境別 HSTS が unit test Green | High |
| T6 | app factory と実配線を実装 | `app.ts`, `index.ts` | logger/security/CORS/routes 順で app test Green | High |
| T7 | 環境設定例を更新 | `.env.example`, `docker-compose.yml` | development/production 判定が明記される | Medium |
| T8 | Refactor と回帰 test | backend 関連 | 重複なし、既存 status/body/Cookie/CORS 不変 | High |
| T9 | security/API docs を更新 | `docs/02_security.md`, `docs/04_api.md` | header 値と frontend CSP 非スコープが実装一致 | High |
| T10 | backend 品質チェック | backend | format/lint/format:check/build/全 test が成功 | High |
| T11 | Docker・ブラウザ手動確認 | backend/frontend | health/404/401/OPTIONS/API 疎通が成功 | High |
| T12 | 実態・進捗・完了記録を更新 | plan、`docs/05_progress.md` | 対象表、`[x]`、実装完了が実態一致 | High |
| T13 | 変更種別ごとに commit | git | 機能・設定・docs を目的別に記録 | High |
| T14 | PR 本文案をチャットで確認 | チャット | 調査・設計根拠・TDD・検証結果を日本語で提示 | High |
| T15 | 承認後に push・PR 作成 | git/GitHub | feature branchをpushし、develop向けPRを作成 | High |

- [x] T1: 既存仕様・Hono 実装・環境差を再確認
- [x] T2: 進捗を実装中へ更新
- [x] T3: security unit test を Red で追加
- [x] T4: app-level test を Red で追加
- [x] T5: security middleware を実装
- [x] T6: app factory と実配線を実装
- [x] T7: 環境設定例を更新
- [x] T8: Refactor と回帰 test
- [x] T9: security/API docs を更新
- [x] T10: backend 品質チェック
- [x] T11: Docker・ブラウザ手動確認
- [x] T12: 実態・進捗・完了記録を更新
- [x] T13: 変更種別ごとに commit
- [x] T14: 詳細なPR本文を作成
- [x] T15: push・PR作成

### 再レビュー改善タスク

- [x] R1: 未知404・未捕捉500の共通JSON契約をtest先行で固定
- [x] R2: app-level `notFound` / `onError` を日本語JSONで実装
- [x] R2a: 未捕捉例外のraw objectをログへ出さず固定イベント名へ置換
- [x] R3: HSTS `includeSubDomains` のhost scopeとrelease gateを明確化
- [x] R4: security/API docs・対象ファイル・実装完了記録を実態へ整合
- [x] R5: format・lint・format:check・build・全testで回帰確認
- [x] R6: PR reviewのraw test error logを固定イベント名へ統一
- [x] R7: FRONTEND_URLを共通設定へ集約しproduction未設定をfail-fast
- [x] R8: deploymentのCORS例を自己完結させ、FRONTEND_URLのorigin形式を検証

### タブ区切り

```text
タスクID	タスク内容	ファイル	優先度
T1	既存仕様・Hono実装・環境差の再確認	docs・backend・Hono package	高
T2	進捗を実装中へ更新	docs/05_progress.md	高
T3	security unit test Red	backend/src/middleware/security/security.test.ts	高
T4	app-level test Red	backend/src/app.test.ts	高
T5	security middleware実装	backend/src/middleware/security/index.ts	高
T6	app factory・実配線	backend/src/app.ts・backend/src/index.ts	高
T7	環境設定例更新	backend/.env.example・docker-compose.yml	中
T8	Refactor・回帰test	backend関連	高
T9	security/API docs更新	docs/02_security.md・docs/04_api.md	高
T10	backend品質チェック	backend	高
T11	Docker・ブラウザ手動確認	backend・frontend	高
T12	完了記録更新	plan.md・docs/05_progress.md	高
T13	変更種別ごとにcommit	git	高
T14	PR本文案をチャットで確認	チャット	高
T15	承認後にpush・PR作成	git・GitHub	高
```

## テストケース一覧

### security middleware unit

| ケース | 期待結果 |
|---|---|
| development の 200 JSON | HSTS 以外の採用 header が exact value で付く |
| production の 200 JSON | HSTS `max-age=31536000; includeSubDomains` を含む |
| development/test | HSTS が存在しない |
| CSP | `default-src 'none'`、`base-uri 'none'`、`frame-ancestors 'none'`、`form-action 'none'` を含み script/style 許可なし |
| frame 防御 | CSP `frame-ancestors 'none'` と `X-Frame-Options: DENY` が併存 |
| Permissions-Policy | camera/microphone/geolocation が空 allowlist |
| CORP | `same-origin` |
| 非採用 COOP/COEP/OAC | header が存在しない |
| `X-XSS-Protection` | `0` |
| downstream が同名 header を設定 | 中央ポリシーの値で上書き |
| downstream が例外 | 500 の body/status を壊さず security header を付与 |
| response body | security 適用前と JSON body が同一 |

### app-level

| ケース | 期待結果 |
|---|---|
| `GET /` | 200、既存 body、security header |
| `GET /api/v1/health` | 200、既存 body shape、security header |
| 存在しない path | 404、日本語JSON `error`、security header |
| app内の未捕捉例外 | 500、日本語JSON `error`、内部情報なし、security header |
| 認証なし `GET /api/v1/users/me` | 401、日本語 error、security header |
| 許可 origin の `OPTIONS` | CORS allow-origin/credentials と security header が共存 |
| 未許可 origin の `OPTIONS` | 許可されない origin を反映せず security header は付く |
| CORS Content-Type/Authorization | 既存 allowHeaders が維持される |
| production app | HSTS あり |
| development app | HSTS なし |
| route prefix 回帰 | auth/admin/elements/game/ranking/users/weak の登録が維持される |

### 回帰・手動

| ケース | 期待結果 |
|---|---|
| frontend 5174 -> API 3000 | 公開 API が CORS error なく表示される |
| ログイン/refresh/logout | Authorization/Cookie/CORS の既存動作を維持 |
| API 400/403/404/429 | status/body/error message 不変、security header あり |
| 非 JSON 502/504 | app 外 edge response のため本 middleware 保証外であることを確認 |
| A11Y 回帰 | error/loading が既存 role/文言で伝わり、keyboard 操作を阻害しない |

## 手動確認項目

- `curl -i http://localhost:3000/`
- `curl -i http://localhost:3000/api/v1/health`
- `curl -i http://localhost:3000/not-found`
- 認証なしで保護 API を呼び、401 と header を確認する。
- `Origin: http://localhost:5174` を付けた `OPTIONS` で CORS と security header を確認する。
- 未許可 origin では `Access-Control-Allow-Origin` が許可値にならないことを確認する。
- frontend の公開 API、ログイン、refresh、logout をブラウザで確認する。
- browser network panel で header 重複、CORS error、CSP console error を確認する。
- production 相当 app test で HSTS、development 実サーバーで HSTS 不在を確認する。
- 本番前に全サブドメインの HTTPS 対応と edge 側 header 設定を確認する。

## 実装完了時の更新ルール

- 対象ファイル一覧を `git diff --name-status` と一致させる。
- 計画になかったファイルは理由つきで追加し、未変更ファイルは削除または未実装と記録する。
- 完了 task を `[x]` にする。
- header 値、Hono options、test expectation、`docs/02_security.md`、`docs/04_api.md` を一致させる。
- `docs/05_progress.md` を `[x]` にして plan と PR をリンクする。
- Red/Green/Refactor、品質コマンド、Docker/ブラウザ確認結果を記録する。
- 計画から変更した HSTS/CSP/CORP/ミドルウェア順序は必ず理由を記録する。

```markdown
## 実装完了

- 完了日: YYYY-MM-DD
- 実装ブランチ: feature/security-headers
- PR: #N

### 計画からの変更点

- なし

### 確定したセキュリティヘッダー

| ヘッダー | 最終設定値 | 適用環境 | 備考 |
|---|---|---|---|
| `Content-Security-Policy` |  |  |  |

### TDD 実施記録

- Red:
- Green:
- Refactor:

### 品質・手動確認結果

- backend format:
- backend lint:
- backend format:check:
- backend build:
- backend test:
- Docker/API:
- browser/CORS/A11Y:

### 実際の変更ファイル

| ファイル | 変更種別 | 内容 |
|---|---|---|
|  |  |  |
```

## 実装完了

- 完了日: 2026-07-12
- 実装ブランチ: `feature/security-headers`
- PR: #84

### 計画からの変更点

- app factory分離時のroute登録漏れを直接検知するため、app-level testへauth/admin/elements/game/ranking/users/weakの全prefix確認を追加した。
- 再レビューで、未知404と未捕捉500がHono既定の英語plain textになり、共通API仕様と日本語エラー規約に反する不整合を検出した。app-level `notFound` / `onError` を追加し、内部例外情報を含まない日本語JSONへ統一した。
- 追加レビューで `console.error(error)` がDB接続情報やtoken等をraw例外から漏らし得ることを検出した。固定イベント名だけを記録する実装へ変更し、secretを含むtest例外がログへ渡らないことをTDDで固定した。
- PR reviewで、test helperにもraw `Error` 出力が残っている点と、productionの `FRONTEND_URL` 未設定がlocalhostへfallbackする点を検出した。test helperも固定イベント名へ統一し、CORSと認証メールURLの環境設定を `lib/config.ts` へ集約してproductionではfail-fastするよう変更した。
- 追加reviewでdeploymentのCORS snippetが `app` / `isProduction` 未定義だったため、`createApp` 全体を含む自己完結例へ修正した。横断再監査で計画書の旧fallback記述とURL形式未検証も検出し、HTTP(S) originの検証・正規化を追加した。
- HSTSの `includeSubDomains` は応答hostの配下にのみ適用され、親domain・兄弟hostには遡及しないことと、対象host未確認時はproductionへ出さないrelease gateを明記した。
- ブラウザでは公開APIを使うトップ・元素一覧、ログイン画面、空欄validationを確認した。認証情報を使うlogin/refresh/logoutの手動操作は行わず、既存を含むbackend自動テストで回帰を確認した。
- ユーザー指定の確認フローに合わせ、commit、PR本文のチャット確認、承認後のpush・PR作成を別タスクへ分割した。

### 確定したセキュリティヘッダー

| ヘッダー | 最終設定値 | 適用環境 | 備考 |
|---|---|---|---|
| `Content-Security-Policy` | `default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'` | 全環境 | JSON API用。SvelteKit HTMLは別責務 |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | productionのみ | preloadなし |
| `X-Frame-Options` | `DENY` | 全環境 | CSP frame-ancestorsと併用 |
| `X-Content-Type-Options` | `nosniff` | 全環境 | MIME sniffing防止 |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | 全環境 | cross-originへpath/queryを送らない |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | 全環境 | 不要機能を拒否 |
| `Cross-Origin-Resource-Policy` | `same-origin` | 全環境 | CORS mode fetchとの共存を確認 |
| `X-XSS-Protection` | `0` | 全環境 | 旧auditorを無効化 |
| `X-Permitted-Cross-Domain-Policies` | `none` | 全環境 | legacy policy拒否 |
| `X-Powered-By` | 削除 | 全環境 | 実装情報を露出しない |

### TDD 実施記録

- Red: 初回実装では `security.test.ts` は未実装関数により7件失敗、`app.test.ts` は未作成moduleによりcollection失敗を確認した。再レビューでは既存14件を維持したまま、未知404・未捕捉500の新規2件がplain text responseのため失敗した。追加レビューではraw `Error` が `console.error` へ渡る1件の失敗を確認した。
- Green: middlewareとapp factoryの初回実装後に対象testを通過させ、再レビューでは共通404/500 handler追加後に対象2ファイル・16件が全通過した。ログ非機密化後は `app.test.ts` 9件が全通過した。
- PR review対応: Redでconfig module未実装、production未設定がthrowしない、空文字development fallback不成立を確認した。Greenでconfig/app/security/register/forgot-passwordの5 files・39 testsが全通過した。
- 追加review対応: Redで末尾slash未正規化と不正URL5ケースの未拒否を確認し、Greenでconfig 10 testsが全通過した。
- Refactor: 全route prefix回帰test、共通エラー契約、内部情報非開示testを追加した。期待済み500 errorのstderrはtest内spyで抑制した。

### 品質・手動確認結果

- backend format: 成功。全対象ファイルunchanged
- backend lint: 成功
- backend format:check: 成功
- backend build: 成功
- backend test: 53 files・500 tests全通過。監査ログintegration 1 file・1 testは専用DB環境変数なしの通常実行でskip
- Docker設定: `docker compose config --quiet`成功。Hono containerだけを`NODE_ENV=development`で再作成
- Docker/API: health 200、404、認証なし401、許可・未許可originのOPTIONSを確認。全対象responseへsecurity headerが付き、developmentではHSTSなし
- browser/CORS/A11Y: トップとランキングプレビュー、元素一覧118件、ログイン画面を確認。空欄errorは`alert`。warning/error 0件

### 実際の変更ファイル

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `backend/src/app.ts` | 新規 | Hono app factory、middleware順序、route登録、共通404/500 handler、production CORS fail-fast |
| `backend/src/app.test.ts` | 新規 | 実配線、health、404/500 JSON、401、preflight、CORS、route prefix test |
| `backend/src/index.ts` | 修正 | app factoryを呼ぶNode server起動entryへ縮小 |
| `backend/src/lib/config.ts` | 新規 | CORS・認証メール共通のFRONTEND_URL解決・origin検証 |
| `backend/src/lib/config.test.ts` | 新規 | production必須・development fallback・不正URL境界test |
| `backend/src/middleware/security/index.ts` | 修正 | 明示設定したsecurity headers middlewareを実装 |
| `backend/src/middleware/security/security.test.ts` | 新規 | exact header、環境差、200/500、上書きtest |
| `backend/src/services/auth.service.ts` | 修正 | 認証メールURLを共通設定へ統一 |
| `backend/.env.example` | 修正 | `NODE_ENV`とHSTS production判定を説明 |
| `docker-compose.yml` | 修正 | ローカルHonoの`NODE_ENV=development`を明示 |
| `docs/02_security.md` | 修正 | API header仕様、frontend CSPとの責務境界、CORS originを更新 |
| `docs/04_api.md` | 修正 | 全API共通response header契約を追加 |
| `docs/05_progress.md` | 修正 | 対象タスクを完了へ更新 |
| `docs/plans/security-headers/plan.md` | 修正 | タスク、TDD、品質・手動確認、実装完了記録を更新 |
