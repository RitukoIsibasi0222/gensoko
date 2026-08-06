# developマージ後のstaging frontend自動更新 実装計画

> 設計者ロール: シニアDevOps / フロントエンドエンジニア
> 対応Issue: [#173 developマージ後に固定ステージングURLを自動更新する](https://github.com/RitukoIsibasi0222/gensoko/issues/173)
> Repository実装PR: [#192](https://github.com/RitukoIsibasi0222/gensoko/pull/192)

## 概要

`develop`へfrontend変更がmergeされたとき、Vercel Git IntegrationがPreview deploymentを作成し、staging projectのPreview branch domain設定が成功deploymentを固定staging URLへ自動反映する。GitHub Actionsはproject限定tokenでexact SHAのPreviewと固定domainの参照先をread-only検証し、軽量smokeを行う。

日常の画面確認ではAPI deploy、DB preflight、fixture、synthetic campaign、M1 evidenceを実行しない。既存M2は初回公開後の回帰またはauth / API / DB / provider設定などの高リスク変更時に使う手動総合試験として維持する。

## 現状と解決する問題

- `develop` mergeからVercel Preview deploymentは自動作成される。
- 固定URL `https://gensoko-frontend-staging-develop.vercel.app/` は当初deployment aliasとしてだけ存在し、最新の成功Previewへ自動追従せず古いUIを表示していた。
- Vercel staging projectへ固定domainをPreview環境・`develop` branch専用として登録し、Git IntegrationまたはM2のreview済みPreview deploy後にprovider側で自動追従させる。
- M2 workflowにはVercel preview deployとSHA確認があるが、API deploy、DB、fixture、M1 evidence、cleanupを伴うため日常用途には使用しない。
- production frontendは2026-08-06のmain merge commitでもVercel Git IntegrationによるGitHub `Production` deployment成功が記録された。一方、API deployとの順序・same SHAは通常release workflowとして統合されていない。これはIssue #174で扱う。

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`.github/workflows/frontend-pr-quality.yml`**

- `pull_request`（`develop` / `main`）かつ`frontend/**`変更時にfrontend品質gateを実行する。
- Node.js 22、`npm ci`、audit、test、lint、Svelte check、format check、`build:preview`を実行する。

**`.github/workflows/staging-release-candidate-campaign.yml`**

- `workflow_dispatch`限定のM2総合試験である。
- Vercel CLI `50.17.1`を固定し、preview build / deploy、固定staging branch domain確認、deployment SHA確認を実行する。
- API deploy、DB preflight、fixture、synthetic campaign、cleanup、M1 evidenceを伴う。

**`frontend/package.json`**

- `test:run`: frontend Vitest全件を1回実行する。
- `lint`: ESLintを実行する。
- `check`: Svelte / TypeScript checkを実行する。
- `format:check`: Prettier差分を検出する。
- `build:preview`: Vercel Build Output v3、SSR route、公開API URL、秘密非混入を検証する。

**Vercel Git Integration**

- `develop`のPreview deploymentを作成する責務を持つ。
- staging projectの固定domainを`develop` Preview branchへ自動割り当てする。
- deploymentにはGit commit SHA / ref metadataが付与される。
- GitHub Actionsは同じ成果物を再deployせず、対象SHAの成功Preview、固定domainの参照先、公開HTMLをread-only検証する。

### 重要な制約

- 対象はfrontend stagingだけとし、staging APIをdeployしない。
- DB接続、migration、query、fixture、cleanupを行わない。
- production Environment、main、production deployment、production alias、DNSを参照・変更しない。
- `develop`以外、手動入力SHA、PR event、scheduleから固定staging domainを検証できないようにする。
- `VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID`は`staging` Environment Secretだけから読む。
- Secret、token、provider内部ID、固有deployment URL、raw provider responseをlog、Summary、Artifactへ出さない。
- Vercel CLIは既存M2と同じversionへ固定し、`@latest`を使わない。
- Vercel Git Integrationが作成したPreviewを再利用し、日常workflowから`vercel deploy`を重複実行しない。
- 固定domainのread-only検証をM2と重複実装しない。共有composite actionへ切り出す。
- project限定tokenで許可されないdeployment detail API、`vercel inspect`、`vercel alias set`を使用しない。
- M2のmanual-only、M1 gate、API→frontend→campaign順序は変更しない。

## 対象ファイル一覧

| ファイル                                                           | 変更種別 | 内容                                                             |
| ------------------------------------------------------------------ | -------- | ---------------------------------------------------------------- |
| `.github/workflows/staging-frontend-deploy.yml`                    | 新規     | `develop` frontend変更の品質確認、Preview探索、domain確認、smoke |
| `.github/actions/vercel-preview-domain/action.yml`                 | 新規     | exact metadata、branch domain、smokeのread-only共通action        |
| `.github/actions/vercel-preview-alias/action.yml`                  | 削除     | project限定tokenで実行不能なalias mutation actionを廃止          |
| `.github/workflows/staging-release-candidate-campaign.yml`         | 修正     | Vercel branch domain確認を共通actionへ置換しM2の重複を除去       |
| `backend/src/jobs/stagingFrontendDeploymentWorkflow.test.ts`       | 新規     | 自動workflowとproduction禁止のsource contract test               |
| `backend/src/jobs/vercelPreviewDomainAction.test.ts`               | 新規     | 共通actionのexact SHA、read-only、秘密非出力contract test        |
| `backend/src/jobs/stagingReleaseCandidateCampaignWorkflow.test.ts` | 修正     | M2が共通actionを使い既存gateを維持する回帰test                   |
| `frontend/scripts/vercel-ignore-build.mjs`                         | 新規     | developのfrontend無変更commitと対象外branchをbuild前にskip       |
| `frontend/src/vercel-ignore-build.test.ts`                         | 新規     | develop/main/featureとgit diff結果のcontract test                |
| `frontend/src/vercel-cli-scope.test.ts`                            | 新規     | Vercel CLIへteam IDをslug用scopeとして渡さない回帰test           |
| `frontend/package.json`                                            | 修正     | Vercel Ignored Build Step用scriptを追加                          |
| `frontend/package-lock.json`                                       | 修正     | auditで検出したmoderate/high transitive依存を安全なversionへ更新 |
| `docs/11_deployment.md`                                            | 修正     | 日常staging、M2、高リスク、失敗時確認のrunbook                   |
| `docs/05_progress.md`                                              | 修正     | Issue #173を進捗管理へ追加し初回公開済み状態を同期               |
| `docs/plans/staging-frontend-auto-deploy/plan.md`                  | 修正     | 実装結果・外部preflight結果を同期                                |

## 設計フロー

```text
developへfrontend変更をmerge
→ push / paths filterでworkflow開始
→ frontend品質gate
→ 対象SHAのVercel Previewをbounded poll
→ target=preview・ref=develop・SHA完全一致・READYを検証
→ GitHubのdevelop先端SHAを再取得
→ 対象SHAが現在の先端の場合だけ固定domainの自動割り当て完了をbounded poll
→ alias listで固定domainの参照先URLと対象Preview URLを完全一致検証
→ 固定domainへread-only軽量smoke
→ SHAと固定statusだけをStep Summaryへ記録
```

品質失敗、Preview未完成、metadata不一致、複数候補、develop先端移動、domain追従timeoutではprovider状態を変更せずfailureにする。固定domainはVercel Project Settingsが管理し、GitHub Actionsから更新・rollbackしない。

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
| domain         | Vercel側でPreview環境・`develop`へ固定したstaging URLをread-only検証        |
| smoke          | GETだけ、有限timeout、200、同一origin、Gensoko HTML marker                  |
| summary        | 対象SHAと固定statusだけ。固有URL・ID・raw responseなし                      |
| artifact       | 作成しない                                                                  |

## 設計上の決定事項

1. **GitHub Actionsから新しいPreviewをdeployするか**
   - 選択: deployしない。Vercel Git Integrationが作成した対象SHAのPreviewを再利用する。
   - 根拠: 日常経路ではPreviewとbranch domainの自動割り当てがprovider責務である。再deployはbuild時間、quota、二重deployment、候補選択の曖昧さを増やす。

2. **PR品質checkの成功だけを再利用するか**
   - 選択: push workflow内でもfrontend品質gateを実行し、成功後だけ対象Previewと固定domainを検証する。
   - 根拠: merge commitのexact SHAを検証対象に固定できる。PR checkのhead SHAとmerge後SHAの取り違えを避ける。

3. **docsだけのdevelop mergeをどう扱うか**
   - 選択: GitHub Actionsは`paths`で起動せず、Vercel Git Integrationはrepository管理のIgnored Build Step scriptでbuildをskipする。
   - 根拠: workflowだけを止めてもprovider側の不要deploymentは残るため、両方の入口でfrontend変更有無を判定する必要がある。scriptは`develop`だけgit diffを確認し、差分判定不能時はbuildを続けるfail-open、`main`の現行production挙動はIssue #174まで変更しない。

4. **古いrunをどう扱うか**
   - 選択: GitHub Actions concurrencyによるcancelに加え、domain検証直前にGitHub APIで`refs/heads/develop`を再取得して対象SHAとの完全一致を必須にする。
   - 根拠: concurrencyの処理順は保証されない。provider状態は変更しないが、古いrunを成功証拠として残さないため二重確認する。

5. **deployment候補をどう特定するか**
   - 選択: `VERCEL_ORG_ID`と`VERCEL_PROJECT_ID`をCI環境変数として設定したpinned Vercel CLIで`githubCommitSha` metadataを使ってbounded pollする。`list <project> --format=json`でSHA、ref、target、state、URLを完全一致させ、`alias ls --format=json`で固定domainの参照先URLが同じ候補URLであることを確認する。team IDである`VERCEL_ORG_ID`をteam slug用の`--scope`へ渡さない。
   - 根拠: project限定tokenはdeployment listとalias listを読み取れる一方、`inspect`と`alias set`が内部利用するdeployment detail APIを利用できない。権限をteamへ広げず、実出力に存在するGit metadataとURLだけでread-only検証する。

6. **固定domainの自動更新責務をどこへ置くか**
   - 選択: Vercel Project SettingsでPreview環境・`develop` branchへdomainを割り当てる。repository local composite actionはread-only検証だけを日常workflowとM2で共用する。
   - 根拠: provider標準のbranch domain機能ならproject限定tokenの権限を広げず、staging/productionを分離したまま成功Previewへ自動追従できる。

7. **domain確認またはsmoke失敗をどう扱うか**
   - 選択: GitHub Actionsからprovider状態を変更せずfailureにする。branch domainは最後の成功deploymentを維持し、Vercel dashboardで原因を確認する。
   - 根拠: read-only検証であれば誤ったrollbackやproduction projectへの権限波及がなく、providerの成功deployment保持契約を利用できる。

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
| `domain`                   | 必須     | `develop`へ割り当て済みの固定staging hostname                 |
| `vercel-token`             | 必須     | `staging` Environment Secret                                  |
| `automation-bypass-secret` | 条件付き | Vercel protection有効時の`staging` Environment Secret         |
| `smoke-marker`             | 必須     | 公開HTMLに含まれる固定Gensoko marker                          |

共通actionは成功時もdeployment URLやprovider IDをoutputしない。workflow内の一時fileだけで受け渡す。

### 日常workflow内部status

```typescript
type StagingFrontendDeploymentStatus =
  | "QUALITY_CLEAR"
  | "PREVIEW_READY"
  | "BRANCH_DOMAIN_READY"
  | "SMOKE_CLEAR";
```

Summaryへ出せる値は上記固定statusと対象SHAだけとする。

## エラー・復旧契約

| 失敗箇所                        | domainへの操作 | workflow結果                | 復旧                             |
| ------------------------------- | -------------- | --------------------------- | -------------------------------- |
| quality                         | なし           | failure                     | code修正後の次merge              |
| Preview timeout / failure       | なし           | failure                     | Vercel状態確認後の次merge        |
| SHA / ref / target / URL不一致  | なし           | failure                     | provider metadataと設定を確認    |
| develop先端移動                 | なし           | cancelled相当のsafe failure | 新しいrunへ委譲                  |
| branch domain確認失敗 / timeout | なし           | failure                     | Vercel domain / Git設定を確認    |
| smoke失敗                       | なし           | failure                     | 直前成功deploymentを維持して調査 |

失敗時もraw provider response、固有deployment URL、tokenを出力しない。調査が必要な場合はVercel dashboardの権限内表示を人間が確認し、値をIssueやArtifactへ転記しない。

## 外部設定境界

repository変更と外部設定変更は別工程にする。2026-08-06にownerの明示承認後、staging projectだけへ固定domainのPreview・`develop` branch割り当てを追加した。production project、production Environment、main、production deploymentは変更していない。

- GitHub `staging` Environmentが`develop`からのjobだけを許可する。
- 自動更新を止めるrequired reviewerがstagingに設定されていない、または自動化方針に合う保護設定である。
- `VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID`がstaging専用で存在する。
- Vercel Previewの`develop` branch scopeに既存`VITE_API_BASE_URL`が設定されている。
- Vercel Git Integrationが`develop` frontend変更でPreviewを作成する。
- Vercel Ignored Build Stepをrepositoryの`npm run vercel:ignore-build`へ設定し、developのfrontend無変更commitをskipする。mainの現行挙動はIssue #174まで維持する。
- 固定staging domainがPreview環境・`develop` branchへ割り当てられている。

不足がある場合はrepository PRと混ぜず、費用、対象project、影響、rollbackを提示した別承認で設定する。

## TDD実装順

### Red

1. 新workflowが未作成で失敗するsource contract testを追加する。
2. trigger、paths、permission、Environment、concurrency、production禁止testを追加する。
3. 共通actionが未作成で失敗するmetadata完全一致、read-only、秘密非出力testを追加する。
4. M2が共通actionを未使用で失敗する回帰testを追加する。
5. developのfrontend無変更時skip、frontend変更時build、main現行維持、feature skipのIgnored Build Step testを追加する。

### Green

1. 共通Vercel preview branch domain検証actionを実装する。
2. frontend品質jobとPreview探索 / domain / smoke jobを持つworkflowを実装する。
3. M2のalias mutationをread-only共通actionへ置き換える。
4. repository管理のVercel Ignored Build Step scriptとpackage scriptを実装する。
5. 対象testを通す。

### Refactor

1. Vercel CLI version、domain hostname、固定status、timeoutを一箇所へ寄せる。
2. temp file cleanupを`always()`またはshell trapで保証する。
3. M2のmanual gateと日常workflowの自動gateが混ざっていないことを再確認する。
4. frontend / backend関連testを再実行する。

## タスクリスト（進捗管理）

| タスクID | 内容                                   | ファイル                                          | 優先度 | 備考         |
| -------- | -------------------------------------- | ------------------------------------------------- | ------ | ------------ |
| SFA-01   | workflow trigger・境界のRed test       | `stagingFrontendDeploymentWorkflow.test.ts`       | 高     | Repository   |
| SFA-02   | alias actionのRed test                 | `vercelPreviewAliasAction.test.ts`                | 高     | Repository   |
| SFA-03   | 共通Vercel preview alias action実装    | `.github/actions/vercel-preview-alias/action.yml` | 高     | Repository   |
| SFA-03A  | Vercel Ignored Build Step scriptとtest | `frontend/scripts` / test / package               | 高     | Repository   |
| SFA-04   | develop自動workflow実装                | `.github/workflows/staging-frontend-deploy.yml`   | 高     | Repository   |
| SFA-05   | M2を共通actionへrefactor               | M2 workflow / test                                | 高     | Repository   |
| SFA-06   | runbook・進捗・計画同期                | docs                                              | 高     | Repository   |
| SFA-07   | 対象test・frontend品質gate             | backend / frontend                                | 高     | Repository   |
| SFA-08   | 全体品質gate                           | repository                                        | 高     | Repository   |
| SFA-08A  | Vercel CLI scope解決の回帰修正         | workflow / action / test                          | 高     | Repository   |
| SFA-08B  | project限定tokenのalias検証回帰修正    | alias action / test / docs                        | 高     | Repository   |
| SFA-08C  | list / inspect候補metadataの回帰修正   | alias action / test / docs                        | 高     | Repository   |
| SFA-08D  | list ID省略時のinspect取得回帰修正     | alias action / test / docs                        | 高     | Repository   |
| SFA-08E  | branch domain方式のRed contract test   | backend / frontend test                           | 高     | Repository   |
| SFA-08F  | read-only branch domain action実装     | preview domain action / test                      | 高     | Repository   |
| SFA-08G  | 日常workflowのdomain検証移行           | staging frontend workflow / test                  | 高     | Repository   |
| SFA-08H  | M2のdomain検証移行                     | M2 workflow / test                                | 高     | Repository   |
| SFA-08I  | 旧alias mutation処理の削除             | alias action / docs                               | 高     | Repository   |
| SFA-09   | staging Environment / Vercel preflight | GitHub / Vercel                                   | 高     | 別承認・外部 |
| SFA-10   | implementation mergeで自動run確認      | GitHub Actions / Vercel                           | 高     | 別承認・外部 |
| SFA-11   | fixed domain SHA・smoke・旧run除外確認 | staging                                           | 高     | 別承認・外部 |
| SFA-12   | Issue #173完了記録                     | docs / GitHub                                     | 中     | 外部証拠後   |

- [x] SFA-01: workflow trigger・境界のRed testを作成する
- [x] SFA-02: alias actionのRed testを作成する
- [x] SFA-03: 共通Vercel preview alias actionを実装する
- [x] SFA-03A: Vercel Ignored Build Step scriptとtestを実装する
- [x] SFA-04: develop自動workflowを実装する
- [x] SFA-05: M2のalias処理を共通actionへrefactorする
- [x] SFA-06: runbook・進捗・計画を同期する
- [x] SFA-07: 対象testとfrontend品質gateを通す
- [x] SFA-08: repository全体の必要な品質gateを通す
- [x] SFA-08A: Vercel CLIへteam IDをslug用scopeとして渡さない回帰修正を行う
- [x] SFA-08B: project限定tokenではCLI JSONのproject nameを完全一致検証し、段階別の安全な失敗診断を追加する
- [x] SFA-08C: listでexact Git metadataを確認し、同じ候補をinspectしてproject境界を完全一致検証する
- [x] SFA-08D: listのID省略を許容し、同じ候補のinspectからIDを取得して後続検証へ引き継ぐ
- [x] SFA-08E: branch domain方式のRed contract testを追加する
- [x] SFA-08F: exact候補・alias list・smokeだけを行うread-only branch domain actionを実装する
- [x] SFA-08G: 日常workflowをVercel自動deploy後のdomain検証へ移行する
- [x] SFA-08H: M2の手動frontend deploy後検証とactive SHA確認をdomain方式へ移行する
- [x] SFA-08I: project限定tokenで実行不能なinspect・alias set・rollback処理を削除する
- [x] SFA-09: 別承認でstaging Environment / Vercelをpreflightする
- [ ] SFA-10: implementation mergeによる自動runを確認する
- [ ] SFA-11: fixed domainのexact SHA、smoke、旧run除外を確認する
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
SFA-08A	Vercel CLI scope解決の回帰修正	workflow / action / test	高
SFA-08B	project限定tokenのalias検証回帰修正	alias action / test / docs	高
SFA-08C	list / inspect候補metadataの回帰修正	alias action / test / docs	高
SFA-08D	list ID省略時のinspect取得回帰修正	alias action / test / docs	高
SFA-08E	branch domain方式のRed contract test	backend / frontend test	高
SFA-08F	read-only branch domain action実装	preview domain action / test	高
SFA-08G	日常workflowのdomain検証移行	staging frontend workflow / test	高
SFA-08H	M2のdomain検証移行	M2 workflow / test	高
SFA-08I	旧alias mutation処理の削除	alias action / docs	高
SFA-09	staging Environment / Vercel preflight	GitHub / Vercel	高
SFA-10	implementation mergeで自動run確認	GitHub Actions / Vercel	高
SFA-11	fixed domain SHA・smoke・旧run除外確認	staging	高
SFA-12	Issue #173完了記録	docs / GitHub	中
```

## テストケース一覧

| ケース                                | 期待結果                                              |
| ------------------------------------- | ----------------------------------------------------- |
| frontend変更をdevelopへmerge          | workflowが1回起動する                                 |
| docsだけをdevelopへmerge              | workflowを起動せず、Vercel buildもskipする            |
| PR / main / feature branch / schedule | 日常staging domain検証workflowを起動しない            |
| frontend品質失敗                      | domain検証へ進まずprovider状態を変更しない            |
| 対象SHAのPreviewがREADY               | 次のgateへ進む                                        |
| PreviewがERROR / CANCELED / timeout   | provider状態を変更せずfailure                         |
| SHA / ref / target / URL不一致        | provider状態を変更せずfailure                         |
| matching deploymentが0件または曖昧    | provider状態を変更せずfailure                         |
| domain確認直前にdevelopが進む         | 古いrunはsafe failure                                 |
| branch domain自動割り当て成功         | fixed domainが対象SHAのURLを示す                      |
| smoke成功                             | `SMOKE_CLEAR`で完了                                   |
| domain確認timeoutまたはsmoke失敗      | provider状態を変更せずfailure                         |
| log / Summary / Artifact              | token、ID、固有URL、raw responseを含まない            |
| source contract                       | production、API deploy、DB、fixture、M1操作を含まない |
| Vercel CLI scope contract             | team IDを`--scope`へ渡さずCI環境IDでprojectを固定する |
| M2回帰                                | manual-only、M1 gate、API→frontend→campaignを維持する |

## 品質チェック

Repository実装・再レビュー・文書同期後に次を実行する。

```bash
cd backend
npm run test -- --run src/jobs/stagingFrontendDeploymentWorkflow.test.ts src/jobs/vercelPreviewDomainAction.test.ts src/jobs/stagingReleaseCandidateCampaignWorkflow.test.ts
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

Repository品質gateではVercel、staging URL、API、DBへ接続せず、workflow dispatch、domain更新、Environment変更を行わない。実staging確認はSFA-09以降の別承認工程とする。

## 実装時の確認結果（2026-08-06）

- Vercel CLI `50.17.1`のJSON出力は`--format=json`を使用する。既存M2の`inspect --json`は同versionの公開optionと一致しなかったため、共通actionとM2を`--format=json`へ統一した。
- GitHub `staging` Environmentは`develop`限定branch policyを維持しており、自動runを止めるrequired reviewerは設定されていない。
- read-only確認時点では`VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID`が未登録だった。承認後、project限定・1年有効のautomation tokenを作成し、3 Secretを`staging` Environmentへ値非表示で登録した。token値とprovider内部IDは記録していない。
- Vercel Hobby projectでは対象`develop`先端SHAのPreviewが`READY`だが、固定staging aliasはそのdeploymentに付与されていない。固定URLが最新UIへ追従しない問題を再現できた。
- Vercel Ignored Build Stepは承認後に既存Custom commandから`npm run vercel:ignore-build`へ変更し、保存後の設定表示で反映を確認した。mainの現行build契約は維持している。
- Node.js `22.23.1`でbackend 1320 test、Workers 32 test、frontend 683 test、build、lint、Svelte check、format check、Preview build contractを通した。frontend auditのmoderate/highは非破壊lockfile更新で解消し、破壊的な`--force`を要するupstream由来のlow 3件だけを残した。
- PR #192のGitHub Copilot reviewでproject identityのfail-closed検証不足を指摘された。当初はVercel REST `GET /v9/projects/{projectId}`を`teamId`で照合し、project IDと固定project名を完全一致検証したうえで、Vercel CLIの候補探索を固定app名へ限定した。再reviewは新規commentなしだったが、suppressed noteからM2の複数行deploy出力を全行連結する潜在不具合を確認し、最後の非空URL行だけを読む修正をRed 1件→Green 19件で追加した。
- PR #192は`develop`へmerge済みで、merge SHAは`b84667a166c296355dd5a5f98957954b5950b203`である。初回run [31072094165](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/31072094165)は3 Secret未登録のためalias更新前に失敗した。承認済みpreflight後のfailed job再実行ではSecretがmaskedで注入されたが、Preview探索がtimeoutし、固定aliasは変更されなかった。
- 再実行の原因調査で、Vercel CLI `50.17.1`のteam slug用`--scope`へteam IDである`VERCEL_ORG_ID`を渡していたため、project-scoped tokenから対象projectを解決できないことを確認した。project限定tokenは維持し、CLIは`VERCEL_ORG_ID` / `VERCEL_PROJECT_ID`環境変数でprojectを固定する修正を回帰test先行で追加した。
- scope回帰修正後はNode.js 22でbackend 1321 test、Workers 32 test、frontend 684 test、backend/frontend build、lint、Svelte check、format check、Preview build contractを通した。frontend auditはmoderate以上0件で、破壊的な`--force`を要するupstream由来のlow 3件だけを残した。
- PR #193のCopilot reviewで、scope回帰testが`process.cwd()`からrepository rootを推測しており、repo直下の`vitest --root frontend`実行で失敗する指摘を受けた。別cwd実行のRedを再現し、既存source contract testと同じ`import.meta.url` / `fileURLToPath`基準へ修正した。
- PR #193は`develop`へmerge済みで、merge SHAは`ef97e98d72a6fa159c424c02cc9a0e0523231aaa`である。run [31076459494](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/31076459494)ではexact `READY` Preview探索とalias直前のdevelop先端再確認まで成功したが、共通alias actionが失敗し、固定aliasは旧CSS bundleを維持した。project限定tokenに不要なProjects REST権限面を増やさず、pinned CLI JSONのproject nameを候補・更新前・更新後・rollbackで完全一致検証し、秘密やprovider raw値を出さない固定段階メッセージをRed 3件→Green backend 6件・frontend 2件で追加した。SFA-10〜SFA-12はこの修正のmerge後に再確認する。
- PR #194のCopilot reviewで、smoke内の`fetch`やURL処理が例外を投げるとNode stack traceがstderrへ出て固定段階メッセージ契約から外れる指摘を受けた。意図した挙動ではないため、smoke範囲だけを検査するRed 1件を追加し、処理全体を`try/catch`で囲んで例外内容を出さず`process.exit(1)`へ寄せた。再reviewでは候補・更新前・更新後・rollbackのmetadata検証にも同じ例外露出経路があると確認したため、重複した`try/catch`を増やさず、5つの埋め込みNode検証すべてでstderrを破棄し、shell側の固定段階メッセージだけを残した。直接影響testはRed 1件からbackend 22件・frontend 2件がGreenである。
- SFA-08Bの最終品質gateはbackend 1324 test、Workers 32 test、frontend 685 test、backend/frontend build、lint、Svelte check、format check、YAML parse、埋め込みBash構文、Preview build contractを通した。frontend auditはmoderate以上0件で、破壊的な`--force`を要するupstream由来のlow 3件だけを残した。
- PR #194は`develop`へmerge済みで、merge SHAは`0918f9a545276f4fa4973927886055683d78fdeb`である。run [31079563100](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/31079563100)では品質gate、exact `READY` Preview探索、alias直前のdevelop先端再確認まで成功したが、共通actionのcandidate project metadata検証で安全に停止し、固定aliasを維持した。Vercel CLI `50.17.1`の配布コードと実runを照合し、`list --format=json`で省略され得るproject name条件を外し、listで確定したIDと同じcandidate URLを`inspect --format=json`してproject境界を完全一致させた。Redはbackend 4件・frontend 1件、直接影響testはbackend 22件・frontend 5件、YAML parseと埋め込みBash構文がGreenである。
- SFA-08Cの最終品質gateはbackend 1324 test、Workers 32 test、frontend 685 test、backend/frontend build、lint、Svelte check、format check、YAML parse、埋め込みBash構文、Preview build contractを通した。frontend auditはmoderate以上0件で、破壊的な`--force`を要するupstream由来のlow 3件だけを残した。
- PR #195は`develop`へmerge済みで、merge SHAは`d40bf3657b806449c0abc5b2bc18bb53cba397e2`である。run [31081222649](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/31081222649)では品質gate、exact `READY` Preview探索、alias直前のdevelop先端再確認まで成功したが、list JSONのdeployment ID省略を共通actionが不一致としてalias更新前に安全停止した。listのID条件を外し、同じ候補URLのinspectからIDを取得して後続検証へ引き継ぐ修正をRed backend 1件・frontend 1件からGreenへ進め、直接影響testはbackend 22件・frontend 5件、YAML parseと埋め込みBash構文が通過した。
- SFA-08Dの最終品質gateはbackend 1324 test、Workers 32 test、frontend 685 test、backend/frontend build、lint、Svelte check、format check、YAML parse、埋め込みBash構文、Preview build contractを通した。frontend auditはmoderate以上0件で、破壊的な`--force`を要するupstream由来のlow 3件だけを残した。
- PR #196は`develop`へmerge済みで、merge SHAは`2fa65d4c5857a2a048e56d60062309091af369db`である。run [31082530994](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/31082530994)とfailed job再実行は、品質gate、exact `READY` Preview探索、develop先端再確認まで成功した後、candidate inspectが利用するdeployment detail APIの権限制約で同じ固定段階へ安全停止した。Vercel CLI最新版でも同API依存は残るため、CLI更新では解消しない。
- ownerの包括承認後、Vercel staging projectの固定domain `gensoko-frontend-staging-develop.vercel.app`をPreview環境・`develop` branchへ追加した。設定画面でValid Configurationとdevelop割り当てを確認し、公開URLで最新トップページUIを確認した。project限定token、staging Environment、production project、main、production deploymentは変更していない。
- branch domain移行はRed backend 11件・frontend 2件から開始し、read-only共通action、日常workflow、M2をGreen backend 21件・frontend 2件へ進めた。旧`inspect`、`alias set`、rollback処理を削除し、Vercel CLIの`list`と`alias ls`、固定domain HTTP smokeだけを残した。
- SFA-08E〜SFA-08Iの最終品質gateはbackend 1323 test、Workers 32 test、frontend 685 test、backend/frontend build、lint、Svelte check、format check、YAML parse、埋め込みBash構文、Preview build contractを通した。frontend auditはmoderate以上0件で、破壊的な`--force`を要するupstream由来のlow 3件だけを残した。

## 参考資料

- [Vercel: Ignored Build Step](https://vercel.com/kb/guide/how-do-i-use-the-ignored-build-step-field-on-vercel)
- [Vercel CLI: deploy](https://vercel.com/docs/cli/deploy)
- [Vercel CLI: list / metadata filter](https://vercel.com/docs/cli/list)
- [Vercel CLI: Global Options](https://vercel.com/docs/cli/global-options)
- [Vercel REST API](https://vercel.com/docs/rest-api)
- [GitHub Actions workflow syntax / concurrency](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)

## Issue #174への引き継ぎ

Issue #173完了後に[#174 通常リリースをmain merge後の承認付き自動デプロイへ簡略化する](https://github.com/RitukoIsibasi0222/gensoko/issues/174)へ着手する。

#174では、現在のVercel Git Integrationによるmain frontend自動deployをそのまま完成形とみなさない。production Environment承認、pending migration停止、API deploy、health、frontend deploy、smoke、same SHA evidenceを順序固定するため、Vercel production deployの所有権をGit IntegrationとGitHub Actionsのどちらに置くかを最初に決定する。Issue #173の共通metadata / alias検証を再利用するが、staging Secretとproduction Secretは共用しない。
