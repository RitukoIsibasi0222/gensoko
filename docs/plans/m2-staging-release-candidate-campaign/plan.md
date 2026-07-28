# M2 release候補staging単一campaign 実装計画

> 設計者ロール: シニアSRE / セキュリティエンジニア / フルスタックテストエンジニア

## 概要

M1でPath Aが承認された後、同一のreview済みrelease候補SHAをstagingのAPI・frontendへ固定し、通常のSQLite-backed `PasswordVerifierDurableObject`、認証rate limit、登録から本人退会までの主要導線、最小security・accessibilityを1回のmanual-only synthetic campaignで確認する。

repository実装と外部実行を分離する。最初に純粋ロジック、CLI、Playwright、workflow source contract、runbookをTDDで実装して`develop`へmergeする。その後、M1P-15〜M1P-16を別承認で実施し、同じrelease候補SHAについてPath Aが確定した場合だけ、さらに別のstaging承認でdeploy・request・fixture操作を行う。

2026-07-28のM1 schema v1はPath Bであり、このM2外部実行条件は成立していない。親release計画のM1RはM1 Artifactを再分類せず、M2P-17〜M2P-22も完了扱いにしない。ポートフォリオ版v0.1ではM2を公開後の回帰campaignへ移し、通常password verifier DO、valid login、最小429、主要導線はM6のproduction smokeで確認する。

M2の成功は、required evidenceとmain cleanupがすべて`clear`で、必要になったrecovery cleanupも`clear`であり、安全なArtifactとrun reviewが完了した場合だけとする。`present`または`unknown`が1項目でもあればM2を完了せず、M3へ進まない。

## 非目標

- 本計画作成タスクでは、コード実装、workflow dispatch、staging/production deploy・request、DB migration、fixture、cleanup、rollback、smoke、Environment/Secret/Variable変更を行わない。
- M1P-15〜M1P-16をM2へ吸収せず、M1の別承認作業として維持する。PR #155のmergeだけでM1を完了扱いにしない。
- productionのsame-site `Secure; HttpOnly; SameSite=Strict` refresh Cookieをstagingのcross-site構成で証明しない。M2ではAPI protocolとしてのrefresh rotationだけを確認し、browserのsame-site証拠はM6へ残す。
- `R7PVRB-13`〜`R7PVRB-15`のrollback baseline deploy・drill・recovery、長期soak、WAF、backup複数世代、restore drillをM2 blockerへ戻さない。
- production DB、production provider、production Environmentへ接続しない。production resourceの存在確認もM2 workflowでは行わない。
- Resendの送信メール本文取得のために`full_access` API keyを新設しない。M2は既存の送信専用keyの最小権限を維持する。
- provider raw log、Worker tail、raw response、raw errorを証拠として保存しない。
- 実在User、通常account、予約外の識別子を作成・変更・削除しない。

## 前提条件・依存関係

### M1 gate

