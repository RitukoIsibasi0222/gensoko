# 管理者ダッシュボード `/admin` 実装計画

> 設計者ロール: シニアフルスタックエンジニア（SvelteKit v2 / Svelte 5 Runes、Hono / Prisma、認証・認可、A11Y、運用設計）

## 背景・目的

フェーズ10で実装済みの管理者API 6本を利用し、管理者がサービス統計とユーザー状態を確認し、アカウント停止・解除、ロール変更、強制退会を安全に実行できる `/admin` 画面を提供する。

本タスクでは、frontend API client、成功レスポンスのruntime validation、認証・認可UX、検索・filter・cursor pagination、詳細・確認dialog、mutation後同期、Header導線、responsive/A11Y、自動テスト、手動確認を実装する。clientに保存されたroleはUX上のヒントに限定し、最終認可はDBの最新状態を参照する管理者APIの401/403を正とする。

## レビュー結果と改善方針

前案のスコープ、API契約、A11Y、error state、mutation確認は概ね妥当だった。一方、実装前に修正すべき問題があるため、以下を本計画へ反映した。

| 優先度 | 区分 | 指摘 | 根拠 | 改善方針 |
|---|---|---|---|---|
| High | 認証 | list/stats等が同時に401になると複数の`authStore.refresh()`が互いをabortし得る | 確認できた事実: `authStore.refresh()`は新規呼出時に既存refreshをabortする | page内に単一のreauth promiseを持ち、tokenを引数に取るcallbackを1回だけretryする |
| High | 認可 | client roleだけでUSERを拒否すると、別管理者に昇格された後もsessionStorageの古いroleで遮断する | 確認できた事実: refreshはaccess tokenだけ更新し、保存済みuserを再取得しない。backendはDB roleで認可する | roleにかかわらず認証済みなら最初のlist APIで認可を確定し、成功前に管理UIを描画しない |
| High | 型契約 | `totalCorrect <= totalAnswered`をadmin detailのruntime validatorに追加すると、現行backend契約より厳しくなる | 確認できた事実: admin serviceは両値を非負化するがpair自体はclampせず、docsにも大小制約がない | 文書化済みの制約だけを検証し、accuracyのみ0〜100を検証する。契約強化は別backend変更とする |
| High | 状態管理 | history/page state利用案に`App.PageState`型定義の変更が含まれていなかった | 確認できた事実: `frontend/src/app.d.ts`の`PageState`は未定義 | `frontend/src/app.d.ts`を対象に追加し、admin専用namespaceでq/cursorを型付けする |
| High | rollback | frontendをrevertしても、UI経由で既に行われた停止・role変更・soft delete・監査ログは戻らない | 確認できた事実: mutationはDB更新と監査記録をtransactionでcommitする | code rollbackと業務データの復旧を分離し、自動データrollbackを禁止する |
| High | UI意味 | APIの`active`はログイン可能を意味しない | 確認できた事実: active filterは`isActive=true && deletedAt=null`のみ。未確認・将来時刻までlock中でもactiveに入る | account status、email verification、lockを別ラベルで表示し、「利用可能」と誤表記しない |
| Medium | DB負荷 | Userに`createdAt,id`複合indexやrole/status用indexがなく、`contains`検索は通常btreeで効かない | 確認できた事実: schemaのUserにはusername/email unique以外のindexがない。既存admin planもindex追加を実測後へ延期 | 本UIではlimitを20に固定し、入力ごとの検索をしない。性能計測後に別backend計画でindex/trigramを検討する |
| Medium | DB負荷 | statsは1回のAPI呼出で複数count/aggregateを並列実行する | 確認できた事実: `getAdminStats()`は9個のDB処理を`Promise.all`する | 初回認可成功後とmutation成功後だけ取得し、filter/page変更では再取得しない。in-flight重複も抑止する |
| Medium | pagination | 1ページ置換型はhistory stateを正確に管理しないと戻る/reloadでcursorとqが分離する | 確認できた事実: APIはnextCursorだけでprevious cursorや総件数を返さない | q/cursorを同じadmin page stateで管理し、role/status/search変更時はcursorを必ず破棄する |
| Medium | auth state | 403の日本語messageを条件分岐に使ってlocal roleをUSERへ書き換える案は脆い | 推測: 将来の文言変更でUX state更新が壊れる可能性がある | 403はfail-closed表示に限定し、messageでauth stateを変更しない。成功時のADMIN同期だけ許可する |
| Medium | test配置 | 複数componentを1つの曖昧なtestファイルへまとめる案は既存のsource近接配置から外れる | 確認できた事実: 既存component testは対応componentと同じ場所に`.svelte.test.ts`で配置される | dialog/list/filter等の責務ごとに対応testを置く |
| Medium | A11Y | mutation後に操作元行がfilterから消えると単純なfocus returnが失敗する | 推測: 停止・role変更・削除で現在filterから対象が外れる | triggerが残れば戻し、消えた場合は一覧headingまたは安全な次行へfocusを移してlive通知する |
| Low | N+1 | frontend計画でN+1対策が明記されていなかった | 確認できた事実: list serviceは単一`findMany`のrelation select、detailは単一`findUnique`で、行ごとのservice呼出loopはない | backend変更不要と明記し、frontendも一覧表示時にdetail APIを行数分呼ばない |

### 確認できた事実と推測の境界

- 上表で「確認できた事実」とした内容は、2026-07-11時点のdocs、route、service、test、schema、frontend実装から確認した。
- 本番ユーザー件数、検索頻度、DB execution plan、管理者の同時操作頻度は確認できていない。性能問題の発生時期やindex効果は推測であり、本タスクでmigrationを追加する根拠にはしない。
- history stateの保持期間はbrowser実装の影響を受けるため、reload/戻る・進むの実動作を手動確認し、結果を実装完了記録へ残す。

## スコープ

