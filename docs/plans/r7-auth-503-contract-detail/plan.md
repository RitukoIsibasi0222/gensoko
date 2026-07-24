# R7 auth 503契約不一致詳細分類 TDD実装計画

> 設計者ロール: シニアバックエンドエンジニア / セキュリティエンジニア

## 概要

第三auth実環境run `30056294929`は、許可request 1〜5回目を通過後、6回目にstatus 503を受け、`EDGE_OR_UNCLASSIFIED_503`として安全停止した。現在の分類では完全なHono 503契約に一致しないことまでは分かるが、Content-Type、`Retry-After`、公開header、JSON parse、単一error bodyのどこが不一致だったかを区別できない。

本タスクでは、raw body・header値・URL・credential・PII・raw例外を保持せず、503契約の不一致箇所だけを固定unionで追加分類する。実環境再実行、delay追加、workflow・Cloudflare・DB変更は含めない。

## 前提条件・依存関係

### 既存の実装

**`backend/src/jobs/stagingRateLimitEvidence.ts`**

- `StagingRateLimitEvidenceObservedResponseClass` — 503公開契約一致、未分類503、その他statusを固定分類する。
- `StagingRateLimitEvidenceExecutionError` — 段階・request番号・status・固定契約名だけを保持する。
- `classifyUnexpectedResponse()` — 503 responseを既存公開契約と比較する。
- `findFailedResponseHeaderContract()` — CORS/security headerの不一致を固定契約名で返す。
- `cancelResponseBodyBestEffort()` — body解放失敗で本来の分類を上書きしない。

**`docs/04_api.md`**

- sensitive rate-limit store障害503はJSON、`Retry-After: 60`、日本語単一errorを返す。
- Cloudflare edge responseはHonoのJSON・CORS・`Retry-After`契約保証外である。

### 重要な制約

- `EDGE_OR_UNCLASSIFIED_503`は維持し、発生源をedge、Durable Object、adapter等へ断定しない。
- 新fieldは503契約不一致時だけ固定値を持ち、安全な503、その他status、request失敗では`null`とする。
- header名は記録してよいが、header値は記録しない。
- response bodyは分類中だけmemory上で検証し、error、CLI、文書へ保持しない。
- JSON parse、header access、body cancel失敗時もraw例外を保持しない。
- 既存の429、503 response class、request番号、body lifecycleを変更しない。
- workflow、API、Worker、rate-limit middleware、Durable Object、DB、frontendを変更しない。
- 実環境request、workflow dispatch、Environment Variable変更を行わない。

## 対象ファイル一覧

| ファイル | 変更種別 | 内容 |
| --- | --- | --- |
| `backend/src/jobs/stagingRateLimitEvidence.test.ts` | 修正 | 503不一致箇所と非露出のRed test |
| `backend/src/jobs/stagingRateLimitEvidence.ts` | 修正 | 固定503契約不一致型とclassifier結果 |
| `backend/src/jobs/stagingRateLimitEvidence.cli.test.ts` | 修正 | CLI固定fieldと非露出test |
| `backend/src/jobs/stagingRateLimitEvidence.cli.ts` | 修正 | 既知errorへ固定fieldを追加 |
| `docs/plans/r7-auth-503-contract-detail/plan.md` | 新規 | 本計画とTDD記録 |
| `docs/plans/r7-rate-limit-environment-gates/plan.md` | 修正 | 第三runと診断タスクを証拠へ同期 |
| `docs/plans/r7-auth-503-safe-classification/plan.md` | 修正 | 後続詳細分類への導線 |
| `docs/05_progress.md` | 修正 | R7未完了状態と本タスク進捗 |

## API仕様

公開APIのstatus、body、header、endpointは変更しない。runner内部の証拠metadataだけを追加する。

## 設計上の決定事項

1. **既存response classと不一致詳細を分離する**
   - 選択: `observedResponseClass`を維持し、`observed503FailedContract`をnullableで追加する。
   - 根拠: response全体の分類と、契約内の不一致箇所は責務が異なる。

2. **固定詳細分類だけを許可する**
   - Content-Type、`Retry-After`、JSON parse、503 error body、response accessは専用固定名にする。
   - header契約名は既存429/503判定と同じsingle sourceを使う。

3. **classifierは固定結果objectを返す**
   - `observedResponseClass`と`observed503FailedContract`を返す。
   - safe JSON 503と503以外では詳細を`null`にする。

