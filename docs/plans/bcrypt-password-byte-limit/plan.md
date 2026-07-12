# bcrypt 72バイト上限の入力検証統一 実装計画

> 設計者ロール: シニアフルスタックエンジニア兼アプリケーションセキュリティエンジニア

## 概要

新しくbcryptハッシュとして保存するパスワードを、正規化後のUTF-8表現で72バイト以内に制限する。登録、パスワードリセット、パスワード変更の新パスワード、管理者作成CLIに同じポリシーを適用し、バックエンドを最終防御境界、フロントエンドを即時フィードバック境界とする。

DBのbcryptハッシュから元のパスワード長は判別できないため、ログイン、パスワード変更・退会時の現在パスワードには72バイト制限を追加せず、既存の72バイト超パスワード利用者が本人確認を継続できるようにする。

- 進捗タスク: `docs/05_progress.md` フェーズ11
- 実装ブランチ想定: `feature/bcrypt-password-byte-limit`
- API成功レスポンス、認証・認可、DBスキーマは変更しない。
- API入力契約へ「新規パスワードはUTF-8で72バイト以内」を追加する。

## レビュー結果と改善方針

### この計画のまま実装すべきではない理由

前案は対象経路と72/73バイト境界を列挙できていたが、bcryptjs自身の判定との一致、Zodを迂回した場合の最終防御、旧パスワードの先頭72バイトへの変更、設定画面のエラー関連付け、リリース順序が未確定だった。このままではUnicode判定差、サイレント切り捨て、実効的に同じパスワードへの変更、誤ったA11Y情報が残る。

### DBの整合性と負荷

| 指摘内容 | 根拠 | 影響・リスク | 改善案 | 優先度 |
|---|---|---|---|---|
| 既存値の元バイト数は判別不能 | 確認できた事実: `User` は `passwordHash` だけを保持する | 72バイト超利用者の抽出・一括移行は不可能 | DB移行せず照合経路で互換維持 | High |
| DB変更は不要 | 確認できた事実: hash前検証だけを変え保存形式は不変 | 不要なmigrationリスク | schema/index/migration変更なし | High |
| N+1・追加queryなし | 確認できた事実: 取得済みhashを再利用可能 | DB負荷増加なし | queryを増やさない | Low |
| bcrypt比較が1回増える | 推測: 変更時の実効同一性確認に必要 | CPU・応答時間増加 | rate limit維持、手動性能確認 | Medium |

### API・コードの整合性

| 指摘内容 | 根拠 | 影響・リスク | 改善案 | 優先度 |
|---|---|---|---|---|
| Zodだけでは最終防御にならない | 確認できた事実: 永続化hashは `hashPassword()` に集約済み | 内部呼び出しで切り捨て | Zodとhash境界の二層防御 | High |
| 独自UTF-8計算はbcryptとずれ得る | 確認できた事実: bcryptjs 3.0.3は `truncates()` を公開 | Unicode端点の差 | backendは同APIをラップ | High |
| 照合入力へ上限を適用できない | 確認できた事実: login/currentPasswordはstrong schemaを使わない | 既存利用者締め出し | 新規保存用schemaと照合schemaを分離 | High |
| 文字列比較では実効同一性を検出不能 | 確認できた事実: change serviceは完全一致だけを拒否 | 旧73バイト以上から先頭72へ変更しても資格情報不変 | 新値も既存hashへcompare | High |
| 照合後の無条件更新に競合窓がある | 確認できた事実: 旧実装はIDだけでupdate | 同じcurrentPasswordの並行要求が両方成功し後勝ちになる | IDと旧hashを条件にupdateManyし、0件は409でrollback | High |
| package間で定数を物理共有できない | 確認できた事実: backend/frontendは別package | 定数・messageのドリフト | 各packageで一元化し契約testで同期 | Medium |
| API client変更は不要 | 確認できた事実: users clientはpayloadとZod detailsを保持 | 不要な回帰範囲 | page validationとerror回帰testのみ | Low |