- `/admin` routeと管理者専用画面。
- 認証初期化中、未ログイン、認可確認中、401、403の状態遷移。
- 管理者API 6本のfrontend client、型、runtime validation、test。
- サービス全体統計の表示と独立retry。
- username/email検索、role/status filter、reset。
- cursor paginationと「次を読み込む」導線。
- URL query、SvelteKit page state、page local state、API responseの責務分離。
- desktop tableとmobile card/list。
- ユーザー詳細dialog。
- 停止・解除、USER/ADMIN変更、強制退会の確認UI。
- mutation二重実行防止と成功後の一覧・詳細・統計同期。
- 初期loading、page loading、部分error、全面error、空状態、retry。
- ADMINだけに表示するdesktop/mobile Header導線。
- keyboard、screen reader、focus management、live region。
- frontend unit/component/page test、品質check、手動確認。
- 進捗・計画書の実装中/完了更新。

## 非スコープ

- backend admin route/service/middlewareの再実装。
- admin APIのrequest/response/status/message変更。
- Prisma schema、migration、index追加、既存データ移行。
- 管理者作成UI。管理者作成は既存CLIを使う。
- 監査ログの閲覧・検索・削除UI/API。
- refresh処理を全API clientへ共通化する全体refactor。
- 汎用design systemまたは全画面向けdialog基盤の新設。
- page number、総件数表示、任意limit選択。
- email/usernameのCSV出力。
- soft delete済みユーザーを復元する機能。
- 本タスクを理由にした既存ElementDetailModalの変更。

## 現状調査結果

### 進捗・既存計画

- `docs/05_progress.md`フェーズ10のAdmin APIs、管理者作成CLI、監査ログは完了済み。
- `管理者ダッシュボード /admin（ユーザー一覧・管理 UI）`だけが未完了。
- 本計画作成前に`docs/plans/admin-dashboard/plan.md`は存在しない。
- `admin-apis/plan.md`は後続UIにtable semantics、行actionのaccessible name、確認dialog、focus return、loading/error/emptyを要求している。
- `audit-log/plan.md`と現行実装では、管理mutationの成功とservice業務失敗を監査し、参照系とmiddlewareの401/403は監査しない。
- Header既存計画は`/weak`、`/mypage`とmobile menuまでで、admin導線を扱っていない。

### Backend/API

- `/api/v1/admin`にはusers list/detail、status、role、delete、statsの6 endpointがmount済み。
- 全endpointは`authMiddleware`の後に`adminMiddleware`を通る。
- authはAuthorization header、JWT、DB上のuser、有効状態、email確認、lockを確認する。
- admin middlewareはDBから設定された現在roleがADMINでなければ403を返す。
- route入口はZodでquery/path/bodyを検証する。
- validation errorは400 `{ error: "バリデーションエラー", details: [...] }`。
- service errorは404/409の具体的な日本語message、想定外は500。
- listはcursor確認の`findUnique`と、stats relation selectを含む`findMany`で実装され、行ごとのdetail queryはない。
- list sortは`createdAt desc, id desc`、limit既定20、最大100。
- detailは選択した1ユーザーに対する`findUnique`。
- UserStatsがない場合、list/detailともstats objectを0/nullで返す。
- status/role/deleteはSerializable transaction、最大2回retry、最後の利用可能な管理者保護を持つ。
- deleteはsoft deleteであり、物理削除ではない。
- mutation成功監査は本体更新と同一transaction。既存UIをrollbackしても記録済み監査ログは消えない。

### DB

- Userはusername/email unique、nullableなdeletedAt/lockedUntil/lastLoginAtを持つ。
- UserStatsはUserと1対0..1で、User削除時cascade。ただしadmin deleteはsoft deleteのためrelation行を削除しない。
- token系relationはUser物理削除時cascadeだが、admin停止/deleteではserviceが明示削除する。
- Userにはadmin listのsort/filter専用indexがない。
- `%term%`相当のcontains検索は通常のusername/email unique indexだけでは高速化されない可能性がある。
- schema/migration変更は本UIの機能成立には不要。

### Frontend

- root layoutがbrowserで`authStore.initialize()`を呼ぶ。
- auth statusは`initializing | authenticated | anonymous`。
- sessionStorageからuser/access tokenを復元した後、refreshでtokenを検証する。
- refresh成功時も保存済みuser role自体はAPIから再取得しない。
- `API_BASE_URL`、`ApiError`、`parseErrorResponse()`、`parseSuccessJsonResponse()`がある。
- `parseErrorResponse()`は非JSON bodyをnullとし、backendのdetails/messageを優先する。
- users/weak/ranking clientに成功responseのruntime validation実績がある。
- toast storeとToasterがある。
- `(app)` layoutにguardはない。
- Headerはdesktop/mobileを持つがadmin導線はない。
- generic dialog/pagination componentはなく、element固有modalとranking tableだけがある。
- Vitestはjsdomで、Svelte client mount helperとcomponent test実績がある。
- `frontend/src/app.d.ts`の`App.PageState`は未定義。

## 前提条件・依存関係

### 既存公開インターフェース

**`frontend/src/lib/api/config.ts`**

- `API_BASE_URL: string`

**`frontend/src/lib/api/errors.ts`**

- `parseErrorResponse(response, defaultMessage?): Promise<never>`
- `parseSuccessJsonResponse(response, invalidMessage): Promise<unknown>`
- `ApiError(status, message, body)`

**`frontend/src/lib/stores/auth.svelte.ts`**

- `authStore.isInitializing`
- `authStore.isLoggedIn`
- `authStore.user`
- `authStore.accessToken`
- `authStore.refresh(): Promise<boolean>`
- `authStore.updateUser(user): void`
- `authStore.logout(): Promise<void>`

**`frontend/src/lib/stores/toast.svelte.ts`**

- `toastStore.success(message, options?)`
- `toastStore.error(message, options?)`
- `toastStore.fromApiError(error, options?)`

