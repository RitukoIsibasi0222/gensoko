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

| ファイル                                                 | 変更種別 | 内容                                                              |
| -------------------------------------------------------- | -------- | ----------------------------------------------------------------- |
| `frontend/src/lib/stores/theme.svelte.ts`                | 新規     | themeのsingle source、OS初期値、保存、media/storage同期           |
| `frontend/src/lib/stores/theme.svelte.test.ts`           | 新規     | SSR、保存値、OS変更、toggle、不正値のunit test                    |
| `frontend/src/lib/components/ThemeToggle.svelte`         | 新規     | keyboard操作可能なtheme切替button                                 |
| `frontend/src/lib/components/ThemeToggle.svelte.test.ts` | 新規     | label、`aria-pressed`、click、focusのcomponent test               |
| `frontend/src/app.html`                                  | 修正候補 | hydration前の安全なtheme bootstrap。CSPとno-flash検証後に採否確定 |
| `frontend/src/app.css`                                   | 修正     | light/dark semantic token、`color-scheme`、body背景・前景         |
| `frontend/src/routes/+layout.svelte`                     | 修正     | theme store初期化をbrowser境界へ接続                              |
| `frontend/src/lib/components/Header.svelte`              | 修正     | desktop/mobileから到達可能なtoggleとtheme対応色                   |
| `frontend/src/lib/components/Footer.svelte`              | 修正     | theme対応色                                                       |
| `frontend/src/routes/**/*.svelte`                        | 修正     | hardcoded light colorをsemantic themeへ移行                       |
| `frontend/src/lib/components/**/*.svelte`                | 修正     | card、modal、form、chart、toast、admin UIのtheme対応              |
| `frontend/src/dark-mode-contract.test.ts`                | 新規     | hardcoded色残存、初期化順、主要画面契約のsource test              |
| `docs/05_progress.md`                                    | 修正     | 実装中/完了状態と計画link                                         |
| `docs/plans/dark-mode/plan.md`                           | 修正     | TDD、実変更、browser確認、完了記録                                |

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

- [ ] D1: 現行色とcontrastを棚卸しする
- [ ] D2: theme storeのRed testを追加する
- [ ] D3: theme storeを実装する
- [ ] D4: theme toggleのRed testを追加する
- [ ] D5: accessible theme toggleを実装する
- [ ] D6: no-flash bootstrap契約をRed化する
- [ ] D7: root初期化とglobal theme tokenを実装する
- [ ] D8: 主要component/pageをsemantic themeへ移行する
- [ ] D9: component/全体回帰testを実行する
- [ ] D10: browser・keyboard・contrastを確認する
- [ ] D11: format/lint/check/buildを通す
- [ ] D12: plan/progressを実態へ同期する

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

主要画面 `/`、`/register`、`/login`、`/elements`、`/game`、`/game/play`、`/game/result`、`/ranking`、`/weak`、`/mypage`、`/settings`、`/admin`、`/privacy`をlight/dark両方で確認する。

- OS light/dark初期値。
- toggle、reload、別tab同期。
- desktop/mobile navigation。
- form、error、toast、modal、focus、disabled。
- element category、chart、game正誤、admin status。
- 200% zoomと320px viewport。
- `prefers-reduced-motion`時に不要なtheme transitionを抑制。

## 実装完了条件

- [ ] OS設定追従、明示toggle、保存、reloadがtestとbrowserで成功する。
- [ ] SSR/hydration errorと大きなtheme flashがない。
- [ ] 主要画面がlight/dark両方で読め、focusとstatusが色だけに依存しない。
- [ ] CSP、security header、auth初期化を弱めていない。
- [ ] frontend全test、lint、format check、Svelte check、production buildが成功する。
- [ ] 対象ファイルと実差分、TDD記録、手動確認結果が本計画と`docs/05_progress.md`に一致する。
