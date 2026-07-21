# ダークモード 実装計画

> 設計者ロール: シニアフロントエンドエンジニア / アクセシビリティエンジニア

## 概要

ポートフォリオ版v0.1のrelease blockerとして、OS設定を初期値に使い、利用者が明示的にライト/ダークを切り替えられるダークモードを実装する。選択はbrowserへ保存し、SSR・hydration・初期描画で大きな色反転が起きないようにする。主要画面の色を一貫したtheme tokenへ移行し、keyboard、focus、contrast、状態伝達を維持する。

## 現状

- `frontend/src/app.css`はfont、brand、inkの最小tokenだけを持つ。
- Header、Footer、各page/componentに`bg-white`、`text-gray-*`、`border-gray-*`等が直接指定されている。
- theme store、保存設定、`prefers-color-scheme`監視、theme切替UIは存在しない。
- `frontend/src/app.html`にはtheme初期化処理がなく、`frontend/src/routes/+layout.svelte`はauth初期化だけを行う。
- `docs/05_progress.md`では未実装であり、v0.1公開前に完了する。

## 前提条件・依存関係

### 既存の公開インターフェース

**`frontend/src/routes/+layout.svelte`**

- browser環境で`authStore.initialize()`を初回描画前に開始するroot layout。

**`frontend/src/lib/components/Header.svelte`**

- desktop/mobile navigation、認証状態、mobile menuのkeyboard/inert契約を持つ。

**`frontend/src/app.css`**

- Tailwind CSS v4の`@theme`とglobal body styleのsingle source。

### 重要な制約

- theme設定をauth StoreやAPIへ保存せず、認証状態と独立したlocal preferenceにする。
- `window`、`localStorage`、`matchMedia`はbrowser guardなしにSSRで参照しない。
- 保存値は`light` / `dark`だけを許可し、不正値はOS設定へfallbackする。
- theme初期化のために秘密値、user識別子、network requestを使用しない。
- inline bootstrapを採用する場合、既存/将来のVercel HTML CSPと整合することをbuild・header確認で固定する。CSPを`unsafe-inline`へ弱めて解決しない。
- 色だけで正誤、error、focus、disabled、習得状態を伝えない。
- theme用の同じ色・localStorage key・media queryを複数componentへ複製しない。

## 対象ファイル一覧

| ファイル                                                 | 変更種別 | 内容                                                      |
| -------------------------------------------------------- | -------- | --------------------------------------------------------- |
| `frontend/src/lib/stores/theme.svelte.ts`                | 新規     | themeのsingle source、OS初期値、保存、media/storage同期   |
| `frontend/src/lib/stores/theme.svelte.test.ts`           | 新規     | SSR、保存値、OS変更、toggle、不正値のunit test            |
| `frontend/src/lib/components/ThemeToggle.svelte`         | 新規     | keyboard操作可能なtheme切替button                         |
| `frontend/src/lib/components/ThemeToggle.svelte.test.ts` | 新規     | label、`aria-pressed`、click、focusのcomponent test       |
| `frontend/src/app.html`                                  | 修正     | CSP nonce付きのhydration前theme bootstrap                 |
| `frontend/src/app.css`                                   | 修正     | light/dark semantic token、`color-scheme`、body背景・前景 |
| `frontend/src/routes/+layout.svelte`                     | 修正     | theme store初期化をbrowser境界へ接続                      |
| `frontend/src/lib/components/Header.svelte`              | 修正     | desktop/mobileから到達可能なtoggleとtheme対応色           |
| `frontend/src/lib/components/Header.svelte.test.ts`      | 修正     | desktop/mobile toggle配置とmobile inert契約の回帰test     |
| `frontend/src/lib/components/Footer.svelte`              | 修正     | theme対応色                                               |
| `frontend/src/routes/**/*.svelte`                        | 修正     | hardcoded light colorをsemantic themeへ移行               |
| `frontend/src/lib/components/**/*.svelte`                | 修正     | card、modal、form、chart、toast、admin UIのtheme対応      |
| `frontend/src/lib/elements/category-style.ts`            | 修正     | 元素分類色をsemantic tokenへ移行                          |
| `frontend/src/lib/elements/category-style.test.ts`       | 修正     | 元素分類styleのtoken契約を更新                            |
| `frontend/src/lib/elements/mastery-badge.ts`             | 修正     | 習得度badgeをsemantic tokenへ移行                         |
| `frontend/src/lib/elements/mastery-badge.test.ts`        | 修正     | 習得度badgeのtoken契約を更新                              |
| `frontend/src/dark-mode-contract.test.ts`                | 新規     | hardcoded色残存、初期化順、主要画面契約のsource test      |
| `docs/05_progress.md`                                    | 修正     | 実装中/完了状態と計画link                                 |
| `docs/plans/dark-mode/plan.md`                           | 修正     | TDD、実変更、browser確認、完了記録                        |
| `docs/plans/portfolio-release-v0-1/plan.md`              | 修正     | release blocker表とR2の状態を同期                         |

