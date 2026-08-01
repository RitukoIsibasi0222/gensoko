# 定期バッチ運用再設計 実装計画

> 設計者ロール: シニアバックエンドエンジニア / セキュリティレビュー担当（個人ポートフォリオ運用）

## 概要

`Batch Jobs` の定期実行が GitHub `production` Environment の必須レビュー待ちとなり、同一 concurrency group の後続 run が継続的に置き換え・キャンセルされている問題を解消する。同時に、`GameQuestionSet` の有効期限30分と物理削除頻度を同一視した現在の30分間隔を見直し、日次 cleanup と観測ベースの頻度変更へ改める。

本計画では、手動の production 操作に必要な承認境界を弱めない。scheduled run だけを専用の自動実行境界へ分離し、repository-level kill switch が明示的に有効な場合だけ production DB へ接続する。

## 結論

1. 定期実行基盤はこのタスクでは GitHub Actions schedule を維持する。
2. `GameQuestionSet` cleanup は30分ごとから1日1回へ変更する。
3. 週間スコアリセットは週1回、監査ログ cleanup は1日1回を維持する。
4. GameQuestionSet cleanup と監査ログ cleanup は別runのまま維持する。
   - 依存関係installの重複より、失敗・retry・ログ・停止判断を分離できる利点を優先する。
5. schedule は新しい GitHub Environment `production-batch` を参照する。
6. workflow_dispatch は既存どおり `staging` / `production` を参照し、`production` の必須レビューを維持する。
7. scheduled run は `gensoko-scheduled-batch`、manual run は既存の `gensoko-batch-jobs` concurrency group を使う。
8. repository Variable `PRODUCTION_SCHEDULED_BATCH_ENABLED` が文字列 `true` の場合だけ scheduled job を開始する。未設定・空文字・`false` は fail-safe にskipする。
9. 未知のcronは成功扱いでskipせず、固定日本語エラーで失敗させる。
10. 待機・保留runのcancelはコード変更から分離する。merge後に旧run #804・#868のstep 0件とDB処理未開始を確認して整理済みである。
11. 個人ポートフォリオの単独運営では、非作成者レビューや厳格なrulesetを運用完了条件にしない。既存の`Repository Integrity / repository-integrity`は軽量CIとして維持するが、required check化は必須にしない。
12. 商用運用ではないため、費用・運用負担に対して過剰な統制、長期baseline、オンコール相当の監視は採用しない。Secret非出力、Environment分離、kill switch、DB処理前validation、未知cronのfail-closed、初回run確認は維持する。

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`.github/workflows/batch.yml`**

- `workflow_dispatch` — `staging` / `production` と実行対象jobを手動選択する。
- `schedule` — weekly reset、GameQuestionSet cleanup、audit log cleanupを起動する。
- `environment.name: ${{ inputs.target_environment || 'production' }}` — scheduleを既存`production`へ送る。
- `concurrency.group: gensoko-batch-jobs` — scheduled / manual / 一部production DB運用を同じgroupへ直列化する。
- `cancel-in-progress: false` — running jobを新runでcancelしない。ただしpending jobの置換は防がない。

**`backend/src/jobs/scheduled.ts`**

- `runScheduledBatch(options: RunScheduledBatchOptions): Promise<ScheduledBatchResult>` — cron文字列から既存jobを1つ選んで実行する。
- `GITHUB_WEEKLY_SCORE_RESET_CRON: string` — GitHub Actions用の週次cron。
- `GITHUB_GAME_QUESTION_SET_CLEANUP_CRON: string` — 現在の30分cleanup cron。
- `AUDIT_LOG_CLEANUP_CRON: string` — 日次監査ログcleanup cron。
- 未知cronは`job: "unknown"`、`skipped: true`で成功終了する。

**`backend/src/jobs/cleanupGameQuestionSets.ts`**

- `cleanupExpiredGameQuestionSets(options?): Promise<CleanupGameQuestionSetsResult>` — `expiresAt <= cutoff`を単発`deleteMany`で削除する。
- APIの期限判定とは独立しており、cleanupが未実行でも`submitGameSession()`が期限切れを拒否する。

**`backend/src/services/game.service.ts`**

- `QUESTION_SET_EXPIRES_MS = 30 * 60 * 1000` — 問題セットの論理的な有効期限。
- `submitGameSession()` — `expiresAt <= now`をcleanupとは無関係に拒否する。

**`backend/src/jobs/batchWorkflow.test.ts`**

- workflowのenvironment、cron、Secret/Variable、manual job、concurrency、timeoutをsource contractとして検証する。

**`docs/11_deployment.md`**

- GitHub Actions scheduleを現在の定期実行正本としている。
- `staging` / `production` EnvironmentのSecret・Variableとrunbookを定義している。
- Cloudflare Workers Cronへの移行条件を別計画事項として記録している。

### 確認済みの運用事実

2026-07-31時点のGitHub APIによる読み取り確認:

- [`Batch Jobs` run 30419479066](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/30419479066) は2026-07-29から`waiting`。
- [`Batch Jobs` run 30605435556](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/30605435556) は`pending`。
- 直近一覧ではpending 1件の後ろにcancelled runが連続している。
- GitHub `production` Environmentにはrequired reviewerとcustom branch policyが設定されている。
- repositoryのdefault branchは`develop`で、`production` Environmentのcustom branch policyも`develop`だけを許可している。
- `develop`は2026-07-31時点でbranch protection API上`not protected`であり、repository rulesetにもPR必須・required status checksはない。
- 既存`Backend PR Quality` / `Frontend PR Quality`はpath filter付きである。対象外PRではcheck自体が作られないため、そのまま全PR必須checkにはできない。
- 既存の調査ではcancelled jobは`steps: []`、`runner_id: 0`で、DB処理前に終了している。
- 最後に確認できた成功runは[`30316388190`](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/30316388190)。