### UI / A11Y

| 指摘内容 | 根拠 | 影響・リスク | 改善案 | 優先度 |
|---|---|---|---|---|
| `maxlength="72"` は使えない | 確認できた事実: maxlengthはUTF-8バイト数ではない | 多バイト誤判定 | TextEncoderで検証 | High |
| settingsのerrorが3入力で共有 | 確認できた事実: current/new/confirmが同じerror ID・invalid状態 | 無関係な入力まで無効と読まれる | field別error state/IDへ分離 | High |
| invalid時のfocus移動なし | 確認できた事実 | keyboard/SRで位置不明 | 最初のinvalid inputへtick後focus | Medium |
| UTF-8 hintなし | 確認できた事実 | 多バイト利用者が理由を理解できない | hintとerrorをdescribedbyで関連付け | Medium |
| page DOM test不足 | 確認できた事実 | ARIA・送信抑止の回帰 | 最小DOM/A11Y test追加 | Medium |

### テスト

| 指摘内容 | 根拠 | 影響・リスク | 改善案 | 優先度 |
|---|---|---|---|---|
| 72/73バイトtestなし | 確認できた事実 | Unicode破綻を検出不能 | ASCII、日本語、絵文字、混在で境界test | High |
| 弱いfixtureでは別errorが先行 | 推測 | 上限を検証できない | 全強度条件を満たすfixture | High |
| mockだけではlegacy互換の証明が弱い | 確認できた事実: bcryptをmock | 実挙動と異なる保証 | 引数伝播と限定的な実bcrypt test | Medium |
| 共通validation testがregister配下 | 確認できた事実 | 共通責務が不明瞭 | lib/validation配下を正本にする | Medium |

## 背景・目的

bcryptjs 3.0.3はUTF-8変換後の先頭72バイトだけをhash対象とする。現行backend/frontendは最小長・文字種・空白だけを確認し、最大バイト数を確認しない。

1. 新規保存値のサイレント切り捨てをAPI、CLI、hash境界で防止する。
2. frontendで同じ上限を事前表示する。
3. 既存hash照合経路を維持する。

## スコープ

### 上限を適用する入力

- `POST /api/v1/auth/register` の `password`
- `POST /api/v1/auth/reset-password` の `password`
- `PATCH /api/v1/users/me` の `newPassword`
- 管理者CLIの `--password` / `ADMIN_PASSWORD`
- 共通 `hashPassword()`
- `/register`、`/reset-password`、`/settings` の新規パスワード

### 上限を適用しない入力

- loginの `password`
- PATCH/DELETE users/meの `currentPassword`
- その他既存hashとの照合だけを行う入力

### 非スコープ

- hashing algorithm、pepper、cost、強度規則、空白・trim方針
- 既存hashの一括再生成、強制reset
- DB schema/index/relation/migration
- request body全体のDoS上限
- API client基盤刷新

## 現状調査結果

### 確認できた事実

- 対象タスクはprogressフェーズ11に存在する。
- 本計画作成前に同pathの計画書はない。
- `docs/02_security.md` は本件を未実装として記録する。
- bcryptjs 3.0.3は `truncates(password)` を公開する。
- strong schemaはregister、reset、newPassword、CLIで共用される。
- login/currentPasswordはstrong schemaを使わない。
- 永続化hashは `hashPassword()` に集約済み。
- loginのtiming対策だけは固定値をcost 4で直接hashする。
- backendはtrim後の値をhash/compareする。
- 対象画面は正規化値を一度計算し検証と送信へ再利用する。
- DBはhashだけを持ち元長を保持しない。

### 推測・再確認事項

- TextEncoderとbcryptjsは有効なUnicodeで一致する見込みだが境界fixtureで固定する。
- 実bcrypt testはcost 4なら許容時間に収まる見込み。
- 追加compareの性能影響はrate limit下で許容見込み。

## 前提条件・依存関係

### 既存の公開インターフェース