### 重要な制約

- frontendからPrisma/backend型を直接importしない。
- API base URLをpage/componentで再定義しない。
- fetch、JSON変換、runtime guardをSvelte componentへ埋め込まない。
- `response.ok`を成功JSON parseより先に確認する。
- 非JSON errorはnullを使い、空objectへ置換しない。
- backendの具体的な日本語messageをfrontend固定文言で上書きしない。
- 401と403を混同しない。
- auth初期化/認可確認完了前にadmin contentを表示しない。
- 同じ検索値の`trim()`を複数箇所で再計算しない。
- qにはemailが入り得るためURL query、toast、console/logへ含めない。
- cursorはfilter/search変更時に必ずresetする。
- last usable adminはclientで確定できないため409を正とする。
- mutation中のclose/再送を防ぐ。
- code rollbackでDB mutationを自動的に戻さない。

### 実装時の確認事項

1. SvelteKitの`pushState`/`replaceState`と`page.state`が現行依存バージョンで期待どおりreactiveに更新されることをtarget testで確認する。
2. q/cursorをhistory stateに置く設計は、URL/referrer/server access logへの露出を避けるための選択である。browser history自体には残るため、共有端末の運用要件が強い場合は検索復元を諦める別案へ変更する。
3. qのcase sensitivityはAPIで保証されていない。UIで大文字小文字を区別しないと案内しない。
4. 本番のUser件数、admin list latency、query planは未確認。性能問題が確認された場合は別計画でindex/pg_trgmを検討する。
5. admin detailの`totalCorrect`と`totalAnswered`にはdocs上の大小制約がない。frontendだけで新しい制約を追加しない。
6. API/docs/test差異が見つかった場合、frontendで黙って吸収せず計画を止めて契約を確定する。

## 対象ファイル一覧

以下は設計上の提案名である。実装時に統合・分割した場合は、完了記録の対象ファイルと計画変更点を更新する。

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `frontend/src/app.d.ts` | 修正 | admin list用`App.PageState`を型定義 |
| `frontend/src/lib/api/admin.ts` | 新規 | API境界型、6 API、request構築、runtime validation |
| `frontend/src/lib/api/admin.test.ts` | 新規 | request/response/error/runtime validation test |
| `frontend/src/lib/admin/query.ts` | 新規 | URL queryとpage stateのparse/serialize/正規化 |
| `frontend/src/lib/admin/query.test.ts` | 新規 | restore/reset/canonicalization/cursor reset test |
| `frontend/src/lib/components/admin/AdminDialog.svelte` | 新規 | admin内共有dialog shellとfocus管理 |
| `frontend/src/lib/components/admin/AdminDialog.svelte.test.ts` | 新規 | dialog semantics、Tab、Esc、focus return |
| `frontend/src/lib/components/admin/AdminStatsSection.svelte` | 新規 | 統計、loading、部分error、retry |
| `frontend/src/lib/components/admin/AdminStatsSection.svelte.test.ts` | 新規 | label、数値、loading/error/retry |
| `frontend/src/lib/components/admin/AdminUserFilters.svelte` | 新規 | 検索、role/status、reset、IME |
| `frontend/src/lib/components/admin/AdminUserFilters.svelte.test.ts` | 新規 | normalize、submit、filter、reset、label |
| `frontend/src/lib/components/admin/AdminUserList.svelte` | 新規 | desktop table、mobile cards、pagination、actions |
| `frontend/src/lib/components/admin/AdminUserList.svelte.test.ts` | 新規 | semantics、responsive構造、actions、pagination |
| `frontend/src/lib/components/admin/AdminUserDetail.svelte` | 新規 | 詳細表示、loading/error/retry、action導線 |
| `frontend/src/lib/components/admin/AdminUserDetail.svelte.test.ts` | 新規 | nullable値、状態表示、focus fallback |
| `frontend/src/lib/components/admin/AdminActionConfirmation.svelte` | 新規 | status/role/delete確認内容とmutation error |
| `frontend/src/lib/components/admin/AdminActionConfirmation.svelte.test.ts` | 新規 | 対象、変更方向、typed confirmation、disabled |
| `frontend/src/routes/(app)/admin/+page.svelte` | 新規 | guard、read/mutation orchestration、同期、競合防止 |
| `frontend/src/routes/(app)/admin/+page.svelte.test.ts` | 新規 | auth/authz、401 single-flight、403、sync orchestration |
| `frontend/src/lib/components/Header.svelte` | 修正 | ADMIN専用desktop/mobile導線 |
| `frontend/src/lib/components/Header.svelte.test.ts` | 新規 | initializing/anonymous/USER/ADMINの導線test |
| `docs/05_progress.md` | 修正 | 実装中・完了更新 |
| `docs/plans/admin-dashboard/plan.md` | 新規/修正 | 本計画と実装完了記録 |
| `docs/04_api.md` | 原則変更なし | 契約差異が見つかった場合だけ更新 |

### 追加しない予定のファイル

| ファイル | 理由 |
|---|---|
| `frontend/src/routes/(app)/admin/+page.ts` | server loadで利用できるHttpOnly refresh/access token契約がなく、browser authStoreを使うため |
| `frontend/src/routes/(app)/admin/validation.ts` | query/page state責務を`$lib/admin/query.ts`へ集約するため |
| `frontend/src/lib/stores/admin.svelte.ts` | `/admin`固有stateをglobal化する必要がないため |
| `frontend/src/lib/stores/auth.svelte.ts` | 現行公開interfaceで必要な処理を構成できるため |
| backend route/service/test | API契約変更を予定しないため |
| Prisma schema/migration | 機能成立に不要で、性能変更は実測後の別計画とするため |

## 実装方針