対象globは無条件の一括置換を意味しない。`rg`でhardcoded色を棚卸しし、意味のあるsurface/text/border/action/status tokenへ分類して実変更表を確定する。

## 公開インターフェース案

```typescript
export type ThemePreference = "light" | "dark";

export type ResolvedTheme = "light" | "dark";

export const themeStore: {
  readonly preference: ThemePreference | null;
  readonly resolvedTheme: ResolvedTheme;
  readonly isDark: boolean;
  initialize(): void;
  toggle(): void;
};
```

- `preference=null`は保存済み選択がなく、OS設定を追従する状態を表す。
- 初回toggle後は現在のeffective themeと反対の明示値を保存する。
- 公開APIにthemeを追加せず、browser内だけで完結する。

## 設計上の決定事項

1. **初期値**
   - 選択: 保存値がなければ`prefers-color-scheme`を使う。
   - 根拠: OS設定追従を満たし、初回利用者の期待に合わせるため。

2. **切替UI**
   - 選択: Headerにライト/ダークを切り替える`button`を置き、desktop/mobileの両方から操作可能にする。
   - 根拠: 常時到達でき、native buttonのkeyboard/semanticを利用できるため。

3. **状態表現**
   - 選択: 現在のthemeを日本語のaccessible nameと`aria-pressed`で伝え、iconだけに依存しない。
   - 根拠: screen readerとkeyboard利用者に状態と操作結果を伝えるため。

4. **保存先**
   - 選択: versioned localStorage keyを1箇所で定義する。CookieやDBへ保存しない。
   - 根拠: 個人情報を増やさず、未ログインでも同じbrowserで維持するため。

5. **初期描画フラッシュ**
   - 選択: hydration前bootstrapを第一候補とし、CSPを弱めずに適用できない場合はserver default + CSS media fallbackで安全に劣化させる。
   - 根拠: no-flashとCSPの両方を守り、見た目のためにsecurity headerを後退させないため。

6. **色管理**
   - 選択: semantic tokenを`app.css`へ集約し、componentごとのdark用hexを禁止する。
   - 根拠: contrast修正と将来のtheme調整を1箇所で行うため。

7. **OS設定変更**
   - 選択: 明示保存がない間だけ`matchMedia`変更を追従する。明示選択がある場合は上書きしない。
   - 根拠: user選択を尊重しつつsystem modeを正しく扱うため。

## theme token方針

最低限、次の意味を持つtokenをlight/dark両方で定義する。

| token分類                         | 用途                             |
| --------------------------------- | -------------------------------- |
| canvas / surface / elevated       | body、header/footer、card、modal |
| text / muted / inverse            | 通常本文、補助文、反転button     |
| border / focus                    | 区切り、input、focus ring        |
| brand / brand-hover               | CTA、link、主要action            |
| success / warning / danger / info | feedback、status、error          |
| overlay                           | modal backdrop                   |

元素分類色、chart色、正誤feedbackは単純反転せず、light/dark双方で文字とのcontrastと色以外の識別を確認する。

## タスクリスト（進捗管理）

| タスクID | 内容                           | ファイル                              | 優先度 | 完了条件                                    |
| -------- | ------------------------------ | ------------------------------------- | ------ | ------------------------------------------- |
| D1       | 現行色とcontrastを棚卸し       | frontend Svelte/CSS                   | 高     | hardcoded色をsemantic分類                   |
| D2       | theme storeのRed test          | `theme.svelte.test.ts`                | 高     | SSR/OS/保存/toggle不一致で失敗              |
| D3       | theme storeを実装              | `theme.svelte.ts`                     | 高     | unit test成功、重複key/queryなし            |
| D4       | toggleのRed test               | `ThemeToggle.svelte.test.ts`          | 高     | label/pressed/click未実装で失敗             |
| D5       | accessible toggleを実装        | `ThemeToggle.svelte`, `Header.svelte` | 高     | desktop/mobileでkeyboard操作可能            |
| D6       | no-flash bootstrap契約をRed化  | `dark-mode-contract.test.ts`          | 高     | 初期化順/CSP契約を検出                      |
| D7       | root初期化とglobal tokenを実装 | `app.html`, root layout, `app.css`    | 高     | SSR/hydration/build成功                     |
| D8       | 主要component/pageを移行       | routes/components                     | 高     | light hardcode依存を解消                    |
| D9       | component/全体回帰             | frontend tests                        | 高     | 対象・関連・全test成功                      |
| D10      | browser/A11Y確認               | Playwright/manual                     | 高     | OS、保存、reload、320px、keyboard、contrast |
| D11      | format/lint/check/build        | frontend                              | 高     | 全品質gate成功                              |
| D12      | plan/progressを同期            | docs                                  | 中     | 実変更表、TDD、結果、完了mark一致           |