- `strongPasswordSchema: ZodType<string>` — 新規保存用strong password schema。
- `hashPassword(password: string): Promise<string>` — cost 12の永続化用hash境界。
- `normalizePassword(rawPassword: string): string` — trimする既存正規化。
- frontend `validatePassword(value: string): string | null` — trim済み新規パスワードの共通検証。

### 重要な制約

- 正規化値を一度だけ作り検証、比較、送信、hashへ再利用する。
- login/currentへ新規保存用schemaを流用しない。
- maxlength、`string.length`、文字数表記で代用しない。
- password/hash/bodyをlog・監査log・responseへ含めない。
- Zod失敗は既存 `{ error, details }` と400を維持する。
- hash guardの内部errorを500 responseへ露出しない。

## 対象ファイル一覧

| ファイル | 種別 | 内容 |
|---|---|---|
| `backend/src/lib/password.ts` | 修正 | 定数、message、bcrypt判定、hash guard |
| `backend/src/lib/password.test.ts` | 修正 | 72/73、guard、legacy |
| `backend/src/lib/validation/auth.ts` | 修正 | strong schema上限 |
| `backend/src/lib/validation/auth.test.ts` | 新規 | Unicode境界 |
| `backend/src/routes/auth/register.test.ts` | 修正 | API境界 |
| `backend/src/routes/auth/reset-password.test.ts` | 修正 | API境界・副作用なし |
| `backend/src/routes/auth/login.test.ts` | 修正 | legacy互換 |
| `backend/src/routes/users/update-me.test.ts` | 修正 | new境界・current互換 |
| `backend/src/routes/users/delete-me.test.ts` | 修正 | current互換 |
| `backend/src/services/user.service.ts` | 修正 | 実効同一性 |
| `backend/src/services/user.service.test.ts` | 修正 | legacy・先頭72拒否 |
| `backend/src/test/password-byte-boundary-fixtures.ts` | 新規 | backend共通境界fixture |
| `backend/src/scripts/createAdmin.test.ts` | 修正 | CLI境界 |
| `frontend/src/lib/validation/password.ts` | 修正 | TextEncoder検証 |
| `frontend/src/lib/validation/password.test.ts` | 新規 | 共通境界 |
| `frontend/src/lib/test/password-byte-boundary-fixtures.ts` | 新規 | frontend共通境界fixture |
| `frontend/src/lib/test/svelte-client.ts` | 修正 | page test用client runtime |
| `frontend/src/routes/register/+page.svelte` | 修正 | hint/ARIA/focus |
| `frontend/src/routes/register/register-page.test.ts` | 新規 | UI test |
| `frontend/src/routes/reset-password/+page.svelte` | 修正 | hint/ARIA/focus |
| `frontend/src/routes/reset-password/reset-password-page.test.ts` | 新規 | UI test |
| `frontend/src/routes/(app)/settings/+page.svelte` | 修正 | error分離/A11Y |
| `frontend/src/routes/(app)/settings/settings-page.test.ts` | 新規 | UI test |
| `frontend/src/routes/login/login-page.test.ts` | 新規 | 長い照合入力 |
| `docs/02_security.md` | 修正 | 完了仕様 |
| `docs/04_api.md` | 修正 | API契約 |
| `docs/05_progress.md` | 修正 | 状態・link |
| 本計画 | 修正 | 完了記録 |

page testが既存harnessでは過度に複雑な場合、共通validationと薄いintegrationへ分け、差分を本表と実装完了へ記録する。

## 実装方針

### backend上限判定

1. password libに上限72、共通error、`bcrypt.truncates()` helper、hash guardを集約する。
2. strong schemaは同helperをrefineに使う。
3. API/CLIはZodで400/code 2、内部迂回はhash guardで拒否する。
4. timing対策の固定dummy hashは保存値でないため変更しない。

### frontend/backend整合