1. API型、runtime guard、URL/request構築を`$lib/api/admin.ts`へ集約する。
2. role/statusをURL query、q/cursorを`App.PageState.adminUsers`、入力中qをcomponent local state、成功users/nextCursorをAPI response stateとする。
3. auth初期化後、認証済みなら保存roleにかかわらずlist APIを最初の認可確認兼data取得として1回呼ぶ。
4. list成功後だけadmin contentを表示し、stats取得を開始する。USERアクセス時にlistとstatsの二重403を発生させない。
5. 401処理はpage内single-flight reauth helperへ集約し、最新access tokenをcallbackへ渡して1回だけretryする。
6. 403時は全admin readをabortし、backend messageを保持したfail-closed画面に遷移する。日本語messageをauth state更新条件にしない。
7. list/stats/detailは別AbortControllerとrequest generationを持つ。
8. mutationは同時1件だけ許可し、一度送信したrequestをUI上のcancelで取り消さない。
9. mutation成功後は最新filter/page stateでlist、開いているdetail、statsを再取得する。
10. API client、query helper、component、page orchestrationをsliceごとにRed → Green → Refactorする。

## DB変更方針

- schema/migration/既存データ変更なし。
- User/UserStats/GameSession/WeakElement/AuditLog/token relationは変更しない。
- listでfrontendから行ごとのdetail APIを呼ばず、N+1を発生させない。
- limitは初期20件に固定し、最大100件を一度に要求しない。
- searchはbutton/Enter確定時のみ。入力ごと/debounce requestは行わない。
- statsは初回認可成功後、明示retry、mutation成功後だけ再取得する。
- filter、search、paginationだけではstatsを再取得しない。
- index追加は本タスクへ含めない。list latencyやEXPLAIN結果に問題がある場合、次を別計画で比較する。
  - `createdAt, id` cursor sort用index。
  - role/status/deletedAtとsortの複合index。
  - username/email contains向け`pg_trgm`等。
- 将来DB変更を追加する場合は、expand/contract、migration deploy、既存データ、rollback、Playwright確認を計画へ追加する。

## API変更方針

### 共通

- API変更なし。frontendは`docs/04_api.md`と実装済みrouteを利用する。
- 全requestにBearer tokenと`credentials: "include"`を指定する。
- JSON bodyがあるmutationだけ`Content-Type: application/json`を付ける。
- `response.ok`を先に確認し、errorは`parseErrorResponse()`、successは`parseSuccessJsonResponse()`を使う。
- network errorはraw objectをlogせず、pageで接続errorへ変換する。
- runtime validationは文書化された契約だけを検証する。

### `GET /api/v1/admin/users`

- query: limit/cursor/q/role/status。
- qはtrim後空文字を送らず、最大100文字。
- cursorはtrim後空文字を送らない。
- status定義はbackendどおりactive/suspended/deleted。
- sortは`createdAt desc, id desc`。
- responseはusersと`nextCursor: string | null`。
- response ID重複は不正な成功responseとして扱う。
- 400不正cursorはpagination領域に具体messageと先頭へ戻る導線を出す。

### `GET /api/v1/admin/users/:id`

- listにないloginFailCountと詳細statsを取得する。
- nullable dateを維持する。
- UserStats不存在時の0/null responseを正常として受理する。
- 404をdialog内へ表示する。

### Status/role/delete mutation

- request/responseは現行docsどおり。
- status/roleの成功responseにlist statsは含まれない。
- delete成功responseにuserは含まれない。
- そのため成功responseだけで局所状態を完成させず再取得する。
- 自己操作、最後の管理者、削除済み、昇格条件、同時競合の409を変更せず表示する。

### `GET /api/v1/admin/stats`

- users/games/learningの全fieldを非負整数、averageAccuracyRateを0〜100として検証する。
- users.totalはdeletedを含む。
- users.adminsは未削除ADMINであり、利用可能な管理者数ではない。
- users.emailVerifiedはservice実装上、未削除かつ確認済みの件数。
- 表示labelでこれらの意味を明確にする。

## UI / A11Y方針

### 認証・認可

- initializing: `aria-busy`と「ログイン状態を確認しています」。
- anonymous: APIを呼ばずlogin導線。現行login pageにredirect契約がないため新しいredirect queryは追加しない。
- authenticated: roleにかかわらずlist APIで認可確認。ただし成功まで管理UIは描画しない。
- 401: single-flight refreshを1回。失敗/再401はanonymousへ。
- 403: redirectせず、具体messageと安全な戻り先を表示。
- 保存roleがUSERでもadmin API成功なら、成功という権限根拠によりlocal roleをADMINへ同期できる。
- 403ではlocalized messageを根拠にlocal roleを変更しない。

### Header

- auth初期化完了、authenticated、local role ADMINのときだけ表示。
- desktop main navigationとmobile menuの両方へ追加。
- Header判定はUX上の導線制御であり、route/API guardの代替ではない。

### 統計

- users/games/learningを独立sectionとして表示。
- stats errorでlistを隠さない。
- users.totalは「登録ユーザー累計（退会含む）」等、adminsは「未退会ADMIN」、emailVerifiedは「メール確認済み（未退会）」と誤解のないlabelにする。

### 検索・filter・pagination

- qは検索buttonまたはIME変換完了後のEnterで適用。
- submit handler冒頭で1回だけtrimし、空文字はundefined、100文字超は画面内error。
- role/status変更、q変更、reset時にcursorを破棄。
- role/statusはURLへserializeし、invalid/未知値をcanonicalizeする。
- q/cursorは同一`page.state.adminUsers`に保存し、URLへ含めない。
- canonicalizationは現在値と比較し、replace loopを起こさない。
- paginationは1ページ置換型。next中は現在行を保持し、完了時に置換する。
- APIにprevious cursorがないため前ページはbrowser backで復元する。
- reload/戻る/進むではpage stateが保持される範囲でq/cursorを復元する。
- URLだけの直接アクセスではrole/statusのみ復元し、q/cursorは先頭状態。
- 総件数は表示しない。現在ページ件数を総件数と誤表記しない。