- [x] D1: 現行色とcontrastを棚卸しする
- [x] D2: theme storeのRed testを追加する
- [x] D3: theme storeを実装する
- [x] D4: theme toggleのRed testを追加する
- [x] D5: accessible theme toggleを実装する
- [x] D6: no-flash bootstrap契約をRed化する
- [x] D7: root初期化とglobal theme tokenを実装する
- [x] D8: 主要component/pageをsemantic themeへ移行する
- [x] D9: component/全体回帰testを実行する
- [x] D10: browser・keyboard・contrastを確認する
- [x] D11: format/lint/check/buildを通す
- [x] D12: plan/progressを実態へ同期する

## TDD方針

### Red

- SSRでbrowser APIを参照しないこと、保存値・OS設定・不正値・toggle・OS変更の期待をtest先行で固定する。
- toggleのaccessible name、`aria-pressed`、click、keyboard focusをcomponent testで固定する。
- app初期化順と主要surface tokenをsource/build contractで固定する。

### Green

- store、toggle、bootstrap、semantic tokenの順で最小実装する。
- hardcoded色の移行は画面単位に行い、対象testだけを都度実行する。

### Refactor

- localStorage key、media query、DOM反映、tokenを共通化する。
- 同じdark classや色定義をcomponentへ複製しない。
- format後に関連testと最終frontend品質gateを実行する。

## テストケース一覧

| ケース                | 期待結果                         |
| --------------------- | -------------------------------- |
| SSR import            | `window`/`localStorage`例外なし  |
| 保存値なし・OS dark   | 初期theme dark                   |
| 保存値なし・OS light  | 初期theme light                  |
| 保存値dark・OS light  | user選択darkを優先               |
| 保存値不正            | 値を採用せずOSへfallback         |
| toggle                | effective themeを反転し保存      |
| OS変更・明示値なし    | 追従                             |
| OS変更・明示値あり    | user選択を維持                   |
| reload                | 保存themeを初期描画から維持      |
| desktop/mobile Header | toggleへkeyboardで到達・操作可能 |
| focus                 | light/dark両方で可視             |
| status/feedback       | 色以外のtext/icon/semanticを維持 |
| 320px viewport        | 横スクロールやtoggle見切れなし   |
| production build      | CSPを弱めず成功                  |

## 手動確認

主要画面 `/`、`/register`、`/login`、`/elements`、`/game`、`/game/play`、`/game/result`、`/ranking`、`/weak`、`/mypage`、`/settings`、`/admin`をlight/dark両方で確認する。`/privacy`はportfolio release計画の別タスクR3で新規実装後に確認する。

- OS light/dark初期値。
- toggle、reload、別tab同期。
- desktop/mobile navigation。
- form、error、toast、modal、focus、disabled。
- element category、chart、game正誤、admin status。
- 200% zoomと320px viewport。
- `prefers-reduced-motion`時に不要なtheme transitionを抑制。

## 実装完了条件

- [x] OS設定追従、明示toggle、保存、reloadがtestとbrowserで成功する。
- [x] SSR/hydration errorと大きなtheme flashがない。
- [x] 主要画面がlight/dark両方で読め、focusとstatusが色だけに依存しない。
- [x] CSP、security header、auth初期化を弱めていない。
- [x] frontend全test、lint、format check、Svelte check、production buildが成功する。
- [x] 対象ファイルと実差分、TDD記録、手動確認結果が本計画と`docs/05_progress.md`に一致する。

## 実装完了

- 完了日: 2026-07-21
- 実装ブランチ: `feature/dark-mode`
- PR: 作成後に追記

### 計画からの変更点