- PR [#155](https://github.com/RitukoIsibasi0222/gensoko/pull/155) は2026-07-27にmerge commit `13e005ba8bf2670612d2ba6ce6547bd389fa3acc`として`develop`へmerge済みである。
- M1P-01〜M1P-16は完了している。2026-07-28にrelease候補`7a6979761428759c744ba3bf9c1ed16527c7b33d`のrun [30321699906](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/30321699906)をreviewし、Path Bへ確定した。
- M1証拠のSHAとM2 release候補SHAは一致したが、Vercel production deployment、GitHub production deployment、production backup historyが`present`であり、Path A条件は成立しなかった。
- M1がPath Aとして確定し、M1のsafe Artifact、run conclusion、review記録、変更凍結attestationがすべて有効な場合だけM2外部実行へ進む。
- M1がPath B、`present`、`unknown`、未実施、証拠期限切れ、Artifact欠落、cancel、timeout、schema不一致のいずれかならM2を停止する。親計画でM1Rが成立してもM2を成功扱いにせず、公開後の回帰campaignとして未完了を維持する。dataや履歴をM2のために削除しない。

### staging既存基盤

- Vercelの`develop` Preview、Cloudflare staging Worker、`RateLimitCounter`、Hyperdrive、Supabase staging DB、Resend staging送信設定の既存実績を再利用する。ただし過去の成功runは別SHAのためM2合格証拠には再利用しない。
- `backend/wrangler.jsonc`には通常staging entrypoint、`RATE_LIMIT_COUNTER`、`PASSWORD_VERIFIER`、`v1`・`v2` migrationが定義済みである。
- `PasswordVerifierDurableObject`のrepository実装とrollback baseline bundleは実装済みである。M2では通常bundleだけをdeployし、rollback baseline bundleをdeployしない。
- staging DB migrationはM2開始時点でrelease候補SHAのmigration checksumと一致していなければならない。pending migrationがある場合、campaign内で暗黙適用せず、`.github/workflows/staging-database.yml`を別承認で実行してからM2を最初からやり直す。

### 実行上の不変条件

- `workflow_dispatch`、`develop`、exact 40文字lowercase SHA、GitHub `staging` Environment、required reviewer、共通concurrencyを必須とする。
- campaign開始から証拠review完了まで、対象SHA、staging deployment、DB schema、Environment/Secret/Variable、binding、reserved fixture、frontend/API URL mappingを凍結する。
- repository実装PR、M1実行、M2 staging preflight/deploy、M2 request campaign、証拠reviewは別の承認境界とする。
- 本計画でURLやresource IDの実値は正本化しない。workflowは既存のstaging専用Variable/Secretと固定origin guardを値非表示で照合する。

## 公式仕様の再確認（2026-07-27）

- [Cloudflare Durable Object migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/) — `new_sqlite_classes`で作成したclassはSQLite-backedであり、storage backendは後から変更できない。M2は既存`v2`を再利用し、新しいmigrationを作らない。
- [Cloudflare Wrangler Workers commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/) / [Versions & Deployments](https://developers.cloudflare.com/workers/versions-and-deployments/) — `wrangler deploy`はversion作成と100% deployを行う。dry-runと実deployを区別し、実deployは別承認jobだけで行う。
- [Vercel Git deployments](https://vercel.com/docs/git) / [Environments](https://vercel.com/docs/deployments/environments) — commit SHAを指定したtargeted deploymentとcommit-specific URLを利用できる。M2はbranch aliasの参照先とprovider metadataのcommit SHAを前後で再照合する。
- [Vercel Environment Variables](https://vercel.com/docs/environment-variables) — Environment変更は既存deploymentへ遡及しない。値を変更した場合は証拠を失効し、新しいdeploymentから再実行する。
- [GitHub deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments) — Environment Secretはapproval通過後だけjobへ渡される。staging jobへrequired reviewerとself-review禁止を要求する。
- [GitHub concurrency](https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency) — pending run取消の挙動を踏まえ、同一group、`cancel-in-progress: false`、実行前の最新状態再確認を組み合わせる。
- [GitHub workflow artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data) — job間共有と完了後reviewにはArtifactを使える。M2は1個のexact allowlist JSONだけを短期保持する。
- [GitHub REST pagination](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api) — `Link` headerまたはendpoint固有cursorを最後まで辿れない場合、部分結果を`clear`にしない。
- [GitHub Actions secrets](https://docs.github.com/en/actions/concepts/security/secrets) — 自動maskは変換値を完全には覆わないため、maskだけに依存せず固定summaryとraw body破棄を使う。
- [Resend Send Email](https://resend.com/docs/api-reference/emails/send-email) — staging appは既存の送信専用keyで送信APIの成功だけを利用する。
- [Resend Retrieve Sent Email](https://resend.com/docs/api-reference/emails/retrieve-email) / [API key permissions](https://resend.com/docs/api-reference/api-keys/create-api-key) — 送信メール取得は`full_access`を必要とするため、M2の最小権限境界に採用しない。
- [Resend pagination](https://resend.com/docs/api-reference/pagination) — provider履歴取得を将来追加する場合はcursor完走が必要だが、M2では履歴取得自体を行わない。
- [Supabase database connections](https://supabase.com/docs/guides/database/connecting-to-postgres) — runtimeのtransaction poolerとmigration向け接続を混同せず、既存project ref validatorでstaging targetだけを許可する。

## 既存の実装（公開インターフェース）

### Password verifier / Workers

**`backend/src/lib/password-verifier.ts`**

- `PasswordVerifier.verifyPassword(input): Promise<boolean>` — auth serviceが依存するruntime非依存port。

**`backend/src/lib/durable-object-password-verifier.ts`**

- `createDurableObjectPasswordVerifier(namespace): PasswordVerifier` — account単位のDO stubへRPCし、binding/RPC/result不正を固定503へ収束するadapter。

**`backend/src/cloudflare/password-verifier.ts`**

- `PasswordVerifierDurableObject.verifyPassword(input): Promise<boolean>` — DO isolate内でcost 12 hashを比較し、password・hash・result・account識別子を保存しないRPC。

**`backend/src/worker.ts`**

- `RateLimitCounter` / `PasswordVerifierDurableObject` export — 通常staging bundleのDO class export。
- `fetch(request, environment, executionContext): Promise<Response>` — 型付きadapterを注入するCloudflare entrypoint。

**`backend/src/worker-staging-rollback-baseline.ts`**

- rollback baseline entrypoint — main Worker内bcryptへ戻すpost-v2 baseline。M2ではbuild contractだけ参照し、deployしない。

### Rate limit evidence

**`backend/src/jobs/stagingRateLimitEvidence.ts`**

- `validateStagingRateLimitEvidenceEnvironment(environment)` — case、staging origin、credential、request timeoutを検証する。
- `runStagingRateLimitEvidence(options): Promise<StagingRateLimitEvidenceSummary>` — authではvalid loginを10回許可し、11回目の429と安全なheader contractを確認する。
- `StagingRateLimitEvidenceExecutionError` — raw responseを保持せず、固定failure stage・kind・response classだけを伝える。

**`backend/src/config/rate-limit.ts`**

- `RATE_LIMIT_POLICIES.AUTH_IP` — register/login/forgot-passwordで共有する10回/600秒の固定window。
- `RATE_LIMIT_POLICIES.AUTH_EMAIL` — 操作scopeごとのemail policy。

### Synthetic fixture / DB target

**`backend/src/jobs/stagingSyntheticAdminE2eFixtures.ts`**

- `validateStagingSyntheticAdminE2eFixtureEnvironment(environment)` — staging flag、DB target、ephemeral credentialを検証する。
- `prepareStagingSyntheticAdminE2eFixtures(options)` — 固定Admin/Userが完全一致する場合だけtransactionで置換する。
- `removeStagingSyntheticAdminE2eFixtures(options)` — 完全一致した予約fixtureだけを削除する。

**`backend/src/lib/staging-database-target.ts`**

- `validateStagingDatabaseTarget(environment)` — `DATABASE_URL`とstaging project refの一致を値非表示で検証する。

### Auth / account / game API

**`backend/src/services/auth.service.ts`**

- `register` — bcrypt hash、64文字random tokenのhash保存、確認メール送信、送信失敗時の補償削除を行う。
- `login` — `PasswordVerifier`経由で照合し、access tokenとrefresh Cookieを発行する。
- `refresh` — refresh tokenをrotateし、旧tokenを失効する。

**`backend/src/services/game.service.ts` / `backend/src/services/user.service.ts`**

- question set取得、回答配列からのsession保存、本人物理削除、旧credential拒否の既存業務契約。

### Frontend / Playwright

**`frontend/src/lib/stores/auth.svelte.ts`**

- access tokenは`sessionStorage`、refresh tokenはHttpOnly Cookie、API errorは日本語messageを維持するauth store。

**`frontend/playwright.config.ts` / `frontend/e2e/admin-force-delete.spec.ts`**

- 1 worker、retry 0、trace/screenshot/video無効、origin限定Vercel bypass、SPA navigation、旧credential 401、browser state clearの既存pattern。

### M1 safe evidence

**`backend/src/jobs/productionInitialStateEvidence.ts` / `inspectProductionInitialState.ts`**

- `clear | present | unknown`、exact allowlist marker、Path A/B再計算、provider pagination、共有時間予算、schema検証、raw error非出力のpattern。

## API仕様（関連エンドポイント）

### エラーレスポンス共通形式

```json
{ "error": "日本語の公開メッセージ" }
```

入力不正では既存契約に従って安全な`details`を持つ場合がある。M2 runnerは`response.ok`をJSON parse前に確認し、error bodyをtry-catchでparseする。non-JSON、schema不一致、stack、DB/provider詳細は証拠へ転記せず固定failure classへ収束する。

### エンドポイント一覧

| メソッド | パス                        | 認証           | M2 request                                | M2で確認するresponse                            |
| -------- | --------------------------- | -------------- | ----------------------------------------- | ----------------------------------------------- |
| GET      | `/health`                   | 不要           | なし                                      | 200、staging target、security/CORS              |
| POST     | `/api/v1/auth/register`     | 不要           | username、email、password                 | 201、mail provider受理。409/429/500はsafe error |
| POST     | `/api/v1/auth/verify-email` | 不要           | 64文字ephemeral token                     | 200。replayは400系safe error                    |
| POST     | `/api/v1/auth/login`        | 不要           | email、password                           | 1〜10回200、11回目429、verifier異常503          |
| POST     | `/api/v1/auth/refresh`      | refresh Cookie | bodyなし                                  | 200 rotation、旧refresh tokenは401              |
| GET      | `/api/v1/game/questions`    | access token   | query contract                            | 200、公開question/choices                       |
| POST     | `/api/v1/game/sessions`     | access token   | questionSetId、mode、answers、durationSec | 201、採点済みresult保存                         |
| GET      | `/api/v1/game/sessions`     | access token   | pagination query                          | 200、本人history                                |
| GET      | `/api/v1/game/sessions/:id` | access token   | なし                                      | 200、本人result                                 |
| DELETE   | `/api/v1/users/me`          | access token   | password、確認                            | 200、refresh Cookie削除、所有data物理削除       |

path parameterやresponseのIDはrunner memory内の次requestへだけ渡し、console、Step Summary、Artifactへ残さない。本人退会後は削除前access token、削除前refresh token、同じlogin credentialを個別に再送し、それぞれ401を確認する。

## 現状の実装・証拠・未完了事項

| 項目                       | 現状                                               | M2での扱い                                                                  |
| -------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| PR #155                    | `develop`へmerge済み                               | repository基盤のみ完了。M1完了証拠ではない                                  |
| M1P-15〜M1P-16             | 同じSHAで実行・review済み、Path B                  | Path A不成立のためM2外部実行を停止し、v0.1では公開後へ移管                  |
| Password verifier DO       | repository実装、binding/migration contract完了     | 同じrelease候補SHAの通常bundleをstagingへdeployして再確認                   |
| R7PV-17                    | 未完了                                             | normal deploy・valid login・11回目429をM2へ統合。rollback drillは移管しない |
| R7PVRB-13〜15              | 未実施                                             | 公開後task。M2 blockerにしない                                              |
| staging auth rate evidence | 旧bundleでmain Worker `exceededCpu`、11回目429未達 | M2で10回200、11回目429、resetまで取り直す                                   |
| staging登録〜本人退会      | 過去SHAでsynthetic成功実績あり                     | 実装patternだけ再利用し、M2 SHAで再実行                                     |
| staging refresh            | cross-siteのためproduction same-siteを証明不能     | server-side request contextでprotocol rotationだけ確認                      |
| keyboard / 320px           | production削除spec等に部分patternあり              | staging用の最小Playwright checkを追加                                       |
| M2統合workflow / Artifact  | 存在しない                                         | manual-only single campaignとsafe JSONを新規実装                            |

### 既存workflowの再利用と不足

| workflow                                        | 再利用する契約                                                                      | そのまま使えない理由 / M2追加範囲                                                       |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `staging-synthetic-admin-e2e.yml`               | staging DB guard、origin限定bypass、mask、main/recovery cleanup、Playwright安全設定 | Admin強制削除専用、review済みSHA gate・deploy・Artifact・register/verify/rate resetなし |
| `staging-rate-limit-evidence.yml`               | 10回許可・11回目429 runner、10秒timeout、三重gate、固定summary                      | 1 run 1 case、resetなし、他auth requestが同じwindowを消費、deploy・UI・Artifactなし     |
| `staging-account-data-deletion.yml`             | manual-only、DB target guard                                                        | legacy cleanup専用。M2ではdispatchしない                                                |
| `staging-account-deletion-cleanup-fixtures.yml` | exact fixture collision時停止                                                       | legacy fixture専用。M2 reserved identityへ流用しない                                    |
| `staging-database.yml`                          | target validator、migration checksum、separate apply boundary                       | campaign内でmigrationを暗黙適用しない。pending時だけ別承認run                           |
| `backend-pr-quality.yml`                        | backend test、Workers test/build、lint、format、Prisma validate                     | repository品質gateとしてそのまま利用                                                    |
| `frontend-pr-quality.yml`                       | frontend test、lint、check、format、Preview build                                   | Playwright source/config contractと`--list`をM2対象testへ追加                           |

## R7PV-17との責務整理

1. R7PV-01〜R7PV-16はnormal DO repository実装、fail-closed 503、rollback bundle、config/source contractまでを担当し、完了済みとする。
2. R7PV-17に残っていた通常DOのstaging deploy、valid login、main Worker `exceededCpu`非再発、auth 11回目429、cleanupは、M2を実行する場合にこのcampaignが担当する。v0.1公開前はM6のproduction smokeで最小範囲を確認する。
3. R7PV-17に混在していたpost-v2 rollback証拠は`R7PVRB-13`〜`R7PVRB-15`へ一本化し、公開後へ維持する。
4. M2 evidenceが`clear`になった時点でR7PV-17のM2担当部分を完了として同期する。M2失敗時はR7PV-17も未完了のままにする。
5. M2はWAF、production namespace、production deploy、長期quota観測、rollback drillを完了扱いにしない。

## 対象ファイル一覧（実装時）

| ファイル                                                           | 変更種別 | 内容                                                                               |
| ------------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------- |
| `.github/workflows/staging-release-candidate-campaign.yml`         | 新規     | M1 gate、同一SHA deploy、single campaign、main/recovery cleanup、safe Artifact     |
| `backend/package.json`                                             | 修正     | M2 fixture・campaign・evidence CLI script                                          |
| `backend/src/jobs/stagingReleaseCandidateFixtures.ts`              | 新規     | reserved identity preflight、verification token hash arm、main/recovery cleanup    |
| `backend/src/jobs/stagingReleaseCandidateFixtures.test.ts`         | 新規     | exact match、Serializable transaction、collision、cleanupのunit test               |
| `backend/src/jobs/stagingReleaseCandidateFixtures.cli.ts`          | 新規     | staging DB guard付きCLI、固定safe output                                           |
| `backend/src/jobs/stagingReleaseCandidateFixtures.cli.test.ts`     | 新規     | env、exit code、秘密非出力CLI test                                                 |
| `backend/src/jobs/stagingReleaseCandidateCampaign.ts`              | 新規     | register、verify、login、refresh、rate limit、game、旧credential拒否のorchestrator |
| `backend/src/jobs/stagingReleaseCandidateCampaign.test.ts`         | 新規     | HTTP契約、timeout、rate reset、cross-site境界のunit test                           |
| `backend/src/jobs/stagingReleaseCandidateCampaign.cli.ts`          | 新規     | masked credentialをenvだけで受けるcampaign CLI                                     |
| `backend/src/jobs/stagingReleaseCandidateCampaign.cli.test.ts`     | 新規     | safe marker、固定error、raw非出力、cancel相当test                                  |
| `backend/src/jobs/stagingReleaseCandidateHealth.ts` / tests        | 新規     | API deploy後health・CORS・security header gateとsafe CLI                           |
| `backend/src/jobs/stagingReleaseCandidateEvidence.ts`              | 新規     | `clear/present/unknown`集約とexact allowlist Artifact schema                       |
| `backend/src/jobs/stagingReleaseCandidateEvidence.test.ts`         | 新規     | fail-closed再計算、schema/version、allowlist test                                  |
| `backend/src/jobs/stagingReleaseCandidateCampaignWorkflow.test.ts` | 新規     | manual-only、SHA、Environment、順序、timeout、cleanup、Artifact source contract    |
| `backend/src/jobs/stagingRateLimitEvidence.ts` / test              | 修正     | auth runner・response contractを重複なしでM2から再利用                             |
| `frontend/e2e/staging-release-candidate.spec.ts`                   | 新規     | keyboard、320px、game表示、本人退会、browser state、safe failure evidence          |
| `frontend/playwright.staging-release-candidate.config.ts`          | 新規     | 1 worker、retry 0、trace/screenshot/video無効、固定staging origin guard            |
| `frontend/e2e/staging-release-candidate-config.test.ts`            | 新規     | production URL拒否、cross-site明示、secret/output無効化contract                    |
| `frontend/e2e/staging-release-candidate-source.test.ts`            | 新規     | keyboard、320px、same-site誤証明禁止、cleanup handoffのsource contract             |
| `docs/11_deployment.md`                                            | 修正     | M2 preflight、deploy順、campaign、cleanup、停止・復旧runbook                       |
| `docs/05_progress.md`                                              | 修正     | repository実装中・外部実行・M2完了の段階状態                                       |
| `docs/plans/portfolio-release-v0-1-minimal/plan.md`                | 修正     | M2 run URL、SHA、判定、M3 handoff                                                  |
| `docs/plans/r7-password-verification-free-worker/plan.md`          | 修正     | R7PV-17のM2担当結果とrollback分離                                                  |
| `docs/plans/r7-rate-limit-environment-gates/plan.md`               | 修正     | auth 429/reset evidenceと未完了範囲                                                |
| `docs/plans/m2-staging-release-candidate-campaign/plan.md`         | 修正     | task、実変更、TDD、品質gate、run evidenceを実態へ同期                              |

DB schemaやmigration fileの変更は予定しない。必要性が判明した場合はM2のscope変更であるため実装を停止し、計画を再reviewする。

## Environment・credential・resource境界

| 種別                  | 許可する境界                                                                                        | 禁止 / fail-closed条件                                           |
| --------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| GitHub Environment    | `staging`だけ。required reviewer、self-review禁止、`develop`だけ                                    | `production`、repository Secretへの昇格、approval前のSecret参照  |
| GitHub token          | `contents: read`、M1 run/Artifact照合に必要な`actions: read`、staging deployment metadataの最小権限 | write permission、Environment変更、workflow再dispatch            |
| Cloudflare credential | staging対象scriptのdeploy/readに限定した専用credential                                              | production account/script、広いaccount write、raw API output     |
| Vercel credential     | staging frontend projectのtargeted deploy/readに限定                                                | production deployment、他project、branch scope変更               |
| Supabase              | staging project refと一致する`DATABASE_URL`のみ                                                     | production project ref、target不明、URL値の出力                  |
| Resend app key        | 既存staging送信専用keyをWorkerだけが利用                                                            | `full_access` key新設、workflowから送信履歴/本文取得             |
| frontend origin       | staging branch aliasをAPI CORS正本とし、candidate SHA metadataを照合                                | commit URLをCORSへ追加、wildcard、production origin              |
| API origin            | staging Worker originだけ                                                                           | production Worker、previewごとの任意API URL                      |
| fixture               | M2専用の固定username/emailを予約し、完全一致したrowだけ                                             | 実値のlog/Artifact出力、部分一致、通常User、識別子衝突時の上書き |

Secretはjob全体の`env`へ置かず、使用stepだけへ渡す。ephemeral password・verification tokenは`randomBytes`で生成し、生成直後にmaskし、CLI引数・`GITHUB_ENV`・Artifactへ渡さない。固定fixture識別子もStep SummaryとArtifactへ出さない。

Environment/Secret/Variableが不足している場合は`unknown`で停止する。本計画のrepository PR内で作成・変更せず、値非表示の差分と最小権限をreviewした別承認作業にする。

## release候補SHA固定と証拠失効条件

### SHA固定

1. M2 repository実装を含む`develop` commitをsecurity/release reviewerがreviewし、40文字lowercase SHAを固定する。
2. M1P-15 workflowの`reviewed_sha`、M1 Artifact内SHA、M1P-16 Path A記録、M2 workflowの`reviewed_sha`、`github.sha`、checkout後`HEAD`を完全一致させる。
3. Cloudflareはそのcheckoutから通常entrypointをbundle/deployし、安全なdeployment annotationにcandidate SHAだけを付与する。Wrangler raw outputはrunner tempへ捨て、固定statusだけを残す。
4. Vercelはcandidate SHAのtargeted staging deploymentを作成し、branch aliasの参照先metadataがcandidate SHAであることを値非表示で確認する。
5. API deploy後、frontend deploy後、request開始直前、campaign終了直後に両providerのactive SHAを再照合する。
6. DB migration checksumとstaging project refをrequest前後で再照合する。

### 証拠失効条件

以下のいずれかで既存runをM2成功に使わず、cleanup後に最初から再実行する。

- candidate SHA、workflow source、Wrangler config、Playwright config、evidence schema、runbookの変更。
- M1 Artifactの欠落・期限切れ・schema不一致、M1 Pathの変更、M1とM2のSHA不一致。
- staging Environment/Secret/Variable、Cloudflare binding/migration、Vercel branch alias/env、Supabase target、Resend allowlistの変更。
- campaign中の別deploy、`develop` head移動に伴うbranch alias更新、active deployment SHAの前後不一致。
- DB migration checksum変更、reserved fixture衝突、campaign外の同一fixture操作。
- timeout、cancel、runner loss、pagination未完走、provider 429、schema不一致、Artifact upload失敗、Artifact欠落。
- main cleanupが`clear`でない、またはmain非成功時のrecovery cleanupが`clear`でない。
- raw response/error、Secret、PII、resource IDがlog・Summary・Artifactに残った疑い。
- campaign開始からevidence review完了までのstaging変更凍結をattestできない。

M2完了後にcandidate SHAを変更した場合はM2を再実行し、古いrun URLをM3へ渡さない。

## 設計上の決定事項

1. **既存workflowを連続dispatchするか、M2専用workflowへ統合するか**
   - 選択: M2専用のmanual-only workflowを新規作成する。
   - 根拠: 既存rate limit workflowは1 case/run、既存Playwright workflowはAdmin削除専用で、同一SHA、単一fixture、reset、Artifact、M1 gateを原子的に扱えない。

2. **メール認証tokenを実mail本文から取得するか**
   - 選択: public register成功後、完全一致した未認証synthetic UserだけをSerializable transactionで再確認し、workflow生成のephemeral token hashへ差し替える。
   - 根拠: DBには本来token hashだけがあり、Resend本文取得には送信専用より広い`full_access` keyが必要になる。M2はregisterのprovider受理とverify API/UIを確認し、実inbox配送の再証明は非目標とする。

3. **staging cross-siteでrefreshをどう確認するか**
   - 選択: backend campaign runnerのisolated cookie jarでSet-Cookieをmemoryだけに保持し、`POST /auth/refresh`成功、rotation、旧refresh拒否を確認する。
   - 根拠: staging browserではproduction same-site Cookie挙動を証明できない。protocol evidenceとbrowser evidenceを混同しない。

4. **Password verifier DO利用をどう安全に証明するか**
   - 選択: candidate SHAの通常entrypoint・binding・v2 migration・local bcrypt非混入contract、active deployment SHA、valid login 200を組み合わせたcomposite evidenceとする。
   - 根拠: raw Worker logやDO payloadを保存せずに、main Workerがlocal bcryptへfallbackできない実装とlive成功を同時に確認できる。これはruntime pathの合成証拠であり、provider内部traceではないことを明記する。

5. **`exceededCpu`非再発をどう判定するか**
   - 選択: valid loginの全許可requestが200で、503 safe classifierが一度も発火しないことを`clear`とする。503、timeout、network failureは`present`または`unknown`で直ちに停止する。
   - 根拠: 既存障害はmain Worker `exceededCpu`により503となった。raw log取得をM2へ追加しない。

6. **auth rate limitを他のauth requestと同じcampaignでどう測るか**
   - 選択: register・初回login後、campaign開始時刻とpolicy windowから最大610秒のbounded waitを行い、clean windowでvalid login 1〜10を200、11回目を429として測る。その`Retry-After`残時間を最大610秒待ち、次の1回が200であることを確認する。
   - 根拠: `AUTH_IP`はregister/login/forgot-passwordで共有され、事前requestを無視すると許可回数がずれる。clockを改変せず実policyを確認する。

7. **cleanupを成功判定から分離するか**
   - 選択: main jobの`always()` cleanupと、main job非成功・cancel相当時に独立jobで動くrecovery cleanupを持つ。最終判定はcleanup結果を含めて再構成する。
   - 根拠: test成功後のcleanup失敗を成功扱いにせず、main runner喪失時も別runnerで再試行できる。

8. **Artifactへ何を残すか**
   - 選択: exact schemaのstatus・時刻・candidate SHA・安全な定数だけを1 JSONで残す。Playwright trace、screenshot、video、HTML、raw logsは保存しない。
   - 根拠: M3 handoffに必要な再現性と秘密非出力を両立する。

## 公開インターフェース案

```typescript
export type M2EvidenceStatus = "clear" | "present" | "unknown";

export type M2CleanupStatus = M2EvidenceStatus | "not-required";

export type M2StagingReleaseCandidateEvidence = Readonly<{
  schemaVersion: 1;
  releaseCandidateSha: string;
  startedAt: string;
  completedAt: string;
  m1Gate: M2EvidenceStatus;
  deployment: Readonly<{
    databaseTarget: M2EvidenceStatus;
    apiCandidate: M2EvidenceStatus;
    frontendCandidate: M2EvidenceStatus;
    passwordVerifierBinding: M2EvidenceStatus;
  }>;
  campaign: Readonly<{
    registration: M2EvidenceStatus;
    emailVerification: M2EvidenceStatus;
    validLogin: M2EvidenceStatus;
    refreshProtocol: M2EvidenceStatus;
    mainWorkerCpu: M2EvidenceStatus;
    authAllowedTen: M2EvidenceStatus;
    authEleventh429: M2EvidenceStatus;
    authRetryAfter: M2EvidenceStatus;
    authReset: M2EvidenceStatus;
    game: M2EvidenceStatus;
    keyboard: M2EvidenceStatus;
    viewport320: M2EvidenceStatus;
    selfDeletion: M2EvidenceStatus;
    oldCredentialRejection: M2EvidenceStatus;
    headersCorsSafeErrors: M2EvidenceStatus;
  }>;
  cleanup: Readonly<{
    main: M2CleanupStatus;
    recovery: M2CleanupStatus;
    residue: M2EvidenceStatus;
  }>;
  decision: M2EvidenceStatus;
}>;

export function createM2Evidence(
  input: unknown,
): M2StagingReleaseCandidateEvidence;

export function validateM2StagingFixtureEnvironment(
  environment: NodeJS.ProcessEnv,
): ValidatedM2StagingFixtureEnvironment;

export async function preflightM2StagingFixture(
  options: M2StagingFixtureOptions,
): Promise<void>;

export async function armM2EmailVerification(
  options: M2ArmVerificationOptions,
): Promise<void>;

export async function removeM2StagingFixture(
  options: M2StagingFixtureOptions,
): Promise<void>;

export async function runM2StagingReleaseCandidateCampaign(
  options: RunM2StagingReleaseCandidateCampaignOptions,
): Promise<M2CampaignSafeSummary>;
```

CLIはcredential、token、email、username、URLを引数に取らず、検証済みenvironmentからだけ受け取る。public return/errorは固定enumとstatusだけにし、raw response/errorを保持しない。

## synthetic fixtureの完全一致preflight

1. M2専用username/emailをコード側定数として予約するが、値はlog・Summary・Artifact・planへ出さない。
2. DB接続前にstaging flag、project ref、URL scheme/host、transaction接続用途を検証する。
3. `email OR username`で候補rowを取得し、0件だけをregistration開始可とする。1件でもあれば削除せず`present`で停止する。
4. public register後の`arm-verification`は、email、username、role、`emailVerified=false`、`isActive=true`、`deletedAt=null`、期待する関連row集合が完全一致する1件だけを対象とする。
5. `arm-verification`はPrismaのSerializable transactionでrowを再取得し、既存EmailVerificationを削除してephemeral tokenのSHA-256 hashを1件作成する。競合・serialization failureは自動上書きせず`unknown`とする。
6. password hash、token hash、User ID、email、usernameを出力しない。tokenは64文字hex、passwordは既存policyとbcrypt 72 byte境界を満たす。
7. cleanupは同じ完全一致guardでUserを物理削除し、cascade対象が0件であることをaggregate statusだけで確認する。
8. AuditLogは既存retention契約に従う。synthetic actor/target識別子やPIIが残らないことを確認し、保持対象logをfixture residueと誤分類しない。契約を満たさないlogがあれば`present`とする。

## 単一campaignの時系列

```text
repository implementation merged
  -> M1P-15/M1P-16 (separate production read-only approval)
  -> M1 Path A + same SHA verified
  -> staging Environment approval
  -> preflight / freeze / exact fixture absence
  -> deploy normal API Worker + PasswordVerifier DO
  -> deploy/alias frontend candidate
  -> recheck API/frontend/DB SHA and bindings
  -> register synthetic user
  -> atomically arm ephemeral verification token hash
  -> verify email
  -> valid login + protocol refresh rotation
  -> wait until clean AUTH_IP window
  -> valid login 1..10 / 11th 429 / Retry-After
  -> bounded wait / reset login 200
  -> game flow
  -> keyboard + 320px + self deletion in Playwright
  -> old access/refresh/login rejection
  -> final SHA/schema/security recheck
  -> main cleanup + residue check
  -> independent recovery cleanup when required
  -> final safe evidence reconstruction and Artifact upload
  -> human evidence review
```

### Prepare責務

- M1 Path A、same SHA、run conclusion、Artifact schema、review記録をread-onlyで照合する。
- branch/SHA/approval confirmation、staging Environment、credential presence、resource/binding/Secret/DB target/frontend/API mappingを値非表示で検証する。
- external APIのpaginationを完走し、page上限・cursor loop・429・timeout・schema不一致を`unknown`にする。
- migration checksum、reserved fixture不存在、candidate freezeを確認する。
- ephemeral passwordとverification tokenを生成・maskする。fixtureは作成しない。

### Deploy責務

- pending migrationがないことを確認し、通常API Workerをcandidate SHAから100% stagingへdeployする。
- `PASSWORD_VERIFIER` binding、`v2` SQLite-backed class、通常entrypoint、staging runtime configを値非表示で再確認する。
- API health、CORS origin、safe headersが正常になった後だけfrontendをcandidate SHAでtargeted deployし、staging branch aliasを切り替える。
- frontend metadata、branch alias、API metadataがsame SHAでない場合はrequestを送らず停止する。
- deploy toolのstdout/stderrはrunner tempへ隔離し、成功時も失敗時も削除する。workflow logには固定statusだけを残す。

### Test責務

- public register、fixture arm、verify、login、refresh protocol、rate limit、game、Playwright、本人退会、旧credential拒否を順番どおり1 User・1 runで実施する。
- 各requestを10秒でabortし、response.okの前後、JSON schema、Content-Type、security header、CORSを明示検証する。
- response bodyはmemoryでZod検証した直後に必要なboolean/enumへ縮約し、raw値をerrorやmarkerへ入れない。
- Playwrightは1 worker、retry 0、trace/screenshot/video無効で、keyboardだけの主要操作と320px viewportの横overflow・主要control可視性を確認する。

### Main cleanup責務

- `always()`で実行し、test成否に関係なく完全一致reserved fixtureを物理削除する。
- Userが本人退会済みで0件でも成功とし、部分一致row、予期しない関連row、DB不明は削除せず`present`/`unknown`にする。
- cleanup後のUser、refresh、email verification、password reset、game所有rowをaggregate statusで確認する。
- main cleanup失敗時はtestが全clearでもmain jobを成功にしない。

### Recovery cleanup責務

- main jobがsuccess以外、cancel相当、timeout、runner loss、main cleanup非clearの場合に独立job・別runnerで起動する。
- main jobのephemeral credentialやoutputへ依存せず、固定reserved identityとstaging DB guardだけで完全一致cleanupを行う。
- recoveryも5分timeout、retry 0とし、失敗・不明を成功に変換しない。
- recoveryがfixtureを除去しても元campaignのtest evidenceは成功へ戻さず、M2全体を`unknown`のまま再実行対象とする。

## auth rate limit・refresh・gameの詳細順序

1. register 201後、初回login 200とrefresh Cookie属性のpresenceだけを確認する。Cookie値はmemory外へ出さない。
2. isolated cookie jarでrefresh 200とtoken rotationを確認し、旧refresh tokenの明示再送が401であることを確認する。
3. register/initial loginが消費した`AUTH_IP` windowの開始時刻から600秒経過するまで待つ。monotonic clockで最大610秒を超えたら`unknown`。
4. 既存`runStagingRateLimitEvidence`のauth contractを再利用し、同じ正しいcredentialで1〜10回目が200、11回目が429であることを確認する。
5. 429はJSON、`Retry-After`整数、1〜600秒、rate limit header、CORS/security headerを確認する。値そのものはArtifactへ残さない。
6. `Retry-After`とclock skew許容分だけ最大610秒待ち、次のlogin 1回が200ならreset `clear`とする。
7. question set取得、公開choiceだけから回答配列を作成、session一括保存、result/historyの最小契約を確認する。公開question/choice以外の内部値を出力しない。
8. Playwrightでstaging UIへloginし、keyboard操作、320px、game結果表示、本人退会を確認する。
9. 削除前access token、削除前refresh token、同じlogin credentialをそれぞれ再送し、すべて401であることを確認する。

`AUTH_IP` 2回のwindow待機によりcampaignは最大約20分待つ。job timeoutは45分、test phaseは30分、deploy phaseは15分、cleanupは各5分とし、job timeoutより先にsafe marker再構成へ到達できる余白を確保する。

## staging cross-site制約

- staging frontendとAPIは別siteであり、productionで予定するsame-site構成ではない。
- M2のrefresh `clear`はserver-side isolated cookie jarによるAPI protocol、rotation、旧token拒否だけを意味する。
- browser reload後のsilent refresh、Strict Cookie送信、production registrable domain、production CORSはM6でのみ合格判定する。
- M2 Artifactのkeyは`refreshProtocol`とし、`sameSiteRefresh`、`browserRefresh`等の誤解を招く名称を禁止する。
- staging cross-siteでbrowser refreshが失敗しても、production same-site設計の失敗証拠とはしない。ただしAPI protocol自体が失敗した場合はM2 `present`とする。

## headers・CORS・safe error・秘密非出力の最小確認

- health、register、verify、login、refresh、rate limited、game、delete、旧credential拒否の代表responseで既存security header contractを確認する。
- CORSはstaging frontend originだけを許可し、`Access-Control-Allow-Origin: *`、production origin、任意preview originを拒否する。
- error JSONは日本語の公開messageと許可されたdetail schemaだけを確認し、stack、DB error、internal path、provider raw errorがないことを確かめる。
- `Set-Cookie`は存在、属性、削除契約だけをbooleanへ縮約し、値をlogへ出さない。
- Authorization、access/refresh token、password、verification token、email、username、User ID、IP、DB URL、provider token、resource/deployment ID、raw URL、raw body/header/errorをconsole、Step Summary、Artifactへ出さない。
- Playwrightのtrace、screenshot、video、HTML reportを無効にする。失敗時も固定failure stageだけを出す。

## clear / present / unknownのfail-closed判定

| status         | 意味                                                      | 例                                                               |
| -------------- | --------------------------------------------------------- | ---------------------------------------------------------------- |
| `clear`        | required contractを完全に確認し、禁止状態を観測しなかった | exact SHA、10回200、11回目429、cleanup residue 0                 |
| `present`      | 禁止状態または契約違反を確実に観測した                    | fixture衝突、503再発、wrong status/header、residueあり           |
| `unknown`      | 不在・成功を完全に証明できない                            | timeout、cancel、429でpagination中断、schema不一致、Artifact欠落 |
| `not-required` | main cleanupがclearでrecoveryを起動する必要がなかった     | recoveryだけに限定                                               |

`decision=clear`は、M1 gate、deployment、全campaign項目、main cleanup、residueがすべて`clear`で、recoveryが`clear`または`not-required`の場合だけ純粋関数で算出する。inputの`decision`は信用せず再計算する。

`present`と`unknown`の優先順位で情報を隠さない。禁止状態が確実なら`present`、判定不能なら`unknown`とし、どちらもworkflowを非成功にする。cleanupが後で成功してもtestの`present`/`unknown`を`clear`へ変更しない。

## Step Summary・Artifactの安全なallowlist

### 許可するfield

- `schemaVersion`
- `releaseCandidateSha`
- `startedAt` / `completedAt`（UTC ISO 8601、ミリ秒付き）
- M1、deployment、campaign、cleanupの固定keyと`clear | present | unknown | not-required`
- `authAllowedRequests: 10`
- `authLimitedRequest: 11`
- `decision`
- fixed workflow nameとevidence version

### 許可しないfield

- email、username、password、hash、User ID、IP、token、Cookie、Authorization。
- account/project/resource/deployment/Artifact ID、provider URL、DB URL、Secret/Variable値。
- approver名、change record値、provider response、HTTP body/header値、raw error、stack、internal path。
- Playwright attachment、trace、screenshot、video、HTML、console dump。

candidate SHAはM2/M3を結ぶ必須の公開code referenceとして例外的に許可する。GitHub run URLはArtifactへ入れず、人手review後に`docs/05_progress.md`と親計画のM3引継ぎ欄へ記録する。

Artifactは固定名、固定1 file、`if-no-files-found: error`、`retention-days: 7`、上書きなしとする。upload前にZod exact schemaで再parseし、余分なkey、symbolic link、複数fileを拒否する。7日以内にM2 reviewとM3 handoffを完了できずArtifactが期限切れになった場合は`unknown`であり、Step Summaryだけで代替しない。

## timeout・cancel・pagination・rate limit・TOCTOU対策

- 全HTTP requestへ10秒AbortSignal、provider inspection全体へ10分共有予算、page上限、cursor loop検出、response size上限を設ける。
- GitHub/Resend等のpaginationはendpoint契約に従い最後まで取得する。M2ではResend履歴取得を行わない。
- provider 429はbounded `Retry-After`があってもinspection共有予算内だけ待つ。完走できなければ`unknown`。
- auth policy 429のreset確認だけは仕様上のtestとして最大610秒待つ。provider API 429 retryと混同しない。
- workflow concurrencyは既存batch groupと共有し、`cancel-in-progress: false`にする。pending run取消の可能性があるため、job開始時にapproval/SHA/freezeを再確認する。
- exact SHA、active API/frontend SHA、DB checksum、fixture状態をdeploy前、request前、request後に再照合する。
- `develop`が進んでbranch aliasが別SHAへ動いた場合、commit-specific deploymentが残っていてもCORS originの実体が変わるため`unknown`で停止する。
- fixture preflightとtoken armの間はSerializable transactionと完全一致guardを使う。競合時にdelete/retryで押し切らない。
- cancel時にmain `always()`が動かない可能性を前提に、independent recovery jobと後続の手動recovery runbookを持つ。

## 停止・復旧方針

| 条件                             | 即時対応                     | 再開条件                                         |
| -------------------------------- | ---------------------------- | ------------------------------------------------ |
| M1がPath Aでない / 不明          | M2をdispatchしない           | M1の通常gateを完了し、親計画を再承認             |
| SHA・deployment・schema不一致    | request前に停止、変更しない  | 同一SHAへ再deployし最初から実行                  |
| fixture部分一致 / 通常User疑い   | deleteせず`present`          | owner reviewで予約fixtureを安全に解消            |
| verifier binding/migration不明   | loginを送らず`unknown`       | 値非表示preflightを再承認                        |
| login 503 / timeout              | requestを増やさず停止        | fixed原因をrepositoryで修正し新SHAでM1から再実行 |
| 11回目が429でない                | 追加requestを送らず`present` | policy/configをTDD修正し新SHAで再実行            |
| resetが時間内に確認不能          | `unknown`、cleanup           | clock/policy原因review後に新run                  |
| test失敗                         | main cleanupを実行           | cleanup clear後も新runが必要                     |
| main cleanup失敗                 | recovery jobを実行           | recovery clear、原因修正、新run                  |
| recovery失敗 / DB不明            | M2未完了、外部request停止    | 別承認の専用recoveryでclear確認                  |
| Artifact欠落 / unsafe output疑い | runを無効化                  | 出力契約修正、新SHAで再実行                      |
| workflow cancel / timeout        | runを`unknown`               | residue clearと新approval後に再実行              |

APIを旧versionへ自動rollbackしない。M2はstagingだけであり、失敗時は追加requestを止め、candidate deploymentを隔離して原因reviewする。rollback baseline drillは公開後taskのままにする。安全上APIを戻す必要がある場合はM2とは別の緊急承認で行い、その時点でM2証拠を失効する。

## TDD実装順序

### Red

1. fixture exact match、collision、Serializable競合、production target拒否、秘密非出力testを先に作成する。
2. evidence exact schema、余分なkey、`present`/`unknown`集約、cleanup非clear、Artifact欠落のfailure testを作成する。
3. campaign HTTP mockでregister、verify、refresh rotation、10回200、11回目429、Retry-After、reset、game、旧credential拒否のtestを作成する。
4. timeout、cancel相当、non-JSON、wrong schema、503分類、clock skew、610秒上限のtestを作成する。
5. Playwright config/source contractで1 worker、retry 0、attachment無効、keyboard、320px、cross-site明示を失敗確認する。
6. workflow source contractでmanual-only、develop/exact SHA、M1 Path A、staging Environment、prepare/deploy/test/cleanup/recovery順、safe Artifactを失敗確認する。

### Green

1. fixture純粋validatorとPrisma transaction、CLIを最小実装する。
2. evidence builder/CLIを実装し、statusだけをstdoutとrunner temp markerへ出す。
3. 既存`stagingRateLimitEvidence`のauth contractを壊さず再利用し、M2 campaign orchestratorを実装する。
4. staging専用Playwright config/specを実装する。
5. M2 workflowを実装し、provider/DBの実操作は行わずsource contractを通す。
6. runbook、progress、R7PV-17、親計画を同期する。

### Refactor

1. JSON parse、safe response分類、bounded wait、origin guard、fixture match、evidence status再計算の重複をshared helperへ集約する。
2. CLI errorを日本語固定messageへ統一し、raw causeをstdout/stderrへ出さない。
3. 対象testと直接関連testだけを再実行し、backend/frontend Prettierを適用する。
4. 計画の対象ファイル、task、設計変更、実変更を実態へ同期する。

## テストケース一覧

### Unit / CLI

| ケース                               | 期待結果                             |
| ------------------------------------ | ------------------------------------ |
| staging DB target完全一致            | preflight継続、値非表示              |
| production / 不明DB target           | 接続前に拒否、`unknown`              |
| reserved identity 0件                | register開始可                       |
| emailまたはusername部分一致          | 削除・上書きせず`present`            |
| register後fixture完全一致            | token hash arm成功                   |
| role/verified/active/deletedAt不一致 | transaction中止                      |
| Serializable競合                     | fixed error、`unknown`               |
| token/passwordがpolicy外             | DB/API前に拒否                       |
| cleanup対象0件                       | 本人退会済みとして`clear`            |
| cleanup完全一致1件                   | cascade削除後`clear`                 |
| cleanup予期しない関連row             | `present`、成功扱いにしない          |
| CLI失敗                              | raw errorなし、固定message、非0 exit |
| marker余分なkey / schema version違い | Artifact生成拒否、`unknown`          |
| cleanup非clearでtest全clear          | decisionは非clear                    |
| recovery成功                         | 元test failureは`unknown`のまま      |

### Campaign HTTP

| ケース                      | 期待結果                                    |
| --------------------------- | ------------------------------------------- |
| register成功                | 201、mail provider受理、safe headers        |
| register non-JSON / timeout | `unknown`、raw body非出力                   |
| verification成功            | 200、token値非出力                          |
| verification replay         | 400系safe error                             |
| valid login                 | 200、DO composite evidence `clear`          |
| verifier 503                | request停止、`present`、Retry-After契約確認 |
| refresh rotation            | new refresh成功、old refresh 401            |
| cross-site browser refresh  | M2合否に使わずprotocol evidenceと分離       |
| clean window 1〜10回        | 全て200                                     |
| 11回目                      | 429、JSON、Retry-After整数1〜600            |
| 11回目が200/503/非JSON      | `present`または`unknown`、追加request停止   |
| Retry-After待機後           | 次のlogin 200、reset `clear`                |
| wait 610秒超過              | `unknown`、cleanup                          |
| game全問完了                | session/result/history最小契約成功          |
| 本人退会後access            | 401                                         |
| 本人退会後old refresh       | 401                                         |
| 本人退会後login             | 401                                         |

### Workflow / Playwright source contract

| ケース                | 期待結果                                                           |
| --------------------- | ------------------------------------------------------------------ |
| trigger               | `workflow_dispatch`だけ、schedule/push/PRなし                      |
| branch/SHA            | `develop`、40文字lowercase、M1 SHA完全一致                         |
| Environment           | `staging`だけ、production参照なし                                  |
| phase order           | prepare → deploy API → deploy frontend → test → cleanup → evidence |
| job timeout           | campaign 45分以内、cleanup各5分                                    |
| cancel / main failure | independent recovery job起動条件あり                               |
| Artifact              | exact 1 JSON、missing error、raw attachmentなし                    |
| secrets               | step scope、mask、CLI引数/GITHUB_ENVなし                           |
| URLs/resources        | production target/resource ID literalなし                          |
| Playwright            | 1 worker、retry 0、trace/screenshot/video off                      |
| keyboard              | Tab/Enter/Spaceで主要controlを操作                                 |
| 320px                 | horizontal overflowなし、主要action可視                            |
| same-site表記         | staging evidenceをproduction証拠と表記しない                       |

## repository品質gate

repository実装、再review、docs同期後に原則1回実行する。

```bash
cd backend
npm run test -- --run
npm run test:workers
npm run build
npm run workers:build
npm run lint
npm run format:check
npx prisma validate

cd ../frontend
npm run test -- --run
npm run lint
npm run check
npm run format
npm run build
npx playwright test --config=playwright.staging-release-candidate.config.ts --list

cd ..
npx prettier --check '.github/workflows/*.yml' 'docs/**/*.md'
git diff --check
```

quality gateではstaging/production URLへrequestせず、Playwrightは`--list`だけとする。Cloudflare deploy、Vercel deploy、Prisma migration、DB fixture CLIは実行しない。schema/migrationを変更していないため`prisma migrate deploy`と実Playwrightはrepository gateの対象外とする。

## 別承認が必要な外部実行手順

### A. M1確定（M2とは別作業）

1. M2 repository実装を含むrelease候補SHAをreviewする。
2. M1P-15のEnvironment/Secret/attestationを別承認し、production read-only workflowを1回だけdispatchする。
3. M1P-16でsafe Artifactとrunをreviewし、全項目clearの場合だけPath Aを記録する。
4. Path B/unknownならM2を実行せず通常gateへ戻る。

### B. staging preflight / Environment準備

1. M1 Path A、同一SHA、staging変更凍結、required reviewerを確認する。
2. Environment/Secret/Variable/resourceの存在と最小権限を値非表示でreviewする。
3. 不足があれば別changeとして承認し、変更後は既存deployment/evidenceを失効する。
4. DB migration checksumが不一致なら`.github/workflows/staging-database.yml`を別承認で実行し、M2を最初から再開する。

### C. staging deploy / campaign

1. exact reviewed SHAでM2 workflowをmanual dispatchし、staging Environment approvalを得る。
2. preflight clear後だけ通常API Worker、次にfrontendをdeployする。
3. candidate SHA再照合後だけsingle campaign requestを開始する。
4. main/recovery cleanupとsafe Artifact uploadまで完了させる。

### D. evidence review / M3 handoff

1. run conclusionだけでなくArtifact exact schema、Step Summary、cleanup、前後SHAをreviewする。
2. 全項目clearの場合だけM2を完了し、run URL、candidate SHA、evidence schema version、未解決事項をdocsへ記録する。
3. present/unknownならM2を未完了のまま原因、residue、再開条件だけを値非表示で記録する。

外部実行の各段階は別承認であり、repository実装PRのmergeはdispatch権限を意味しない。

## M2完了条件とM3への引き継ぎ条件

### repository実装完了

- M2 fixture/campaign/evidence CLI、Playwright、workflow、source contract、runbookがTDDで実装され`develop`へmerge済み。
- backend/frontend/repository品質gateが成功している。
- repository PR中にstaging/production接続、workflow dispatch、Environment変更、deploy、migration、fixture、cleanupを行っていない。

### M2完了

- M1P-15〜M1P-16が同じcandidate SHAで完了し、Path Aが確定している。
- API/frontend active deployment、DB schema、binding、resource境界が同じcandidate SHAとstaging targetでclear。
- register、verification、valid login、refresh protocol、10回許可、11回目429、Retry-After、reset、game、keyboard、320px、本人退会、旧credential拒否、headers/CORS/safe errorがclear。
- main Workerの503/`exceededCpu`再発がなく、通常DO composite evidenceがclear。
- main cleanup、residue、必要なrecovery cleanupがclear。
- workflowがsuccess、safe Artifactが存在し、人手reviewでschemaとallowlistが確認済み。
- docsのM2、R7PV-17担当範囲、parent plan、progressが実態と一致する。

### M3へ渡すもの

- 変更されていない40文字release候補SHA。
- review済みM2 GitHub Actions run URL。
- safe Artifactのschema versionと全status clearのreview記録。
- API/frontend/DB/bindingの値非表示attestation。
- M2で非目標としたproduction same-site refresh、production deploy/smoke、公開後rollback/soak/backup課題。
- 未解決事項がある場合はM2を完了せず、M3へ「既知リスク」として押し流さない。

## タスクリスト（進捗管理）

### 3回レビュー記録

#### v1（初版）

- fixture、campaign runner、evidence、Playwright、workflow、runbook、外部実行を分離した。
- repository実装とstaging実行を別task群へ分けた。

#### v2（1回目レビュー: error・型・security・整合性）

- registerと初回loginが`AUTH_IP`を消費する見落としを修正し、clean window待機と610秒上限を追加した。
- Resend本文取得には`full_access` keyが必要なため採用を中止し、完全一致fixtureへのtoken hash armへ変更した。
- Artifact exact schema、raw非出力、cleanupをdecisionへ含めるtaskを追加した。
- cross-site staging refreshをproduction same-site証拠と誤認しないprotocol-only契約を追加した。

#### v3（2回目レビュー: 既存実装・test・DB制約・説明範囲）

- 既存`runStagingRateLimitEvidence`、staging DB validator、fixture guard、M1 pagination/safe markerを再利用するtaskへ整理した。
- User unique、EmailVerification cascade、AuditLog retention、Serializable競合をfixture testへ追加した。
- R7PV-17からrollback drillを除き、M2担当とpost-public担当を分離した。
- Playwright attachment無効、320px、keyboard、旧access/refresh/loginの個別拒否をtestへ追加した。

#### v4（3回目レビュー・確定）

- repository変更、M1別承認、staging preflight/deploy、request campaign、evidence reviewの順序を確定した。
- timeout/cancel/pagination/TOCTOU/Artifact欠落/schema不一致をすべてfail-closedへ統一した。
- rollback drill、長期soak、WAF、backup複数世代をM2 blockerへ戻していないことを確認した。
- 無理なprovider権限追加とraw observability取得を除外し、下記M2P-01〜M2P-22を確定した。

### 確定タスク

| タスクID | 内容                                                      | ファイル / 対象                           | 優先度 | 境界         |
| -------- | --------------------------------------------------------- | ----------------------------------------- | ------ | ------------ |
| M2P-01   | M1/R7/既存workflowの状態と再利用契約を同期                | docs / existing source                    | 高     | Repository   |
| M2P-02   | fixture validator・exact match・collisionのRed test       | `stagingReleaseCandidateFixtures.test.ts` | 高     | Repository   |
| M2P-03   | fixture preflight・token arm・cleanupを実装               | `stagingReleaseCandidateFixtures.ts`      | 高     | Repository   |
| M2P-04   | fixture CLIのRed/Greenと秘密非出力test                    | fixture CLI / test                        | 高     | Repository   |
| M2P-05   | evidence schema・fail-closed集約のRed test                | `stagingReleaseCandidateEvidence.test.ts` | 高     | Repository   |
| M2P-06   | safe marker / Artifact builderを実装                      | `stagingReleaseCandidateEvidence.ts`      | 高     | Repository   |
| M2P-07   | campaign HTTP契約とbounded waitのRed test                 | `stagingReleaseCandidateCampaign.test.ts` | 高     | Repository   |
| M2P-08   | register〜旧credential拒否runnerを実装                    | `stagingReleaseCandidateCampaign.ts`      | 高     | Repository   |
| M2P-09   | 既存rate limit runnerを共通化・回帰test                   | `stagingRateLimitEvidence.ts` / test      | 高     | Repository   |
| M2P-10   | campaign CLIのRed/Greenとsafe output test                 | campaign CLI / test                       | 高     | Repository   |
| M2P-11   | staging Playwright config/source contractのRed test       | frontend E2E tests                        | 高     | Repository   |
| M2P-12   | keyboard・320px・game・本人退会specを実装                 | frontend E2E spec/config                  | 高     | Repository   |
| M2P-13   | workflow source contractのRed test                        | workflow contract test                    | 高     | Repository   |
| M2P-14   | M1 gate・deploy・campaign・cleanup workflowを実装         | M2 workflow                               | 高     | Repository   |
| M2P-15   | runbook、R7PV-17、親計画、progressを同期                  | docs                                      | 高     | Repository   |
| M2P-16   | 厳格reviewとrepository品質gate、実装PRを完了              | repository                                | 高     | Repository   |
| M2P-17   | M1P-15〜M1P-16でsame SHA Path Aを確定                     | M1 production read-only                   | 高     | 別承認・外部 |
| M2P-18   | staging Environment/resource/credential/schemaをpreflight | staging providers / GitHub                | 高     | 別承認・外部 |
| M2P-19   | same SHAの通常API Workerとfrontendを順次deploy            | Cloudflare / Vercel                       | 高     | 別承認・外部 |
| M2P-20   | single synthetic campaignを1回実行                        | staging API/frontend/DB                   | 高     | 別承認・外部 |
| M2P-21   | main/recovery cleanupとsafe Artifactをreview              | staging / GitHub Actions                  | 高     | 別承認・外部 |
| M2P-22   | M2完了記録とM3 handoffを同期                              | docs                                      | 高     | Evidence     |

- [x] M2P-01: M1/R7/既存workflowの状態と再利用契約を同期する
- [x] M2P-02: fixture validator・exact match・collisionのRed testを作成する
- [x] M2P-03: fixture preflight・token arm・cleanupを実装する
- [x] M2P-04: fixture CLIをTDD実装し秘密非出力を固定する
- [x] M2P-05: evidence schema・fail-closed集約のRed testを作成する
- [x] M2P-06: safe marker / Artifact builderを実装する
- [x] M2P-07: campaign HTTP契約とbounded waitのRed testを作成する
- [x] M2P-08: register〜旧credential拒否runnerを実装する
- [x] M2P-09: 既存rate limit runnerを共通化し回帰testを通す
- [x] M2P-10: campaign CLIをTDD実装しsafe outputを固定する
- [x] M2P-11: staging Playwright config/source contractのRed testを作成する
- [x] M2P-12: keyboard・320px・game・本人退会specを実装する
- [x] M2P-13: workflow source contractのRed testを作成する
- [x] M2P-14: M1 gate・deploy・campaign・cleanup workflowを実装する
- [x] M2P-15: runbook、R7PV-17、親計画、progressを同期する
- [x] M2P-16: 厳格review、repository品質gate、実装PRを完了する
- [ ] M2P-17: 別承認でM1P-15〜M1P-16を実行しsame SHA Path Aを確定する
- [ ] M2P-18: 別承認でstaging Environment/resource/credential/schemaをpreflightする
- [ ] M2P-19: 別承認でsame SHAの通常API Workerとfrontendを順次deployする
- [ ] M2P-20: 別承認でsingle synthetic campaignを1回実行する
- [ ] M2P-21: main/recovery cleanupとsafe Artifactをreviewする
- [ ] M2P-22: M2完了記録とM3 handoffを同期する

2026-07-28の同一SHA M1 runはPath Bであり、M2P-17の「Path Aを確定」という完了条件を満たさない。M2P-17〜M2P-22のcheckboxは未完了を表す`[ ]`のまま保持するが、これはv0.1公開前に次に実行すべきtaskを示すものではない。M2外部作業は公開後の回帰または次のauth/infra高リスク変更まで延期し、M6 production smokeの成功をM2完了へ読み替えない。

### タブ区切り出力

```text
タスクID	タスク内容	ファイル・対象	優先度	境界
M2P-01	M1/R7/既存workflowの状態と再利用契約を同期	docs / existing source	高	Repository
M2P-02	fixture validator・exact match・collisionのRed test	stagingReleaseCandidateFixtures.test.ts	高	Repository
M2P-03	fixture preflight・token arm・cleanupを実装	stagingReleaseCandidateFixtures.ts	高	Repository
M2P-04	fixture CLIのRed/Greenと秘密非出力test	fixture CLI / test	高	Repository
M2P-05	evidence schema・fail-closed集約のRed test	stagingReleaseCandidateEvidence.test.ts	高	Repository
M2P-06	safe marker / Artifact builderを実装	stagingReleaseCandidateEvidence.ts	高	Repository
M2P-07	campaign HTTP契約とbounded waitのRed test	stagingReleaseCandidateCampaign.test.ts	高	Repository
M2P-08	register〜旧credential拒否runnerを実装	stagingReleaseCandidateCampaign.ts	高	Repository
M2P-09	既存rate limit runnerを共通化・回帰test	stagingRateLimitEvidence.ts / test	高	Repository
M2P-10	campaign CLIのRed/Greenとsafe output test	campaign CLI / test	高	Repository
M2P-11	staging Playwright config/source contractのRed test	frontend E2E tests	高	Repository
M2P-12	keyboard・320px・game・本人退会specを実装	frontend E2E spec/config	高	Repository
M2P-13	workflow source contractのRed test	workflow contract test	高	Repository
M2P-14	M1 gate・deploy・campaign・cleanup workflowを実装	M2 workflow	高	Repository
M2P-15	runbook、R7PV-17、親計画、progressを同期	docs	高	Repository
M2P-16	厳格reviewとrepository品質gate、実装PRを完了	repository	高	Repository
M2P-17	M1P-15〜M1P-16でsame SHA Path Aを確定	M1 production read-only	高	別承認・外部
M2P-18	staging Environment/resource/credential/schemaをpreflight	staging providers / GitHub	高	別承認・外部
M2P-19	same SHAの通常API Workerとfrontendを順次deploy	Cloudflare / Vercel	高	別承認・外部
M2P-20	single synthetic campaignを1回実行	staging API/frontend/DB	高	別承認・外部
M2P-21	main/recovery cleanupとsafe Artifactをreview	staging / GitHub Actions	高	別承認・外部
M2P-22	M2完了記録とM3 handoffを同期	docs	高	Evidence
```

## 厳格review checklist

- [x] M1 Path AとM2 same SHAが機械的に一致し、PR #155 mergeだけでM1を完了にしていない。
- [x] Path B/unknown時は外部操作前に停止し、親計画の通常gateへ戻る。
- [x] staging/production Environment、credential、resource、DB、frontend/API originが分離されている。
- [x] `PasswordVerifierDurableObject`の通常bundleだけをM2でdeployし、rollback baselineを実行しない。
- [x] valid loginと10回200がmain Worker `exceededCpu`非再発の安全な合成証拠になっている。
- [x] registerによるrate limit消費、fixed window、11回目、Retry-After、resetの時系列が整合している。
- [x] cross-site staging refreshをproduction same-site証拠として扱っていない。
- [x] fixture preflight、token arm、cleanupが完全一致・Serializable・staging限定である。
- [x] main/recovery cleanupとresidueが成功判定へ含まれている。
- [x] timeout、cancel、pagination、429、schema不一致、Artifact欠落、TOCTOUが`unknown`へ倒れる。
- [x] Summary/Artifact/logにPII、Secret、resource ID、raw response/errorが残らない。
- [x] 既存CLI/workflow/Playwrightの再利用と新規追加の境界が具体的である。
- [x] unit、CLI、workflow source contract、frontend、Playwright source/config testがRed→Green→Refactor順である。
- [x] repository実装と別承認のdeploy/request/Environment変更が別taskである。
- [x] rollback drill、長期soak、WAF、backup複数世代をM2 blockerへ戻していない。
- [x] M3へ渡すSHA、run URL、safe evidence、未解決事項の扱いがfail-closedである。

## Repository実装完了

- 完了日: 2026-07-28
- 実装ブランチ: `feature/m2-staging-release-candidate-campaign`
- PR: [#157](https://github.com/RitukoIsibasi0222/gensoko/pull/157)
- 境界: M2P-01〜M2P-16のみ。M2P-17〜M2P-22の外部実行は未実施

### 計画からの変更点

- response JSON・timeout・CORS/security header検証の重複を`stagingEvidenceHttp.ts`へ共通化した。
- rate-limit policyの実在する正本は`backend/src/middleware/rateLimit/policies.ts`であることを確認し、既存runnerからそのまま参照した。
- evidenceとfixtureに独立CLI/testを追加し、M1 Artifact exact検証もevidence CLIへ統合した。
- frontend staging固定値とcross-site境界は`staging-release-candidate-config.ts`へ分離した。
- repository workflow contract testはbackend job testとして配置した。
- PR #157 review対応で複数`Set-Cookie`から削除cookieを除外し、active refresh cookieをexact 1件だけ受理するようにした。
- 再監査でM1 run metadata、API deploy後health/CORS/header、API/frontend deploy後same SHA、safe 503契約のgate不足を検出し、fail-closed検証を追加した。

### 実際の変更ファイル

| ファイル                                                                  | 変更種別   | 内容                                                          |
| ------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------- |
| `.github/workflows/staging-release-candidate-campaign.yml`                | 新規       | manual-only M1 gate、deploy、campaign、cleanup、safe Artifact |
| `backend/package.json`                                                    | 修正       | fixture・campaign・health・evidence CLI script                |
| `backend/src/jobs/stagingEvidenceHttp.ts`                                 | 新規       | staging HTTP response/timeout/header共通契約                  |
| `backend/src/jobs/stagingReleaseCandidateEvidence.ts` / `.cli.ts` / tests | 新規       | exact evidence、M1 gate、safe CLI                             |
| `backend/src/jobs/stagingReleaseCandidateFixtures.ts` / `.cli.ts` / tests | 新規       | fixed fixture preflight、arm、cleanup、safe CLI               |
| `backend/src/jobs/stagingReleaseCandidateCampaign.ts` / `.cli.ts` / tests | 新規       | single campaign runner、CLI、workflow source contract         |
| `backend/src/jobs/stagingReleaseCandidateHealth.ts` / `.cli.ts` / tests   | 新規       | API health・CORS・security header gate、safe CLI              |
| `backend/src/jobs/stagingRateLimitEvidence.ts` / `.m2.test.ts`            | 修正・新規 | M2 credential注入と既存runner回帰contract                     |
| `frontend/package.json`                                                   | 修正       | M2 Playwright script                                          |
| `frontend/package-lock.json`                                              | 修正       | PR CIで検出したmoderate/high advisoryの非breaking更新         |
| `frontend/e2e/staging-release-candidate-config.ts` / tests                | 新規       | staging origin・cross-site・秘密入力contract                  |
| `frontend/e2e/staging-release-candidate.spec.ts`                          | 新規       | keyboard、320px、game、本人退会spec                           |
| `frontend/playwright.staging-release-candidate.config.ts`                 | 新規       | 1 worker、retry/attachment無効config                          |
| `docs/11_deployment.md`、`docs/05_progress.md`、関連計画書                | 修正       | repository完了と外部未実施境界を同期                          |

### TDD記録

fixture/evidence、各CLI、campaign、rate runner再利用、frontend config/source、workflow source contractごとに対象testを先に失敗させ、実装後にGreen、共通HTTP helper抽出後に回帰testを通した。最終品質gateとdevelop向けPR #157の作成を完了し、M2P-16までを完了した。

### Repository品質gate

- backend: 外部DB不要 1,267 tests、Workers runtime 32 tests、Node build、Workers build、ESLint、Prettier、Prisma validate成功
- frontend: 680 tests、ESLint、Svelte check 0 errors/0 warnings、Prettier、Vite build、`npm audit --audit-level=moderate`成功
- dependency audit: `brace-expansion`と`tar`を非breaking更新。強制breaking変更が必要な`cookie`由来low 3件は別管理
- Playwright: M2 staging configで1 specを`--list`し、外部requestなしで収集成功
- repository: workflow/docs Prettier、`git diff --check`成功