### 一覧・状態表示

- desktopはtable。`caption`、`thead`、`th scope="col"`、必要ならusernameを`scope="row"`で関連付ける。
- mobileはcard/listと`dl`でlabel/value関係を維持する。
- role/status/verification/lockを色だけで表現しない。
- deletedを最優先、次にisActiveからaccount statusをderiveする。
- `emailVerified=false`と`lockedUntil > now`はaccount statusとは別badge/説明にする。
- active filterを「ログイン可能」と表現しない。
- emailは一覧へ常時出さずdetailで表示する。
- 行actionのaccessible nameにusernameと操作内容を含める。emailは含めない。

### 詳細・確認dialog

- 行の詳細buttonでのみdetail APIを取得し、list件数分のrequestを行わない。
- admin配下のdialog shellで`role="dialog"`, `aria-modal`, label/description、focus trap、body scroll lockを管理する。
- 詳細dialogはclose、確認dialogはcancelへ初期focus。
- mutation未送信時はEsc/cancelで閉じる。
- mutation中はEsc、backdrop、close、全mutation actionを無効化し、`aria-busy`で通知する。
- close後、triggerが残れば戻す。filter変更等で消えた場合は一覧headingまたは安全な次行へfocusし、live regionで通知する。
- dialogを重ねない。詳細からactionへ進む場合は同じdialog stateを切り替えるか、一度閉じてfocusを安全に移す。

### 管理操作

- 停止/解除: username、現在状態、変更後状態を確認。
- role変更: username、現在role、変更後roleを確認。
- 強制退会: danger style、username、影響、固定文字列`強制退会`入力を要求。
- soft deleteだが現行UI/APIに復元機能がないため、「この管理画面から元に戻せない」と正確に説明する。「物理的に不可逆」とは表現しない。
- typed confirmation inputはlabel/instructionsを持ち、autocomplete/spellcheckによる意図しない補完を避ける。
- 自分自身、deleted対象、停止中のrole変更などresponseだけで確定できる禁止操作はdisabledと理由表示。
- last usable admin等、clientで確定不能な条件はAPIへ委ねる。

### Loading/error/success

- auth、authorization、initial list、next page、stats、detail、mutation、post-mutation syncを別stateにする。
- initial list errorは全面error + retry。
- next page errorは現在行を保持しpagination付近にerror + retry。
- stats errorはstats内だけ。
- detail/mutation errorはdialog内`role="alert"`。
- mutation successはbackend messageをtoast/live regionへ表示。
- 409はdialogを維持し、同じ操作を安全に再確認できるようにする。
- success後sync failureではmutationを再送せずread retryだけ提供する。

## 公開インターフェース案

実装コードではなく、frontend API境界の型・signature案を示す。

```ts
export type AdminUserRole = "USER" | "ADMIN";
export type AdminUserStatus = "active" | "suspended" | "deleted";

export type AdminUserSummary = {
  id: string;
  username: string;
  email: string;
  role: AdminUserRole;
  emailVerified: boolean;
  isActive: boolean;
  deletedAt: string | null;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminUserListItem = AdminUserSummary & {
  stats: {
    totalGames: number;
    accuracyRate: number;
    weeklyScore: number;
    allTimeScore: number;
  };
};

export type AdminUserDetail = AdminUserSummary & {
  loginFailCount: number;
  stats: {
    totalGames: number;
    totalCorrect: number;
    totalAnswered: number;
    accuracyRate: number;
    masteredCount: number;
    currentStreak: number;
    weeklyScore: number;
    allTimeScore: number;
    lastActiveDate: string | null;
    updatedAt: string | null;
  };
};

export type AdminUsersQuery = {
  limit?: number;
  cursor?: string;
  q?: string;
  role?: AdminUserRole;
  status?: AdminUserStatus;
};

export type AdminUsersResponse = {
  users: AdminUserListItem[];
  nextCursor: string | null;
};

export type AdminStats = {
  users: {
    total: number;
    active: number;
    suspended: number;
    deleted: number;
    admins: number;
    emailVerified: number;
  };
  games: {
    totalSessions: number;
    totalAnswered: number;
    averageAccuracyRate: number;
  };
  learning: {
    totalWeakElements: number;
    totalMasteredCount: number;
  };
};

export type AdminUserMutationResponse = {
  message: string;
  user: AdminUserSummary;
};
```

```ts
export function getAdminUsers(options: {
  accessToken: string;
  query?: AdminUsersQuery;
  signal?: AbortSignal;
}): Promise<AdminUsersResponse>;

export function getAdminUserDetail(options: {
  accessToken: string;
  userId: string;
  signal?: AbortSignal;
}): Promise<{ user: AdminUserDetail }>;

export function getAdminStats(options: {
  accessToken: string;
  signal?: AbortSignal;
}): Promise<AdminStats>;

export function updateAdminUserStatus(options: {
  accessToken: string;
  userId: string;
  isActive: boolean;
  signal?: AbortSignal;
}): Promise<AdminUserMutationResponse>;

export function updateAdminUserRole(options: {
  accessToken: string;
  userId: string;
  role: AdminUserRole;
  signal?: AbortSignal;
}): Promise<AdminUserMutationResponse>;

export function deleteAdminUser(options: {
  accessToken: string;
  userId: string;
  signal?: AbortSignal;
}): Promise<{ message: string }>;
```