4. **body lifecycleを一度だけ所有する**
   - Content-Type、`Retry-After`、header不一致ではbodyをparseせずbest-effort cancelする。
   - JSON parse失敗ではparse ownerがbest-effort cancelする。
   - body契約不一致ではparse済みbodyを保持・再serializeしない。

## 公開インターフェース案

```typescript
export type StagingRateLimitEvidenceObserved503FailedContract =
  | "SERVICE_UNAVAILABLE_CONTENT_TYPE"
  | "SERVICE_UNAVAILABLE_RETRY_AFTER"
  | "SERVICE_UNAVAILABLE_JSON_BODY"
  | "SERVICE_UNAVAILABLE_ERROR_BODY"
  | "SERVICE_UNAVAILABLE_RESPONSE_ACCESS"
  | StagingRateLimitEvidenceResponseHeaderContract;

export class StagingRateLimitEvidenceExecutionError extends Error {
  readonly observed503FailedContract:
    | StagingRateLimitEvidenceObserved503FailedContract
    | null;
}
```

## タスクリスト（3回レビュー）

### v1

- response header契約型をsingle sourceへ整理する。
- 503不一致詳細型とerror metadataを追加する。
- CLIへ固定fieldを追加し、testと文書を更新する。

### v2: security・error review

- raw body、header値、URL、credential、PII、raw例外の非露出を追加する。
- header access、JSON parse、body cancel失敗を追加する。
- response classから原因を推測しない設計を確認する。

### v3: regression・consistency review

- 既存safe 503、その他status、network failureは詳細`null`とする。
- request段階・番号・outer failed contractを維持する。
- 429とquestions/game-submitの既存testを関連testで確認する。
- workflow、API、DB、Cloudflare設定が非変更であることを確認する。

### v4: 確定

| タスクID | 内容 | ファイル | 優先度 |
| --- | --- | --- | --- |
| R7C-01 | Red: 503不一致詳細とnull境界を追加 | runner test | 高 |
| R7C-02 | Red: CLI固定fieldと非露出を追加 | CLI test | 高 |
| R7C-03 | Green: 固定型・classifier結果・error metadata | runner | 高 |
| R7C-04 | Green: CLI固定field | CLI | 高 |
| R7C-05 | Refactor: header契約型とbody lifecycle | runner/test | 高 |
| R7C-06 | 対象・関連test | backend jobs tests | 高 |
| R7C-07 | backend最終品質gate | backend | 高 |
| R7C-08 | 第三run・進捗・計画を同期 | docs | 中 |
| R7C-09 | 分割commit・push・PR | Git/GitHub | 中 |

- [x] R7C-01: Redで503不一致詳細とnull境界を追加する
- [x] R7C-02: CLI固定fieldと非露出のRed testを追加する
- [x] R7C-03: 固定型・classifier結果・error metadataをGreen実装する
- [x] R7C-04: CLI固定fieldをGreen実装する
- [x] R7C-05: header契約型とbody lifecycleをRefactorする
- [x] R7C-06: 対象・関連testを通す
- [x] R7C-07: backend最終品質gateを通す
- [x] R7C-08: 第三run・進捗・計画を同期する
- [ ] R7C-09: 分割commit・push・PRを作成する

### タブ区切り

```tsv
タスクID	タスク内容	ファイル	優先度
R7C-01	Red: 503不一致詳細とnull境界を追加	backend/src/jobs/stagingRateLimitEvidence.test.ts	高
R7C-02	Red: CLI固定fieldと非露出を追加	backend/src/jobs/stagingRateLimitEvidence.cli.test.ts	高
R7C-03	Green: 固定型・classifier結果・error metadata	backend/src/jobs/stagingRateLimitEvidence.ts	高
R7C-04	Green: CLI固定field	backend/src/jobs/stagingRateLimitEvidence.cli.ts	高
R7C-05	Refactor: header契約型とbody lifecycle	runner/test	高
R7C-06	対象・関連test	backend/src/jobs/*.test.ts	高
R7C-07	backend最終品質gate	backend	高
R7C-08	第三run・進捗・計画を同期	docs	中
R7C-09	分割commit・push・PR	Git/GitHub	中
```

## テストケース一覧