- backend: bcryptjs `truncates()`
- frontend: `TextEncoder().encode(value).byteLength`
- frontendへBuffer/bcryptjsを導入しない。
- 定数/messageは各packageの1か所に置き、共通fixtureとAPI文書で同期する。
- Unicode正規化は値を変えるため追加しない。

### パスワード変更の実効同一性

1. currentを既存hashへcompareする。
2. 不一致なら既存400。new compare/hashなし。
3. 一致後、newも同じhashへcompareする。
4. trueなら文字列が異なっても既存の「異なるもの」400。
5. falseだけ新hash・transactionへ進む。
6. transaction内でIDと照合時の旧hashを条件に更新し、0件なら競合として409でrollbackする。
7. 1件更新時だけtoken削除・監査へ進む。

### UI / A11Y

- 新規パスワードだけにUTF-8 72バイトと多バイト文字のhintを表示する。
- maxlengthは設定しない。
- errorは `パスワードはUTF-8で72バイト以内にしてください`。
- describedbyはhint、error時はhintとerrorを参照する。
- invalid submitは最初のinvalid fieldへtick後focusする。
- 既存role alert、disabled、text表現を維持する。
- settingsはcurrent/new/confirm/API errorを分離する。
- login/currentへ上限hint・validationを追加しない。

## DB変更方針

- schema、migration、index、relation、unique、nullable、cascade変更なし。
- query追加、N+1、raw SQLなし。
- パスワード更新は主キーIDと旧hashを条件にした単一の `updateMany` とし、追加SELECTなしで並行更新を検出する。
- 既存hash更新なし。新hash形式・cost 12は不変。
- DB変更が必要なら停止し、expand/contract、deploy、rollback、Playwrightを追加して再レビューする。

## API変更方針

```json
{
  "error": "バリデーションエラー",
  "details": [{
    "message": "パスワードはUTF-8で72バイト以内にしてください",
    "path": ["password"]
  }]
}
```

PATCH users/meのpathは `newPassword`。成功status、401/403/409/429/500、rate limit、Cookie、監査は不変。

| API | field | 契約 |
|---|---|---|
| register | password | 72受理、73以上400 |
| reset | password | 72受理、73以上400 |
| PATCH users/me | newPassword | 72受理、73以上400 |
| login | password | 新上限なし |
| PATCH/DELETE users/me | currentPassword | 新上限なし |

## CLI変更方針

- 引数・環境変数とも同じstrong schema。
- 72受理、73以上code 2、DB dependency未load。
- 値・byte数をstderrへ出さない。
- 既存警告、優先順位、終了codeを維持する。

## 公開インターフェース案

```typescript
// backend
export const BCRYPT_MAX_PASSWORD_BYTES: 72;
export const PASSWORD_TOO_LONG_MESSAGE: string;
export function isPasswordWithinBcryptLimit(password: string): boolean;
export function hashPassword(password: string): Promise<string>;

// frontend
export const MAX_PASSWORD_UTF8_BYTES: 72;
export function getUtf8ByteLength(value: string): number;
export function validatePassword(value: string): string | null;
```

## テスト方針

1. Red: backend schema/hash/API/CLI/legacy/実効同一性。
2. Green: backend共通判定・service。
3. Red: frontend validation/page DOM/A11Y。
4. Green: frontend validation/hint/error/focus。
5. Refactor: fixture・定数・message重複除去。
6. format/lint/build/全test。

fixtureは全強度条件を満たし、test内で実byte数72/73をassertする。ASCII、日本語3byte、絵文字4byte、混在を含める。backend test oracle補助はBuffer、production判定はbcryptjs。frontendはTextEncoder。

## テストケース一覧

### backend/API