```ts
export type AdminListPageState = {
  q?: string;
  cursor?: string;
};

export type AdminListLocation = {
  query: AdminUsersQuery;
  searchDraft: string;
  canonicalSearchParams: URLSearchParams;
  canonicalPageState: AdminListPageState;
  needsCanonicalization: boolean;
};

export function parseAdminListLocation(
  searchParams: URLSearchParams,
  pageState: unknown
): AdminListLocation;

export function serializeAdminListLocation(input: {
  role?: AdminUserRole;
  status?: AdminUserStatus;
  q?: string;
  cursor?: string;
}): {
  searchParams: URLSearchParams;
  pageState: AdminListPageState;
};

export function normalizeAdminSearchInput(rawValue: string):
  | { success: true; value: string | undefined }
  | { success: false; message: string };
```

`App.PageState`は衝突を避けるため、admin専用propertyにまとめる。

```ts
interface PageState {
  adminUsers?: AdminListPageState;
}
```

runtime guardは内部実装とし、公開API関数の振る舞いでtestする。admin detailの`totalCorrect <= totalAnswered`など文書にない制約は追加しない。

## テスト方針

### TDD

1. API client testをRedで追加し、未実装または不正responseで失敗することを確認。
2. API clientをGreenにする。
3. query helper testをRedで追加し、parse/serialize/state復元を実装。
4. component testを責務ごとにRed → Green。
5. page orchestration testでauth/authz/401 single-flight/mutation syncをRed → Green。
6. Refactor後に全frontend test、check、lint、formatを通す。

### 自動テスト範囲

- API client: URL、method、headers、credentials、body、signal、runtime validation、全error種別。
- query helper: URL query、page state、不正値、canonicalization、cursor reset。
- components: semantics、label、responsive両構造、dialog keyboard/focus、typed confirmation。
- page: auth state、API認可、single-flight refresh、stale response、mutation後sync。
- Header: initializing/anonymous/USER/ADMIN、desktop/mobile。
- backend:変更しない。契約差異が疑われる場合のみ既存admin route/service testを回帰実行する。

### Test配置

- API/helper testは対応sourceと同じdirectory。
- Svelte component testは対応componentと同じ`*.svelte.test.ts`。
- page orchestration testは`+page.svelte`と同じroute directory。
- endpoint別backend test命名規則はbackend変更がないため影響しない。

## テストケース一覧

### API client

| ケース | 期待結果 |
|---|---|
| list queryなし | 不要なqueryを送らない |
| q前後空白 | normalize済み値を1回だけ使用 |
| q空文字 | qを送らない |
| limit 1/20/100 | 正しくserialize |
| role/status/cursor併用 | AND条件用queryをURL encode |
| optional undefined | 文字列`undefined`を送らない |
| Authorization | Bearer token |
| credentials | 全requestでinclude |
| AbortSignal | 指定時にfetchへ渡す |
| list/detail/stats正常 | 型どおり返す |
| UserStats不存在相当 | 0/null responseを受理 |
| nullable date | nullまたはparse可能なstringを受理 |
| totalCorrect > totalAnswered | docsに制約がないため、それだけでは拒否しない |
| count負数/小数 | 不正成功responseとしてApiError(500) |
| accuracy 101 | ApiError(500) |
| role不正/date不正 | ApiError(500) |
| response user ID重複 | ApiError(500) |
| status PATCH | method/body/content-typeが正しい |
| role PATCH | method/body/content-typeが正しい |
| delete | DELETE、不要bodyなし |
| 400/401/403/404/409/500 | statusと具体messageを保持 |
| validation details | details[0].messageを保持 |
| 非JSON error | body null、fallback message |
| success非JSON | ApiError(500), body null |
| network error | pageが接続errorへ変換可能なrejection |

### 認証・認可

| ケース | 期待結果 |
|---|---|
| initializing | anonymous/forbidden/admin contentを表示しない |
| anonymous | API未呼出、login導線 |
| local USER + API 403 | protected contentなし、backend message |
| local USER + API 200 | content表示、成功後にlocal role ADMIN同期 |
| local ADMIN + API 200 | content表示 |
| local ADMIN + API 403 | fail-closed、messageでroleを書換えない |
| list 401 + refresh成功 | 新tokenで1回retry |
| list/stats/detailが近接して401 | refreshは同時1回だけ |
| refresh失敗 | anonymousへ |
| retry後も401 | 無限retryしない |
| 403停止/未確認/lock | 具体messageを保持 |
| 403発生後 | in-flight admin readをabort |
| reload/直接URL | auth初期化完了前に誤表示なし |

### Query/search/filter/pagination

| ケース | 期待結果 |
|---|---|
| 初期 | q/role/status/cursorなし |
| role/status URL | 正しく復元 |
| invalid role/status | 除去してcanonical URL |
| URL q/cursor | 利用せずURLから除去 |
| page state q/cursor | 同じstateから復元 |
| q trim | 同一normalize値をstate/APIで使用 |
| q空文字 | 未指定 |
| q 100文字 | 許可 |
| q 101文字 | 画面error、API未呼出 |
| IME変換中Enter | submitしない |
| search/filter変更 | cursor reset |
| reset | q/role/status/cursorを全clear |
| replace canonicalization | effect loopなし |
| nextあり | nextCursorで次page取得 |
| nextなし | 導線なし |
| next二重click | request 1回 |
| next loading | 現在rowsを保持 |
| next failure | 現在rows + inline retry |
| invalid cursor 400 | 具体message + 先頭導線 |
| back/forward/reload | URL/page stateを復元 |
| URL共有 | role/statusのみ復元 |
| stale request | 最新rowsを上書きしない |

### 一覧・詳細・A11Y

| ケース | 期待結果 |
|---|---|
| desktop table | caption/th/scope |
| mobile card | label/value対応を維持 |
| account status | active/suspended/deletedを文字表示 |
| 未確認/lock | statusとは別表示 |
| 色覚 | 色だけに依存しない |
| email | list常時非表示、detail表示 |
| row action | usernameと操作をaccessible nameに含む |
| list empty | 条件付きempty + reset |
| detail open | 選択時だけAPI |
| detail loading/error/retry | dialog内で通知・再試行 |
| detail 404 | 具体message |
| dialog open | safe initial focus |
| Tab/Shift+Tab | focus trap |
| Esc/cancel | 未送信時にclose |
| focus return | triggerまたはlist headingへ戻る |
| live region | loading/error/successを通知 |
| focus-visible | 全interactiveで維持 |