| ケース | 期待結果 |
| --- | --- |
| 完全なsafe JSON 503 | response classはsafe、詳細`null` |
| 非JSON 503 | `SERVICE_UNAVAILABLE_CONTENT_TYPE` |
| `Retry-After`不一致 | `SERVICE_UNAVAILABLE_RETRY_AFTER` |
| CORS/security header不一致 | 該当する固定header契約名 |
| JSON parse失敗 | `SERVICE_UNAVAILABLE_JSON_BODY` |
| 単一error body不一致 | `SERVICE_UNAVAILABLE_ERROR_BODY` |
| header access失敗 | `SERVICE_UNAVAILABLE_RESPONSE_ACCESS` |
| 500/502/504 | その他status、詳細`null` |
| timeout/network failure | response class・詳細とも`null` |
| CLI known error | 固定fieldだけを出力 |

## 停止条件

- 詳細分類にraw body・header値・URL・例外messageが必要になる。
- API、Worker、middleware、Durable Object、DB、workflow変更が必要になる。
- 503の内部原因を固定分類名で断定する設計になる。
- 既存429、cleanup、body lifecycleを弱める必要が出る。
- testがstaging HTTP、DB、Cloudflare resourceを要求する。

停止時は範囲を広げず、別計画または実環境観測gateの承認を求める。

## 実装完了

- 実装日: 2026-07-24
- 実装branch: `feature/r7-auth-503-contract-detail`
- base `develop` SHA: `628ce06f90d150ae3dd3eb7e8e6c52ee42deace8`
- PR: 作成後に追記する

### TDD実測

- Red: runner 54 tests中33 tests成功・21 tests失敗、CLI 4 tests中3 tests成功・1 test失敗。すべて`observed503FailedContract`未実装を理由に失敗した
- Green: runner/CLI 2 files / 58 testsが成功した
- Refactor: workflow contractを含むrunner/CLI/workflow 3 files / 66 testsが成功した
- 最終品質gate: backend 104 files / 1110 tests成功、外部DB用10 testsは既定どおりskip。Workers runtime 2 files / 15 tests、Node/Workers TypeScript build、ESLint、Prettier checkが成功した

### 設計判断と安全性

- `observedResponseClass`を維持し、503公開契約の不一致箇所だけをnullableな`observed503FailedContract`へ追加した
- Content-Type、`Retry-After`、JSON parse、単一error body、response accessは固定名で分類し、公開header契約は既存header contract型をsingle sourceとして再利用する
- safe JSON 503、503以外の想定外status、request失敗、通常の429では詳細を`null`にする
- response body、header値、URL、credential、PII、raw例外をerror metadata、CLI、文書へ保持・出力しない
- 第三runは既存の広いclassだけを記録したため、新しい詳細分類を遡及適用しない
- workflow、API、Worker、rate-limit middleware、Durable Object、DB、Cloudflare設定、frontend、production resourceは変更していない
- 本task中にstaging HTTP request、workflow dispatch、Environment Variable変更、fixture/DB操作、delay追加を行っていない

### 実際の変更ファイル

| ファイル | 変更種別 | 内容 |
| --- | --- | --- |
| `backend/src/jobs/stagingRateLimitEvidence.test.ts` | 修正 | 503不一致詳細、null境界、非露出、request 6回帰のcontract test |
| `backend/src/jobs/stagingRateLimitEvidence.ts` | 修正 | 固定詳細型、classifier結果、error metadata、header型共通化 |
| `backend/src/jobs/stagingRateLimitEvidence.cli.test.ts` | 修正 | CLI固定詳細fieldと非露出test |
| `backend/src/jobs/stagingRateLimitEvidence.cli.ts` | 修正 | known errorへ固定詳細fieldを追加 |
| `docs/plans/r7-auth-503-contract-detail/plan.md` | 新規 | 計画、TDD、品質gate、実変更を記録 |
| `docs/plans/r7-rate-limit-environment-gates/plan.md` | 修正 | 第三run E-05、R7-04完了、R7-05未完了を同期 |
| `docs/plans/r7-auth-503-safe-classification/plan.md` | 修正 | PR #144 mergeと第三run、後続taskを同期 |
| `docs/05_progress.md` | 修正 | R7-04完了、R7-05未完了、本task進捗を同期 |

### 計画からの変更点

- `docs/04_api.md`は公開API契約を変更していないため更新しない
- DB変更がないためmigration、DB integration test、Playwrightは実行しない
- auth requestの間隔は変更しない。10分固定window内の短いdelayでは503回避の根拠にならず、長いdelayは11回目429の証拠契約を壊すためである