| ケース | 期待 |
|---|---|
| ASCII/日本語/絵文字72/73 | 72成功、73上限error |
| hashへ73を直接入力 | bcrypt.hash未呼出でreject |
| hashへ72 | cost 12で1回 |
| 既存の空・7/8・文字種・space | 既存message/順序 |
| legacy 72超hashへ元値compare | 実bcrypt成功 |
| register 72/73 | 201 / 400・DB/hashなし |
| 未認証同一account再登録73 | user/password/token不変 |
| reset 72/73 | 200 / token・DB・hashなし |
| users new 72/73 | 200 / 400・DB/hashなし |
| login 73+ | 上限拒否せず完全な正規化値をcompare |
| change/delete current 73+ | route拒否せずcompare |
| legacy currentから別new | 成功 |
| legacy currentから先頭72 | bcrypt上同一で400 |
| current不一致 | new compareなしで400 |
| 照合後に別要求が先行してhash更新 | 409・token削除なし・成功監査なし |
| validation | error/details/path/message |
| 他status | 既存仕様維持 |

### CLI

| ケース | 期待 |
|---|---|
| env 72/73 | 成功 / code 2・DB未load |
| arg 72/73 | 成功 / code 2・警告維持・秘密非出力 |
| Unicode境界 | APIと同じ |

### frontend

| ケース | 期待 |
|---|---|
| ASCII/日本語/絵文字72/73 | null / 共通error |
| 文字数72未満・UTF-8 73+ | 拒否 |
| register/reset 73 submit | field error・focus・fetchなし |
| settings new 73 | newだけinvalid・fetchなし |
| settings current 73+ | 上限errorなしでAPIへ |
| login 73+ | 上限errorなしでrequestへ |
| ARIA | 存在IDのhint/errorを参照 |
| keyboard submit | invalid fieldへfocus |
| API 400 | 具体的message |
| 非JSON 502/504 | fallback |
| 二重submit | fetch 1回・disabled |

## リリース・移行方針

1. DB migrationなし。
2. backendを先にdeployしてAPI/CLI最終防御を有効化。
3. 新規値拒否と照合互換を確認。
4. frontendをdeploy。
5. CLIを運用環境相当で確認。
6. feature flagなし。既存成功response・hash形式不変。
7. 既存ユーザーへ強制resetなし。

frontend先行ではAPI直接利用を防げないためbackend先行を必須とする。

## ロールバック方針

- frontend、backendの順で戻しbackend防御を最後まで維持する。
- migration rollbackなし。
- 本変更後の72以内hashは旧codeでも照合可能。
- frontend障害ならbackend guardは残す。
- 既存hashを自動更新・削除しない。
- 実効同一性checkと上限guardを分けてcommitする。

## リスクと対策

| リスク | 対策 |
|---|---|
| package間判定差 | bcryptjs、TextEncoder、共通fixture、API文書 |
| 照合入力への誤適用 | 用途明記、login/current/delete test |
| Zod迂回 | hash guard |
| 別error先行 | 強度を満たすfixture |
| settings誤ARIA | error state/ID分離 |
| 既存利用者特定不能 | データ移行せず互換維持 |
| bcrypt負荷 | rate limit、取得済みhash、手動確認 |
| 秘密漏えい | 固定message、値/hash/raw error非出力 |

## 作業手順

1. 経路再確認、progressを `[-]`。
2. backend共通境界Red。
3. API/CLI/legacy/同一性Red。
4. backend Green/Refactor。
5. frontend validation Red/Green。
6. page UI/A11Y Red/Green。
7. docs更新。
8. backend format/lint/build/test。
9. frontend format/lint/build/test。
10. Docker API/CLI/UI/legacy/A11Y確認。
11. planを実態へ更新、progress `[x]`、完了記録。
12. backend/frontend/docsを分割commitしPR。

## タスクリスト

