# R7 auth 503安全分類 TDD実装計画

> 設計者ロール: シニアバックエンド / セキュリティエンジニア

## 概要

R7 auth実環境証拠run `30010266297`は、正しいloginの1〜4回目を通過後、5回目にstatus 503を受けて安全停止した。現在のrunnerは期待status 200以外を一律`EXPECTED_STATUS`として分類するため、既存の安全なJSON 503契約とedge/non-JSON 503を区別できない。

本タスクでは、response body・header値・credential・識別子をlogやerror metadataへ保存せず、固定enumだけで503応答契約を分類できるようにする。実装・review・mergeまでを別タスクとし、staging再実行、Environment変更、fixture作成、DB操作は含めない。

## 背景・現状証拠

- 初回run: [30004874751](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/30004874751)。境界runnerで失敗したが、当時はrequest番号・statusの安全な分類がなかった。
- 第二run: [30010266297](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/30010266297)。
  - auth許可request 1〜4回目はvalidator通過
  - 5回目は`AUTH_ALLOWED_REQUEST` / `RESPONSE_CONTRACT_FAILED` / status 503 / `EXPECTED_STATUS`
  - 11回目の429へ未到達
  - main cleanup 2件、recovery cleanup 0件、fixture flag `false`復旧
- 両run間にstaging Workerの再配備はなく、同じ配備状態で発生した。
- Workers Logs / Tracesは無効であり、過去runの503発生源をserver-side eventから遡及できない。
- 2026-07-23の[Cloudflare Status](https://www.cloudflarestatus.com/)と[Supabase Status](https://status.supabase.com/)では、実行時刻に一致するWorkers / Durable Objectsまたは東京リージョンの公表障害を確認できなかった。ただし、公表障害がないことは個別Worker障害がない証明にはしない。

## 目的

1. 許可requestで503を受けた場合に、安全な固定分類をCLIへ残す。
2. 既存のHono/Worker安全503契約と、edgeまたは契約不一致503を区別する。
3. 実際のresponse body・header値・URL・credential・識別子をerror object、console、GitHub Actions summary、artifactへ残さない。
4. 既存の429成功契約、request失敗分類、body cancelのbest-effort動作を維持する。
5. 次回実環境runの前に、503がどの応答契約だったかを判断できるrepository側の観測能力を整える。

## 非目的

- 503の根本原因をこの実装だけで`AUTH_IP`、`AUTH_EMAIL`、Durable Object、adapter、Cloudflare edgeのいずれかへ断定しない。
- APIへ新しいheader、error code、debug情報を追加しない。
- `worker-handler.ts`、rate-limit middleware、Durable Object、Prisma、DB schemaを変更しない。
- Workers Logs / Traces / samplingを有効化しない。
- workflow dispatch、staging HTTP request、fixture作成、Environment Variable変更を行わない。
- R7-04/R7-05を完了扱いにしない。
- R7-02、R7-06以降、production、WAF、deploymentへ範囲を広げない。

## 前提条件・依存関係

### 既存の公開インターフェース

**`backend/src/jobs/stagingRateLimitEvidence.ts`**

- `runStagingRateLimitEvidence(options): Promise<StagingRateLimitEvidenceSummary>` — 1実行1caseの境界requestを行う。
- `StagingRateLimitEvidenceExecutionError` — request段階・番号・status・固定契約名だけを保持する。
- `StagingRateLimitEvidenceFailedContract` — response契約違反を固定enumで表す。
- `runClassifiedEvidenceRequest(...)` — request例外とvalidator失敗を安全なexecution errorへ変換する。
- `readExpectedJson(response, expectedStatus)` — status、Content-Type、JSON bodyを順に検証する。
- `cancelResponseBodyBestEffort(response)` — 未消費bodyを解放し、cancel失敗で本来の分類を上書きしない。
- `createRateLimitSummary(...)` — 429、`Retry-After`、日本語単一error、CORS、security headersを検証する。

**`backend/src/jobs/stagingRateLimitEvidence.cli.ts`**

- `main(): Promise<void>` — 成功summaryまたは安全な失敗metadataだけをconsoleへ出力する。

**`backend/src/lib/http-error-messages.ts`**

- `SERVICE_UNAVAILABLE_MESSAGE: string` — 既存の日本語503 message。
- `SERVICE_UNAVAILABLE_RETRY_AFTER_SEC: number` — 既存の503 `Retry-After`固定値。

**`docs/04_api.md`**

- sensitive rate-limit store障害は503、日本語単一error body、`Retry-After: 60`、`application/json`を返す。
- Cloudflare edge responseはHono JSON/CORS/`Retry-After`契約の保証対象外である。

### 重要な制約

- response bodyは分類処理中にmemory上で検証してもよいが、値を返却・serialize・log・保存してはいけない。
- headerは契約の真偽判定だけに使い、値をerror metadataやCLI出力へ含めない。
- `safe 503 contract`は応答契約の分類であり、発生源の断定ではない。
- status 503だけでHono/Worker由来と判断しない。
- body parse失敗、header getter例外、body cancel拒否でもraw errorを保持しない。
- 既存の`failedContract`と新しい分類の責務を混同しない。
- 新しい分類は文字列unionで閉じ、自由入力文字列を許可しない。
- 既存429/security header検証と同じ判定を複製しない。共通化する場合は既存429の判定順序と結果を回帰testで固定する。
- APIレスポンス仕様は変更しないため、`docs/04_api.md`の仕様変更は原則不要とする。

## 対象ファイル一覧

| ファイル                                                | 変更種別 | 内容                                                                     |
| ------------------------------------------------------- | -------- | ------------------------------------------------------------------------ |
| `backend/src/jobs/stagingRateLimitEvidence.test.ts`     | 修正     | 5回目503、safe JSON 503、edge/non-JSON 503、非露出、cancel失敗のRed test |
| `backend/src/jobs/stagingRateLimitEvidence.ts`          | 修正     | 固定response classと安全な503契約分類helper                              |
| `backend/src/jobs/stagingRateLimitEvidence.cli.test.ts` | 修正     | CLIが固定classだけを出しraw値を出さないRed test                          |
| `backend/src/jobs/stagingRateLimitEvidence.cli.ts`      | 修正     | 固定response classの出力                                                 |
| `docs/plans/r7-auth-503-safe-classification/plan.md`    | 新規     | 本計画と実装記録                                                         |
| `docs/plans/r7-rate-limit-environment-gates/plan.md`    | 修正     | 本計画への導線を追加し、実装後に結果を同期                               |
| `docs/05_progress.md`                                   | 修正     | 計画・実装・未完了状態を同期                                             |

### 明示的に変更しないファイル

- `.github/workflows/staging-rate-limit-evidence.yml`
- `backend/src/worker-handler.ts`
- `backend/src/middleware/rateLimit/**`
- `backend/src/cloudflare/**`
- `backend/prisma/**`
- `backend/wrangler.jsonc`
- frontend全体
- production / Cloudflare / GitHub Environment設定

上記へ変更が必要になった場合は、本タスクを停止して計画変更の承認を得る。

## API仕様

APIのstatus、body、header、endpointは変更しない。runnerが既存503契約を読み取り、証拠用の固定分類へ変換するだけとする。

### 既存503契約

| 項目             | safe contract                                                   |
| ---------------- | --------------------------------------------------------------- |
| status           | 503                                                             |
| Content-Type     | `application/json`                                              |
| Retry-After      | `SERVICE_UNAVAILABLE_RETRY_AFTER_SEC`と一致する正のsafe integer |
| body             | 日本語の単一`error` fieldが`SERVICE_UNAVAILABLE_MESSAGE`と一致  |
| CORS             | 固定staging frontend origin、credentials `true`                 |
| security headers | 既存production security header契約一式                          |
| X-Powered-By     | 非露出                                                          |

## 設計上の決定事項

### 1. 「発生源」ではなく「応答契約」を分類する

- 選択: `observedResponseClass`は固定enumで応答契約だけを表す。
- 根拠: Hono rate-limit 503とWorker adapter 503は同じ安全契約になり得るため、client responseだけで内部原因を断定できない。
- 危険性: `APP_503`や`DO_ERROR`のような名前は、証拠のない原因断定になるため禁止する。

### 2. 固定分類

```typescript
export type StagingRateLimitEvidenceObservedResponseClass =
  | "SAFE_JSON_503_CONTRACT"
  | "EDGE_OR_UNCLASSIFIED_503"
  | "OTHER_UNEXPECTED_STATUS";
```

| 条件                                    | 固定分類                   | 意味                                                 |
| --------------------------------------- | -------------------------- | ---------------------------------------------------- |
| status 503かつ既存503契約をすべて満たす | `SAFE_JSON_503_CONTRACT`   | application側と整合する安全503契約。内部原因は未確定 |
| status 503だが契約のいずれかが不一致    | `EDGE_OR_UNCLASSIFIED_503` | edge、proxy、または不正なapplication 503の可能性     |
| 503以外の想定外status                   | `OTHER_UNEXPECTED_STATUS`  | status以外の原因推測をしない                         |

分類名は実装前reviewで再確認し、意味を広げない範囲の名称修正は許容する。

### 3. error metadataへ追加する値

```typescript
readonly observedResponseClass: StagingRateLimitEvidenceObservedResponseClass | null;
```

- HTTP responseを受け取って固定分類できた場合だけenumを設定する。
- network/timeout等の`REQUEST_FAILED`は`null`を維持する。
- raw body、header map、URL、例外message、causeを追加しない。

### 4. classifierの挿入位置とbody lifecycle

- 現行`readExpectedJson`と`createRateLimitSummary`はstatus不一致時にbodyを先にcancelするため、outer catchで503分類を始めてはいけない。
- status不一致を検出した同じ分岐で、cancel前にprivate classifierを呼ぶ。
- classifierの固定結果をprivateな`StagingRateLimitEvidenceContractError`へ持たせ、`runClassifiedEvidenceRequest`がpublicな`StagingRateLimitEvidenceExecutionError`へコピーする。
- auth許可requestの既存`failedContract: "EXPECTED_STATUS"`と、auth制限requestの`failedContract: "RATE_LIMIT_STATUS"`は変更しない。
- classifierは対象responseのbody lifecycleを一度だけ所有する。
  - safe JSON 503候補はbodyを一度parseし、単一error契約との一致をbooleanで判断する。
  - 非JSON 503または503以外では、未消費bodyをbest-effortでcancelする。
  - callerはclassifier完了後に同じbodyを再parse・再cancelしない。
- parseしたobjectをerror classやreturn値へ格納しない。
- parse/cancel/header getter失敗は固定分類または既存失敗分類を上書きせず、raw例外を捨てる。
- expected statusと一致するresponseではclassifierを呼ばず、既存validatorへそのまま渡す。

### 5. security header判定の重複を作らない

- 429と503で同じCORS/security header式を複製しない。
- 共通helperへ切り出す場合、最初に既存429 testを追加・確認してからrefactorする。
- helperはheader値を返さず、固定契約名またはbooleanだけを返す。

### 6. workflowは変更しない

- CLIの既存JSON風structured console出力へ固定fieldを1つ追加するだけで、workflow input、Environment、cleanup、concurrencyは変更しない。
- workflow変更が必要と判明した場合は実装を停止する。

## 公開インターフェース案

```typescript
export type StagingRateLimitEvidenceObservedResponseClass =
  | "SAFE_JSON_503_CONTRACT"
  | "EDGE_OR_UNCLASSIFIED_503"
  | "OTHER_UNEXPECTED_STATUS";

export class StagingRateLimitEvidenceExecutionError extends Error {
  readonly observedResponseClass: StagingRateLimitEvidenceObservedResponseClass | null;
}
```

分類helperは原則privateとし、testのためだけにexportしない。公開関数`runStagingRateLimitEvidence`を通して検証する。

## TDD実装手順

### Red 1: 実runを再現する

`stagingRateLimitEvidence.test.ts`へ、1〜4回目が200、5回目が503となるcaseを追加する。

期待する失敗:

- 現実装には`observedResponseClass`が存在しないためassertionが失敗する。
- failure stage、request number 5、observed status 503、`EXPECTED_STATUS`は既存どおり維持する。
- test用bodyの秘密文字列がserialized errorへ含まれないことを同時に固定する。

### Red 2: 503契約の境界を固定する

table-driven testで最低限次を追加する。

- 完全なsafe JSON 503契約
- Content-Typeが非JSON
- JSON parse失敗
- error field以外を含むbody
- 日本語error message不一致
- `Retry-After`欠損・不正・期待値不一致
- CORS不一致
- production security header不一致
- `X-Powered-By`露出
- header getter例外
- body cancel拒否
- 503以外の500/502/504

### Green 1: 最小実装

- 固定union型を追加する。
- 503応答を既存契約と比較するprivate helperを追加する。
- `readExpectedJson`と`createRateLimitSummary`のstatus不一致分岐で、body cancel前にhelperを呼ぶ。
- private contract errorへ固定classを追加し、outer execution errorへコピーする。
- `StagingRateLimitEvidenceExecutionError`へnullable fieldを追加する。
- 既存request failureでは`null`を明示する。

### Red 3 / Green 2: CLI非露出契約

`stagingRateLimitEvidence.cli.test.ts`で次を先に失敗させ、最小実装で通す。

- known failureは固定`observedResponseClass`だけを出力する。
- body文字列、header値、URL、password、token、Cookie、Authorization、email、User ID、raw IPを出さない。
- unknown errorは従来どおり固定event/messageだけを出す。

### Refactor

- 429/503で重複するCORS/security header判定を1箇所へ統合する。
- `cancelResponseBodyBestEffort`の呼出しが二重にならないよう整理する。
- 分類helperは1責務とし、body objectやheader値を返さない。
- Prettierを適用し、対象testと関連testを再実行する。

## テストケース一覧

| ケース                                  | 期待結果                                            |
| --------------------------------------- | --------------------------------------------------- |
| auth 1〜4回目200、5回目が完全な503契約  | request 5、status 503、`SAFE_JSON_503_CONTRACT`     |
| auth 5回目がHTML 503                    | `EDGE_OR_UNCLASSIFIED_503`                          |
| auth 5回目がJSONだがbody契約不一致      | `EDGE_OR_UNCLASSIFIED_503`                          |
| auth 5回目がJSONだがRetry-After不一致   | `EDGE_OR_UNCLASSIFIED_503`                          |
| auth 5回目がJSONだがCORS/security不一致 | `EDGE_OR_UNCLASSIFIED_503`                          |
| auth 5回目が500                         | `OTHER_UNEXPECTED_STATUS`                           |
| auth requestがtimeout/network error     | class `null`、raw例外なし                           |
| header getterがthrow                    | 固定分類で停止、raw例外なし                         |
| body parseが失敗                        | 固定分類で停止、bodyなし                            |
| body cancelがreject                     | 本来の分類を維持、cancel例外なし                    |
| auth 11回目の正常429                    | 既存summary・`AUTH_IP`契約を維持                    |
| auth 11回目が503                        | limited段階、`RATE_LIMIT_STATUS`、固定503分類を記録 |
| questions/game-submit既存case           | 既存契約を維持                                      |
| CLI known error                         | 固定enumだけを出力                                  |
| CLI unknown error                       | 固定event/messageだけを出力                         |

## タスクリスト（3回レビュー済み）

### v1: 初版

- 503 response class型を追加
- runnerで503契約を分類
- CLIへ固定classを出力
- testと文書を更新

### v2: セキュリティ・エラーケースreview

- raw body/header/例外の非露出testを追加
- parse/cancel/header getter失敗を追加
- statusだけから発生源を断定しない命名へ修正
- 5回目503の実run再現caseを追加

### v3: 既存実装・回帰review

- 既存429契約の回帰を追加
- CORS/security header判定の重複禁止を追加
- questions/game-submitへの影響確認を追加
- workflow、API、DB、Cloudflare設定を対象外へ固定

### v4: 確定

| タスクID | 内容                                                       | ファイル                           | 優先度 |
| -------- | ---------------------------------------------------------- | ---------------------------------- | ------ |
| R7D-01   | Red: auth 5回目503と固定class欠如を再現                    | `stagingRateLimitEvidence.test.ts` | 高     |
| R7D-02   | Red: safe/non-JSON/不正503、非露出、parse/cancel失敗を追加 | `stagingRateLimitEvidence.test.ts` | 高     |
| R7D-03   | Green: 固定class型・安全な503分類・error metadataを実装    | `stagingRateLimitEvidence.ts`      | 高     |
| R7D-04   | Red→Green: CLI固定class出力と非露出契約                    | CLI本体・test                      | 高     |
| R7D-05   | Refactor: CORS/security判定共通化とbody lifecycle整理      | runner本体・test                   | 高     |
| R7D-06   | 対象・関連testを実行                                       | backend jobs tests                 | 高     |
| R7D-07   | 最終品質gateを1回実行                                      | backend全体                        | 高     |
| R7D-08   | 正本計画・進捗・本計画を実態へ同期                         | docs                               | 中     |
| R7D-09   | 詳細な日本語commit・PRを作成しreview待ち                   | Git/GitHub                         | 中     |

- [x] R7D-01: Redでauth 5回目503を再現する
- [x] R7D-02: 503境界・非露出・body lifecycleのRed testを追加する
- [x] R7D-03: 固定response classをGreen実装する
- [x] R7D-04: CLIのRed→Greenを完了する
- [x] R7D-05: 重複を除去してRefactorする
- [x] R7D-06: 対象・関連testを通す
- [x] R7D-07: 最終品質gateを通す
- [x] R7D-08: 文書を実態へ同期する
- [x] R7D-09: review用PR #144を作成する

### タブ区切り

```tsv
タスクID	タスク内容	ファイル	優先度
R7D-01	Red: auth 5回目503と固定class欠如を再現	backend/src/jobs/stagingRateLimitEvidence.test.ts	高
R7D-02	Red: 503境界・非露出・parse/cancel失敗を追加	backend/src/jobs/stagingRateLimitEvidence.test.ts	高
R7D-03	Green: 固定class型・安全な503分類・error metadata	backend/src/jobs/stagingRateLimitEvidence.ts	高
R7D-04	Red→Green: CLI固定class出力と非露出契約	backend/src/jobs/stagingRateLimitEvidence.cli.ts / .test.ts	高
R7D-05	Refactor: CORS/security判定共通化とbody lifecycle整理	backend/src/jobs/stagingRateLimitEvidence.ts / .test.ts	高
R7D-06	対象・関連test	backend/src/jobs/*.test.ts	高
R7D-07	最終品質gate	backend	高
R7D-08	正本計画・進捗・本計画を同期	docs	中
R7D-09	詳細commit・PR作成	Git/GitHub	中
```

## Git・PR方針

- 実装branch: `feature/r7-auth-503-safe-classification`
- base branch: `develop`
- 実装開始時に最新`develop` SHAを40桁で記録する。
- 推奨commit分割:
  1. `test: R7 auth 503安全分類のRed契約を追加`
  2. `fix: R7 auth 503応答を固定契約で安全に分類`
  3. `docs: R7 auth 503診断実装結果を同期`
- PR本文へRed→Green→Refactorの失敗理由・成功test件数、非露出確認、変更しなかった実環境範囲、R7-04/R7-05未完了、第三run未承認を記載する。
- PRをmergeしてもworkflowを自動実行せず、新しい実環境承認待ちで停止する。

## テスト実行コマンド

### Red / Green

```bash
cd backend
npm run test -- --run src/jobs/stagingRateLimitEvidence.test.ts
npm run test -- --run src/jobs/stagingRateLimitEvidence.cli.test.ts
```

### Refactor

```bash
cd backend
npm run test -- --run \
  src/jobs/stagingRateLimitEvidence.test.ts \
  src/jobs/stagingRateLimitEvidence.cli.test.ts \
  src/jobs/stagingRateLimitEvidenceWorkflow.test.ts
npm run format
```

### 最終品質gate

```bash
cd backend
npm run test -- --run
npm run test:workers
npm run build
npm run lint
npm run format:check
```

- DB構造変更はないためmigration・DB integration test・Playwrightは不要。
- 実環境requestは品質gateに含めない。

## 合格条件

- [x] auth 5回目503再現testが固定classを検証する
- [x] 完全な既存503契約だけが`SAFE_JSON_503_CONTRACT`になる
- [x] 非JSONまたは契約不一致503は`EDGE_OR_UNCLASSIFIED_503`になる
- [x] その他の想定外statusは`OTHER_UNEXPECTED_STATUS`になる
- [x] request失敗はclass `null`を維持する
- [x] response body・header値・URL・credential・識別子・raw例外をerror/consoleへ出さない
- [x] body parse/cancel/header getter失敗でも固定分類を維持する
- [x] 既存429、CORS、security headers、`X-Powered-By`非露出判定が回帰しない
- [x] questions/game-submitの既存testが回帰しない
- [x] workflow、API、DB schema、Cloudflare設定を変更しない
- [x] backend最終品質gateがすべて成功する
- [x] R7-04/R7-05を未完了のまま維持する

## 停止条件

- response classを判定するためにraw body/header値のlogまたは保存が必要になる
- APIへdebug header/error codeを追加する必要が出る
- Worker、rate-limit middleware、Durable Object、DB schema、workflow変更が必要になる
- Workers Logs/Tracesの有効化が必要になる
- fixed enumだけではなく自由入力message/causeを出力する設計になる
- 503をDO/adapter/edgeのいずれかへ根拠なく断定する実装になる
- 既存429契約またはcleanup安全性を弱める必要が出る
- testが実環境、staging DB、production resourceを要求する

停止時はその場で範囲を拡大せず、計画変更またはR7-11/R7-15の別承認を求める。

## 実装後の文書更新

- 本計画の完了taskへ`[x]`を付け、実装完了sectionへ実測test件数・commit・PR・実変更ファイルを記録する。
- `docs/plans/r7-rate-limit-environment-gates/plan.md`へ、診断能力の追加と実環境第三run未実施を記録する。
- `docs/05_progress.md`を実態へ同期する。
- API契約を変更していない場合、`docs/04_api.md`は変更しない。
- portfolio release計画はR7状態が実際に変わる場合だけ更新する。

## 実装完了

- 実装日: 2026-07-23
- 実装branch: `feature/r7-auth-503-safe-classification`
- base `develop` SHA: `647ea6b17c6994e2e953b6c26224173d658eac5c`
- Red test commit: `0247510`（`test: R7 auth 503安全分類のRed契約を追加`）
- Green/Refactor commit: `a9cb3db`（`fix: R7 auth 503応答を固定契約で安全に分類`）
- PR: [#144](https://github.com/RitukoIsibasi0222/gensoko/pull/144)（2026-07-24に`develop`へmerge、merge commit `628ce06f90d150ae3dd3eb7e8e6c52ee42deace8`）

### TDD実測

- Red 1: runner 49 tests中、既存31 testsは成功し、固定response class未実装とbody二重cancelを理由に18 testsが失敗した
- Green 1: safe JSON 503、非JSON/契約不一致503、500/502/504、auth 5回目/11回目、header getter・cancel拒否、request失敗nullを実装し、runner 49 testsが成功した
- Red 2: CLI 4 tests中、既存3 testsは成功し、`observedResponseClass`未出力だけを理由に1 testが失敗した
- Green 2: known errorへ固定enumだけを追加し、runner/CLI 2 files / 53 testsが成功した
- Refactor: 429/503のCORS/security判定を共通化し、contract errorが処理済みのbodyをouter layerで再cancelしない構造へ整理した。初回時点でrunner/CLI/workflow 3 files / 60 testsが成功した
- 最終品質gate: PR #144追加review対応後、backend 104 files / 1109 tests成功、外部DB用10 testsは既定どおりskip。Workers runtime 2 files / 15 tests、Node/Workers TypeScript build、ESLint、Prettier checkが成功した

### PR #144 review対応

- 対象review: [pullrequestreview-4765099785](https://github.com/RitukoIsibasi0222/gensoko/pull/144#pullrequestreview-4765099785)
- 文書2件: 「PR未作成」「ユーザー確認待ち」の不整合は、PR作成直後のcommit `37671b5`でPR #144 review待ちへ更新済み
- code 1件 Red: `Retry-After`またはheader契約不一致503でbodyをparseしない契約を2 tests追加し、runner 51 tests中49 tests成功・2 tests失敗を確認した
- code 1件 Green: `Retry-After`、header、bodyの順に短絡評価し、先行契約不一致ではbodyをbest-effort cancelして`EDGE_OR_UNCLASSIFIED_503`を維持する。runner 51 tests、関連3 files / 62 testsが成功した
- review対応commit: `f3b156d`（`fix: 503契約不一致時のbody解析を短絡`）
- security: 完全なsafe 503候補だけがbody JSON parseへ進むため、response bodyを扱う範囲と不要な解析コストを縮小した。raw値の保持・出力は追加していない

### PR #144追加review対応

- 対象review: [pullrequestreview-4768836627](https://github.com/RitukoIsibasi0222/gensoko/pull/144#pullrequestreview-4768836627)
- Red: auth許可200、auth 5回目503、auth 11回目429のJSON parse失敗時にも未消費bodyを解放する3 testsを追加し、runner 54 tests中51 tests成功・3 tests失敗を確認した
- Green: parse失敗を所有する`readExpectedJson`、`classifyUnexpectedResponse`、`createRateLimitSummary`でbodyをbest-effort cancelし、既存の固定契約違反・503分類とraw例外非露出を維持した。runner 54 tests、関連3 files / 65 testsが成功した
- 追加review対応commit: `74cc588`（`fix: JSON parse失敗時にresponse bodyを解放`）
- security: cancel自体が失敗しても元の固定分類を上書きせず、parse例外、response body、credential、PIIをerror metadataやCLIへ保持・出力しない

### 設計判断と安全性

- `SAFE_JSON_503_CONTRACT`は既存Hono 503公開契約との一致だけを示し、Durable Object、adapter、edge等の内部原因を断定しない
- response bodyは分類中だけmemory上で検証し、error metadata・CLI・文書へ保持しない。headerも固定契約との一致だけを判定し、値を返さない
- workflow、API route、Worker、rate-limit middleware、Durable Object、DB schema、Cloudflare設定、frontend、production resourceは変更していない
- staging HTTP request、fixture、Environment Variable、DB、workflow dispatchは行っていない。第三runは未実施
- 過去のrun 30010266297はbody/headerを記録していないため、新classを遡及適用できない。R7-04/R7-05とR7全体は未完了を維持する

### 実際の変更ファイル

| ファイル | 変更種別 | 内容 |
| --- | --- | --- |
| `backend/src/jobs/stagingRateLimitEvidence.test.ts` | 修正 | 503分類境界、非露出、body lifecycle、既存429回帰のcontract test |
| `backend/src/jobs/stagingRateLimitEvidence.ts` | 修正 | 固定response class、503契約分類、error metadata、header共通判定 |
| `backend/src/jobs/stagingRateLimitEvidence.cli.test.ts` | 修正 | 固定class出力とcredential・PII・raw値非露出test |
| `backend/src/jobs/stagingRateLimitEvidence.cli.ts` | 修正 | known errorへ固定`observedResponseClass`を追加 |
| `docs/plans/r7-auth-503-safe-classification/plan.md` | 修正 | TDD・品質gate・実変更・未完了境界を記録 |
| `docs/plans/r7-rate-limit-environment-gates/plan.md` | 修正 | 診断能力追加と第三run未実施を正本へ同期 |
| `docs/05_progress.md` | 修正 | R7-04/R7-05未完了のまま実装進捗を同期 |

### 計画からの変更点

- portfolio release計画はR7の実環境状態が変わっていないため更新しない
- `docs/04_api.md`は公開API契約を変更していないため更新しない
- DB変更がないためmigration・DB integration test・Playwrightは実行しない

## 実装後も必要な別承認

本タスクのmergeは実環境再実行の承認ではない。第三runを検討する場合は、少なくとも次を新しく固定する。

- 最新`develop` 40桁SHA
- 新しいG5/G6承認
- 実行時間帯
- 停止時通知先
- `approved_by`
- `change_record`
- fixture flagの一時`true`化と必須`false`復旧
- 想定外503時に再実行しない停止条件

Workers Logs/metricsを使って内部原因まで切り分ける場合は、R7-04/R7-05の範囲を越えるため、G4およびR7-11/R7-15として別途承認する。

## merge後の第三auth run

- PR #144 merge後、新しいG5/G6承認のもと、[run 30056294929](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/30056294929)を`develop` SHA `628ce06f90d150ae3dd3eb7e8e6c52ee42deace8`で1回だけ実施した
- auth許可request 1〜5回目は通過し、6回目のstatus 503を`EDGE_OR_UNCLASSIFIED_503`として安全停止した
- fixture prepare 2件、main cleanup 2件、recovery cleanup追加削除0件で、fixture flagは`false`へ復旧確認した
- 新しいG5/G6承認とfixture lifecycleが成立したためR7-04は完了する。11回目429へ未到達のためR7-05とR7全体は未完了を維持する
- 本実装の固定classは503公開契約不一致までを示し、どの契約が不一致だったか、内部原因が何かは示さない
- 第三run時点でbody/headerを保持していないため、後続の詳細分類をこのrunへ遡及適用しない
- 後続task: [`r7-auth-503-contract-detail`](../r7-auth-503-contract-detail/plan.md)で、raw値を保持せず不一致箇所だけを固定値で追加分類する。実環境再実行、delay追加、Environment/DB/Cloudflare変更は含めない