- CSP nonce付きinline bootstrapを`app.html`へ採用し、storage keyとmedia queryはdocument rootのdata属性をsingle sourceとしてstoreと共有した。
- 元素分類色と習得度badgeもhardcoded palette棚卸しの対象となったため、`category-style.ts`、`mastery-badge.ts`と対応testを実変更へ追加した。
- browser確認で320px時の`body { min-width: 320px; }`がscrollbarを生むことを検出し、固定最小幅を削除した。
- 実装後レビューで主要な文字・status・focusのWCAGコントラストを自動検証する契約testを追加した。
- `/privacy`は本タスクR2では未実装であり、portfolio release計画のR3へ維持した。

### TDD実施記録

| phase      | 対象                                       | 結果                                                                |
| ---------- | ------------------------------------------ | ------------------------------------------------------------------- |
| Red        | theme store                                | module未実装により対象testが意図どおり失敗                          |
| Green      | theme store                                | SSR、OS、保存、toggle、media/storage同期を含む12 test成功           |
| Red        | ThemeToggle                                | component未実装によりaccessible name・pressed・click testが失敗     |
| Green      | ThemeToggle / Header                       | toggle 4 testとHeader回帰5 testの計9 test成功                       |
| Red        | bootstrap / semantic token source contract | bootstrap、初期化順、token、固定palette検出の6 testが意図どおり失敗 |
| Green      | bootstrap / semantic移行                   | 関連13 files・88 test成功、source contract成功                      |
| Review     | contrast contract                          | light/dark各9組の文字・status・focus比率を検証し8 contract test成功 |
| Final gate | frontend全体                               | 54 files・580 test、lint、format、Svelte check、preview build成功   |

### 最終品質gate

| command                 | 結果                                      |
| ----------------------- | ----------------------------------------- |
| `npm run test:run`      | 54 files・580 test成功                    |
| `npm run lint`          | 成功                                      |
| `npm run format:check`  | 成功                                      |
| `npm run check`         | 0 errors・0 warnings                      |
| `npm run build:preview` | Vercel Preview buildとoutput contract成功 |

### browser・アクセシビリティ確認

| 確認項目               | 結果                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| 初期表示・保存・reload | system lightの初期表示、明示dark切替、reload後dark維持、console error 0件                                |
| OS設定・別tab同期      | matchMediaのlight/darkとstorage eventをstore/bootstrap testで確認                                        |
| desktop/mobile Header  | 両方にnative buttonを配置し、mobile menuのinert契約、accessible name、`aria-pressed`、focus可視を確認    |
| 320px                  | 主要routeで横overflow 0件。mobile toggleがviewport内に収まり、light/dark切替成功                         |
| 主要route              | `/`、認証、元素、game、ranking、weak、mypage、settings、adminの公開・未認証状態でdark表示とconsoleを確認 |
| contrast               | body 16.69/17.22、muted 7.56/11.81、action 5.17、surface 17.74/16.12（light/dark、WCAG AA以上）          |
| focus / reduced motion | focus outline 2pxをdarkで視認。native button testとreduced-motion global ruleを確認                      |
| scope外                | `/privacy`はR3、認証後のstaging導線とproduction CSP headerはR12/R16で最終確認                            |

### 実際の変更ファイル

| ファイル・範囲                                              | 変更種別 | 内容                                                        |
| ----------------------------------------------------------- | -------- | ----------------------------------------------------------- |
| `frontend/src/lib/stores/theme.svelte.{ts,test.ts}`         | 新規     | theme state、browser adapter、unit test                     |
| `frontend/src/lib/components/ThemeToggle.svelte{,.test.ts}` | 新規     | accessible toggleとcomponent test                           |
| `frontend/src/app.html`、`app.css`、root layout             | 修正     | no-flash bootstrap、semantic token、初期化                  |
| `frontend/src/lib/components/Header.svelte{,.test.ts}`      | 修正     | desktop/mobile統合と回帰test                                |
| `frontend/src/lib/components/**/*.svelte`                   | 修正     | footer、home、game、elements、ranking、mypage、toast、admin |
| `frontend/src/routes/**/*.svelte`                           | 修正     | 公開・認証後pageのsemantic theme移行                        |
| `frontend/src/lib/elements/category-style.{ts,test.ts}`     | 修正     | 元素分類semantic token                                      |
| `frontend/src/lib/elements/mastery-badge.{ts,test.ts}`      | 修正     | 習得度semantic token                                        |
| `frontend/src/dark-mode-contract.test.ts`                   | 新規     | bootstrap、CSP、palette、token、contrast契約                |
| `docs/05_progress.md`                                       | 修正     | dark mode状態同期                                           |
| `docs/plans/dark-mode/plan.md`                              | 修正     | 実装記録と完了状態                                          |
| `docs/plans/portfolio-release-v0-1/plan.md`                 | 修正     | release blockerとR2状態同期                                 |