### Mutation

| ケース | 期待結果 |
|---|---|
| 停止/解除 | 対象とbefore/after確認、body正しい |
| USER→ADMIN/ADMIN→USER | 変更方向を明示 |
| 強制退会 | danger表示、固定語一致までdisabled |
| cancel | API未呼出 |
| 自己操作 | UI disabled、API 409も処理 |
| deleted対象 | mutation disabled、競合409も処理 |
| 停止中role変更 | disabledまたは409を具体表示 |
| last admin | client推測せず409表示 |
| 404/409/500/non-JSON/network | dialogを維持し安全にretry |
| double click | mutation 1回 |
| mutation中Esc/backdrop | closeしない |
| success | backend messageをtoast |
| success後 | 最新条件でlist/detail/stats再取得 |
| sync failure | mutation再送なし、read retry |
| 対象がfilterから消える | focus fallback + live通知 |
| current page空 | cursor resetして先頭を再取得 |
| filterがmutation中に変化 | 最新filterでsync |

## リリース・移行方針

- DB migration/データ移行なし。
- backend admin APIと監査ログが先にdeploy済みであることを確認してfrontendをreleaseする。
- 管理者アカウントは既存CLIで用意し、通常登録UIからADMINを作らない。
- release前にfrontend lint/format/check/testを全通過させる。
- disposableな確認用USERと、最後の1人ではない確認用ADMINを使ってsmoke testする。
- 本番データで強制退会testをしない。
- stats/list latencyと500を確認し、異常があればfrontend releaseを止め、backend性能計画へ切り分ける。
- feature flag基盤は現状確認できないため本タスクで新設しない。問題時はfrontend route/Header変更をrevertする。

## ロールバック方針

- frontend codeのrollbackは本タスクのcommitをrevertし、`/admin` route、admin API client、Header導線を除去する。
- backend API/schemaは本タスクで変更しないためrollback対象外。
- code rollbackは、既に成功した停止・解除・role変更・soft delete・token削除・監査ログを戻さない。
- 業務データの復旧が必要な場合、別の利用可能な管理者と既存APIで安全に戻せるstatus/roleだけを明示操作する。
- soft deleteは現行APIにrestoreがないため、自動復元やraw SQLを行わない。必要なら別の承認済み復旧手順を設計する。
- audit logは証跡のためrollback時にも削除しない。
- 最後の利用可能な管理者を失う操作はbackendが拒否するが、rollback作業前にも管理者数と状態を確認する。

## リスクと対策

| リスク | 影響 | 対策 |
|---|---|---|
| stale local role | 誤った導線/拒否 | API認可を正、成功前にcontent非表示 |
| multiple refresh | refresh同士がabort | single-flight promise + 1 retry |
| qの個人情報露出 | URL/log/referrerへemail | qはpage state、console/toast禁止 |
| history state型不整合 | check/build失敗 | `App.PageState`を明示定義 |
| cursor/filter不整合 | 欠落/重複page | 条件変更時cursor reset、同一state管理 |
| stale response | 新条件を上書き | controller + request generation |
| list scan/sort | 大規模DBで遅延 | limit20、submit検索、計測後index別計画 |
| stats複数集計 | DB負荷 | 初回/mutation/retryだけ、dedupe |
| status誤解 | activeをlogin可能と誤認 | verification/lockを別表示 |
| mutation同期漏れ | list/detail/stats不整合 | 成功後にserver再取得 |
| sync失敗時再mutation | 重複操作 | read retryを分離 |
| dialog trigger消失 | focus喪失 | list heading/次行fallback |
| 409上書き | 保護理由喪失 | ApiError.messageをdialogへ保持 |
| rollback誤解 | DB変更が残る | code/data rollbackを明確に分離 |
| test過分割/不足 | 保守性低下 | source近接test、pageはorchestration限定 |

## 作業手順

1. 本計画、進捗、API docs、規約、admin backend/frontend類似実装を再確認する。
2. `docs/05_progress.md`の対象タスクを`[-]`にする。
3. API client testをRedで追加する。
4. frontend admin API型、runtime guard、6 APIを実装してGreenにする。
5. query/page state helper testをRedで追加する。
6. `App.PageState`とquery helperを実装してGreenにする。
7. stats/filter componentをRed → Greenで実装する。
8. list/mobile/paginationをRed → Greenで実装する。
9. dialog/detail/action confirmationをRed → Greenで実装する。
10. page auth/authz/read orchestration testをRedで追加する。
11. single-flight reauth、list authz、stats/detail readを実装する。
12. mutation orchestration testをRedで追加する。
13. mutation、二重実行防止、post-mutation syncを実装する。
14. Header testをRedで追加し、desktop/mobile admin導線を実装する。
15. request/state/dialogの重複をRefactorする。
16. frontend format/lint/check/testを実行する。
17. desktop/mobile、keyboard、screen reader、error、競合を手動確認する。
18. `docs/04_api.md`の更新要否を確認する。
19. 進捗と本計画のcheckbox/対象ファイル/完了記録を更新する。
20. 変更種別ごとにcommitし、PRを作成する。

## タスクリスト