| ID | 内容 | 完了条件 | 優先度 |
|---|---|---|---|
| T1 | 経路棚卸し・進捗更新 | 全経路列挙、`[-]` | High |
| T2 | backend共通境界Red | Unicode 72/73・guard失敗 | High |
| T3 | API/CLI/互換性Red | 上限・互換test失敗 | High |
| T4 | backend判定・guard | bcrypt実挙動一致・Green | High |
| T5 | 実効同一性 | 旧hashと同一のnewを400 | High |
| T6 | backend Refactor | 重複なし・Green | High |
| T7 | frontend validation | TextEncoder境界Green | High |
| T8 | register UI/A11Y | hint・抑止・focus・ARIA | High |
| T9 | reset UI/A11Y | token維持・focus・ARIA | High |
| T10 | settings error分離 | field責務分離 | High |
| T11 | 照合入力UI互換 | 長い値を上限拒否しない | High |
| T12 | security/API docs | 実装と一致 | Medium |
| T13 | backend品質 | format/lint/build/test | High |
| T14 | frontend品質 | format/lint/build/test | High |
| T15 | Docker確認 | 境界・legacy・keyboard | High |
| T16 | 完了文書・PR | `[x]`・完了・PR | High |

- [x] T1: 経路棚卸し・進捗更新
- [x] T2: backend共通境界Red
- [x] T3: API/CLI/互換性Red
- [x] T4: backend判定・guard
- [x] T5: 実効同一性
- [x] T6: backend Refactor
- [x] T7: frontend validation
- [x] T8: register UI/A11Y
- [x] T9: reset UI/A11Y
- [x] T10: settings error分離
- [x] T11: 照合入力UI互換
- [x] T12: security/API docs
- [x] T13: backend品質
- [x] T14: frontend品質
- [ ] T15: Docker確認
- [ ] T16: 完了文書・PR

### タブ区切り

```text
タスクID	タスク内容	ファイル	優先度
T1	経路棚卸し・進捗更新	plan.md・docs/05_progress.md・関連全体	高
T2	backend共通境界Red	backend/src/lib/password.test.ts・validation/auth.test.ts	高
T3	API・CLI・互換性Red	backend関連test	高
T4	backend判定・guard	backend/src/lib/password.ts・validation/auth.ts	高
T5	実効同一性	backend/src/services/user.service.ts	高
T6	backend Refactor	backend関連	高
T7	frontend validation	frontend/src/lib/validation/password.ts・test	高
T8	register UI/A11Y	frontend/src/routes/register	高
T9	reset UI/A11Y	frontend/src/routes/reset-password	高
T10	settings error分離	frontend/src/routes/(app)/settings	高
T11	照合入力UI互換	frontend/src/routes/login・settings	高
T12	security/API docs	docs/02_security.md・docs/04_api.md	中
T13	backend品質	backend	高
T14	frontend品質	frontend	高
T15	Docker確認	API・CLI・UI	高
T16	完了文書・PR	plan.md・docs/05_progress.md	高
```

## 手動確認項目

- [ ] registerの72受理・73拒否。
- [ ] resetの72受理・73拒否・拒否時token未消費。
- [ ] settings newPasswordの境界。
- [ ] legacy 72超userがlogin可能。
- [ ] legacy currentで変更・退会確認可能。
- [ ] legacy値の先頭72への変更を拒否。
- [ ] CLI両方式の境界・秘密非出力。
- [ ] 日本語・絵文字をUTF-8 byteで判定。
- [ ] hint/error読上げ・invalid focus。
- [ ] keyboardだけで操作可能。
- [ ] loading中二重送信なし。
- [ ] errorが色だけに依存しない。
- [ ] password/hash/token/bodyが出力されない。

## 実装完了時の更新ルール

- 対象ファイルと実変更を一致させる。
- taskを `[x]` にする。
- 設計変更、TDD、品質check、Docker確認を記録する。
- progressを `[x]` にし次を追記する。

```markdown
## 実装完了
- 完了日: YYYY-MM-DD
- 実装ブランチ: feature/bcrypt-password-byte-limit
- PR: #N

### 計画からの変更点
### TDD記録
- Red:
- Green:
- Refactor:

### 実際の変更ファイル
| ファイル | 変更種別 | 内容 |
|---|---|---|

### 検証結果
- Backend format/lint/build/test:
- Frontend format/lint/build/test:
- Docker API/CLI:
- UI/A11Y:
```