### 公式仕様

- [GitHub Actions concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
  - 同じconcurrency groupでは、実行中runは最大1件、pending runも最大1件となり、新しいrunが既存のpending runを置き換える。
  - `cancel-in-progress: false`はrunning runのcancelを防ぐ設定であり、pending runを無制限に保持する設定ではない。
- [GitHub deployment environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)
  - required reviewer通過前はjobとEnvironment Secretを利用できない。
  - environmentとconcurrencyは独立した制御である。
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
  - Workers移行には`scheduled()` handler、UTC cron、runtime test、運用監視が必要。

## 厳格レビュー結果

### このまま実装・運用を継続してはいけない理由

| 観点             | 現状の問題                                                        | 影響                                                           | 改善                                                                                      |
| ---------------- | ----------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 要件整合         | 無人実行するscheduleが手動承認必須の`production`を参照する        | 承認されない限りjobが開始しない                                | scheduled専用`production-batch`へ分離する                                                 |
| 頻度             | 30分の論理TTLを30分の物理削除頻度へ直結している                   | 48回/日のrunner起動とDB接続になる                              | 日次化し、実測値でのみ短縮する                                                            |
| concurrency理解  | `cancel-in-progress: false`を待ち行列保持と誤認しやすい           | pending runが新runでcancelされる                               | schedule/manual groupを分離し、意図をtestとdocsへ固定する                                 |
| timeout          | `timeout-minutes: 20`で承認待ちを止められる前提に見える           | 20分を超えてwaitingが残る                                      | timeoutはrunner開始後の上限と明記し、kill switchで起動前に止める                          |
| 責務分離         | scheduledとmanualが同じenvironment式・job・concurrencyを共有する  | 自動保守と承認付き操作が互いを阻害する                         | eventごとのenvironment/concurrencyを明示する                                              |
| security         | required reviewerを外すだけでは全production操作の防御が低下する   | migration、証拠取得、破壊的操作まで無承認化し得る              | 既存`production`は変更せず、scheduled専用境界だけ追加する                                 |
| source integrity | production codeを持つ`main`にPR必須・required status checksがない | ownerの誤変更をGitHub rulesetだけでは防げない                  | source contract test、main限定Environment、kill switchを維持し、軽量CIで早期検出する      |
| status check設計 | 既存quality workflowはpath filter付き                             | そのまま必須化すると対象外PRがpendingのままmerge不能になり得る | path filterなしの`Repository Integrity`は残すが、単独運営ではrequired checkを必須にしない |
| rollout          | scheduleをmergeすると外部設定未完了でも自動起動する               | Secret欠落runや誤接続が発生する                                | repository kill switchを既定falseにする                                                   |
| fail-closed      | 未知cronが成功skipになる                                          | cronのtypoやdocs不整合が正常に見える                           | 未知cronを固定エラーで失敗させる                                                          |
| 観測             | cleanup頻度を短縮・延長する数値基準がない                         | 感覚で48回/日に戻り得る                                        | 初回runの結果を記録し、公開後に問題やprovider警告がある場合だけ追加観測する               |
| docs整合         | 旧計画の30分根拠が現在の運用事故を反映していない                  | 実装者が旧判断を再利用する                                     | 新計画を正本とし旧計画へ後継リンクを追加する                                              |

### 採用しない案

#### 既存`production`からrequired reviewerを削除する

不採用。手動migration、backup、production smoke、証拠取得などの承認境界まで弱めるため、今回の問題より影響が大きい。

#### `queue: max`で待機runをすべて保持する

不採用。承認されないrunを蓄積するだけで無人実行の要件を満たさない。古い時刻のcleanupを順番に実行する必要もなく、冪等jobでは最新runによる回復を優先すべきである。

#### GameQuestionSet cleanupとaudit log cleanupを同じ日次runへ統合する

不採用。runner準備回数はさらに減るが、保持期間・enable flag・失敗時対応・手動retryの責務が異なる。日次2runの準備コストより、独立した失敗判定を優先する。

#### このタスクでCloudflare Workers Cronへ移行する

不採用。API Workers基盤は実装済みだが、production Workerは未配備であり、batch jobはNode用Prisma singletonと`process.env`設定へ依存している。安全な移行には以下が追加で必要となり、今回の事故修正としてスコープ過大である。

- job本体への`AppPrismaClient`・設定の依存注入
- staging / production `scheduled()` handler
- Hyperdrive接続のscheduled境界での生成・切断
- GitHub scheduleとの二重実行防止
- Cloudflare Cron Past Eventsと外部通知
- 本番deploy・rollbackと同時のcron有効化手順

Cloudflare移行はproduction Worker安定稼働後の別タスクとする。

## スコープ

- GameQuestionSet cleanupを30分ごとから日次へ変更する。
- scheduled runとmanual runのEnvironmentを分離する。
- scheduled runとmanual runのconcurrency groupを分離する。
- `PRODUCTION_SCHEDULED_BATCH_ENABLED`によるscheduled jobのkill switchを追加する。
- 未知cronをfail-closedへ変更する。
- workflow / scheduled wrapper / CLIのsource contractとunit testをTDDで更新する。
- `docs/09_startup_commands.md`、`docs/11_deployment.md`、旧計画、進捗を同期する。
- 新Environmentの外部設定手順、初回有効化、停止、rollbackを文書化する。
- 現在のwaiting / pending runの安全な解消手順を文書化する。

## 非スコープ

- `GameQuestionSet`の有効期限30分の変更
- 公開API、画面、エラーステータスの変更
- DB schema / migrationの変更
- audit log保持期間365日の変更
- refresh token cleanupの自動実行
- Cloudflare Workers Cronへの移行
- GitHub `production` Environmentのrequired reviewer削除
- production DBへの直接query
- 計画作成ブランチでのEnvironment作成、Secret複製、Variable変更、workflow実行、run cancel

## 対象ファイル一覧

| ファイル                                       | 変更種別 | 内容                                                  |
| ---------------------------------------------- | -------- | ----------------------------------------------------- |
| `.github/workflows/batch.yml`                  | 修正     | 日次cron、event別Environment/concurrency、kill switch |
| `.github/workflows/repository-integrity.yml`   | 新規     | 全PRでbatchのproduction境界contractを検証する軽量CI   |
| `backend/src/jobs/batchWorkflow.test.ts`       | 修正     | workflow source contractを新設計へ更新                |
| `backend/src/jobs/scheduled.ts`                | 修正     | 日次cron定数と未知cron fail-closed                    |
| `backend/src/jobs/scheduled.test.ts`           | 修正     | 日次dispatch・旧cron拒否・未知cron失敗                |
| `backend/src/jobs/scheduled.cli.test.ts`       | 修正     | 未知cron時の非0終了契約                               |
| `docs/09_startup_commands.md`                  | 修正     | 日次cron、manual実行、kill switch確認                 |
| `docs/11_deployment.md`                        | 修正     | Environment分離、初回有効化、監視、停止、rollback     |
| `docs/05_progress.md`                          | 修正     | 実装中・完了状態                                      |
| `docs/plans/batch-cron-triggers/plan.md`       | 修正     | 履歴を保持したまま後継計画へのリンクを追加            |
| `docs/plans/batch-operations-redesign/plan.md` | 修正     | タスク・実装完了記録                                  |

## API仕様

公開HTTP APIの追加・変更はない。`docs/04_api.md`は更新しない。

## Cron設計

### 現在と変更後

| job                     | 現在            | 変更後        | JST       | 理由                                         |
| ----------------------- | --------------- | ------------- | --------- | -------------------------------------------- |
| weekly reset            | `7 15 * * 0`    | `7 15 * * 0`  | 月曜00:07 | 週境界処理のため維持                         |
| GameQuestionSet cleanup | `17,47 * * * *` | `17 18 * * *` | 毎日03:17 | 論理TTLはAPIで強制済み。物理削除は日次で十分 |
| audit log cleanup       | `37 18 * * *`   | `37 18 * * *` | 毎日03:37 | 365日保持の保守処理として維持                |

設定上の起動回数は週344回から週15回へ減少する。

- 現在: GameQuestionSet 336回 + audit 7回 + weekly 1回
- 変更後: GameQuestionSet 7回 + audit 7回 + weekly 1回
- 削減率: 約95.6%

### 頻度再評価

日次化後は、最初に自然発生するrunで次を簡潔に記録する。

- `deletedCount`
- cleanup所要時間
- status / conclusion
- 失敗・skipの場合はその理由
- Secret、PII、内部ID、raw DB errorがlogへ出ていないこと

14日間のbaselineは運用完了条件にしない。公開後、DB容量・所要時間・失敗に問題が見つかった場合だけ、必要な期間の追加観測を行う。次のいずれかが観測された場合は、6時間ごとへの短縮を新しいレビュー対象にする。

- cleanupが2回連続で失敗またはtimeoutする。
- cleanup所要時間が継続的に増加する。
- 日次削除ではDB容量・query性能・正解情報保持期間の要件を満たさない。
- 公開後の利用量から、最大約24時間30分の物理残留が許容できないと判断される。

根拠を記録せず30分間隔へ戻さない。

## Environment・権限設計

| GitHub Environment | 用途                         | required reviewer | branch policy | Secret / Variable       |
| ------------------ | ---------------------------- | ----------------- | ------------- | ----------------------- |
| `staging`          | manual検証                   | 既存設定を維持    | 既存設定      | staging専用値           |
| `production`       | manual production操作        | 必須を維持        | `main`のみ    | 既存production値        |
| `production-batch` | scheduled production保守のみ | なし              | `main`のみ    | scheduledに必要な最小値 |

`production-batch`へ登録する項目:

| 種別     | 名前                            | 扱い                                                     |
| -------- | ------------------------------- | -------------------------------------------------------- |
| Secret   | `DATABASE_URL`                  | production専用Session pooler。値を取得・表示・記録しない |
| Variable | `BATCH_ENVIRONMENT`             | `production`                                             |
| Variable | `AUDIT_LOG_RETENTION_DAYS`      | 承認済みの`365`                                          |
| Variable | `AUDIT_LOG_CLEANUP_ENABLED`     | release gate完了までは`false`                            |
| Variable | `REFRESH_TOKEN_CLEANUP_ENABLED` | 自動化承認までは`false`                                  |

repository Variable:

| 名前                                 | 初期値              | 用途                           |
| ------------------------------------ | ------------------- | ------------------------------ |
| `PRODUCTION_SCHEDULED_BATCH_ENABLED` | 未設定または`false` | scheduled job全体のkill switch |

### 重要な制約

- `production-batch`をworkflow_dispatchの選択肢へ追加しない。
- scheduled以外のjobから`production-batch`を参照しない。
- GitHub Environmentだけでは特定workflowへの利用制限を強制できないため、source contract、main限定policy、manual選択禁止、kill switchを組み合わせる。
- repository共通Secretへ`DATABASE_URL`を移さない。
- `production`のrequired reviewer、branch policy、Secretを削除・緩和しない。
- 単独運営の個人ポートフォリオでは、非作成者レビュー、厳格なruleset、`Repository Integrity / repository-integrity`のrequired check化を運用完了条件にしない。
- `.github/workflows/repository-integrity.yml`はSecretやEnvironmentを参照しない軽量CIとして維持する。
- path filter付きの`Backend PR Quality` / `Frontend PR Quality`を無条件のrequired checkへ直接指定しない。対象外PRをmerge不能にしないため、既存workflowは変更対象に応じて実行するquality gateとして維持する。
- kill switchを`true`にする前に、review済みSHA、Environment名、branch policy、Secret名、Variable名を値非表示で確認する。
- Secret値をCLI、log、Artifact、summary、Issue、PR、文書へ出さない。

## 軽量source contract設計

`.github/workflows/repository-integrity.yml`は`develop`向けの全pull requestでpath filterなしに起動し、check名を`Repository Integrity / repository-integrity`へ固定する。これはownerの誤変更を早期検出する軽量CIであり、非作成者レビューやrequired checkを前提としない。

このcheckはproduction Secretを一切参照せず、`contents: read`だけを持ち、次のbatch security contractを毎回検証する。

- `production-batch`を参照できるworkflowは`.github/workflows/batch.yml`だけである。
- `production-batch`は`workflow_dispatch`の入力候補ではない。
- scheduled jobはkill switchが文字列`true`のときだけEnvironment評価へ進む。
- manual productionは引き続き`production`を参照する。
- scheduled / manualのEnvironmentとconcurrency groupが分離されている。
- batch cron、未知cronのfail-closed、CLI非0終了に関する対象testが成功する。

workflowのjob-level条件は次の契約とし、未設定Variableをfail-safeに扱う。

```yaml
if: >-
  github.event_name == 'workflow_dispatch' ||
  vars.PRODUCTION_SCHEDULED_BATCH_ENABLED == 'true'
```

既存Backend/Frontend workflowはpath filterがあるため、全PR共通のrequired checkには使わない。将来collaboratorを追加して複数人運営へ移行する場合は、PR必須化やrequired check化を別途検討する。現在の有効化判断は、`develop`限定Environment、source contract、kill switch、DB処理前validation、初回run確認の組み合わせで行う。

## concurrency設計

| event               | group                     | 方針                                                |
| ------------------- | ------------------------- | --------------------------------------------------- |
| `schedule`          | `gensoko-scheduled-batch` | 日次・週次の軽量で冪等なonline保守を直列化          |
| `workflow_dispatch` | `gensoko-batch-jobs`      | 既存manual batch・production DB運用との直列化を維持 |

- scheduled groupは既定の単一pending方針を使う。
- `cancel-in-progress: false`を維持し、開始済みjobは完了させる。
- 20分timeout内のjobに対して日次cronを使うため、正常時にpendingが積み上がる設計にはしない。
- manual production DB操作はscheduled時刻付近を避ける。ただしschedule遅延を考慮し、各jobは通常のアプリtrafficと並行しても安全なPrisma操作だけを行う。
- migrationがbatchと同時実行できない変更を含む場合は、先にkill switchを`false`へ変更し、active scheduled jobがないことを確認する。

## 公開インターフェース案

実装コードではなく、変更後の型シグネチャと役割を示す。

```typescript
export const GITHUB_DAILY_GAME_QUESTION_SET_CLEANUP_CRON: string;

export type ScheduledBatchJobName =
  | "resetWeeklyScores"
  | "cleanupExpiredGameQuestionSets"
  | "cleanupExpiredAuditLogs";

export function runScheduledBatch(
  options: RunScheduledBatchOptions,
): Promise<ScheduledBatchResult>;
```

未知cronは`ScheduledBatchResult`を返さず、固定日本語エラーをthrowする。`"unknown"`成功resultは廃止する。

## 設計上の決定事項

1. **GameQuestionSetのTTLも30分なのでcleanupも30分必要か**
   - 選択: 不要。cleanupは日次。
   - 根拠: `submitGameSession()`が同期的に期限を検証するため、物理行が残っても期限切れ利用はできない。

2. **既存production approvalを外すか**
   - 選択: 外さない。
   - 根拠: manual production操作の安全境界であり、scheduled要件だけを理由に弱めてはいけない。

3. **自動実行用Environmentを作るか**
   - 選択: `production-batch`を新設する。
   - 根拠: 自動保守と承認付きmanual操作を別の権限・監査境界にする。

4. **scheduledとmanualでconcurrencyを共用するか**
   - 選択: 共用しない。
   - 根拠: Environment承認待ちがconcurrency枠を保持し、自動保守を停止させた実績がある。

5. **日次cleanupを監査ログcleanupと統合するか**
   - 選択: 統合しない。
   - 根拠: enable flag、保持方針、retry、失敗通知を独立させる。

6. **未知cronをskipするか**
   - 選択: fail-closedで失敗させる。
   - 根拠: schedule typoやdocs driftを成功表示で隠さない。

7. **Cloudflare Cronへ今すぐ移行するか**
   - 選択: 移行しない。
   - 根拠: production Worker未配備の段階でruntime・監視・rollback変更まで同時に行わない。

## TDD実装方針

### Red

1. `batchWorkflow.test.ts`を先に変更する。
   - 30分cronが存在しない。
   - 日次GameQuestionSet cronが1回だけ存在する。
   - scheduled jobはkill switchが`true`の場合だけ起動する。
   - scheduleは`production-batch`、manualは入力Environmentを参照する。
   - schedule/manualのconcurrency groupが異なる。
   - workflow_dispatchに`production-batch`選択肢がない。
   - 全workflowを走査し、`production-batch`参照が`batch.yml`以外にない。
2. `scheduled.test.ts`を先に変更する。
   - 日次cronがGameQuestionSet cleanupを1回だけ呼ぶ。
   - 旧30分cronは受理しない。
   - 未知cronは固定エラーで失敗し、DB jobを呼ばない。
3. `scheduled.cli.test.ts`で未知cron時の非0終了を固定する。
4. `repository-integrity.yml`のsource contract testを追加する。
   - `pull_request`にpath filterがない。
   - job名が`repository-integrity`で固定される。
   - production Secret / Environmentを参照しない。
   - batch security contractの対象testだけを実行する。
5. 対象testだけを実行し、現行設計に対して意図した理由で失敗することを確認する。

### Green

1. workflowのcron、Environment式、kill switch、concurrency式を変更する。
2. path filterなし・最小権限の`repository-integrity.yml`を追加する。
3. scheduled wrapperの定数とdispatchを変更する。
4. 未知cronをfail-closedへ変更する。
5. 対象testだけを実行して成功を確認する。

### Refactor

1. workflow内のevent判定式を必要最小限にし、同じ式の不整合を防ぐ。
2. cron文字列の重複を増やさない。
3. 対象3 test filesを実行する。
4. Prettierを適用する。

### 最終品質ゲート

```bash
cd backend
npm run test -- --run
npm run test:workers
npm run build
npm run lint
npm run format:check
```

DB schema / migrationを変更しないため、`prisma migrate deploy`とPlaywrightは不要。変更が発生した場合は本計画を更新して追加確認を必須にする。

## テストケース一覧

| ケース                        | 期待結果                                               |
| ----------------------------- | ------------------------------------------------------ |
| schedule・kill switch未設定   | jobはEnvironmentへ入らずskip                           |
| schedule・kill switch=`false` | jobはEnvironmentへ入らずskip                           |
| schedule・kill switch=`true`  | `production-batch`を参照                               |
| manual staging                | `staging`を参照                                        |
| manual production             | required reviewer付き`production`を参照                |
| workflow_dispatch選択肢       | `production-batch`を選択できない                       |
| workflow全体のEnvironment参照 | `production-batch`参照は`batch.yml`のscheduled経路だけ |
| Repository Integrity trigger  | `develop`向け全PRでpath filterなしに起動               |
| Repository Integrity権限      | `contents: read`のみ、Secret / Environment参照なし     |
| GameQuestionSet cron          | `17 18 * * *`だけを登録                                |
| 旧cron                        | `17,47 * * * *`と`*/30 * * * *`を登録・受理しない      |
| weekly cron                   | 既存週次jobを実行                                      |
| audit cron                    | 既存日次jobを実行                                      |
| 未知cron                      | 固定日本語エラー、DB job 0回、CLI非0終了               |
| scheduled concurrency         | `gensoko-scheduled-batch`                              |
| manual concurrency            | `gensoko-batch-jobs`                                   |
| scheduled active run中の次run | running runをcancelしない                              |
| Secret欠落                    | DB処理・依存install前に失敗                            |
| Environment識別不一致         | DB処理・依存install前に失敗                            |

## タスクリスト（進捗管理）

| タスクID | 内容                                          | ファイル                                               | 優先度 | 備考                          |
| -------- | --------------------------------------------- | ------------------------------------------------------ | ------ | ----------------------------- |
| BO1      | workflow contractをRedへ変更                  | `backend/src/jobs/batchWorkflow.test.ts`               | 高     | 頻度・境界・kill switch       |
| BO2      | scheduled wrapper testをRedへ変更             | `backend/src/jobs/scheduled.test.ts`                   | 高     | 日次・旧cron拒否・fail-closed |
| BO3      | CLI failure contractをRedへ変更               | `backend/src/jobs/scheduled.cli.test.ts`               | 高     | 非0終了                       |
| BO4      | workflowをGreen実装                           | `.github/workflows/batch.yml`                          | 高     | schedule/manual分離           |
| BO5      | integrity workflowをGreen実装                 | `.github/workflows/repository-integrity.yml`           | 高     | path filterなし・最小権限     |
| BO6      | scheduled wrapperをGreen実装                  | `backend/src/jobs/scheduled.ts`                        | 高     | 日次cron                      |
| BO7      | 対象test・Refactor・format                    | `backend/src/jobs/*.test.ts`                           | 高     | TDD記録                       |
| BO8      | 運用docsを同期                                | `docs/09_startup_commands.md`, `docs/11_deployment.md` | 高     | rollout/rollback              |
| BO9      | 旧計画へ後継リンクを追加                      | `docs/plans/batch-cron-triggers/plan.md`               | 中     | 履歴本文は改変しない          |
| BO10     | 最終品質ゲート                                | `backend/`                                             | 高     | 外部DB不使用                  |
| BO11     | repository実装をcommit・push・PR              | Git                                                    | 高     | base `develop`                |
| BO12     | 過剰なsource integrity gateを完了条件から除外 | 本計画                                                 | 高     | 軽量CIは維持                  |
| BO13     | `production-batch`を外部設定                  | GitHub Environment                                     | 高     | 別承認・値非表示              |
| BO14     | merge後に旧waiting/pending runを整理          | GitHub Actions                                         | 高     | step 0件・owner承認           |
| BO15     | kill switchを有効化                           | GitHub repository Variable                             | 高     | release gate後                |
| BO16     | 初回scheduled runを確認                       | GitHub Actions                                         | 高     | 成功・skip・失敗理由          |
| BO17     | 公開後に必要な場合だけ追加観測                | 運用記録                                               | 任意   | 運用完了条件外                |
| BO18     | 計画書・進捗を完了更新                        | docs                                                   | 高     | 実態と一致                    |

- [x] BO1: workflow contractをRedへ変更
- [x] BO2: scheduled wrapper testをRedへ変更
- [x] BO3: CLI failure contractをRedへ変更
- [x] BO4: workflowをGreen実装
- [x] BO5: integrity workflowをGreen実装
- [x] BO6: scheduled wrapperをGreen実装
- [x] BO7: 対象test・Refactor・format
- [x] BO8: 運用docsを同期
- [x] BO9: 旧計画へ後継リンクを追加
- [x] BO10: 最終品質ゲート
- [x] BO11: repository実装をcommit・push・PR
- [x] BO12: 過剰なsource integrity gateを運用完了条件から除外し、軽量CIを維持
- [x] BO13: `production-batch`を外部設定
- [x] BO14: merge後に旧waiting/pending runを整理
- [ ] BO15: kill switchを有効化
- [ ] BO16: 初回scheduled runを確認
- [ ] BO17: 公開後に必要な場合だけ追加観測（任意・運用完了条件外）
- [ ] BO18: 計画書・進捗を完了更新

### 実装指示用タブ区切り

```text
タスクID	タスク内容	ファイル	優先度
BO1	workflow contractをRedへ変更	backend/src/jobs/batchWorkflow.test.ts	高
BO2	scheduled wrapper testをRedへ変更	backend/src/jobs/scheduled.test.ts	高
BO3	CLI failure contractをRedへ変更	backend/src/jobs/scheduled.cli.test.ts	高
BO4	workflowをGreen実装	.github/workflows/batch.yml	高
BO5	integrity workflowをGreen実装	.github/workflows/repository-integrity.yml	高
BO6	scheduled wrapperをGreen実装	backend/src/jobs/scheduled.ts	高
BO7	対象test・Refactor・format	backend/src/jobs/*.test.ts	高
BO8	運用docsを同期	docs/09_startup_commands.md, docs/11_deployment.md	高
BO9	旧計画へ後継リンクを追加	docs/plans/batch-cron-triggers/plan.md	中
BO10	最終品質ゲート	backend/	高
BO11	repository実装をcommit・push・PR	Git	高
BO12	過剰なsource integrity gateを完了条件から除外	本計画	高
BO13	production-batchを外部設定	GitHub Environment	高
BO14	旧waiting/pending runを整理	GitHub Actions	高
BO15	kill switchを有効化	GitHub repository Variable	高
BO16	初回scheduled runを確認	GitHub Actions	高
BO17	公開後に必要な場合だけ追加観測	運用記録	任意
BO18	計画書・進捗を完了更新	docs	高
```

## 実装順序と外部操作境界

2026-08-01にbranch境界を`develop=staging`、`main=production`へ変更した。repository実装を先にdevelopへmergeし、直接release PRをmainへmergeした後、別承認で`production` / `production-batch`のbranch policyとdefault branchをmainへ切り替える。外部切替が完了するまでBO15を有効化せず、旧develop scheduleはpre-Environment branch validationでDB処理へ進ませない。

### Phase 1: repository実装

1. `feature/batch-operations-redesign`を最新`develop`から作成する。
2. TDDでcontractと実装を変更する。
3. docsと計画書を同期する。
4. 最終品質ゲートを実行する。
5. 変更種別ごとにcommitし、push、PR作成する。
6. この段階ではEnvironment、Secret、Variable、Actions runを変更しない。

### Phase 2: BO13外部preflight（2026-07-31完了・履歴）

別承認を得て、値を表示せず次を確認・設定する。

1. `production` required reviewerと当時の`develop` branch policyが維持されている。
2. `Repository Integrity / repository-integrity`がSecret・Environmentを参照しない軽量CIとして残っていることを確認する。required check化とdocs-only検証PRは求めない。
3. `production-batch`を作成し、required reviewerなし、`develop`のみ許可する。
4. 必要なSecret名・Variable名を登録する。
5. `PRODUCTION_SCHEDULED_BATCH_ENABLED`は未設定または`false`のままにする。
6. review済みPR差分に`production-batch`のmanual選択肢がないことを再確認する。

### Phase 3: merge・旧run整理

完了済み。PR #166は`develop`へmergeされ、旧run #804（ID `30419479066`）と#868（ID `30613767092`）は、jobの`steps`が空でDB処理未開始であることを確認したうえでcancelされた。2026-07-31の再確認時点で、Batch Jobsのwaiting / queued / in-progress / pendingは0件である。

### Phase 3.5: main境界への切替

1. repository境界修正をdevelopへmergeする。
2. review済みdevelop固定SHAからmainへの直接PRを作成し、別承認でmergeする。
3. production DB・batch・M1Rがmain以外をpre-Environment validationで拒否することを再確認する。
4. 別承認で`production`と`production-batch`のbranch policyをmain限定へ変更する。production required reviewerは維持する。
5. 続けてdefault branchをmainへ変更し、scheduleのsourceをmainへ切り替える。
6. kill switchは`false`のまま維持し、workflow dispatchやDB処理を実行しない。

### Phase 4: 有効化

main確定SHAのM3・M1Rを再固定し、ポートフォリオ版v0.1のM5 production preflight・deployとM6 production smoke・cleanupが完了した後に、BO15の別承認を得る。M3/M1R/M5/M6より先に定期バッチを有効化しない。

1. Environmentの識別子、Secret名、Variable名、branch policyを値非表示で再確認する。
2. `PRODUCTION_SCHEDULED_BATCH_ENABLED=true`へ変更する。
3. 最初に自然発生する各scheduled jobについて、対象SHA、job、status / conclusion、DB処理前validation、cleanup結果またはskip・失敗理由を確認する。
4. Secret、PII、内部ID、raw DB errorがlogにないことを確認する。
5. 問題があればkill switchを`false`へ戻す。

## ロールバック・停止

### 即時停止

1. `PRODUCTION_SCHEDULED_BATCH_ENABLED=false`へ戻す。
2. active scheduled runがある場合、jobとDB stepを確認する。
3. 実行中のDB stepを無条件にcancelしない。処理の冪等性と中断影響を確認して判断する。
4. 次回scheduleがskipされることを確認する。

### code rollback

1. kill switchを先に`false`へする。
2. 問題commitをrevertするPRを作成する。
3. 30分cronへは戻さない。必要なcleanupは既存manual dispatchで1回だけ行う。
4. 原因・run URL・DB影響・再有効化条件を記録する。

### 誤接続・Secret異常

- `BATCH_ENVIRONMENT`不一致またはSecret欠落時はDB処理前に失敗させる。
- production/staging取り違えの疑いがある場合はkill switchをfalseにし、Secret値を読み出さずEnvironment名・project識別用の既存preflightで確認する。
- Secretをrepository共通へ移動して回避しない。

## リスクと対策

| リスク                                    | 対策                                                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| 日次化で期限切れrowが最大約24時間30分残る | API期限判定を維持。初回runを確認し、provider警告や性能問題がある場合だけ追加観測       |
| 1回のdelete件数が増える                   | `deletedCount`と所要時間を観測し、増加時だけ6時間化・batch limitを別レビュー           |
| 自動EnvironmentのSecret露出面が増える     | main限定、scheduled専用、manual選択禁止、contents read、Secret非出力                   |
| Environmentを別workflowから参照できる     | main限定policy、source contract、manual選択禁止、kill switchで低コストに多層防御       |
| kill switch誤有効化                       | 初期false、外部preflight、review済みSHA、別承認                                        |
| manual DB操作とscheduledが重なる          | kill switch停止手順、maintenance前確認、online-safeなPrisma操作のみ                    |
| schedule遅延                              | jobはscheduled時刻ではなく実行時点の期限行を冪等処理。日次保守で厳密時刻を要件にしない |
| 未知cronが正常表示される                  | fail-closedへ変更                                                                      |
| Cloudflare移行との二重実行                | 本タスクではWorkers cronを追加しない。将来移行時にActions scheduleを先にdisable        |

## 完了条件

### repository完了

- [x] 30分cronがworkflowとscheduled wrapperから除去されている。
- [x] 日次GameQuestionSet cronがsource contractで固定されている。
- [x] schedule/manualのEnvironmentとconcurrencyが分離されている。
- [x] kill switch未設定時はscheduled jobがEnvironmentへ入らずskipする。
- [x] 未知cronがfail-closedである。
- [x] 対象test、全test、Workers test、build、lint、format checkが成功する。
- [x] docsと旧計画の後継リンクが同期している。

### BO13運用完了（履歴）

- [x] `production` required reviewerと`develop`限定branch policyが維持されている。
- [x] `Repository Integrity / repository-integrity`をSecret・Environment非参照の軽量CIとして維持し、required check化は運用完了条件から除外した。
- [x] `production-batch`がdevelop限定・manual選択不可で設定されている。
- [x] 旧waiting / pending runがstep 0件確認後に整理され、active runが0件である。

### main境界切替

- [ ] `production` required reviewerを維持したままmain限定branch policyへ変更する。
- [ ] `production-batch`をmain限定へ変更し、manual選択不可を維持する。
- [ ] repository default branchをmainへ変更し、schedule sourceをmainへ切り替える。
- [ ] kill switchが`false`で、production workflow未実行であることを再確認する。
- [ ] kill switch有効化後、最初に自然発生する各jobの成功・skip・失敗理由と秘密非出力を確認する。

default branch切替前に非mainから発生するproduction database scheduleは、branch validation jobと後続jobをskipしてproduction Environment・Secretへ到達させない。このskipをcapacity-checkまたはbackupの成功実績として数えず、main切替後の自然発生runを観測する。workflow_dispatchの非main実行はfail-closedを維持する。

公開後の長期baselineは任意であり、運用完了条件に含めない。

## Repository実装記録

- 実装日: 2026-07-31
- 実装ブランチ: `feature/batch-operations-redesign`
- PR: #166
- 状態: BO1〜BO14完了（BO13: 外部設定、BO14: 旧run整理）。有効化BO15、初回run確認BO16、最終同期BO18は未実施。BO17は任意

### 計画からの変更点

- BO3のCLIは未知cronを非0終了へ変換する。PRレビュー後、wrapperが記録済みの失敗をCLIの共通catchで再ログしないよう、wrapper例外は終了コードだけへ変換し、共通catchはCLI入力エラーの記録に限定した。
- 旧計画は履歴本文を改変せず、後継計画へのリンクだけを先頭へ追加した。

### 実際の変更ファイル

| ファイル                                       | 変更種別 | 内容                                                  |
| ---------------------------------------------- | -------- | ----------------------------------------------------- |
| `.github/workflows/batch.yml`                  | 修正     | 日次cron、event別Environment/concurrency、kill switch |
| `.github/workflows/repository-integrity.yml`   | 新規     | 全PRでbatchのproduction境界contractを検証するcheck    |
| `backend/src/jobs/batchWorkflow.test.ts`       | 修正     | workflow・integrity workflow・runbookのcontractを更新 |
| `backend/src/jobs/scheduled.ts`                | 修正     | 日次cron定数と未知cron fail-closed                    |
| `backend/src/jobs/scheduled.test.ts`           | 修正     | 日次dispatch・旧cron拒否・未知cron失敗                |
| `backend/src/jobs/scheduled.cli.ts`            | 修正     | wrapper失敗時の非0終了と二重ログ防止                  |
| `backend/src/jobs/scheduled.cli.test.ts`       | 修正     | 未知cron時の非0終了・二重ログ防止契約                 |
| `docs/09_startup_commands.md`                  | 修正     | 日次cron、manual実行、kill switch境界                 |
| `docs/11_deployment.md`                        | 修正     | Environment分離、必要Variable、初回有効化、rollback   |
| `docs/05_progress.md`                          | 修正     | repository実装中へ更新                                |
| `docs/plans/batch-cron-triggers/plan.md`       | 修正     | 履歴を維持して後継計画リンクを追加                    |
| `docs/plans/batch-operations-redesign/plan.md` | 修正     | repository実装とTDD記録                               |

### TDD記録

| フェーズ | コマンド                                                                                                         | 結果                                                |
| -------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Red      | `npm run test -- --run src/jobs/batchWorkflow.test.ts src/jobs/scheduled.test.ts src/jobs/scheduled.cli.test.ts` | 2 files失敗・1 file成功、11 tests失敗・18 tests成功 |
| Green    | `npm run test -- --run src/jobs/batchWorkflow.test.ts src/jobs/scheduled.test.ts src/jobs/scheduled.cli.test.ts` | 3 files / 29 tests成功                              |
| Refactor | format・docs同期後に同じ対象testを再実行                                                                         | 3 files / 29 tests成功                              |

### PRレビュー対応記録

#### review 4826325659

| フェーズ | コマンド                                                                                                         | 結果                                                  |
| -------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Red      | `npm run test -- --run src/jobs/scheduled.cli.test.ts`                                                           | 二重ログ禁止の1 testが意図した理由で失敗、4 tests成功 |
| Green    | `npm run test -- --run src/jobs/scheduled.cli.test.ts`                                                           | 1 file / 5 tests成功                                  |
| Refactor | `npm run test -- --run src/jobs/batchWorkflow.test.ts src/jobs/scheduled.test.ts src/jobs/scheduled.cli.test.ts` | Repository Integrity対象の3 files / 29 tests成功      |

#### review 4826419430

| フェーズ | コマンド                                                                                                         | 結果                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Red      | `npm run test -- --run src/jobs/batchWorkflow.test.ts`                                                           | 必要な3 Environment中1件だけの記載を検出し、1 test失敗・12成功 |
| Green    | `npm run test -- --run src/jobs/batchWorkflow.test.ts`                                                           | 1 file / 13 tests成功                                          |
| Refactor | `npm run test -- --run src/jobs/batchWorkflow.test.ts src/jobs/scheduled.test.ts src/jobs/scheduled.cli.test.ts` | Repository Integrity対象の3 files / 30 tests成功               |

#### review 4826486339

| フェーズ | コマンド                                                                                                         | 結果                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Red      | `npm run test -- --run src/jobs/batchWorkflow.test.ts`                                                           | 設定先の境界文がないことを検出し、1 test失敗・13 tests成功 |
| Green    | `npm run test -- --run src/jobs/batchWorkflow.test.ts`                                                           | 1 file / 14 tests成功                                      |
| Refactor | `npm run test -- --run src/jobs/batchWorkflow.test.ts src/jobs/scheduled.test.ts src/jobs/scheduled.cli.test.ts` | Repository Integrity対象の3 files / 31 tests成功           |

### 最終品質ゲート

| 確認                                           | 結果                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| `npm run test -- --run`                        | 123 files / 1276 tests成功、専用DB 4 files / 10 testsは環境変数未設定のためskip       |
| `npm run test:workers`                         | 初回は既存の実時間計測1件が一時失敗。該当12 tests単体成功後、全4 files / 32 tests成功 |
| `npm run build`                                | 成功                                                                                  |
| `npm run lint`                                 | 成功                                                                                  |
| `npm run format:check`                         | 成功                                                                                  |
| 変更workflow・主要docsの`npx prettier --check` | 成功                                                                                  |
| `git diff --check`                             | 成功                                                                                  |

### 外部設定・運用再開記録

PR #166のrepository実装ではGitHub Environment、Secret、Variable、ruleset、Actions run、production DBを変更していない。その後、旧run #804・#868はstep 0件・DB処理未開始を確認してcancelされ、BO14を完了した。

2026-07-31の初回再確認では、`production-batch`は未作成、repository Variableは0件、`PRODUCTION_SCHEDULED_BATCH_ENABLED`は未設定、`staging` / `production`の`REFRESH_TOKEN_CLEANUP_ENABLED`は未登録だった。

その後、ownerの明示承認によりBO13を実施した。`production-batch`をrequired reviewerなし・`develop`限定で作成し、`DATABASE_URL` Secret名と必要な4 Variable名を値非表示で確認した。repository kill switchは無効を維持し、`staging` / `production`の`REFRESH_TOKEN_CLEANUP_ENABLED`も安全側設定との一致を確認した。`production`のrequired reviewerと`develop`限定policyは維持され、設定後のactive Batch Jobsは0件だった。Secret値の取得・表示、workflow実行、production DB query、有効化BO15、初回run確認BO16は実施していない。

外部設定記録はPR #168として`develop`へmerge済みで、merge commitは`4c1a3739b61698a8562fb91db425502c5fa8f872`、最終headは`d5f9d5c8f7b6d5e9495a345e403a84a2db3b1cd8`である。merge後の再監査でも、kill switchの無効状態、3 Environmentのbranch policy、`production` required reviewer、`production-batch`のSecret名・Variable名、active Batch Jobs 0件を値非表示で確認した。

BO13後の再開順序は、M5 production preflight・deploy、M6 production smoke・cleanup、別承認によるBO15、自然発生するscheduled runのBO16、最終文書同期のBO18とする。この文書整備はBO15以降の実行許可ではなく、BO15/BO16/BO18は未完了を維持する。

## 実装完了時の記録

```markdown
## 実装完了

- 完了日: YYYY-MM-DD
- 実装ブランチ: feature/batch-operations-redesign
- PR: #N

### 計画からの変更点

- 変更がなければ「なし」

### 実際の変更ファイル

| ファイル | 変更種別 | 内容 |
| -------- | -------- | ---- |

### TDD記録

| フェーズ | コマンド | 結果               |
| -------- | -------- | ------------------ |
| Red      | 対象test | 意図した理由で失敗 |
| Green    | 対象test | 成功               |
| Refactor | 関連test | 成功               |

### 最終品質ゲート

| 確認          | 結果 |
| ------------- | ---- |
| backend全test |      |
| Workers test  |      |
| build         |      |
| lint          |      |
| format check  |      |

### 外部設定・初回run

| 確認                           | 結果 |
| ------------------------------ | ---- |
| production reviewer維持        |      |
| Repository Integrity軽量CI維持 |      |
| production-batch branch policy |      |
| kill switch初期false           |      |
| 旧run整理                      |      |
| 日次GameQuestionSet cleanup    |      |
| 日次audit cleanup              |      |
| 週次reset                      |      |
```
