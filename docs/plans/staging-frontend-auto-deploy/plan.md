# developマージ後のstaging frontend自動更新 実装計画

> 設計者ロール: シニアDevOps / フロントエンドエンジニア
> 対応Issue: [#173 developマージ後に固定ステージングURLを自動更新する](https://github.com/RitukoIsibasi0222/gensoko/issues/173)

## 概要

`develop`へfrontend変更がmergeされたとき、Vercel Git Integrationが作成するPreview deploymentをGitHub Actionsからexact SHAで検証し、成功したdeploymentだけを固定staging URLへ反映する。

日常の画面確認ではAPI deploy、DB preflight、fixture、synthetic campaign、M1 evidenceを実行しない。既存M2は初回公開後の回帰またはauth / API / DB / provider設定などの高リスク変更時に使う手動総合試験として維持する。

## 現状と解決する問題

- `develop` mergeからVercel Preview deploymentは自動作成される。
- 固定URL `https://gensoko-frontend-staging-develop.vercel.app/` は最新の成功Previewへ自動追従しない場合があり、古いUIを表示する。
- M2 workflowにはVercel preview deploy、alias更新、SHA確認があるが、API deploy、DB、fixture、M1 evidence、cleanupを伴うため日常用途には過剰である。
- production frontendは2026-08-06のmain merge commitでもVercel Git IntegrationによるGitHub `Production` deployment成功が記録された。一方、API deployとの順序・same SHAは通常release workflowとして統合されていない。これはIssue #174で扱う。

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`.github/workflows/frontend-pr-quality.yml`**

- `pull_request`（`develop` / `main`）かつ`frontend/**`変更時にfrontend品質gateを実行する。
- Node.js 22、`npm ci`、audit、test、lint、Svelte check、format check、`build:preview`を実行する。

**`.github/workflows/staging-release-candidate-campaign.yml`**

- `workflow_dispatch`限定のM2総合試験である。
- Vercel CLI `50.17.1`を固定し、preview build / deploy、固定staging alias更新、deployment SHA確認を実行する。
- API deploy、DB preflight、fixture、synthetic campaign、cleanup、M1 evidenceを伴う。

**`frontend/package.json`**

- `test:run`: frontend Vitest全件を1回実行する。
- `lint`: ESLintを実行する。
- `check`: Svelte / TypeScript checkを実行する。
- `format:check`: Prettier差分を検出する。
- `build:preview`: Vercel Build Output v3、SSR route、公開API URL、秘密非混入を検証する。

**Vercel Git Integration**

- `develop`のPreview deploymentを作成する責務を持つ。
- deploymentにはGit commit SHA / ref metadataが付与される。
- GitHub Actionsは同じ成果物を再deployせず、対象SHAの成功Previewを検証して固定aliasへ昇格する。

### 重要な制約

- 対象はfrontend stagingだけとし、staging APIをdeployしない。
- DB接続、migration、query、fixture、cleanupを行わない。
- production Environment、main、production deployment、production alias、DNSを参照・変更しない。
- `develop`以外、手動入力SHA、PR event、scheduleから固定staging aliasを更新できないようにする。
- `VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID`は`staging` Environment Secretだけから読む。
- Secret、token、provider内部ID、固有deployment URL、raw provider responseをlog、Summary、Artifactへ出さない。
- Vercel CLIは既存M2と同じversionへ固定し、`@latest`を使わない。
- Vercel Git Integrationが作成したPreviewを再利用し、日常workflowから`vercel deploy`を重複実行しない。
- alias更新処理をM2と重複実装しない。共有composite actionへ切り出す。
- M2のmanual-only、M1 gate、API→frontend→campaign順序は変更しない。

## 対象ファイル一覧

| ファイル                                                           | 変更種別 | 内容                                                               |
| ------------------------------------------------------------------ | -------- | ------------------------------------------------------------------ |
| `.github/workflows/staging-frontend-deploy.yml`                    | 新規     | `develop` frontend変更の品質確認、Preview探索、alias更新、smoke    |
| `.github/actions/vercel-preview-alias/action.yml`                  | 新規     | exact metadata検証、alias更新、更新後smoke、失敗時復旧の共通action |
| `.github/workflows/staging-release-candidate-campaign.yml`         | 修正     | Vercel alias処理を共通actionへ置換しM2の重複を除去                 |
| `backend/src/jobs/stagingFrontendDeploymentWorkflow.test.ts`       | 新規     | 自動workflowとproduction禁止のsource contract test                 |
| `backend/src/jobs/vercelPreviewAliasAction.test.ts`                | 新規     | 共通actionの順序、SHA、rollback、秘密非出力contract test           |
| `backend/src/jobs/stagingReleaseCandidateCampaignWorkflow.test.ts` | 修正     | M2が共通actionを使い既存gateを維持する回帰test                     |
| `frontend/scripts/vercel-ignore-build.mjs`                         | 新規     | developのfrontend無変更commitと対象外branchをbuild前にskip         |
| `frontend/src/vercel-ignore-build.test.ts`                         | 新規     | develop/main/featureとgit diff結果のcontract test                  |
| `frontend/package.json`                                            | 修正     | Vercel Ignored Build Step用scriptを追加                            |
| `docs/11_deployment.md`                                            | 修正     | 日常staging、M2、高リスク、rollbackのrunbook                       |
| `docs/05_progress.md`                                              | 修正     | Issue #173を進捗管理へ追加し初回公開済み状態を同期                 |
| `docs/plans/staging-frontend-auto-deploy/plan.md`                  | 新規     | 本計画                                                             |

## 設計フロー

```text
developへfrontend変更をmerge
→ push / paths filterでworkflow開始
→ frontend品質gate
→ 対象SHAのVercel Previewをbounded poll
→ target=preview・ref=develop・SHA完全一致・READYを検証
→ GitHubのdevelop先端SHAを再取得
→ 対象SHAが現在の先端の場合だけ固定aliasを更新
→ 固定aliasのmetadataを再検証
→ 固定aliasへread-only軽量smoke
→ SHAと固定statusだけをStep Summaryへ記録
```

品質失敗、Preview未完成、metadata不一致、複数候補、develop先端移動ではaliasを変更しない。alias更新後の検証またはsmokeが失敗した場合は、更新前に記録した直前の正常deploymentへaliasを戻し、rollback確認に失敗したときはworkflowをfailureで終了してrunbookの手動復旧へ移る。

## workflow契約

| 項目           | 契約                                                                        |
| -------------- | --------------------------------------------------------------------------- |
| event          | `push`のみ                                                                  |
| branch         | `develop`のみ                                                               |
| paths          | `frontend/**`だけ。workflow / actionだけの変更ではstaging成果物を更新しない |
| permission     | workflow既定`contents: read`、write permissionなし                          |
| Environment    | `staging`だけ                                                               |
| concurrency    | 固定staging frontend group、`cancel-in-progress: true`                      |
| candidate      | Vercel Git Integrationが作成したPreview、対象`github.sha`完全一致           |
| provider state | `target=preview`、`ref=develop`、`READY`、同一project                       |
| alias          | 固定staging URLだけ                                                         |
| smoke          | GETだけ、有限timeout、200、同一origin、Gensoko HTML marker                  |
| summary        | 対象SHAと固定statusだけ。固有URL・ID・raw responseなし                      |
| artifact       | 作成しない                                                                  |

## 設計上の決定事項

1. **GitHub Actionsから新しいPreviewをdeployするか**
   - 選択: deployしない。Vercel Git Integrationが作成した対象SHAのPreviewを再利用する。
   - 根拠: 現在もPreviewは自動作成されており、問題は固定aliasが追従しないことに限定される。再deployはbuild時間、quota、二重deployment、候補選択の曖昧さを増やす。

2. **PR品質checkの成功だけを再利用するか**
   - 選択: push workflow内でもfrontend品質gateを実行し、成功後だけaliasを更新する。
   - 根拠: merge commitのexact SHAを検証対象に固定できる。PR checkのhead SHAとmerge後SHAの取り違えを避ける。

3. **docsだけのdevelop mergeをどう扱うか**
   - 選択: GitHub Actionsは`paths`で起動せず、Vercel Git Integrationはrepository管理のIgnored Build Step scriptでbuildをskipする。
   - 根拠: workflowだけを止めてもprovider側の不要deploymentは残るため、両方の入口でfrontend変更有無を判定する必要がある。scriptは`develop`だけgit diffを確認し、差分判定不能時はbuildを続けるfail-open、`main`の現行production挙動はIssue #174まで変更しない。

4. **古いrunによるalias上書きをどう防ぐか**
   - 選択: GitHub Actions concurrencyによるcancelに加え、alias更新直前にGitHub APIで`refs/heads/develop`を再取得して対象SHAとの完全一致を必須にする。
   - 根拠: concurrencyの処理順は保証されないため、provider変更直前の二重確認が必要である。

5. **deployment候補をどう特定するか**
   - 選択: pinned Vercel CLIで`githubCommitSha` metadataを使ってbounded pollし、JSONを構造化parseしてSHA、ref、target、state、projectを完全一致検証する。
   - 根拠: raw JSON文字列への`includes`は別fieldの偶然一致を許すためfail-closedにならない。

6. **alias更新処理をどこへ置くか**
   - 選択: repository local composite actionへ共通化し、日常workflowとM2の両方から呼ぶ。
   - 根拠: metadata検証、alias、post-check、軽量smoke、rollback、秘密非出力を一箇所で維持する。smokeもaction内で実行するため、smoke失敗時に同じactionが直前aliasへ戻せる。

7. **alias更新後の失敗をどう扱うか**
   - 選択: 更新前のalias参照先を一時fileだけに保持し、post-checkまたはsmoke失敗時は直前の参照先へ自動rollbackする。値は出力・Artifact化しない。
   - 根拠: 固定URLを最後に確認済みのdeploymentへ戻し、古いUIより悪い壊れたUIを残さない。

8. **M2をどう扱うか**
   - 選択: 廃止しない。共通actionを使う範囲だけrefactorし、手動総合試験として残す。
   - 根拠: API、認証、DB、provider設定などの高リスク変更には日常frontend更新より強いgateが必要である。

## 公開インターフェース案

### local composite action inputs

| input                      | 必須     | 役割                                                          |
| -------------------------- | -------- | ------------------------------------------------------------- |
| `deployment-url-file`      | 必須     | provider stdoutを保存した一時file。値をworkflow出力へ載せない |
| `expected-sha`             | 必須     | 40桁lowercase SHA                                             |
| `expected-ref`             | 必須     | `develop`                                                     |
| `expected-target`          | 必須     | `preview`                                                     |
| `alias`                    | 必須     | 固定staging hostname                                          |
| `vercel-token`             | 必須     | `staging` Environment Secret                                  |
| `automation-bypass-secret` | 条件付き | Vercel protection有効時の`staging` Environment Secret         |
| `smoke-marker`             | 必須     | 公開HTMLに含まれる固定Gensoko marker                          |

共通actionは成功時もdeployment URLやprovider IDをoutputしない。workflow内の一時fileだけで受け渡す。

### 日常workflow内部status

```typescript
type StagingFrontendDeploymentStatus =
  | "QUALITY_CLEAR"
  | "PREVIEW_READY"
  | "ALIAS_UPDATED"
  | "SMOKE_CLEAR"
  | "ROLLED_BACK";
```

Summaryへ出せる値は上記固定statusと対象SHAだけとする。

## エラー・rollback契約

| 失敗箇所                           | aliasへの影響   | workflow結果                | 復旧                            |
| ---------------------------------- | --------------- | --------------------------- | ------------------------------- |
| quality                            | 変更なし        | failure                     | code修正後の次merge             |
| Preview timeout / failure          | 変更なし        | failure                     | Vercel状態確認後の次merge       |
| SHA / ref / target / project不一致 | 変更なし        | failure                     | provider metadataを確認し再設計 |
| develop先端移動                    | 変更なし        | cancelled相当のsafe failure | 新しいrunへ委譲                 |
| alias set失敗                      | 直前aliasを維持 | failure                     | provider状態確認                |
| alias post-check失敗               | rollbackを試行  | failure                     | rollback成功を固定statusで確認  |
| smoke失敗                          | rollbackを試行  | failure                     | 原因修正後の次merge             |
| rollback失敗                       | 不明として停止  | failure                     | runbookの手動alias復旧          |

失敗時もraw provider response、固有deployment URL、tokenを出力しない。調査が必要な場合はVercel dashboardの権限内表示を人間が確認し、値をIssueやArtifactへ転記しない。

## 外部設定境界

repository実装PRではEnvironment、Secret、Vercel Project Settings、alias、deploymentを変更しない。実装merge前に次を値非表示で確認する。

- GitHub `staging` Environmentが`develop`からのjobだけを許可する。
- 自動更新を止めるrequired reviewerがstagingに設定されていない、または自動化方針に合う保護設定である。
- `VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID`がstaging専用で存在する。
- Vercel Previewの`develop` branch scopeに既存`VITE_API_BASE_URL`が設定されている。
- Vercel Git Integrationが`develop` frontend変更でPreviewを作成する。
- Vercel Ignored Build Stepをrepositoryの`npm run vercel:ignore-build`へ設定し、developのfrontend無変更commitをskipする。mainの現行挙動はIssue #174まで維持する。
- 固定staging aliasの現在の参照先をdashboardで確認できる。

不足がある場合はrepository PRと混ぜず、費用、対象project、影響、rollbackを提示した別承認で設定する。

## TDD実装順

### Red

1. 新workflowが未作成で失敗するsource contract testを追加する。
2. trigger、paths、permission、Environment、concurrency、production禁止testを追加する。
3. 共通actionが未作成で失敗するmetadata完全一致、順序、rollback、秘密非出力testを追加する。
4. M2が共通actionを未使用で失敗する回帰testを追加する。
5. developのfrontend無変更時skip、frontend変更時build、main現行維持、feature skipのIgnored Build Step testを追加する。

### Green

1. 共通Vercel preview alias actionを実装する。
2. frontend品質jobとPreview探索 / alias / smoke jobを持つworkflowを実装する。
3. M2のalias処理を共通actionへ置き換える。
4. repository管理のVercel Ignored Build Step scriptとpackage scriptを実装する。
5. 対象testを通す。

### Refactor

1. Vercel CLI version、alias hostname、固定status、timeoutを一箇所へ寄せる。
2. temp file cleanupを`always()`またはshell trapで保証する。
3. M2のmanual gateと日常workflowの自動gateが混ざっていないことを再確認する。
4. frontend / backend関連testを再実行する。

## タスクリスト（進捗管理）

| タスクID | 内容                                      | ファイル                                          | 優先度 | 備考         |
| -------- | ----------------------------------------- | ------------------------------------------------- | ------ | ------------ |
| SFA-01   | workflow trigger・境界のRed test          | `stagingFrontendDeploymentWorkflow.test.ts`       | 高     | Repository   |
| SFA-02   | alias actionのRed test                    | `vercelPreviewAliasAction.test.ts`                | 高     | Repository   |
| SFA-03   | 共通Vercel preview alias action実装       | `.github/actions/vercel-preview-alias/action.yml` | 高     | Repository   |
| SFA-03A  | Vercel Ignored Build Step scriptとtest    | `frontend/scripts` / test / package               | 高     | Repository   |
| SFA-04   | develop自動workflow実装                   | `.github/workflows/staging-frontend-deploy.yml`   | 高     | Repository   |
| SFA-05   | M2を共通actionへrefactor                  | M2 workflow / test                                | 高     | Repository   |
| SFA-06   | runbook・進捗・計画同期                   | docs                                              | 高     | Repository   |
| SFA-07   | 対象test・frontend品質gate                | backend / frontend                                | 高     | Repository   |
| SFA-08   | 全体品質gate                              | repository                                        | 高     | Repository   |
| SFA-09   | staging Environment / Vercel preflight    | GitHub / Vercel                                   | 高     | 別承認・外部 |
| SFA-10   | implementation mergeで自動run確認         | GitHub Actions / Vercel                           | 高     | 別承認・外部 |
| SFA-11   | fixed alias SHA・smoke・旧run非上書き確認 | staging                                           | 高     | 別承認・外部 |
| SFA-12   | Issue #173完了記録                        | docs / GitHub                                     | 中     | 外部証拠後   |

- [ ] SFA-01: workflow trigger・境界のRed testを作成する
- [ ] SFA-02: alias actionのRed testを作成する
- [ ] SFA-03: 共通Vercel preview alias actionを実装する
- [ ] SFA-03A: Vercel Ignored Build Step scriptとtestを実装する
- [ ] SFA-04: develop自動workflowを実装する
- [ ] SFA-05: M2のalias処理を共通actionへrefactorする
- [ ] SFA-06: runbook・進捗・計画を同期する
- [ ] SFA-07: 対象testとfrontend品質gateを通す
- [ ] SFA-08: repository全体の必要な品質gateを通す
- [ ] SFA-09: 別承認でstaging Environment / Vercelをpreflightする
- [ ] SFA-10: implementation mergeによる自動runを確認する
- [ ] SFA-11: fixed aliasのexact SHA、smoke、旧run非上書きを確認する
- [ ] SFA-12: Issue #173の完了記録を同期する

### タブ区切り出力

```text
タスクID	タスク内容	ファイル	優先度
SFA-01	workflow trigger・境界のRed test	stagingFrontendDeploymentWorkflow.test.ts	高
SFA-02	alias actionのRed test	vercelPreviewAliasAction.test.ts	高
SFA-03	共通Vercel preview alias action実装	.github/actions/vercel-preview-alias/action.yml	高
SFA-03A	Vercel Ignored Build Step scriptとtest	frontend/scripts / test / package	高
SFA-04	develop自動workflow実装	.github/workflows/staging-frontend-deploy.yml	高
SFA-05	M2を共通actionへrefactor	M2 workflow / test	高
SFA-06	runbook・進捗・計画同期	docs	高
SFA-07	対象test・frontend品質gate	backend / frontend	高
SFA-08	repository全体品質gate	repository	高
SFA-09	staging Environment / Vercel preflight	GitHub / Vercel	高
SFA-10	implementation mergeで自動run確認	GitHub Actions / Vercel	高
SFA-11	fixed alias SHA・smoke・旧run非上書き確認	staging	高
SFA-12	Issue #173完了記録	docs / GitHub	中
```

## テストケース一覧

| ケース                                | 期待結果                                              |
| ------------------------------------- | ----------------------------------------------------- |
| frontend変更をdevelopへmerge          | workflowが1回起動する                                 |
| docsだけをdevelopへmerge              | workflowを起動せず、Vercel buildもskipする            |
| PR / main / feature branch / schedule | fixed staging aliasを更新できない                     |
| frontend品質失敗                      | aliasを変更しない                                     |
| 対象SHAのPreviewがREADY               | 次のgateへ進む                                        |
| PreviewがERROR / CANCELED / timeout   | aliasを変更せずfailure                                |
| SHA / ref / target / project不一致    | aliasを変更せずfailure                                |
| matching deploymentが0件または曖昧    | aliasを変更せずfailure                                |
| alias直前にdevelopが進む              | 古いrunはaliasを変更しない                            |
| alias更新成功・post-check成功         | fixed aliasが対象SHAを示す                            |
| smoke成功                             | `SMOKE_CLEAR`で完了                                   |
| post-checkまたはsmoke失敗             | 直前deploymentへrollbackを試行する                    |
| rollback成功                          | fixed aliasが直前deploymentへ戻りrunはfailure         |
| rollback失敗                          | 不明状態として停止し手動runbookを案内する             |
| log / Summary / Artifact              | token、ID、固有URL、raw responseを含まない            |
| source contract                       | production、API deploy、DB、fixture、M1操作を含まない |
| M2回帰                                | manual-only、M1 gate、API→frontend→campaignを維持する |

## 品質チェック

Repository実装・再レビュー・文書同期後に次を実行する。

```bash
cd backend
npm run test -- --run src/jobs/stagingFrontendDeploymentWorkflow.test.ts src/jobs/vercelPreviewAliasAction.test.ts src/jobs/stagingReleaseCandidateCampaignWorkflow.test.ts
npm run test -- --run
npm run test:workers
npm run build
npm run lint
npm run format:check

cd ../frontend
npm run test:run
npm run lint
npm run check
npm run format:check
env VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=develop VITE_API_BASE_URL=https://staging-api.example.invalid/api/v1 npm run build:preview
```

Repository品質gateではVercel、staging URL、API、DBへ接続せず、workflow dispatch、alias更新、Environment変更を行わない。実staging確認はSFA-09以降の別承認工程とする。

## 参考資料

- [Vercel: Ignored Build Step](https://vercel.com/kb/guide/how-do-i-use-the-ignored-build-step-field-on-vercel)
- [Vercel CLI: deploy](https://vercel.com/docs/cli/deploy)
- [Vercel CLI: list / metadata filter](https://vercel.com/docs/cli/list)
- [GitHub Actions workflow syntax / concurrency](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)

## Issue #174への引き継ぎ

Issue #173完了後に[#174 通常リリースをmain merge後の承認付き自動デプロイへ簡略化する](https://github.com/RitukoIsibasi0222/gensoko/issues/174)へ着手する。

#174では、現在のVercel Git Integrationによるmain frontend自動deployをそのまま完成形とみなさない。production Environment承認、pending migration停止、API deploy、health、frontend deploy、smoke、same SHA evidenceを順序固定するため、Vercel production deployの所有権をGit IntegrationとGitHub Actionsのどちらに置くかを最初に決定する。Issue #173の共通metadata / alias検証を再利用するが、staging Secretとproduction Secretは共用しない。