| ID | 内容 | 主対象 | 完了条件 | 優先度 |
|---|---|---|---|---|
| T1 | 既存仕様・実装・計画を再確認 | docs/backend/frontend | 契約差異と対象fileを確認 | High |
| T2 | 進捗を実装中へ更新 | `docs/05_progress.md` | 対象が`[-]` | High |
| T3 | API client Red test | `admin.test.ts` | 6 API/error/guard testが意図どおり失敗 | High |
| T4 | API client Green | `admin.ts` | T3通過、共通error/runtime guard利用 | High |
| T5 | query/state Red test | `query.test.ts` | restore/reset/canonicalization test失敗 | High |
| T6 | PageState/query helper Green | `app.d.ts`, `query.ts` | T5とcheck通過 | High |
| T7 | stats/filter Red test | component tests | 状態/A11Y/IME test失敗 | High |
| T8 | stats/filter Green | stats/filter components | T7通過 | High |
| T9 | list/pagination Red test | list test | table/mobile/next test失敗 | High |
| T10 | list/pagination Green | list component | T9通過 | High |
| T11 | dialog/detail/action Red test | dialog/detail/action tests | focus/confirmation test失敗 | High |
| T12 | dialog/detail/action Green | admin components | T11通過 | High |
| T13 | auth/authz/read Red test | page test | role/401/403/stale response test失敗 | High |
| T14 | auth/authz/read Green | `+page.svelte` | single-flight/list/stats/detail test通過 | High |
| T15 | mutation/sync Red test | page test | status/role/delete/sync test失敗 | High |
| T16 | mutation/sync Green | `+page.svelte` | T15通過、mutation同時1件 | High |
| T17 | Header Red test | Header test | role別desktop/mobile test失敗 | High |
| T18 | Header Green | `Header.svelte` | T17通過 | High |
| T19 | Refactor/A11Y再監査 | frontend変更 | 重複削除、focus/live region確認 | High |
| T20 | 品質check | frontend | lint/format/check/test全通過 | High |
| T21 | 手動確認 | `/admin` | 下記項目を記録 | High |
| T22 | docs更新要否確認 | `docs/04_api.md` | 契約差異なし/更新根拠を記録 | Medium |
| T23 | 進捗・計画完了更新 | progress/plan | `[x]`と実装完了記録 | High |

- [ ] T1: 既存仕様・実装・計画を再確認
- [ ] T2: 進捗を実装中へ更新
- [ ] T3: API client Red test
- [ ] T4: API client Green
- [ ] T5: query/state Red test
- [ ] T6: PageState/query helper Green
- [ ] T7: stats/filter Red test
- [ ] T8: stats/filter Green
- [ ] T9: list/pagination Red test
- [ ] T10: list/pagination Green
- [ ] T11: dialog/detail/action Red test
- [ ] T12: dialog/detail/action Green
- [ ] T13: auth/authz/read Red test
- [ ] T14: auth/authz/read Green
- [ ] T15: mutation/sync Red test
- [ ] T16: mutation/sync Green
- [ ] T17: Header Red test
- [ ] T18: Header Green
- [ ] T19: Refactor/A11Y再監査
- [ ] T20: 品質check
- [ ] T21: 手動確認
- [ ] T22: docs更新要否確認
- [ ] T23: 進捗・計画完了更新

## 品質チェック・手動確認

### Commands

```bash
cd frontend
npm run lint
npm run format
npm run check
npm run test:run
```

DB/backendを変更しないためmigration deployは不要。契約差異を疑う場合だけ既存admin backend testsを回帰実行する。

### 手動確認

- 未ログイン/USER/ADMINで`/admin`直接アクセス。
- slow refresh中にanonymous/forbidden/contentがflashしない。
- local USERだがAPI 200、local ADMINだがAPI 403のstale role scenario。
- Headerのdesktop/mobile表示。
- stats label、部分error、retry。
- username/email検索、IME、100/101文字境界。
- role/status/複数filter/reset。
- next page、nextなし、double click、invalid cursor。
- reload、戻る/進む、直接URL共有時の復元範囲。
- detail、nullable date、404、retry、focus return。
- 停止/解除、昇格/降格、強制退会、cancel。
- 自己操作、最後の管理者、deleted、昇格条件、同時競合の409。
- 401 single refresh、403、500、非JSON、offline、slow network。
- mutation成功後sync、sync failure、対象がfilterから消える場合。
- keyboard-only、Tab/Shift+Tab/Esc、focus-visible。
- screen readerでcaption/label/live region/alert/dialogを確認。
- desktop/mobileで横overflowと操作性を確認。
- URL、toast、consoleにemail/q/token/raw responseがない。
- disposable test userの代表mutationについて、必要に応じPrisma Studio等のPrisma経由で監査action/result/内部IDを確認し、email/username/request/responseが保存されていないことを確認する。
- 本番データ、唯一の利用可能なADMIN、復元不能な実ユーザーで強制退会testをしない。

## 実装完了時の更新ルール

- 完了taskを`- [x]`にする。
- `docs/05_progress.md`を`[x]`にする。
- 対象ファイル一覧を実際の変更fileと一致させる。
- 作成しなかったfile、計画外file、component統合/分割を記録する。
- 計画から変更したauth、state、pagination、dialog、sync判断を記録する。
- API契約が変わった場合だけ`docs/04_api.md`を更新する。
- DB変更が生じた場合はmigration、既存data影響、deploy/rollback、Playwright結果を追記する。
- `## 実装完了`を追記し、完了日、branch、PR、TDD、品質check、手動確認、実際の変更fileを記録する。

```markdown
## 実装完了

- 完了日: YYYY-MM-DD
- 実装ブランチ: feature/admin-dashboard
- PR: #N

### 計画からの変更点

### 実際の変更ファイル

| ファイル | 変更種別 | 内容 |
|---|---|---|

### TDD・品質チェック結果

| 確認 | 結果 |
|---|---|
| Red / Green / Refactor | |
| `npm run lint` | |
| `npm run format` | |
| `npm run check` | |
| `npm run test:run` | |

### 手動確認結果

| 項目 | 結果・補足 |
|---|---|
| auth/authz | |
| search/filter/pagination | |
| detail/mutation | |
| error/競合 | |
| desktop/mobile/A11Y | |
| 個人情報非露出 | |
| 監査ログ | |
```
