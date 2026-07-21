# 退会時の個人情報・学習データ完全削除 実装計画

> 設計者ロール: シニアフルスタック／バックエンド／データベース／プライバシー設計エンジニア
>
> 計画日: 2026-07-15
>
> 対象進捗: フェーズ11「退会時の個人情報・学習データ完全削除方針」

## 背景・目的

現在の本人退会と管理者強制退会は `User` を soft delete するだけで、メールアドレス、ユーザー名、password hash、学習履歴が稼働DBに残る。これは `docs/02_security.md` の「アカウント削除時に個人情報・学習データを完全削除する」という目標要件を満たしていない。

本人退会と管理者強制退会を `User` の物理削除へ変更し、DB cascade により全ユーザー所有データを同一transactionで削除する。既存の soft-deleted user も安全な一回限りの移行で削除し、認証、管理API、管理UI、監査ログ、バックアップ復元手順を物理削除後の契約へ整合させる。

本計画でいう「完全削除」は、稼働DB上の個人情報・認証データ・学習データを物理削除することを指す。暗号化backup、期間限定の監査内部ID、メール配送事業者、ブラウザ等の別媒体は同一transactionでは消去できないため、保持期間、アクセス制限、復元時の再削除、利用者への開示を別途明記する。「全媒体から即時かつ無条件に消える」とは表現しない。

## スコープ

- `DELETE /api/v1/users/me` を本人確認付きの物理削除へ変更する。
- `DELETE /api/v1/admin/users/:id` を管理者による物理削除へ変更する。
- `User` 配下の認証データ・学習データが DB cascade で削除されることを保証する。
- 本人退会成功の監査 action を追加し、削除本体と同じtransactionへ保存する。
- 本人退会にも最後の利用可能な管理者保護と Serializable retry を適用する。
- 管理者強制退会時に、不可逆操作の直前で actor の管理者権限を再確認する。
- cascade 負荷に必要な外部キー index を追加する。
- 既存 soft-deleted user を dry-run、明示的execute、batch、冪等再実行で物理削除する。
- 管理画面から「退会済みユーザーをDBに保持する」前提の表示を除去する。
- 設定画面の削除説明、エラー関連付け、focus、loading/live region を改善する。
- 削除成功後、現在タブと対応ブラウザの他タブに残る認証状態を無効化する。
- backup復元時の再削除手順、段階リリース、rollback条件、release gate を整備する。
- API・セキュリティ・テスト・運用・進捗ドキュメントを実装と同期する。

## 非スコープ

- `AuditLog` 自体の閲覧・更新・個別削除API。
- 監査内部IDのHMAC化、退会時null化、legal hold。採用する場合は別schema・鍵管理設計を行う。
- 匿名化済みの永続KPI・退会者累計テーブルの新設。
- メール配送事業者や利用者のメールボックスからのメール削除。
- ブラウザ履歴、OSバックアップ、利用者が取得した画面キャプチャの遠隔削除。
- `/privacy` ページ自体の新規実装。ただし本機能の本番公開前依存関係とし、削除・backup・監査保持の説明が公開済みであることをrelease gateに含める。
- 非同期削除queueの新設。同期cascadeがプラットフォームのrequest上限を満たさない場合は本計画を再レビューし、非同期方式を別設計する。
- API v2の新設。既存v1の互換fieldはdeprecation期間中に互換値を返す。

## レビュー結果と改善内容

### この計画のまま実装すべきではない理由

初版の物理削除方針自体は妥当だが、cascade用index、最後の管理者となる本人の退会、transaction内の再確認、管理APIの互換期間、`deletedAt` contract migrationの順序、実DBcascade検証、backup復元後の再削除元が不足していた。このままでは削除遅延、最後の管理者喪失、旧frontendの破損、migration直後のAPI障害、backupからの個人情報復活を起こし得る。

### DBの整合性と負荷

1. **cascade外部キーの一部に `userId` index がない**
   - 指摘内容: `RefreshToken`、`EmailVerification`、`GameQuestionSet` は `User` への `onDelete: Cascade` を持つが、`userId` 単独indexがない。
   - 根拠: **確認できた事実**。`backend/prisma/schema.prisma` と適用済みmigrationを確認した。
   - 影響・リスク: `User` 削除時の外部キー確認が子table全体のscanになり、データ増加後に削除APIとlegacy cleanupが遅延・lock競合し得る。
   - 改善案: expand migrationで3tableへ `userId` indexを追加する。`PasswordResetToken.userId` はunique index、`WeakElement` は複合unique先頭、`GameSession` は複合index先頭、`UserStats` はPK、`GameAnswer` は `sessionId` 複合index先頭を利用する。
   - 優先度: **High**

2. **legacy selectorの規模と実行時間が未確認**
   - 指摘内容: `deletedAt IS NOT NULL` の対象件数、子row数、最大ユーザー学習量、productionのlock時間が未計測。
   - 根拠: 対象件数未確認は **確認できた事実**。将来の遅延は **推測**。
   - 影響・リスク: 一括transactionでtimeoutし、再試行やproduction運用が不安定になる。
   - 改善案: `User(deletedAt, id)` の移行用indexをexpandで追加し、dry-runでtable別総件数だけを取得する。executeは小さいbatch単位でcommitし、production前にstagingの代表最大fixtureで処理時間を計測する。
   - 優先度: **High**

3. **cascade対象の将来追加を検知できない**
   - 指摘内容: 現在のrelationは削除できるが、将来ユーザー所有modelが追加された際の計画・test guardがない。
   - 根拠: **確認できた事実**。現在は全所有relationにcascadeがあるが、schema inventoryを固定するtestはない。
   - 影響・リスク: 新しい個人データtableだけが残る、またはRESTRICTで削除APIが500になる。
   - 改善案: schema contract testと専用PostgreSQL integration fixtureを追加し、全所有model・共有model・監査例外を明示する。
   - 優先度: **High**

4. **N+1の重大な問題は現行一覧にはない**
   - 指摘内容: 管理一覧は Prisma relation `select` を1queryで取得しており、現行コードにN+1は確認されなかった。
   - 根拠: **確認できた事実**。
   - 影響・リスク: cleanupをユーザーごとのcount loopで実装すると新たなN+1を作る。
   - 改善案: dry-run/countはtableごとの固定本数query、executeはbatch IDに対する集合queryとDB cascadeを使い、ユーザーごとの子table count loopを禁止する。
   - 優先度: **Medium**

### API・コードの整合性

1. **本人退会に最後の管理者保護がない**
   - 指摘内容: 管理者強制退会は最後の利用可能な管理者を保護するが、`deleteCurrentUser()` は同じ保護を通らない。
   - 根拠: **確認できた事実**。
   - 影響・リスク: 最後のADMINが設定画面から退会し、管理機能へアクセスできる利用者が0人になる。
   - 改善案: 本人退会もSerializable transaction内で最新role/stateと利用可能な管理者数を確認し、最後の管理者なら409で拒否する。
   - 優先度: **High**

2. **パスワード照合後のTOCTOUがある**
   - 指摘内容: bcrypt照合後、transaction内で `passwordHash` や対象rowを再確認せず更新している。
   - 根拠: **確認できた事実**。
   - 影響・リスク: 並行するパスワード変更・role変更・二重削除と競合し、古い本人確認結果で不可逆削除する可能性がある。
   - 改善案: bcryptはtransaction外で行い、transaction内で `passwordHash` と最新role/stateを再読込する。hash変更、対象消失、P2034枯渇は409に正規化する。
   - 優先度: **High**

3. **Serializable retryロジックがadmin service専用で再利用できない**
   - 指摘内容: P2034判定と最大2回retryが `admin.service.ts` のprivate helperに閉じている。
   - 根拠: **確認できた事実**。
   - 影響・リスク: 本人退会側へ複製すると定数・判定・testがずれる。
   - 改善案: Prisma transaction retryを共通helperへ切り出し、admin/user側でdomain errorへ変換する。
   - 優先度: **Medium**

4. **管理者actorの権限再確認が不可逆操作直前にない**
   - 指摘内容: `authMiddleware` はDBの最新roleを読むが、その後にactorが降格・停止されても既存transactionは強制退会を続行できる。
   - 根拠: middlewareとservice間の再確認がないことは **確認できた事実**。実競合の発生頻度は **推測**。
   - 影響・リスク: 権限喪失後の管理者が物理削除をcommitするTOCTOUとなる。
   - 改善案: 強制退会transaction内でactorが利用可能なADMINか再確認し、変化時は409で中止する。全admin mutationへの横展開は別タスク候補とし、本タスクでは不可逆な強制退会を必須対象とする。
   - 優先度: **High**

5. **再登録・認証エラーの意味が物理削除後に変わる**
   - 指摘内容: 現在は削除済みrowが残るため再登録403・login 403だが、物理削除後は新規登録可能、旧loginは存在しないユーザーとして401になる。
   - 根拠: **確認できた事実**。
   - 影響・リスク: frontend、API文書、testが現状文言のままだと契約不一致になる。username再利用による表示上のなりすましリスクもある。
   - 改善案: 同一email/usernameの再登録を許可し、新しいUser IDを発行する方針を明記する。旧IDとの自動再関連付けは禁止し、username再利用リスクをリリース承認事項にする。
   - 優先度: **High**

### 監査・プライバシー

1. **本人退会の成功監査がない**
   - 指摘内容: 管理者強制退会には成功監査があるが、本人退会にはactionも監査insertもない。
   - 根拠: **確認できた事実**。
   - 影響・リスク: 誰がいつ不可逆削除を完了したかを内部IDで追跡できず、復元後の再削除候補抽出にも使えない。
   - 改善案: `USER_ACCOUNT_DELETE / SUCCESS` を追加し、`actorId = targetId`、削除前role、PIIなしで削除transactionへ含める。監査insert失敗時は削除全体をrollbackする。
   - 優先度: **High**

2. **監査内部ID保持は正式承認済みではない**
   - 指摘内容: 365日と退会後raw内部ID保持は文書上の暫定案で、本番承認者・通知先が未確定。
   - 根拠: **確認できた事実**。`docs/02_security.md` と監査運用計画に未承認gateが残る。
   - 影響・リスク: 再識別可能な内部IDを承認なしで本番保持し、利用者説明とも不一致になる。
   - 改善案: プライバシー責任者またはプロダクトオーナーの承認者・日付・期間・目的・問い合わせ先を記録するまで本番公開をblockする。
   - 優先度: **High**

3. **backupからの復元で削除済み個人情報が復活し得る**
   - 指摘内容: backup後に削除されたUserは、そのbackupを復元すると復活する。現行DBも失った災害では、backup後の削除IDを取得する独立sourceがない。
   - 根拠: backupが7日保持・PITRなしであること、独立削除ledgerがないことは **確認できた事実**。災害発生は **推測**。
   - 影響・リスク: 「復元時に必ず再削除する」という約束を完全には保証できない。
   - 改善案: 現行DBが読める復元では監査actionから再削除する。現行DB全損時の外部replay sourceを導入するか、残余リスクと最長7日のbackup保持を正式承認・開示する。どちらも未確定のまま完全削除を対外表明しない。
   - 優先度: **High**

### migration・本番運用

1. **`deletedAt` 削除を同一releaseに入れるとmigration順序が壊れる**
   - 指摘内容: productionは `prisma migrate deploy` をAPI deploy前に実行する。稼働中コードが `deletedAt` を参照したまま列をdropすると、新API切替前に障害になる。
   - 根拠: **確認できた事実**。
   - 影響・リスク: login、ranking、admin、admin-createがcolumn不存在で失敗する。
   - 改善案: index追加、物理削除、legacy cleanup、`deletedAt`非参照コードの先行deploy、backup世代待ち、列dropの順に分離する。drop後のrollback先は非参照版だけに限定する。
   - 優先度: **High**

2. **古いbackupとcontract migrationの組合せが未定義**
   - 指摘内容: soft-deleted rowを含むbackupへcolumn dropだけを適用すると、PIIが残ったinactive userとして残存する。
   - 根拠: **確認できた事実**に基づく migration結果の **推測**。
   - 影響・リスク: 復元時にlegacy PIIを削除せず列だけ失う。
   - 改善案: legacy cleanup後に暗号化backupを作成し、7日間の旧Artifact失効を待ってからdropする。drop migrationは `deletedAt IS NOT NULL` が1件でもあればIDを出さず失敗するguardを持つ。
   - 優先度: **High**

3. **production cleanupの二重確認が不足**
   - 指摘内容: 既存workflowはcapacity、backup、migrationだけで、legacy user削除用operationとbackup gateがない。
   - 根拠: **確認できた事実**。
   - 影響・リスク: 開発端末からの誤接続、dry-runなし実行、古いbackupでの実行が起こり得る。
   - 改善案: production固定workflowへdry-run/executeを追加し、execute flag、確認文字列、24時間以内のbackup run ID、既存concurrencyを必須化する。
   - 優先度: **High**

### UI / A11Y

1. **削除同意エラーがパスワード欄へ誤関連付けされる**
   - 指摘内容: 設定画面は password未入力、同意未チェック、API失敗を単一 `deleteError` で扱い、すべて password inputへ `aria-invalid` / `aria-describedby` を付ける。
   - 根拠: **確認できた事実**。
   - 影響・リスク: スクリーンリーダーが、正しいpassword欄を誤って無効と読み上げる。どのcontrolを修正すべきか分からない。
   - 改善案: password error、acknowledgement error、form/API errorを分離し、各controlへ正しく関連付ける。client validation後は最初の無効controlへfocusする。
   - 優先度: **High**

2. **管理者が詳細dialogから削除すると不存在detailを再取得する**
   - 指摘内容: 現行 `synchronizeAfterMutation()` は削除後も `shouldRestoreDetail=true` ならdetailを再取得する。
   - 根拠: **確認できた事実**。
   - 影響・リスク: 物理削除後は404となり、成功直後にエラーdialogを見せる。元のtriggerも一覧から消えるためfocus復帰が不安定になる。
   - 改善案: delete成功はdetail再取得を禁止し、dialogを閉じ、一覧・統計を同期し、次の行の操作buttonまたは一覧headingへfocusし、live regionで成功を通知する。
   - 優先度: **High**

3. **他タブのsessionStorageが残る**
   - 指摘内容: 現在タブは `logout()` でclearされるが、`sessionStorage` はtab単位で、他タブへ削除完了を通知する実装がない。
   - 根拠: **確認できた事実**。
   - 影響・リスク: server accessは401になるが、他タブにusername等の古い表示が一時的に残る。
   - 改善案: PII/tokenを含めない `BroadcastChannel` eventで他タブのrefreshをabortし、local auth stateをclearする。未対応browserではserver側401を最終防御とし、制約を記録する。
   - 優先度: **Medium**

4. **既存dialogの基本A11Yには重大な問題なし**
   - 指摘内容: `AdminDialog` はdialog semantics、focus trap、Escape、busy中close禁止、trigger消失時fallback focusを実装済み。
   - 根拠: **確認できた事実**。
   - 影響・リスク: 削除後に正しいfallbackを渡さない場合だけ既存機構を活用できない。
   - 改善案: 共通dialog自体の再実装はせず、削除成功分岐とtestを追加する。
   - 優先度: **Low**

### テスト

1. **mock testだけではDB cascadeを証明できない**
   - 指摘内容: 現行本人・管理者削除testはPrisma mockでsoft delete呼出しだけを確認している。
   - 根拠: **確認できた事実**。
   - 影響・リスク: migration上のFK不足、RESTRICT、GameAnswerの間接cascade、監査rollbackを見逃す。
   - 改善案: 専用Docker PostgreSQL DBで全所有modelを作成し、User削除後の0件、共有Element残存、AuditLog残存、audit失敗時rollback、2回目挙動を検証する。
   - 優先度: **High**

2. **競合・旧データ・復元のtest matrixが不足**
   - 指摘内容: self deleteのP2034、password変更競合、最後の管理者、admin actor降格、legacy batch再実行、途中失敗、restore replayが未test。
   - 根拠: **確認できた事実**。
   - 影響・リスク: 稀だが不可逆な誤削除・削除漏れを回帰で検知できない。
   - 改善案: unit、route、integration、workflow contract、staging manualを分担し、後述test一覧をrelease gateへ含める。
   - 優先度: **High**

3. **設定画面の削除A11Y testが不足**
   - 指摘内容: 現行page testは主に73byte password送信を確認し、control別error関連付け、focus、多重送信、success後の他tab clearを検証していない。
   - 根拠: **確認できた事実**。
   - 影響・リスク: 見た目では気付きにくいA11Y回帰が残る。
   - 改善案: DOM testにkeyboard submit、focus、`aria-invalid`、`aria-describedby`、`role=alert/status`、二重送信、error保持、cross-tabを追加する。
   - 優先度: **High**

## 現状調査結果

### 確認できた事実

| 領域        | 事実                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 本人退会    | `deleteCurrentUser()` は `isActive=false`, `deletedAt=now`, `lockedUntil=null` とtoken削除を行い、学習データとUser rowを残す。監査はない。 |
| 管理者退会  | `forceDeleteAdminUser()` はSerializable・最大2回retry・最後の管理者保護・成功/失敗監査を持つが、対象をsoft deleteする。                    |
| DB relation | User所有データは全て直接または `GameSession` 経由で `onDelete: Cascade`。`Element` は共有masterで残す。                                    |
| 監査        | `AuditLog` はUser relationを持たず、User削除後も `actorId` / `targetId` を保持できる。                                                     |
| 認証        | access token requestは毎回UserをDB参照するため、User物理削除後は401。refresh tokenはUser削除cascade後に見つからず401。                     |
| 再登録      | 現在はsoft-deleted rowを検出して403。物理削除後はunique値が解放され、新規Userとして登録できる。                                            |
| 管理API     | `deletedAt`、`status=deleted`、`users.deleted`、退会済みUIを公開契約として持つ。                                                           |
| 管理UI      | 削除を含むmutation後に一覧を再取得し、detail起点では対象detailも再取得する。                                                               |
| 設定UI      | passwordをtrim後1回計算し、多重送信guardを持つ。成功時はtoast、logout、`/` 遷移。                                                          |
| backup      | production Free planはPITRなし。暗号化logical backup Artifactを7日保持するworkflowがある。                                                 |
| production  | migrationは24時間以内の成功backupを確認し、API deploy前に `prisma migrate deploy` する。                                                   |
| 進捗        | 完全削除は監査保持とは別の本番公開前ブロッカーとして未完了。                                                                               |

### 未確認・承認待ち

| 項目                                                          | 状態                 | releaseへの影響                                 |
| ------------------------------------------------------------- | -------------------- | ----------------------------------------------- |
| production/stagingのlegacy soft-deleted user件数と子row数     | 未計測               | execute前dry-run必須                            |
| 最大ユーザーのGameSession / GameAnswer件数とcascade所要時間   | 未計測               | 同期削除可否のperformance gate                  |
| 監査保持365日・退会後raw内部ID・承認者・問い合わせ先          | 正式承認未完了       | 本番公開block                                   |
| `BACKUP_ENCRYPTION_PASSPHRASE` 登録、初回backup/migration実績 | 監査運用計画上未完了 | production migration/cleanup block              |
| 現行DB全損時のbackup後削除ID replay source                    | 未導入               | 完全削除の対外表明blockまたは残余リスク承認必須 |
| メール配送事業者・アプリログ・ブラウザcacheの保持期間         | 未確認               | privacy policy文言確定block                     |
| frontend asset/cacheの互換期間                                | 未確認               | v1互換fieldは本タスクでは削除せずdeprecated維持 |
| username再利用のプロダクト承認                                | 未確認               | 公開前承認必須                                  |

## 削除対象データ

| データ/model            | 個人との関係                                  | 稼働DBでの方針                               | 削除経路                                  | 検証                        |
| ----------------------- | --------------------------------------------- | -------------------------------------------- | ----------------------------------------- | --------------------------- |
| `User`                  | email、username、passwordHash、role、認証状態 | 物理削除                                     | `tx.user.delete`                          | PK検索0件                   |
| `RefreshToken`          | 認証session                                   | 削除                                         | User FK cascade                           | `userId` 0件                |
| `EmailVerification`     | メール確認token                               | 削除                                         | User FK cascade                           | `userId` 0件                |
| `PasswordResetToken`    | password reset token                          | 削除                                         | User FK cascade                           | `userId` 0件                |
| `WeakElement`           | 苦手学習データ                                | 削除                                         | User FK cascade                           | `userId` 0件                |
| `GameSession`           | 得点・正答・時間・履歴                        | 削除                                         | User FK cascade                           | `userId` 0件                |
| `GameAnswer`            | 問題・回答・正誤                              | 削除                                         | GameSession FK cascade                    | deleted session由来0件      |
| `GameQuestionSet`       | 一時問題・正解JSON                            | 削除                                         | User FK cascade                           | `userId` 0件                |
| `UserStats`             | 集計学習データ                                | 削除                                         | User FK cascade                           | `userId` 0件                |
| `AuditLog`              | 内部IDによる相関可能性                        | 承認期間だけ例外保持                         | User FKなし。保持期限cleanupでrowごと削除 | User削除後も必要rowのみ存在 |
| `Element`               | 共有元素master                                | 保持                                         | User relationなし                         | fixture Elementが残る       |
| 暗号化backup            | 削除前PIIを含み得る                           | 最大7日、アクセス制限、復元時再削除          | Artifact expiry / restore runbook         | Artifact期限・再削除結果    |
| browser認証状態         | access token、username等                      | 現在tabを即時clear、対応browserの他tabへ通知 | auth store / BroadcastChannel             | DOM/store test              |
| 配送済みメール・外部log | DB外copy                                      | provider保持規約に従い開示                   | 本transaction外                           | provider設定の確認記録      |

## 前提条件・依存関係

### 既存の実装（公開インターフェース）

**`backend/src/services/user.service.ts`**

- `deleteCurrentUser(input: { userId: string; currentPassword: string }): Promise<void>` — 本人passwordを確認し、現在はUserをsoft deleteする。
- `UserError(status: 400 | 403 | 409, message: string)` — user serviceの公開エラー。

**`backend/src/services/admin.service.ts`**

- `forceDeleteAdminUser(input: { adminUserId: string; targetUserId: string }): Promise<{ message: string }>` — 現在は対象Userをsoft deleteし、監査付きtransactionを実行する。
- `getAdminUsers(input?: AdminUserListQuery): Promise<{ users: AdminUserListItem[]; nextCursor: string | null }>` — cursor pagination付き一覧。
- `getAdminUserDetail(input: { userId: string }): Promise<{ user: AdminUserDetail }>` — 管理者用詳細。
- `getAdminStats(): Promise<AdminStats>` — user/game/learning集計。

**`backend/src/services/audit.service.ts` / `audit-events.ts`**

- `recordAuditEvent(client, event): Promise<void>` — strict schema検証後にtransaction clientで監査rowを作る。
- `recordAuditEventBestEffort(event): Promise<void>` — 許可済み失敗監査を本処理へ影響させず記録する。
- `AUDIT_ACTIONS` — login、password、admin操作の許可action集合。

**`backend/src/lib/refresh-token-cookie.ts`**

- `clearRefreshTokenCookies(c, requestPath): void` — `/api/v1/auth` と `/api/v1/auth/refresh` のCookieを削除する。

**`frontend/src/lib/api/users.ts`**

- `deleteCurrentUser(options: DeleteCurrentUserOptions): Promise<UserMessageResponse>` — backend error本文を保持し、success responseをruntime検証する。

**`frontend/src/lib/stores/auth.svelte.ts`**

- `logout(): Promise<void>` — refreshをabortし、現在tabのstate/sessionStorageを先にclearしてからlogout APIを呼ぶ。
- `refresh(): Promise<boolean>` — HttpOnly refresh Cookieでaccess tokenを更新する。

**`frontend/src/lib/api/admin.ts`**

- `deleteAdminUser(options: DeleteAdminUserOptions): Promise<AdminMessageResponse>` — 管理者強制退会API。
- `getAdminUsers` / `getAdminUserDetail` / `getAdminStats` — runtime validator付き管理API client。

### 重要な制約

- Prisma v7のclientは `PrismaPg` adapter経由とし、`schema.prisma` のdatasourceへ `url` を追加しない。
- DBアクセスはPrisma ORMを使う。migration DDL以外のraw queryを追加しない。
- API入力はroute入口のZodで検証し、既存のstrict payloadと日本語error形式を維持する。
- passwordは既存の `normalizePassword()` とbcrypt完全比較を使い、平文を保存・logしない。
- User削除と成功監査は同一transaction。監査作成失敗時はUserと全cascadeをrollbackする。
- AuditLogへemail、username、password、token、Cookie、request/response、raw errorを保存しない。
- 一般API/account rate limitを迂回しない。
- `Element` を削除しない。
- 既存migrationを編集しない。index追加とcontract削除は新しいmigrationで行う。
- production DB操作は既存Environment、Secret、backup gate、concurrencyを使い、端末から直接実行しない。
- drop migration後は `deletedAt` 参照版へrollbackしない。

### 実装開始前に確定する事項

#### T1A: コード実装前に確定する契約

- [x] Userを物理削除し、所有データはDB cascadeで削除する。共有Elementと承認期間内のAuditLogは保持する。
- [x] 本人退会成功は `USER_ACCOUNT_DELETE / SUCCESS` を削除transaction内へ保存し、内部IDとrole以外のPIIを含めない。
- [x] 同一email/usernameの再登録を許可し、旧accountと関連付かない新しいUser IDを発行する。
- [x] 暗号化backupは最長7日保持し、復元時に再削除する。稼働DB外の媒体境界をprivacy policy/UIへ開示する。
- [x] 現行DB全損時の外部削除replayは別タスクとし、導入または残余リスクの正式承認まで本番公開をblockする。
- [x] 同期cascadeのperformance合格値は、platform request timeoutの50%以内かつ5秒以内の短い方とする。

確定日: 2026-07-16。今回の確定はコード・staging検証の開始条件であり、次のT1Bを承認済みにはしない。

#### T1B: 本番公開前に確定する運用gate

- [ ] 監査内部ID保持期間、目的、承認者、承認日、問い合わせ先。
- [ ] backup最長7日と復元時再削除をprivacy policy/UIへ記載する正式文言。
- [ ] 現行DB全損時の削除replay sourceを導入するか、残余リスクを承認するかの最終判断。
- [ ] production cleanupの実行者・承認者・実行時間帯・通知先。

## 対象ファイル一覧

`<timestamp>` と「候補」と記載した新規名は実装時に確定し、`## 実装完了` で実ファイル名へ更新する。

### 新規候補

| ファイル                                                                           | 変更種別 | 内容                                                 |
| ---------------------------------------------------------------------------------- | -------- | ---------------------------------------------------- |
| `backend/prisma/migrations/<timestamp>_add_account_deletion_indexes/migration.sql` | 新規候補 | cascade FKとlegacy selectorのexpand index            |
| `backend/prisma/migrations/<timestamp>_drop_users_deleted_at/migration.sql`        | 新規候補 | 旧backup失効後のguard付きcontract migration          |
| `backend/src/lib/serializable-transaction.ts`                                      | 新規候補 | P2034最大2回retryの共通helper                        |
| `backend/src/lib/serializable-transaction.test.ts`                                 | 新規候補 | retry/non-retry/exhaustion test                      |
| `backend/src/lib/usable-admin.ts`                                                  | 新規     | 利用可能account・ADMIN判定とcount条件を一元管理      |
| `backend/src/jobs/deleteLegacySoftDeletedUsers.ts`                                 | 新規     | dry-run、batch execute、aggregate、許可field log     |
| `backend/src/jobs/deleteLegacySoftDeletedUsers.test.ts`                            | 新規     | cleanup unit test                                    |
| `backend/src/jobs/deleteLegacySoftDeletedUsers.cli.ts`                             | 新規     | CLI引数・環境gate・PrismaPg初期化                    |
| `backend/src/jobs/deleteLegacySoftDeletedUsers.cli.test.ts`                        | 新規     | CLI安全策・秘密情報非出力test                        |
| `backend/src/jobs/accountDeletion.integration.test.ts`                             | 新規     | 専用PostgreSQLでcascade/監査/rollback/並行削除を検証 |
| `backend/src/services/account-deletion-schema.test.ts`                             | 新規候補 | User所有relationとcascade/index inventory contract   |
| `.github/workflows/staging-account-data-deletion.yml`                              | 新規     | staging固定dry-run/execute workflow                  |
| `backend/src/jobs/accountDeletionWorkflow.test.ts`                                 | 新規     | staging/production workflow contract test            |
| `frontend/src/lib/stores/auth.svelte.test.ts`                                      | 新規候補 | account deletion後のcurrent/cross-tab clear test     |

### 修正対象

| ファイル                                                                        | 変更種別 | 内容                                                                  |
| ------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------- |
| `backend/prisma/schema.prisma`                                                  | 修正     | `userId` index、移行用index、最終phaseで `deletedAt` 削除             |
| `backend/src/services/user.service.ts`                                          | 修正     | 本人物理削除、password再確認、最後の管理者保護、成功監査、409整合     |
| `backend/src/services/user.service.test.ts`                                     | 修正     | self delete unit/rollback/concurrency/last-admin test                 |
| `backend/src/services/admin.service.ts`                                         | 修正     | 管理者物理削除、actor再確認、共通retry、互換集計                      |
| `backend/src/services/admin.service.test.ts`                                    | 修正     | cascade呼出し、actor権限、last-admin、P2034、404、統計test            |
| `backend/src/services/audit-events.ts`                                          | 修正     | `USER_ACCOUNT_DELETE` 成功schema                                      |
| `backend/src/services/audit.service.test.ts`                                    | 修正     | 新action strict schema、PII/余剰field拒否                             |
| `backend/src/routes/users/index.ts`                                             | 修正     | 409を含む物理削除error契約を維持、Cookie確認                          |
| `backend/src/routes/users/delete-me.test.ts`                                    | 修正     | status/body/Cookie/error形式回帰                                      |
| `backend/src/routes/admin/index.ts`                                             | 修正     | 互換fieldを合成しつつ物理削除後404契約へ整合                          |
| `backend/src/routes/admin/user-delete.test.ts`                                  | 修正     | 200/404/409/429/500 response契約                                      |
| `backend/src/routes/admin/users.test.ts`                                        | 修正     | `status=deleted` deprecation互換と空結果                              |
| `backend/src/routes/admin/user-detail.test.ts`                                  | 修正     | 物理削除済みIDの404                                                   |
| `backend/src/routes/admin/user-status.test.ts`                                  | 修正     | deprecated `deletedAt:null` 互換field                                 |
| `backend/src/routes/admin/user-role.test.ts`                                    | 修正     | deprecated `deletedAt:null` 互換field                                 |
| `backend/src/routes/admin/stats.test.ts`                                        | 修正     | current row count、deprecated `deleted:0`、current data集計           |
| `backend/src/services/auth.service.ts`                                          | 修正     | 削除後loginの汎用401、auth回帰、contract phaseで `deletedAt` 参照除去 |
| `backend/src/routes/auth/register.test.ts`                                      | 修正     | 削除後の同一email/username再登録                                      |
| `backend/src/routes/auth/login.test.ts`                                         | 修正     | 旧資格情報401、contract後のaccount state                              |
| `backend/src/routes/auth/forgot-password.test.ts`                               | 修正     | 削除後・legacy rowの200 no-op                                         |
| `backend/src/routes/auth/refresh.test.ts`                                       | 修正     | cascade後のtoken不存在401とCookie削除                                 |
| `backend/src/middleware/auth/auth.test.ts`                                      | 修正     | 物理削除後の旧access token 401                                        |
| `backend/src/services/ranking.service.ts`                                       | 修正     | contract phaseで `deletedAt` filter除去、`isActive` と物理存在へ整合  |
| `backend/src/services/ranking.service.test.ts`                                  | 修正     | suspended/不存在のranking除外回帰                                     |
| `backend/src/services/admin-create.service.ts`                                  | 修正     | contract phaseで `deletedAt` 参照除去                                 |
| `backend/src/services/admin-create.service.test.ts`                             | 修正     | contract後の既存user判定                                              |
| `backend/src/lib/config.ts`                                                     | 修正     | legacy削除execute flag・batch sizeの一元検証                          |
| `backend/src/lib/config.test.ts`                                                | 修正     | default false、境界、不正値test                                       |
| `backend/.env.example`                                                          | 修正     | 安全側defaultの環境変数例                                             |
| `backend/package.json` / `backend/package-lock.json`                            | 修正     | cleanup/integration npm script                                        |
| `.github/workflows/production-database.yml`                                     | 修正     | dry-run/execute operation、確認文字列、backup gate、concurrency       |
| `backend/src/jobs/productionDatabaseWorkflow.test.ts`                           | 修正     | production workflow安全契約                                           |
| `frontend/src/lib/api/admin.ts`                                                 | 修正     | UI内部型からdeleted状態を除去し、v1互換extra fieldを許容              |
| `frontend/src/lib/api/admin.test.ts`                                            | 修正     | 物理削除後のvalidator/query/統計契約                                  |
| `frontend/src/lib/admin/query.ts`                                               | 修正     | 旧 `status=deleted` URLをdropしてcanonicalize                         |
| `frontend/src/lib/admin/query.test.ts`                                          | 修正     | 旧URL、active/suspended、未知値の正規化                               |
| `frontend/src/lib/admin/actions.ts` / `actions.test.ts`                         | 修正     | soft-deleted状態依存を除去                                            |
| `frontend/src/lib/components/admin/AdminUserFilters.svelte` / `.test.ts`        | 修正     | 退会済みfilter除去、keyboard/label回帰                                |
| `frontend/src/lib/components/admin/AdminUserList.svelte` / `.test.ts`           | 修正     | 退会済み表示・分岐除去、削除後focus対象                               |
| `frontend/src/lib/components/admin/AdminUserDetail.svelte` / `.test.ts`         | 修正     | 退会済み表示・分岐除去、404/empty回帰                                 |
| `frontend/src/lib/components/admin/AdminActionConfirmation.svelte` / `.test.ts` | 修正     | 物理削除説明、既存dialog A11Y維持                                     |
| `frontend/src/lib/components/admin/AdminStatsSection.svelte` / `.test.ts`       | 修正     | 「現在の登録ユーザー」表示、退会済みcard除去                          |
| `frontend/src/routes/(app)/admin/+page.svelte`                                  | 修正     | delete成功時detail再取得禁止、一覧同期、focus/live region             |
| `frontend/src/routes/(app)/admin/admin-page.test.ts`                            | 修正     | delete後404防止、focus、live message、sync failure                    |
| `frontend/src/routes/(app)/settings/+page.svelte`                               | 修正     | 説明文、control別error、focus、busy/live、account deletion clear      |
| `frontend/src/routes/(app)/settings/settings-page.test.ts`                      | 修正     | A11Y、keyboard、多重送信、error、成功遷移test                         |
| `frontend/src/lib/stores/auth.svelte.ts`                                        | 修正     | PIIなしcross-tab deletion event、refresh abort、state clear           |
| `docs/02_security.md`                                                           | 修正     | 稼働DB削除、監査/backup例外、正式承認                                 |
| `docs/04_api.md`                                                                | 修正     | self/admin/auth/admin statsの最終契約とdeprecation                    |
| `docs/05_progress.md`                                                           | 修正     | 計画書link、実装中/完了状態                                           |
| `docs/07_testing_flow.md`                                                       | 修正     | 専用account deletion integration DB手順                               |
| `docs/09_startup_commands.md`                                                   | 修正     | dry-run/executeの安全な起動方法                                       |
| `docs/11_deployment.md`                                                         | 修正     | rollout、cleanup、backup、restore、rollback runbook                   |
| `docs/plans/account-data-complete-deletion/plan.md`                             | 修正     | 実装中checkと実装完了記録                                             |

### 確認のみ・変更禁止

| ファイル                                                    | 理由                                                                   |
| ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| 既存 `backend/prisma/migrations/**`                         | migration履歴は編集しない                                              |
| `docs/plans/settings-page/plan.md`                          | soft delete採用当時の履歴として保持し、今回の計画・API文書で上書きする |
| `docs/plans/admin-apis/plan.md` / `admin-dashboard/plan.md` | 実装当時の履歴として保持し、今回の計画でcontract変更を記録する         |
| `docs/plans/audit-log-production-operations/plan.md`        | 監査保持のsourceを参照し、完全削除の実装記録は本計画へ分離する         |

### T33 staging検証follow-upで追加する対象

PR #99 merge後の再確認で、既存の`Staging Database Setup`はmigration適用のみ、`Staging Account Data Deletion`はT35のlegacy cleanup専用であり、T33のindex作成時間・write待ち・live cascade性能を安全に測定する手段が未実装と判明した。T33では既存Userを変更せず、staging固定のsynthetic fixtureだけを使う専用手段を追加する。

| ファイル                                                                                                                | 変更種別 | 内容                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/src/lib/staging-database-target.ts` / `.test.ts`                                                               | 新規     | `BATCH_ENVIRONMENT`、project ref、DATABASE_URLのprotocol・username・host・port・pathを一元検証                                           |
| `backend/src/jobs/validateStagingDatabaseTarget.cli.ts` / `.test.ts`                                                    | 新規     | migration前に秘密情報を出さずstaging接続先を検証                                                                                         |
| `backend/src/jobs/stagingAccountDeletionPerformance.ts` / `.test.ts`                                                    | 新規     | 既存Userの最大session/answer・残存fixture・Element有無preview、上限付きsynthetic fixture、実service経路の削除時間・合格判定・cleanup状態 |
| `backend/src/jobs/stagingAccountDeletionPerformance.cli.ts` / `.test.ts`                                                | 新規     | preview既定、executeのflag・明示引数・確認文字列、終了code、cleanup状態を含む安全log                                                     |
| `.github/workflows/staging-account-deletion-performance.yml`                                                            | 新規     | manual-only・staging/develop固定のpreview/execute workflow                                                                               |
| `backend/src/jobs/stagingAccountDeletionPerformanceWorkflow.test.ts`                                                    | 新規     | production/schedule不在、共通concurrency、三重gate、秘密非出力のworkflow契約                                                             |
| `.github/workflows/staging-database.yml`                                                                                | 修正     | 通常migration・T33計測・確認文字列付きElement seedを分離                                                                                 |
| `backend/prisma/seed.ts`                                                                                                | 修正     | 118元素をPrisma `upsert`し、失敗時は生Errorを出さず非ゼロ終了                                                                            |
| `backend/src/jobs/stagingDatabaseWorkflow.test.ts`                                                                      | 修正     | 通常適用・T33計測・Element seed、直列化・秘密非出力契約                                                                                  |
| `backend/src/jobs/stagingAuditCleanupFixtures.ts` / `.test.ts`                                                          | 修正     | 重複するstaging DB接続先検証を共通helperへ移行                                                                                           |
| `.github/workflows/staging-audit-cleanup-fixtures.yml` / `backend/src/jobs/stagingAuditCleanupFixturesWorkflow.test.ts` | 修正     | project refをEnvironment Secret参照へ統一し、Actionsのenv一覧への露出を防止                                                              |
| `backend/src/lib/config.ts` / `.test.ts` / `backend/.env.example`                                                       | 修正     | staging性能測定flagの安全側defaultと厳格validationを一元管理                                                                             |
| `backend/package.json`                                                                                                  | 修正     | staging接続検証・account deletion性能測定の専用script追加                                                                                |
| `docs/09_startup_commands.md` / `docs/11_deployment.md`                                                                 | 修正     | T33 workflowのpreview/execute、停止条件、結果記録手順                                                                                    |
| `docs/05_progress.md` / 本計画書                                                                                        | 修正     | 初回preview失敗、安全停止、Prisma生成・Secret参照修正を記録                                                                              |

T33のperformance executeは、専用Environment flag、`--execute`、確認文字列、session件数、answer件数、platform request timeoutをすべて明示した場合だけ許可する。既存Userの最大件数がfixture上限または指定件数を超える場合は削除を開始せず、本番公開をblockして計画を再レビューする。

## 実装方針

### 不変条件

1. APIが200を返した時点で、対象Userと全ユーザー所有rowは稼働DBから消えている。
2. Userまたは子rowの削除と成功監査は、すべてcommitするか、すべてrollbackする。
3. `Element` と承認済み保持期間内の `AuditLog` は削除しない。
4. 成功監査には内部IDとroleだけを保存し、PII、秘密情報、request body、raw errorを保存しない。
5. 本人退会・管理者強制退会のどちらでも、利用可能な管理者を0人にしない。
6. 並行password/role/status/deleteと整合できない場合は削除せず409を返す。
7. legacy cleanupは対象が0件でも成功し、再実行で追加削除がなければ0件成功になる。
8. backupを復元して公開trafficへ切り替える前に、復元後の再削除checkを完了する。
9. log、Actions summary、error responseへ内部ID、email、username、接続情報、生Errorを出さない。
10. `deletedAt` contract drop前に、稼働code、rollback対象、保持中backupのすべてがdropと互換であることを確認する。

### データ状態の最終形

- 現在利用中または停止中のaccountだけが `users` に存在する。
- 退会完了したaccountのtombstone、email hash、username reservationは作らない。
- 同一email/usernameで再登録したaccountは新しいUser IDを持ち、旧監査内部IDへ自動的に結び付けない。
- 管理画面の「退会済み」表示・filter・累計は廃止する。
- v1互換の `deletedAt` / `users.deleted` / `status=deleted` は移行期間中だけdeprecated互換値を返し、DB soft deleteの根拠にはしない。
- `users.total` は「現在DBに存在するUser row数」であり、退会者を含むhistorical KPIではない。
- game/learning集計も現在保持しているUser所有rowの集計であり、退会後に減少する。

## DB変更方針

### relation・cascade

物理削除はUserを起点にし、個別tableの `deleteMany` を列挙して削除の正しさを担保しない。DBの外部キーcascadeをsource of truthとする。個別token削除はUser削除前に実行しない。重複実装を避け、将来のrelation追加をschema contract testで検知する。

| relation                  | 現行制約                                | 最終方針                 |
| ------------------------- | --------------------------------------- | ------------------------ |
| User → RefreshToken       | Cascade                                 | 維持、`userId` index追加 |
| User → EmailVerification  | Cascade                                 | 維持、`userId` index追加 |
| User → PasswordResetToken | Cascade、`userId` unique                | 維持、追加index不要      |
| User → WeakElement        | Cascade、`(userId, elementId)` unique   | 維持、追加index不要      |
| User → GameSession        | Cascade、`(userId, playedAt, id)` index | 維持、追加index不要      |
| GameSession → GameAnswer  | Cascade、`sessionId` prefix index       | 維持、追加index不要      |
| User → GameQuestionSet    | Cascade                                 | 維持、`userId` index追加 |
| User → UserStats          | Cascade、`userId` PK                    | 維持、追加index不要      |
| AuditLog → User           | relationなし                            | 維持                     |
| Element → 学習row         | 共有master、RESTRICT                    | 維持                     |

### index

expand migrationで以下を追加する。

- `RefreshToken`: `@@index([userId])`
- `EmailVerification`: `@@index([userId])`
- `GameQuestionSet`: `@@index([userId])`
- `User`: `@@index([deletedAt, id])`。legacy cleanup専用の一時indexとし、`deletedAt` contract migrationで列とともに削除する。

index migration前にstagingで作成時間とwrite lockを測定する。通常の `CREATE INDEX` がproduction maintenance windowの許容時間を超える場合は、同じmigration履歴内で安易に `IF NOT EXISTS` を足さず、`CREATE INDEX CONCURRENTLY` の失敗時にinvalid indexを検出・除去できるrunbookを別途確定してから計画を更新する。

### query効率

- live deleteはUser PK lookup 2回と、必要時のusable admin count 1回、User delete 1回、AuditLog insert 1回の固定本数とする。
- admin一覧は現行のrelation `select` を維持し、行ごとのstats queryを追加しない。
- legacy dry-runはtableごとのaggregate countを固定本数で実行し、IDごとのcount loopを禁止する。
- legacy executeは `deletedAt != null` のUser IDを小さいbatchで取得し、batchごとの `deleteMany` とDB cascadeを使う。
- admin statsは現在保持中のrowだけを数える。`deletedAt` 移行中はrelation filterでlegacy rowを除き、contract後は全現存rowを集計する。

### expand / contract

`deletedAt` は物理削除releaseと同時にdropしない。

1. expand index migrationを先行適用する。
2. `deletedAt` を残したまま物理削除codeをdeployする。
3. legacy cleanupを完了し、dry-run 0件を確認する。
4. `deletedAt` を参照しないcodeを先にdeployする。v1互換fieldはDB列を読まず定数で合成する。
5. cleanup後の暗号化backupを作成し、soft-deleted rowを含み得る旧Artifactが7日保持期限を過ぎたことを確認する。
6. `deletedAt IS NOT NULL` が1件でもあればgeneric errorで中止するguard付きmigrationで列と一時indexをdropする。
7. drop後は非参照版codeだけをrollback候補とする。

## API変更方針

### 共通エラーレスポンス

```json
{ "error": "日本語のメッセージ" }
```

Zod validationは既存どおり次を返す。

```json
{
  "error": "バリデーションエラー",
  "details": [
    {
      "origin": "string",
      "code": "too_small",
      "minimum": 1,
      "inclusive": true,
      "message": "現在のパスワードを入力してください",
      "path": ["currentPassword"]
    }
  ]
}
```

stack trace、DB error、内部path、対象ID、email、usernameを返さない。

### DELETE `/api/v1/users/me`

#### Request

Headers:

- `Authorization: Bearer <accessToken>`
- `Content-Type: application/json`

Body:

```json
{ "currentPassword": "Pass1234!" }
```

- Zod objectは `.strict()` を維持する。
- `currentPassword` は空文字不可。
- 既存password照合値のためUTF-8 72byte上限を適用しない。
- frontend/backendとも正規化後の値を1回だけ計算し、同じ値を照合・送信に使う。

#### Response 200

```json
{ "message": "アカウントを削除しました" }
```

Cookie:

- `refreshToken` を `/api/v1/auth` と `/api/v1/auth/refresh` の両pathで削除する。
- Cookie属性は既存helperを使い、routeへ重複実装しない。

#### Status / error

| status | 条件・message                                                                          |
| ------ | -------------------------------------------------------------------------------------- |
| 400    | validation / `現在のパスワードが正しくありません`                                      |
| 401    | 認証なし / token不正 / 既に物理削除済みで `ユーザーが見つかりません`                   |
| 403    | 停止、メール未確認、lock中などauth middleware拒否                                      |
| 409    | `最後の管理者は退会できません` / password hash変更 / 同時削除 / Serializable retry枯渇 |
| 429    | account rate limit超過                                                                 |
| 500    | 予期しない内部error。削除はrollback                                                    |
| 503    | fail-closed account rate-limit store利用不可                                           |

#### 変更後の挙動

- success時はUserと全所有rowを物理削除し、成功監査だけを残す。
- 古いaccess tokenは次requestのauth middlewareで401。
- 古いrefresh tokenはcascadeで消え、refresh APIは401。
- 同じrequestがtransaction開始後に競合した場合は409。通常の再requestはauth middlewareで401。
- 削除成功後にlogout APIを成功させる必要はない。frontendは専用local clearを使い、backend responseのCookie clearを信頼する。

### DELETE `/api/v1/admin/users/:id`

#### Request

- `Authorization: Bearer <accessToken>`
- bodyなし。
- `id` は既存Zod paramでtrim後空文字を拒否する。

#### Response 200

```json
{ "message": "ユーザーを強制退会しました" }
```

#### Status / error

| status | 条件・message                                                                  |
| ------ | ------------------------------------------------------------------------------ |
| 400    | path validation                                                                |
| 401    | 認証なし / token不正 / actor不存在                                             |
| 403    | actorがADMINでない、停止、未確認、lock中                                       |
| 404    | target不存在、物理削除済み、cleanup済みlegacy target                           |
| 409    | 自分自身 / 最後の管理者 / actor権限・target状態の競合 / Serializable retry枯渇 |
| 429    | general API rate limit超過                                                     |
| 500    | 予期しない内部error。削除はrollback                                            |

- 同じtargetの再実行は404とし、successを偽装しない。
- transition中に残るlegacy soft-deleted targetは既存409を維持できるが、cleanup完了後の最終契約は404だけとする。
- 管理者自身の削除はこのendpointでは引き続き409。本人退会endpointは最後の管理者でなければ利用可能。

### 認証関連の確認・変更

| endpoint                                         | 物理削除後の契約                                                      |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| `POST /api/v1/auth/register`                     | 同一email/usernameを新しいUser IDで登録可能。通常の201契約            |
| `POST /api/v1/auth/login`                        | 旧資格情報は存在しないaccountとしてgeneric 401。削除済み専用403は廃止 |
| `POST /api/v1/auth/forgot-password`              | 存在列挙を防ぎ、従来どおり200で何もしない                             |
| `POST /api/v1/auth/refresh`                      | token rowがないため401                                                |
| Bearer認証endpoint（例: `GET /api/v1/users/me`） | User rowがないため401                                                 |

### 管理API v1の互換方針

旧frontendや開いたままのtabを壊さないため、v1からfieldを即時削除しない。DB列drop後も次のdeprecated互換をroute境界で合成する。

| contract                   | 移行後のv1互換値               | 新frontend                                      |
| -------------------------- | ------------------------------ | ----------------------------------------------- |
| user summaryの `deletedAt` | 常に `null`                    | 内部型・UIでは使用しない。extra fieldとして許容 |
| query `status=deleted`     | 200、空一覧、`nextCursor=null` | URL parserが削除してcanonicalize                |
| `users.deleted`            | 常に `0`                       | 表示しない                                      |
| `users.total`              | 現在存在するUser row数         | 「現在の登録ユーザー」                          |

- `status` の実用値は `"active" | "suspended"`。
- API v1からdeprecated fieldを物理削除する作業はAPI v2またはversion/asset退役を保証できる別計画へ分離する。
- 一覧・詳細・status/role mutationは物理削除済みUserを返さない。
- game/learning statsは現在保持中のrowだけを数え、historical KPIではないことを文書化する。

## UI / A11Y方針

### 設定画面

- 警告文は、稼働DBのprofile/auth/learning dataが削除され、操作を取り消せないことを明示する。
- 正式承認後、監査内部IDの目的・期間と、暗号化backupが最長7日残り復元時に再削除することへのlink/補足を表示する。
- email/username再登録が可能になることを必要に応じて説明する。
- `deleteCurrentPasswordError`、`deleteAcknowledgementError`、`deleteFormError` を分離する。
- password inputはpassword errorだけを `aria-invalid` / `aria-describedby` で関連付ける。
- checkboxはwarningとacknowledgement errorを関連付け、色だけでなく文言でerrorを示す。
- validation失敗後は `tick()` 後に最初のinvalid controlへfocusする。
- formへ `aria-busy={isDeleting}` を付け、送信buttonは既存guardと `disabled` を維持する。
- API errorは `role="alert"` で通知し、backendの具体的な日本語messageを上書きしない。
- successは既存global toastのpolite live regionで通知してから `/` へ遷移する。
- account delete request中にpageが破棄された場合のAbort方針を統一する。ただしrequestがserverへ到達した後のclient abortを「削除失敗」と断定しない。結果不明時は再認証でUser不存在を確認できる案内をtestする。

### 他タブの認証状態

- `authStore.completeAccountDeletion()`（仮称）は現在tabのrefreshをabortし、stateとsessionStorageを同期的にclearする。
- PII、User ID、tokenを含めない `{ type: "account-deleted" }` eventだけを `BroadcastChannel` へ送る。
- 受信tabもrefreshをabortし、local auth stateをclearしてlogin/topへ遷移できる状態にする。
- SSRと未対応browserではchannelを作らず、安全にcurrent tab clearだけを行う。
- serverではUser/tokenが既にないため、channel非対応でも保護対象dataへのaccessは401になる。

### 管理画面

- 「退会済み」filter、badge、detail status、操作不可理由、stats cardを除去する。
- 強制退会確認文は「プロフィール・認証・学習データを稼働DBから物理削除し、取り消せない」ことを明示する。
- delete成功時はdetailを再取得しない。
- 一覧を再取得し、対象が消えた後は同じ位置の次の操作button、なければ前の行、なければ一覧headingへfocusする。
- success messageを既存page live regionとtoastで通知する。
- 一覧同期失敗時も削除成功を取り消したように見せない。「削除は完了したが一覧を更新できない」と分離して表示する。
- loading、empty、error、paginationは既存の `aria-live` / `role=alert` を維持する。
- `AdminDialog` のfocus trap、Escape、busy中close禁止、fallback focusは再利用する。

## 設計上の決定事項

1. **物理削除か匿名化か**
   - 選択: User rowの物理削除。
   - 根拠: email、username、passwordHash、学習relationを一括で消し、soft-deleted PIIを残さないため。

2. **email/username tombstoneを残すか**
   - 選択: 残さない。
   - 根拠: identifier保持を継続せず、unique値を解放する。再利用リスクは正式承認事項とする。

3. **再登録時のID**
   - 選択: 常に新しいUser ID。
   - 根拠: 旧監査内部IDと新accountを暗黙に関連付けない。

4. **削除のsource of truth**
   - 選択: DB FK cascade。
   - 根拠: 個別delete listの更新漏れを避け、transaction原子性をDBで保証する。

5. **共有Element**
   - 選択: 保持。
   - 根拠: 個人所有データではない。

6. **監査ログ**
   - 選択: 承認期間中はUser relationなしの内部IDだけ保持。
   - 根拠: incident/admin操作の相関と、PII完全削除を分離する。正式承認必須。

7. **本人退会action**
   - 選択: `USER_ACCOUNT_DELETE / SUCCESS` のみ追加。
   - 根拠: password不一致等の失敗は現行PASSWORD_CHANGEと同様に監査対象外とし、成功した不可逆変更を必須監査にする。

8. **成功監査失敗時**
   - 選択: 削除全体をrollback。
   - 根拠: 削除完了の証跡欠落を許容しない。

9. **bcryptの位置**
   - 選択: transaction外で実行し、transaction内でhash一致を再確認。
   - 根拠: 長いCPU処理でDB transactionを保持せず、TOCTOUも防ぐ。

10. **transaction isolation/retry**
    - 選択: Serializable、P2034は最大2attempt。
    - 根拠: 現行admin mutationと同じ競合方針に統一する。

11. **最後の管理者**
    - 選択: 本人退会・強制退会の両方で保護。
    - 根拠: 管理機能のlockoutを防ぐ。

12. **管理者actor再確認**
    - 選択: 強制退会transaction内で利用可能ADMINを再確認。
    - 根拠: 不可逆操作の認可TOCTOUを閉じる。

13. **self delete二重実行**
    - 選択: 競合中は409、commit後の再requestは401。
    - 根拠: successを偽装せず、実際のroute到達状態に合わせる。

14. **admin delete二重実行**
    - 選択: 2回目は404。
    - 根拠: targetの不存在を正しく返す。

15. **legacy cleanup 0件**
    - 選択: dry-run/executeとも成功。
    - 根拠: 冪等な運用とrestore時の再実行を可能にする。

16. **legacy cleanup transaction単位**
    - 選択: 小さいbatch単位でatomic commit。
    - 根拠: 全件一括lockを避け、失敗時は前batchを維持して再実行できる。

17. **cleanup log**
    - 選択: mode、件数、batch番号、所要時間、完了/失敗分類だけ。
    - 根拠: PII・内部ID・secret・raw error漏えいを防ぐ。

18. **admin v1互換field**
    - 選択: deprecated定数として維持し、DB soft deleteには使わない。
    - 根拠: 古いfrontend/open tabを壊さず、DB列をdropできる。

19. **historical KPI**
    - 選択: 本タスクでは作らない。
    - 根拠: 匿名集計の粒度・再識別リスク・削除時差分の要件が別途必要。

20. **`deletedAt` drop**
    - 選択: code非参照deployと旧backup失効後の別contract migration。
    - 根拠: migration→API deploy順序とrestore互換性を守る。

21. **backup内PII**
    - 選択: 即時改変せず、暗号化・7日失効・復元時再削除・開示。
    - 根拠: 既存logical backup全体から個別rowだけを安全に除去できない。

22. **全損時replay gap**
    - 選択: external source導入または残余リスクの正式承認をrelease gateにする。
    - 根拠: 現行DBも失うとbackup後の削除actionを取得できない。

23. **同期削除**
    - 選択: performance gateを満たす間は同期transaction。
    - 根拠: 200時点の削除完了を明確にできる。上限超過時は非同期方式を再設計する。

24. **cross-tab clear**
    - 選択: PIIなしBroadcastChannel event。
    - 根拠: sessionStorageがtab単位である一方、token/PIIを共有storageへ置かないため。

25. **管理画面の削除後focus**
    - 選択: 次行→前行→一覧headingの順。
    - 根拠: 消えたtriggerへfocusせず、keyboard利用者が操作を継続できる。

## 削除transaction設計

### 本人退会

1. routeのZodとrate limitを通す。
2. middlewareで認証済みUser IDを取得する。
3. `normalizePassword()` を1回適用する。
4. Userの `id`, `passwordHash`, `role` を最小selectで取得する。既にない場合はraceとして409、通常はmiddlewareで401になる。
5. bcrypt完全比較をtransaction外で行う。不一致は400。
6. 共通helperでSerializable transactionを開始する。
7. transaction内でUserの `id`, `passwordHash`, `role`, `isActive`, `emailVerified`, `lockedUntil`, 移行中は `deletedAt` を再取得する。
8. User不存在、hash変更、legacy deleted状態は削除せずdomain errorにする。
9. 最新Userが利用可能ADMINなら、同一transaction内で利用可能ADMIN数を数える。1以下なら409。
10. 削除前の `id` と `role` を局所変数へ保持する。
11. `tx.user.delete({ where: { id } })` を実行し、DB cascadeで所有rowを削除する。
12. 同じtransactionで `USER_ACCOUNT_DELETE / SUCCESS` を `actorId=targetId=id` と削除前roleで作成する。
13. commit後だけrouteが両Cookie pathをclearして200を返す。
14. frontendはlocal/cross-tab auth stateをclearし、toast後に `/` へ移動する。

### 管理者強制退会

1. routeでauth/admin middleware、Zod param、general rate limitを通す。
2. 自分自身targetは既存どおり409とbest-effort failure audit。
3. Serializable transaction内でactorを再取得し、利用可能ADMINであることを確認する。権限変化は削除せず409。
4. targetを最新状態で取得する。不在は404。移行中legacy deletedは409、cleanup後は不在404。
5. targetが利用可能ADMINならusable admin countを同一transactionで確認し、1以下なら409。
6. `tx.user.delete` でUserと所有rowをcascade削除する。
7. 既存 `ADMIN_USER_FORCE_DELETE / SUCCESS` を同じtransactionへ作成する。
8. P2034はtransaction全体を最大2attempt。commitされたattemptの成功監査1件だけを残す。
9. 404、自分自身、最後の管理者、state競合、retry枯渇は既存分類のbest-effort failure auditを1件だけ残す。

### 監査とrollback

- AuditLogはUser relationを持たないため、User delete後にも同じtransaction内でinsertできる。
- audit schemaは `.strict()` を維持し、新actionの余剰fieldを拒否する。
- audit insertが失敗した場合、User、全cascade、AuditLogのいずれもcommitしない。
- P2034 retryではrollback済みattemptのaudit rowは残らない。
- app/workflow logへAuditLog ID、actorId、targetIdを出さない。

### concurrency・0件の意味

| 状況                             | 結果                                              |
| -------------------------------- | ------------------------------------------------- |
| self delete中にpassword変更      | hash不一致409、削除なし                           |
| self delete中に最後のADMINになる | 409、削除なし                                     |
| self delete 2requestが競合       | 1件だけ200。もう一方は409または次requestで401     |
| admin targetを別adminが先に削除  | 404またはSerializable後404、重複success auditなし |
| admin actorが直前に降格/停止     | 409、削除なし                                     |
| P2034 1回後成功                  | success 1件、audit 1件                            |
| P2034 2回                        | 409、削除なし、failure audit 1件                  |
| legacy dry-run対象0              | exit 0、deleted 0                                 |
| legacy execute対象0              | exit 0、deleted 0                                 |
| restore replay targetが既にない  | 冪等successとしてcount、API 404とは分離           |

## 公開インターフェース案

実装コードではなく責務と型の案を示す。名称は既存命名と重複を確認して実装時に確定する。

```ts
export async function runSerializableTransaction<T>(
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { maxAttempts?: number },
): Promise<T>;

export class SerializationRetryExhaustedError extends Error {}

export async function deleteCurrentUser(input: {
  userId: string;
  currentPassword: string;
}): Promise<void>;

export async function forceDeleteAdminUser(input: {
  adminUserId: string;
  targetUserId: string;
}): Promise<{ message: string }>;

export type DeleteLegacySoftDeletedUsersMode = "dry-run" | "execute";

export type DeleteLegacySoftDeletedUsersResult = Readonly<{
  mode: DeleteLegacySoftDeletedUsersMode;
  matchedUsers: number;
  deletedUsers: number;
  processedBatches: number;
  remainingUsers: number;
}>;

export async function deleteLegacySoftDeletedUsers(input: {
  mode: DeleteLegacySoftDeletedUsersMode;
  batchSize: number;
}): Promise<DeleteLegacySoftDeletedUsersResult>;

export function getAccountDataDeletionConfig(options?: {
  environment?: Readonly<Record<string, string | undefined>>;
}): Readonly<{
  executeEnabled: boolean;
  batchSize: number;
}>;

export function deleteCurrentUser(options: {
  accessToken: string;
  currentPassword: string;
  signal?: AbortSignal;
}): Promise<{ message: string }>;

export interface AuthStoreAccountDeletion {
  completeAccountDeletion(): void;
}
```

## legacy soft-deleted user移行

### CLI・実行契約

```bash
# defaultは必ずdry-run
npm run delete:legacy-soft-deleted-users

# executeは引数・環境flag・確認文字列の3条件を必須にする
ACCOUNT_DATA_DELETION_EXECUTE_ENABLED=true \
  npm run delete:legacy-soft-deleted-users -- \
  --execute \
  --confirm=DELETE_LEGACY_SOFT_DELETED_USERS
```

| 環境変数                                | default | validation       | 用途                   |
| --------------------------------------- | ------- | ---------------- | ---------------------- |
| `ACCOUNT_DATA_DELETION_EXECUTE_ENABLED` | `false` | `true` / `false` | executeの二重gate      |
| `ACCOUNT_DATA_DELETION_BATCH_SIZE`      | `25`    | 1〜100の整数     | 1transactionのUser上限 |

- unknown/重複引数、確認文字列不一致、flag false、不正batchはDB dependency load前に拒否する。
- dry-runはexecute flagがtrueでも削除しない。
- CLIはPrisma v7の `PrismaPg` adapterを使い、終了時にdisconnectする。
- raw connection/disconnect errorは出さず、許可した日本語分類messageだけを返す。

### dry-run

`deletedAt != null` のUser数と、対象Userに属するRefreshToken、EmailVerification、PasswordResetToken、WeakElement、GameSession、GameAnswer、GameQuestionSet、UserStatsの総row数、batch size、必要batch数を固定本数queryで集計する。

許可logはevent、mode、table別件数、matched/deleted/remaining、batch size/count、duration、完了分類だけとする。User/Audit ID、email、username、password hash、token、Cookie、`DATABASE_URL`、project ref、host、stack、生Errorは禁止する。

### execute

1. transaction外で `deletedAt != null` の次batch IDを順序固定で取得し、memory内だけで扱う。
2. table別countは集合queryで取得し、ユーザーごとのcount loopを禁止する。
3. Serializable transactionで `id IN batchIds AND deletedAt != null` のUserを `deleteMany` する。
4. FK cascadeで所有rowを削除する。移行自体のUserごとのAuditLogは新規作成しない。
5. commit後に件数だけをlogする。
6. 失敗batchはrollbackし、以前のcommit済みbatchは維持する。再実行は残件から続ける。
7. 終了時remaining 0を再countし、残件があればexit non-zero。
8. execute直後にdry-runを再実行し、matched 0を記録する。

dry-run 0件、execute 0件、2回目execute 0件はいずれも正常終了とする。1Userの子rowだけが部分commitされることは許さない。cleanup中に旧codeが新soft rowを作らないよう、旧API instanceをdrainしてからexecuteする。

### workflow

stagingは固定Environmentのmanual workflowで `dry-run` / `execute` を選択し、既存staging DB concurrencyを再利用する。専用fixtureだけを使い、active/suspended user、Element、AuditLogへの非影響を確認して後片付けする。

productionは既存 `.github/workflows/production-database.yml` に `account-deletion-dry-run` と `account-deletion-execute` を追加する。executeは次を必須にする。

1. branch `develop`、Environment `production`、`BATCH_ENVIRONMENT=production`。
2. `ACCOUNT_DATA_DELETION_EXECUTE_ENABLED=true`。
3. confirmation input完全一致。
4. 24時間以内の成功backup Artifact。
5. `gensoko-batch-jobs` concurrency。
6. 24時間以内に成功したmanual dry-runの短期marker Artifact。
7. 承認者とchange record。

実行後はflagをfalseへ戻し、dry-run 0件、DB容量、API smoke testを確認する。

## backup・restore後の再削除

### 媒体境界

- 稼働DB: API 200時点で物理削除。
- AuditLog: 正式承認期間だけ内部IDを保持し、retention cleanupでrowごと削除。
- 暗号化backup: Artifactを最長7日保持し、個別User単位で編集しない。
- メール・外部log・browser: 媒体ごとの保持と制約をprivacy policyへ記載する。

### 復元手順

1. 新しいSupabase projectへ復元し、現在のproductionを上書きしない。
2. 公開trafficを流さず、Environment/接続先を二名で確認する。
3. cleanup前backupなら、互換code/CLIでlegacy soft-deleted userを先に削除する。
4. backup時刻後の `USER_ACCOUNT_DELETE / SUCCESS` と `ADMIN_USER_FORCE_DELETE / SUCCESS` のtarget IDを、読取可能な現行production AuditLogからmemoryへ取得する。IDをfile/logへ出さない。
5. 復元DBに存在する該当Userを小batchで再削除し、不在IDは冪等successとする。
6. 現行migrationを適用し、drop guardがlegacy rowを検出したら公開を中止する。
7. orphan 0、監査保持row、Element、active/suspended user、admin数を検証する。
8. login、refresh、本人退会、管理者強制退会、ranking、admin一覧をsmoke testする。
9. 件数と確認時刻だけをchange recordへ残す。
10. release/privacy責任者の承認前に切り替えない。

### 現行DB全損時の制約

現行DBも読めない場合、backup後に削除されたtarget IDを現行設計だけでは再構成できない。同期的・暗号化済みの外部削除ledgerを別設計するか、最大7日の隔離復元リスクを正式承認・開示する。未決定なら本番公開と「backupを含む完全削除」の対外表明をblockする。通常のAuditLogは外部ledgerの代替ではない。

## リリース・移行方針

### 実装フェーズと本番適用ゲートの関係

Phase番号は実装・検証する作業パッケージであり、番号順に無条件で本番公開する指示ではない。互換なexpand indexは先行適用できるが、物理削除backend、不可逆cleanup、contract migrationは、それぞれの前提を満たしてから本番へ適用する。

| 本番操作                       | 実装・検証の前提                                                        | 切り出しタスクの完了期限                                                                    |
| ------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| expand index適用               | Phase 1のschema contract・専用DB・staging検証、24時間以内のbackup       | index作成時間とmaintenance windowを確定                                                     |
| 物理削除backend・frontend公開  | Phase 2とPhase 4、専用DB integration、staging Playwright                | 監査保持承認、`/privacy` 公開、backup/replay方針、username再利用承認、本番cleanup体制を確定 |
| legacy cleanup execute         | 物理削除backend公開、旧instance drain、dry-run承認、24時間以内のbackup  | production実行者・承認者・時間帯・通知先を記録                                              |
| `deletedAt` 非参照code公開     | legacy cleanup後のdry-run 0件、v1互換test                               | 旧frontendとの互換期間を確認                                                                |
| cleanup後backup・restore drill | 非参照codeのsoak、cleanup後backup作成                                   | 全損時replay source導入、または残余リスクの正式承認                                         |
| guard付きcontract migration    | 旧Artifactの7日失効、restore drill、legacy 0件、非参照rollback artifact | 管理API v2は不要。deprecated field廃止は別計画で行う                                        |

同期cascadeがstaging性能基準を超えた場合は、物理削除backendの本番公開を止め、非同期削除queueを別計画として作成する。匿名化済みhistorical KPIと管理API v2は本機能の本番公開後に実施できるため、release blockerにはしない。

### Phase 0: 承認・計測

監査保持、backup/replay、username再利用、privacy copy、performance基準、maintenance windowを確定し、`docs/05_progress.md` を `[-]` にする。

### Phase 1: expand index

schema contract/indexをTDD実装し、専用DB→staging→24時間以内backup付きproductionの順でmigrationする。追加indexは旧codeと互換であり、緊急時もindexを残したまま旧appへ戻せる。

### Phase 2: 物理削除backend

共通Serializable helper、監査action、self/admin物理削除、last-admin、actor再確認、cleanup CLI/workflowを実装し、専用DBとstagingで検証する。v1 deprecated admin shapeは維持する。本番公開はPhase 4のfrontend・`/privacy` と切り出しタスクのgate完了後に行い、新規退会がUserを残さないことを確認して旧instanceをdrainする。

### Phase 3: legacy cleanup

Phase 2の実装後、stagingでdry-run→execute→dry-run 0→execute 0→Playwrightを行う。production cleanupはPhase 2とPhase 4の同時公開、切り出しタスクのgate完了、旧instance drain後に実施し、dry-run承認→backup→execute→dry-run 0→容量・active/suspended/admin数・smoke test→flag falseの順とする。

### Phase 4: frontend・表示整合

設定画面のA11Y/cross-tab clearと、管理画面のdeleted UI除去・削除後focusを実装し、stagingで検証する。新frontendは旧backendのextra deprecated fieldを許容する。`/privacy` と関連docsを確定し、Phase 2のbackendと同じ本番公開gateでdeployする。

### Phase 5: `deletedAt` 非参照code

auth、admin、ranking、admin-create、testからDB列依存を除去する。Userを返すPrisma writeは明示`select`を必須とし、現行schemaに残る旧列を暗黙`RETURNING`へ含めない。v1互換値はroute境界で合成する。columnを残したままdeployし最低1release cycle soakする。旧版rollbackでsoft rowが増えた場合は再cleanupする。T44ではschemaから旧列を除去してPrisma Clientを再生成し、再度deploy・soakしてからcontract SQLを適用する。

### Phase 6: backup世代更新

legacy 0件・非参照code稼働中に新backupを作り、旧Artifactの7日失効と手動保管なしを確認する。isolated restore drillを行う。

### Phase 7: contract migration

transaction開始直後に`users` tableをlockし、guard確認からDDLまでの競合を閉じる。legacy rowが1件でもあればIDを出さず中止するguardをTDD実装する。専用DBでは、並行legacy insertがlock解放後に確定した場合もguardが中止することと、drop後に再生成済みPrisma ClientのUser writeが成功することを確認する。staging確認後、24時間以内backup付きproductionでdropする。drop後はT44で再生成した非参照版だけをrollback候補とし、orphan checkとsmoke testを行う。

## ロールバック方針

| phase            | rollback                        | データ上の注意                                    |
| ---------------- | ------------------------------- | ------------------------------------------------- |
| expand index     | 旧appへ戻せる                   | indexは残し緊急削除しない                         |
| 物理削除backend  | column残存中は旧appへ戻せる     | 物理削除Userを復元しない。新soft rowは再cleanup   |
| legacy cleanup   | code rollback可能               | cleanupは不可逆。通常rollbackで全DB restoreしない |
| frontend         | 旧frontendへ戻せる              | v1互換shapeを維持                                 |
| 非参照code       | drop前はPhase 2版へ戻せる       | soft rowをdry-run                                 |
| `deletedAt` drop | Phase 5非参照版だけへ戻す       | 旧参照版は禁止                                    |
| backup restore   | 切替前なら新projectを破棄できる | 再削除完了までtraffic禁止                         |

application rollbackは削除済み個人データを復元する権限を意味しない。誤削除が疑われても他ユーザー変更を巻き戻す全DB restoreを即断しない。audit失敗、timeout、P2034枯渇はtransaction rollbackし、成功を返さない。

## リスクと対策

| リスク               | 影響               | 対策                                     | 残余リスク               |
| -------------------- | ------------------ | ---------------------------------------- | ------------------------ |
| FK index/cascade漏れ | 遅延・PII残存      | expand index、schema/実DBtest            | 将来model review         |
| 最後のADMIN          | lockout            | self/admin保護、Serializable             | 別理由の全ADMIN停止      |
| password/role競合    | 誤削除             | transaction再読込、409                   | client再試行             |
| audit失敗            | 証跡欠落           | 同一transaction rollback                 | audit障害中は削除不能    |
| 同期timeout          | 削除未完了         | 性能gate、全rollback                     | 超過時は非同期再設計     |
| cleanup誤実行        | 大量不可逆削除     | dry-run、flag、確認、backup、Environment | 誤承認                   |
| batch途中失敗        | 一部移行済み       | batch atomic、remaining、再実行          | 全件同時rollbackでない   |
| stats低下            | KPI誤解            | current dataと明記                       | historical比較不可       |
| username再利用       | 表示上のなりすまし | 新ID、承認、説明                         | usernameは本人保証でない |
| 旧frontend           | validator破損      | v1互換shape                              | 将来v2管理               |
| 他tab                | 古い表示           | PIIなしchannel、server 401               | 非対応browser            |
| backup復活           | privacy違反        | 7日失効、隔離、replay                    | 現行DB全損gap            |
| 監査内部ID           | 再識別             | 目的限定、期限、承認                     | 保持中の内部相関         |
| migration順序        | API停止            | 非参照code先行、guard                    | 手順逸脱                 |
| log漏えい            | 二次漏えい         | 許可field、negative test                 | platform metadata        |

## 作業手順

1. planと関連docsを実装開始時に再読する。
2. branchと差分を確認し、未コミット変更があれば止める。
3. `docs/05_progress.md` を `[-]` にする。
4. schema/index/retry/audit/self/admin/cleanup/API/frontend testをRedで先行追加する。
5. expand index migrationを実装し、専用DB/stagingで適用・性能確認する。
6. 共通Serializable helper、監査action、本人・管理者物理削除を実装する。
7. 実DBcascade/rollback integration testを通す。
8. legacy cleanup service/CLI/workflowを実装する。
9. 認証・admin v1互換契約を更新する。
10. 設定・auth store・管理UIをA11Y test先行で更新する。
11. API/security/testing/deployment docsを更新する。
12. backend/frontend全品質checkを通す。
13. stagingでmigration、cleanup、Playwright、restore drillを実施する。
14. 承認gateを満たしてproductionを段階rolloutする。
15. 旧backup失効と非参照code soak後にcontract migrationを行う。
16. planのcheckbox、対象file、判断、実装完了sectionを実態へ更新する。
17. 種類別commit、push、詳細PRを作成する。

## タスクリスト（進捗管理）

| ID  | 内容                                     | 主対象                | 依存             | 優先度 |
| --- | ---------------------------------------- | --------------------- | ---------------- | ------ |
| T1A | コード実装に必要な削除契約を確定         | docs/plan             | なし             | High   |
| T1B | 本番運用・privacy・replay gateを正式承認 | docs/plan             | T1A              | High   |
| T2  | 進捗を実装準備中へ更新                   | `docs/05_progress.md` | なし（文書整備） | High   |
| T3  | schema cascade/index contract Red test   | schema test           | T1A,T2           | High   |
| T4  | expand index schema/migration            | Prisma                | T3               | High   |
| T5  | Serializable helper Red test             | lib test              | T1A,T2           | High   |
| T6  | 共通Serializable helper実装・admin回帰   | lib/admin             | T5               | High   |
| T7  | self delete audit schema Red/Green       | audit                 | T1A,T2           | High   |
| T8  | self物理削除・last-admin・競合 Red test  | user test             | T6,T7            | High   |
| T9  | self物理削除実装                         | user service          | T8               | High   |
| T10 | admin物理削除・actor再確認 Red test      | admin test            | T6               | High   |
| T11 | admin物理削除実装                        | admin service         | T10              | High   |
| T12 | self/admin route契約test・実装           | routes                | T9,T11           | High   |
| T13 | 専用DB cascade/監査/rollback integration | integration           | T4,T9,T11        | High   |
| T14 | cleanup config Red/Green                 | config/env            | T1A,T2           | High   |
| T15 | legacy cleanup service Red test          | job test              | T14              | High   |
| T16 | legacy cleanup service実装               | job                   | T15              | High   |
| T17 | cleanup CLI Red test                     | CLI test              | T16              | High   |
| T18 | cleanup CLI・npm script実装              | CLI/package           | T17              | High   |
| T19 | staging/production workflow Red test     | workflow tests        | T18              | High   |
| T20 | staging/production workflow実装          | workflows             | T19              | High   |
| T21 | auth削除後回帰                           | auth tests/service    | T9               | High   |
| T22 | admin v1互換一覧/detail/stats契約        | admin API             | T11              | High   |
| T23 | settings A11Y Red test                   | settings test         | T12              | High   |
| T24 | settings説明/error/focus/busy実装        | settings              | T23              | High   |
| T25 | auth store cross-tab Red test            | store test            | T23              | Medium |
| T26 | local/cross-tab clear実装                | auth store            | T25              | Medium |
| T27 | admin frontend Red test                  | admin FE tests        | T22              | High   |
| T28 | deleted UI除去・削除後focus実装          | admin FE              | T27              | High   |
| T29 | 関連docs更新                             | docs                  | T12,T20,T28      | High   |
| T30 | backend品質check                         | backend               | T29              | High   |
| T31 | frontend品質check                        | frontend              | T29              | High   |
| T32 | 専用DB integration実行                   | Docker PostgreSQL     | T30              | High   |
| T33 | staging expand migration・性能           | staging               | T4,T32           | High   |
| T34 | staging API/UI・Playwright               | staging               | T31,T33          | High   |
| T35 | staging cleanup dry/execute/再実行       | workflow              | T20,T34          | High   |
| T36 | production expand migration              | production            | T33              | High   |
| T37 | production物理削除rollout                | deploy                | T35,T36          | High   |
| T38 | production legacy cleanup                | workflow              | T37              | High   |
| T39 | `deletedAt` 非参照code Red/Green         | backend               | T38              | High   |
| T40 | 非参照code deploy・soak                  | deploy                | T39              | High   |
| T41 | cleanup後backup・旧Artifact失効          | production            | T40              | High   |
| T42 | isolated restore drill・replay           | restore               | T41              | High   |
| T43 | guard付きcontract migration Red/Green    | Prisma                | T41,T42          | High   |
| T44 | staging/production contract migration    | workflows             | T43              | High   |
| T45 | release gate・plan完了・PR               | docs/GitHub           | T1B,T44          | High   |

- [x] T1A: コード実装に必要な削除契約を確定する
- [ ] T1B: 本番運用・privacy・replay gateを正式承認する
- [x] T2: `docs/05_progress.md` を実装準備中へ更新する
- [x] T3: schema cascade/index contract Red testを追加する
- [x] T4: expand index schema/migrationを実装する
- [x] T5: Serializable helper Red testを追加する
- [x] T6: 共通Serializable helperを実装しadmin回帰を通す
- [x] T7: `USER_ACCOUNT_DELETE` audit schemaをTDD実装する
- [x] T8: self物理削除・last-admin・競合 Red testを追加する
- [x] T9: self物理削除を実装する
- [x] T10: admin物理削除・actor再確認 Red testを追加する
- [x] T11: admin物理削除を実装する
- [x] T12: self/admin route契約testと実装を更新する
- [x] T13: 専用DB cascade/監査/rollback integration testを追加する
- [x] T14: cleanup configをTDD実装する
- [x] T15: legacy cleanup service Red testを追加する
- [x] T16: legacy cleanup serviceを実装する
- [x] T17: cleanup CLI Red testを追加する
- [x] T18: cleanup CLI・npm scriptを実装する
- [x] T19: staging/production workflow Red testを追加する
- [x] T20: staging/production workflowを実装する
- [x] T21: auth削除後回帰testとservice契約を更新する
- [x] T22: admin v1互換一覧/detail/stats契約を更新する
- [x] T23: settings A11Y Red testを追加する
- [x] T24: settings説明/error/focus/busyを実装する
- [x] T25: auth store cross-tab Red testを追加する
- [x] T26: account deletion local/cross-tab clearを実装する
- [x] T27: admin frontend Red testを追加する
- [x] T28: admin deleted UI除去・削除後focusを実装する
- [x] T29: API/security/testing/deployment docsを更新する
- [x] T30: backend品質checkを通す
- [x] T31: frontend品質checkを通す
- [x] T32: 専用Docker PostgreSQL integration testを通す
- [ ] T33: staging expand migration・性能を確認する
- [-] T34: staging API/UI・Playwrightの安全なsynthetic実行基盤を実装し、承認後に確認する
- [ ] T35: staging cleanup dry-run/execute/再実行を確認する
- [ ] T36: production expand migrationを適用する
- [ ] T37: production物理削除を段階deployする
- [ ] T38: production legacy cleanupを完了する
- [x] T39: `deletedAt` 非参照codeをTDD実装する
- [ ] T40: 非参照codeをdeploy・soakする
- [ ] T41: cleanup後backupと旧Artifact失効を確認する
- [ ] T42: isolated restore drillと削除replayを確認する
- [x] T43: guard付きcontract migrationをTDD実装する
- [ ] T44: staging/production contract migrationを完了する
- [ ] T45: release gate、進捗、plan実装完了、PRを完了する

> 実施順に関する注記（2026-07-16）: 実装前にタスクの現在地と段階的なrelease gateを可視化するため、文書整備だけを行うT2はT1Aの確定前に実施した。T1A確定後はT3以降のコード・DB・workflow変更を開始できるが、T1Bが未完了の間は本番公開・production cleanup・contract migrationを行わない。

> TDD Red記録（2026-07-16）: T3は14件中4件が不足indexで失敗し、migration契約testは対象migration未作成で失敗した。T5は共通helper未実装でsuite失敗し、T7は34件中2件が新監査action未実装で失敗した。

> TDD Green/Refactor記録（2026-07-16）: T4は4本のindexとexpand migrationを追加しschema契約15件が全通過、T6はP2034だけを最大2回試行する共通Serializable helperへadmin処理を統合しhelper/admin回帰29件が全通過、T7は内部ID・roleのみを許可する`USER_ACCOUNT_DELETE/SUCCESS` schemaを追加し監査34件が全通過した。関連testは合計108件、lint、format check、build、Prisma validate、ローカル`migrate deploy`が成功した。Playwrightではトップページ表示、ランキング応答、未認証`/settings`から`/login`への遷移を確認し、console error/warningは0件だった。専用DB integration、staging migration・性能確認は未実施のためPhase 1全体は進行中とする。

> T8/T9 TDD記録（2026-07-16）: 現行soft deleteに対して本人退会testは35件中13件がRedとなり、物理削除、transaction内再確認、last-admin、P2034 retry、成功監査の不足を確認した。Greenではbcrypt照合後にSerializable transactionでUser状態とhashを再確認し、利用可能ADMIN数を保護して`tx.user.delete`と`USER_ACCOUNT_DELETE / SUCCESS`を同一transactionへ保存した。利用可能account・ADMIN条件は`usable-admin.ts`へ共通化した。backend全体は698件成功、専用DBintegration 2件skip、lint、format check、buildが成功した。実DBcascade/rollbackはT13で検証する。

> T10/T11 TDD記録（2026-07-16）: 現行admin soft deleteに対して強制退会testは36件中12件がRedとなり、actor再確認、target物理削除、競合時の監査分類不足を確認した。GreenではSerializable transactionの先頭でactorを最小field再取得し、利用可能ADMINでなければtarget取得前に409と`ACTOR_STATE_CONFLICT`失敗監査へ分類した。target確認後は`tx.user.delete`と既存`ADMIN_USER_FORCE_DELETE / SUCCESS`を同一transactionへ保存し、手動token削除を除去した。actor競合監査はtargetなしだけをstrict schemaで許可する。backend全体は711件成功、専用DBintegration 2件skip、lint、format check、buildが成功した。route契約はT12、実DBrollbackはT13で検証する。

> T12 route契約記録（2026-07-16）: self/admin routeへvalidation、401/403、404、last-admin・actor/state・Serializable競合409、失敗時Cookie非削除、generic 500の契約testを先行追加した。22件は初回から全通過し、既存routeの共通error handlerとCookie helperが物理削除service契約に適合していたため、route sourceへテストを通すためだけの変更は加えなかった。`docs/04_api.md`はsoft delete記述を物理削除・DB cascade・同一transaction監査・最新error契約へ更新した。

> T13 integration記録（2026-07-16）: host allowlistとDB名完全一致guardを持つ`accountDeletion.integration.test.ts`を追加し、通常suiteでは専用env未設定時に5件skipする。Docker PostgreSQLへ専用DB`gensoko_account_deletion_test`を新規作成し、15 migrationを適用した。実DB5件は初回から全通過し、7つの直接relation、GameAnswer間接cascade、Element保持、self/admin成功監査とPII非保存、監査insert失敗時rollback、同一User並行削除の1commit、2 ADMIN並行本人退会後の1 ADMIN残存を確認した。再現用npm scriptと`docs/07_testing_flow.md`・`docs/09_startup_commands.md`を更新した。大量fixture性能はT32/T33で計測する。

> T14 TDD記録（2026-07-16）: cleanup設定testを先行追加し、既存38件は成功したまま新規17件が未実装関数でRedとなることを確認した。Greenでは`ACCOUNT_DATA_DELETION_EXECUTE_ENABLED`を未設定時`false`、`ACCOUNT_DATA_DELETION_BATCH_SIZE`を未設定時`25`とし、明示値は前後空白を除去したうえで小文字`true`/`false`と1〜100の10進整数だけを受理する共通configへ一元化した。境界値、空文字、大文字boolean、小数、負数、単位付き値を含む設定testは55件全通過した。

> T15 Red記録（2026-07-16）: `deleteLegacySoftDeletedUsers.test.ts`を先行追加し、service module未実装によるimport失敗を確認した。テスト契約はdry-runのUser・8所有table固定本数集計、対象0件の正常終了、`deletedAt,id`固定順batch取得、Serializable transaction内の条件付き`deleteMany`、実削除件数の集計、User単位監査を作らないこと、ID・PII・接続情報をlogへ出さないこと、失敗batch以降を開始しないことを含む。単体lintは成功し、TypeScript errorは未実装moduleの1件だけである。

> T16 Green/Refactor記録（2026-07-16）: legacy cleanup serviceを追加し、dry-runはUserと8所有tableを9本の集合count queryで集計、executeは`deletedAt,id`順で取得した小さいID集合を共通Serializable transaction内の`id IN (...) AND deletedAt IS NOT NULL`付き`deleteMany`で物理削除する。実際の`deleteMany.count`だけを集計し、batch commit後のlogには件数・時間・完了分類だけを出力する。失敗時は生Errorをlogへ渡さず固定日本語Errorへ変換する。Greenは7件全通過し、Refactorではbuildが検出したlogの`mode`二重定義を除去した。backend全体は748件成功、専用DBtest 7件skip、lint、format check、buildが成功した。legacy cleanupの実DB検証はT32で行う。

> T17 Red記録（2026-07-16）: cleanup CLI testを先行追加し、28件すべてがCLI module未実装でRedとなることを確認した。引数なし・環境flagだけではdry-run、executeは`--execute`・環境flag・確認文字列の三重gate、unknown・位置・重複引数と不正configはDB dependency load前に終了code 2、execute直後のdry-run再確認、残件・service/DB失敗は終了code 1、disconnect失敗時の結果維持、stderrへの接続情報・ID・生Error非出力を契約化した。単体lintは成功し、TypeScript errorは未実装CLI moduleの1件だけである。

> T18 Green/Refactor記録（2026-07-16）: 引数解析、共通config検証、三重gate確認をDB dependencyのdynamic importより前に行うCLIを追加し、引数なしは常にdry-run、execute成功後はdry-runを再実行して残件0を確認する。残件・service/DB load失敗は終了code 1、入力・設定不備は2、disconnect失敗は確定済み結果を維持して固定警告とした。Prisma module load失敗testはVitestのmodule cacheを避ける`vi.doMock`へRefactorし、28件全通過した。`delete:legacy-soft-deleted-users` npm scriptと手動実行手順を追加した。backend全体は776件成功、専用DBtest 7件skip、lint、format check、buildが成功した。Docker開発DBで引数なし・execute flag falseの実CLI dry-runを行い、対象2件に対して`deletedUsers: 0`・`remainingUsers: 2`、PII・ID非出力を確認した。

> T19 Red記録（2026-07-16）: staging/production account deletion workflow契約testを追加し、9件中8件がRed、既存production workflowのschedule非実行・共通`gensoko-batch-jobs` concurrencyだけが初回からGreenだった。stagingはmanual-only・Environment/branch固定・dry-run/execute・三重gate・秘密非出力、productionは既存workflowへの2操作追加・Environment/branch/flag/確認文字列・承認者/change record・24時間以内のdevelop成功backup Artifact・専用CLI stepを契約化した。単体lint、Prettier、TypeScript確認は成功した。

> T20 Green/Refactor記録（2026-07-16）: staging固定のmanual workflowを新設し、`develop` branch、`BATCH_ENVIRONMENT=staging`、execute flag、確認文字列、共通`gensoko-batch-jobs` concurrencyでdry-run/executeを分離した。productionは既存DB workflowへmanualの`account-deletion-dry-run` / `account-deletion-execute`だけを追加し、scheduleの選択肢は変更していない。executeは24時間以内のdevelop成功backup Artifactに加え、24時間以内のmanual dry-run成功を示す1日保持marker Artifact、承認者、change recordを検証する。実行後dry-runはCLI内部で残件0を確認し、Step Summaryへflagをfalseに戻す運用を記録する。専用testは9件、既存workflow回帰を含め22件が全通過し、2 workflowのYAMLはPrettier parse/checkに成功した。backend全体は785件成功、専用DB test 7件skip、lint、format check、buildが成功した。staging fixture・実Environmentでのdry-run/executeはT35、本番実行はT38まで未実施とする。

> T21 TDD記録（2026-07-16）: 物理削除後の同一email/username再登録、旧資格情報login、forgot-password no-op、refresh token cascade後401、旧access token 401と、cleanup前のlegacy row契約をtest先行で追加・更新した。Redは対象71件中69件成功・2件失敗で、legacy soft-deleted loginが削除済み専用403を返す不一致だけを確認した。Greenではlegacy rowも不存在accountと同じ汎用401へ統一し、対象71件が全通過した。Refactorでは同じlogin汎用message 4箇所を共通定数へ集約した。物理削除後のregister/forgot/refresh/Bearerとtransaction中User消失は既存実装が契約を満たしていたため、テストを通すだけのsource変更は加えなかった。`deletedAt`参照自体はcleanup・soak後のT39まで維持する。backend全体は789件成功、専用DB test 7件skip、lint、format check、buildが成功した。専用DB・staging・productionは実行していない。

> T22 TDD記録（2026-07-16）: admin v1のdeprecated互換として、無指定一覧からlegacy soft-deleted userを除外し、`status=deleted`はcursorを参照せず200空一覧、legacy詳細は404、一覧・詳細・status/role mutationの`deletedAt`はroute境界で常に`null`、statsの`users.deleted`は常に0とするtestを先行追加・更新した。game/learning statsもlegacy userの所有dataをrelation filterで除外する。Redは対象55件中47件成功・8件失敗で、一覧・詳細・互換field・current data集計の不一致を確認した。Greenでは一覧のcurrent User条件、deleted filterの早期空応答、legacy詳細404、route互換値合成、statsのcurrent row限定を実装し、対象55件が全通過した。Refactorではcurrent User条件を共通定数へ集約した。mutationのlegacy 409判定とDB `deletedAt`参照はT39まで維持する。backend全体は793件成功、専用DB test 7件skip、lint、format check、buildが成功した。専用DB・staging・productionは実行していない。

> T23 Red記録（2026-07-16）: settings退会フォームへ、稼働DBのprofile/auth/learning dataと不可逆性の警告、password・同意checkbox別error、`aria-invalid` / `aria-describedby`、最初のinvalid controlへのfocus、送信中の`aria-busy`・button無効化・二重submit防止、400/409/429/503のbackend message保持、network message、Abort時の結果不明案内、page破棄時のrequest abort契約testを追加した。T1B未承認の監査保持期間・backup表示と、T25/T26のlocal/cross-tab clearは対象外とした。初回は将来のform error IDへAPI/network testも依存して12件Redだったため、control別IDとform alertの責務を分離してtestをRefactorした。確定Redは専用18件中11件成功・7件失敗で、警告文、control別error/focus、busy、Abort契約の不足だけを確認した。frontend全体は466件成功・同じ7件Redで、他42 test fileに回帰失敗はない。lint、Prettier、Svelte/TypeScript checkは成功した。画面sourceは変更せず、GreenはT24で行う。

> T24 Green/Refactor記録（2026-07-16）: settings退会フォームの警告を、プロフィール・認証・学習データを稼働DBから物理削除し取り消せない内容へ更新した。password・同意checkbox・form errorを独立stateに分け、両validationを同時評価して`tick()`後にpassword→checkboxの順でfocusし、各controlへ専用の`aria-invalid` / `aria-describedby`を設定した。formの`aria-busy`と既存submit guard・button disabledを維持し、request単位の`AbortController`をAPIへ渡す。AbortErrorは通常network errorと区別して、page表示中は削除結果不明と再ログイン確認を案内し、page破棄時はSvelte 5のeffect cleanupでrequestをabortしてerror toastを出さない。最初のGreen実行は`onDestroy`がtest環境のserver exportへ解決され全18件mount失敗となったため、既存Svelte 5構成に合わせてeffect cleanupへRefactorした。その後、専用18件とfrontend全体473件が全通過し、lint、Prettier、Svelte/TypeScript check、production buildが成功した。T25/T26のlocal/cross-tab clear、実ブラウザ・staging確認は未実施。

> T25 Red記録（2026-07-16）: auth storeへ、本人退会完了時に現在tabのrefreshをabortして認証state・sessionStorageを同期clearする契約と、PIIを含まない厳密な`{ type: "account-deleted" }`だけをBroadcastChannelで送受信する契約testを追加した。受信tabはeventを再送せず同じlocal clearを行い、別type・`null`・追加fieldを持つeventは無視する。BroadcastChannel未対応browserとSSRではchannelを作らず現在tabだけを安全にclearし、logout APIは呼ばない。専用5件は`completeAccountDeletion()`とchannel未実装により全件Redとなり、frontend全体は既存473件成功・追加5件Redで他43 test fileに回帰失敗はない。lint、Prettier、Svelte/TypeScript checkは成功した。auth store sourceは変更せず、GreenはT26で行う。

> T26 Green/Refactor記録（2026-07-16）: auth storeへ`completeAccountDeletion()`を追加し、送信側・受信側が共有するlocal clearで実行中refreshをabortして認証state・sessionStorageを同期消去する。browserかつ対応環境だけ`gensoko-auth` BroadcastChannelを生成し、PIIを含まない厳密な`{ type: "account-deleted" }`だけを受理する。本人操作はlocal clear後に1回通知し、受信tabは再送しない。channel生成・送信失敗、未対応browser、SSRでもcurrent tab clearを維持する。settingsの退会成功処理は、削除済みserverへlogout APIを送らず専用clearを呼んでtoast後にトップへ遷移するよう更新し、通常の401・password変更logoutは維持した。settings接続testを先行追加したRedは対象24件中18件成功・6件失敗、Green/Refactor後は対象24件とfrontend全体479件が全通過した。lint、Prettier、Svelte/TypeScript check、production buildが成功した。実browserの複数tab・staging確認は未実施。

> T27 Red記録（2026-07-16）: admin frontendの8 test fileへ11件を追加し、既存期待値も完全削除後のUI契約へ更新した。deprecated `status=deleted`のURL除去、退会済みfilter・badge・detail status・操作不可理由・stats card・「未退会」表現の除去、互換`deletedAt`を表示判断に使わないこと、強制退会確認で稼働DBのプロフィール・認証情報・学習データを物理削除して取り消せないことを契約化した。強制退会成功後はdetailを再取得せずlist/statsだけを同期し、消えた行の同位置にある次行操作button→前行操作button→一覧headingの順でfocusする。一覧同期失敗時も成功toast/live messageを維持し、削除成功と一覧更新失敗を分離する。確定Redは対象85件中68件成功・17件失敗、frontend全体490件中473件成功・同じ17件失敗で、他36 test fileに回帰失敗はない。一覧が空になった場合のheading focusは既存実装でGreenだった。lint、Prettier、Svelte/TypeScript checkは成功した。admin sourceは変更せず、GreenはT28で行う。

> T28 Green/Refactor記録（2026-07-16）: 新frontendの`AdminUserStatus`を`"active" | "suspended"`へ狭め、deprecated `status=deleted`をURLからcanonicalizeしてfilterから除去した。API v1 responseの`deletedAt`と`users.deleted`は旧asset互換のruntime validatorとして維持する一方、actions・list・detail・confirmation・statsの表示判断から退会済み／未退会UIを除去した。強制退会確認は稼働DBのプロフィール・認証情報・学習データを物理削除し、取り消せないことを明示する。削除成功後はdetailを再取得せずlist/statsだけを同期し、元のdesktop/mobile viewと削除前indexを保持して、同位置の次Userの強制退会button→前Userのbutton→一覧headingへfocusする。同期失敗時は成功toast/live messageを維持し、「強制退会は完了」「ユーザー一覧を更新できない」を分離してread retryできる。最初のGreenはfocus用`data-user-id`が既存mobile card selectorと衝突して85件中83件成功・2件失敗だったため、`data-admin-user-id`へ責務を分離した。Refactor後は対象85件とfrontend全体490件が全通過し、lint、Prettier、Svelte/TypeScript check、production buildが成功した。実browser・staging確認は未実施。

> T29 docs整合記録（2026-07-16）: `docs/02_security.md`、`04_api.md`、`07_testing_flow.md`、`09_startup_commands.md`、`11_deployment.md`を現行service・CLI・workflow契約と突合した。securityの旧soft-delete記述を「codeは物理削除へ移行済み・本番未公開」へ更新し、APIには実装済み契約と未適用状態、testingには専用DB以外へ接続しない境界、startup/deploymentには既定dry-run、stagingのT35明示承認、productionの24時間以内backup/dry-run・execute flag・確認文字列・承認者・change record、不可逆rollback・isolated restore制約を記録した。T1Bはproduction公開・production cleanup・contract migrationの未承認blockerとして維持する。MarkdownへPrettierを適用し、workflow入力名・branch・Artifact保持期間との照合と`git diff --check`が成功した。文書だけの変更であり、コードtest、専用DB、staging/production workflowは実行していない。

> T30 backend品質check記録（2026-07-16）: backendのESLint、Prettier check、TypeScript build、Prisma schema validateが成功した。通常全testは73 files・793件成功、専用DB 3 files・7件skipで、skip内訳はaccount deletion 5件、監査rollback 1件、監査cleanup 1件だった。T29でaccount deletion単体を7件と記載していた誤りを`docs/07_testing_flow.md`で5件へ修正し、全専用DB test合計が7件であることを明記した。専用DBを実接続するT32、frontend品質checkのT31、staging/production workflowは実行していない。

> T31 frontend品質check記録（2026-07-16）: frontendのPrettier適用、ESLint、Svelte/TypeScript check、production buildが成功し、`svelte-check`は0 errors・0 warningsだった。通常全testは44 files・490件すべて成功した。Prettier適用とbuild後にfrontend source差分がないことを確認した。adapter-autoの配備先未確定messageは既知の非errorでbuild終了codeは0だった。実browser・PlaywrightはT34、専用DBはT32、staging/production workflowは各タスク境界まで実行していない。

> T32 専用DB integration記録（2026-07-16）: ローカルDocker PostgreSQLの専用DB `gensoko_account_deletion_test`へ接続し、15 migrationsが適用済み・pending 0件であることを確認した。`ACCOUNT_DELETION_INTEGRATION_DATABASE_URL`を明示してaccount deletion integration 5件を実行し、本人退会・管理者強制退会の全所有row cascade、共有Element保持、PIIなし成功監査、監査insert失敗時rollback、同一User並行退会の1commit、2 ADMIN並行退会時のlast-admin保護がすべて成功した。1 file・5件成功、test時間3.08秒、全体3.66秒だった。終了後の専用DBはUser 0件・AuditLog 0件・fixture Element 0件で、後片付け完了を確認した。staging/productionへの接続・workflowは実行していない。

> T33 測定手段TDD記録（2026-07-16）: PR #99 merge後のfollow-up branchで、staging固定の接続先共通validator、既存Userの最大GameSession/GameAnswer件数だけを返すpreview、上限付きsynthetic User fixture、実`deleteCurrentUser` service経路の時間測定、migration中の4 index対象table write probe、全所有row 0件検証、finally cleanup、manual-only workflowを追加した。Redは新規module/workflow未実装と既存migration workflowのconcurrency・project ref・計測不足により5 filesすべて失敗した。Green/Refactor後はT33対象7 files・59件、configを含む8 files・120件が成功し、backend通常全testは78 files・841件成功、専用DB 3 files・7件skip、ESLint・Prettier check・TypeScript buildが成功した。staging Environment Variableは変更せず、migration・preview・performance executeのいずれも実環境では未実行であるため、T33自体は進行中のままとする。

> T33 review follow-up（2026-07-16）: `Staging Database Setup`がT33専用化されて通常・将来migrationへ使えない不整合を修正し、既定`apply`と`measure-account-deletion-indexes`を分離した。`apply`は対象index migrationがpendingなら拒否して初回計測の迂回を防ぎ、計測側は対象1件だけがpendingの場合に限定する。あわせてperformance execute入力をGitHub Actionsの`env`経由へ変更し、shellへの直接展開を廃止した。CLIは性能測定flagの設定不備を引数不備と区別した。Redは3 files・5件失敗、Greenは3 files・19件成功。最終品質checkはESLint・Prettier・TypeScript build・backend全842件成功、専用DB 7件skip。staging workflowは未実行。

> T33 write probe duration review follow-up（2026-07-16）: migration write probeの開始時刻をsynthetic fixture作成前から作成完了直後へ移し、fixture作成時間を指定durationへ算入しないよう修正した。fixture作成で4,000ms経過する時刻mockに対し、旧実装が5,000ms指定で3回しかprobeしないRedを確認し、修正後は作成後から5,000ms以上にわたり15回probeするGreenを確認した。T33対象61件、backend全843件成功、専用DB 7件skip。staging workflowは未実行。

> T33 初回staging preview・安全停止記録（2026-07-17）: staging Environmentへ`STAGING_ACCOUNT_DELETION_PERFORMANCE_ENABLED=false`を明示設定し、`develop`のPR #100 merge commitからread-only previewを実行した（run: https://github.com/RitukoIsibasi0222/gensoko/actions/runs/29505517333）。branch・Environment・入力検証、checkout、依存installまでは成功したが、Prisma Client未生成のため性能測定CLIのmodule読込で失敗し、接続先検証・既存User件数取得を含むDB処理前に停止した。migration、write probe、synthetic fixture、performance executeは未実行で、終了後もflagが`false`であることを確認した。さらにproject refを通常Variableからjob envへ渡すとActionsのenv一覧へ表示されることが判明したため、再実行を停止した。修正ではT33の2 workflowへ`npx prisma generate`を追加し、project refをstaging Environment Secret参照へ統一した。Redは3 files・14件中5件失敗、Greenは3 files・14件成功、backend通常全testは78 files・845件成功、専用DB 3 files・7件skip。Prisma Client生成・schema validate、ESLint、Prettier、TypeScript build、workflow・文書のPrettier checkも成功した。修正は未mergeでpreview未再実行のため、T33は進行中のままとする。

> T33 修正版preview・migration安全停止記録（2026-07-17）: PR #101 merge commitからread-only previewを再実行し成功した（run: https://github.com/RitukoIsibasi0222/gensoko/actions/runs/29545332260）。既存Userの最大GameSession・GameAnswerはいずれも0件で、executeはskipされ、project ref・接続URL・synthetic識別子patternの露出は検出されなかった。明示承認後にflagを`true`へ変更してindex migration計測を実行した（run: https://github.com/RitukoIsibasi0222/gensoko/actions/runs/29545713168）。対象migrationは正常に適用されたが、write probeが非ゼロ終了し、GitHub runnerの`bash -e`により`wait`でstepが中断したため、probeのgeneric event、cleanup結果、計測summary、最終`prisma migrate status`を記録できなかった。cascade performance executeは行わず、flagを直ちに`false`へ戻して確認した。既存Userを対象とする更新・削除は実行していない。T33は性能確認未完了のため進行中を維持する。

> T33 migration failure diagnostics TDD記録（2026-07-17）: `bash -e`中断、cleanup状態欠落、Prisma生ログの接続先表示、失敗後のmigration最終確認skipを再現するcontract testと、残存synthetic fixture・Element未投入時のexecute開始前拒否testを追加した。Redは3 files・38件中9件失敗、その後の安全条件追加は1 file・21件中2件失敗、Prisma生ログ隔離は1 file・6件中1件失敗を確認した。Green/Refactorではmigration/probeの終了codeを明示回収し、許可fieldだけを`jq`で再構成してsummaryへ出し、最終migration status確認後にjob全体を失敗させる。CLIはcleanup状態を`completed` / `failed` / `not-required`だけで返し、previewは最大件数に加えて残存synthetic fixture User件数とfixture元Element有無をread-only取得する。残存fixtureが1件以上またはElementが0件ならexecuteを開始しない。対象3 files・40件、backend通常全testは78 files・850件成功、専用DB 3 files・7件skip。ESLint・Prettier check・TypeScript build・Prisma Client生成・schema validateが成功した。修正は未mergeで、staging preview再確認・migration current確認・cascade executeは未実行。

> T33 PR #102 review follow-up（2026-07-17）: fixture件数・上限・Element前提のvalidation失敗もfixture未作成を示す`StagingAccountDeletionPerformanceFailure("not-required")`へ統一し、CLIの構造化失敗logからcleanup状態が欠落しないよう修正した。cleanup失敗testはError全体の等価比較をやめ、`message`と`fixtureCleanupStatus`だけを`toMatchObject`で検証する安定した契約へ変更した。対象3 files・40件、ESLint・Prettier check・TypeScript buildが成功した。

> T33 PR #102 merge後preview・Element precondition follow-up（2026-07-17）: `develop`のmerge commit `bd7dc2b`からread-only previewを再実行し成功した（run: https://github.com/RitukoIsibasi0222/gensoko/actions/runs/29548067973）。最大GameSession・GameAnswer・残存synthetic fixtureはいずれも0件だったが、`fixtureSourceElementAvailable=false`を検出したためcascade executeを停止した。flagは実行前後とも`false`で、execute stepはskipされた。既存のstaging workflowにseed経路がないため、`Staging Database Setup`へ`seed-elements`を追加する。`develop`・staging固定、確認文字列、接続先完全検証、対象外pending migration拒否、生ログ非表示を要求し、既存118元素をPrisma `upsert`する。Redは対象8件中3件失敗、互換schema条件の再レビューでは1件失敗を確認し、Greenは対象8件成功。backend通常全testは78 files・852件成功、専用DB 3 files・7件skip、ESLint・Prettier check・TypeScript build、workflow・文書のPrettier checkが成功した。merge後にseedとpreview再実行が必要なため、T33は進行中を維持する。

> T33 PR #104 review follow-up（2026-07-17）: runbookのpreview停止条件へfixture元Elementなしを明記し、実装のexecute拒否条件と一致させた。Element seedは`main()`と`prisma.$disconnect()`を個別のtry-catchで処理し、どちらの失敗も生Error・stackを参照せず日本語の一般化メッセージと終了code 1だけを返す。Redは対象8件中1件失敗、Greenは8件成功。backend通常全testは78 files・852件成功、専用DB 3 files・7件skip、ESLint・Prettier check・TypeScript buildが成功した。

> T33 staging Element seed・cascade性能記録（2026-07-17）: PR #104 merge commit `567eb1f`から`Staging Database Setup`の`seed-elements`を実行し、既存118元素のPrisma `upsert`に成功した（run: https://github.com/RitukoIsibasi0222/gensoko/actions/runs/29549872910）。flag `false`のread-only previewは最大GameSession 0件・最大GameAnswer 0件・残存synthetic fixture 0件・Element有りで成功した（run: https://github.com/RitukoIsibasi0222/gensoko/actions/runs/29549921830）。明示承認後、flagを`true`へ変更し、synthetic GameSession 5,000件・GameAnswer 50,000件、platform timeout 10,000msで実`deleteCurrentUser`経路を測定した（run: https://github.com/RitukoIsibasi0222/gensoko/actions/runs/29550089330）。削除時間は1,446.32msで基準5,000ms以内、`passed=true`、`fixtureCleanupStatus=completed`だった。終了直後にflagを`false`へ戻し、事後previewでも最大件数0件・残存fixture 0件・Element有りを確認した（run: https://github.com/RitukoIsibasi0222/gensoko/actions/runs/29550170012）。既存Userの更新・削除、migration、write probeはこの一連のrunでは実行していない。cascade性能は合格したが、初回index migration時のwrite probe計測値は同じstaging DBで再取得できないため、isolated staging相当環境での再現またはproduction判断を残し、T33は進行中を維持する。

> T33 ローカルisolated初回migration再現記録（2026-07-17）: staging・production・通常開発DBへ接続せず、ローカルDocker PostgreSQL 16.13の専用DB `gensoko_t33_migration_perf_20260717`だけを使用した。現行schemaから対象4 indexを除去し、先行14 migrationsを適用済みとして記録して、`20260716112500_add_account_deletion_indexes`だけがpendingであることを確認した。Element 118件をseed後、既存のmigration write probeを30,000ms実行し、開始2秒後に実 `prisma migrate deploy`を並行実行した。migrationは1,427ms、probeは115回、`writeProbeMaxDurationMs`は22.14ms、`fixtureCleanupStatus=completed`、最終migration statusは`current`だった。対象4 index作成、15 migrations適用済み、残存synthetic User 0件、Element 118件を確認後、専用DBと一時実行scriptを削除した。stagingの性能flagは変更せず`false`を再確認し、既存Userの更新・削除は行っていない。
>
> この値は初回migrationと現行probeの組合せを安全に再現できることを示すローカルbaselineであり、Supabase stagingと同じcompute・network・実データ量のisolated環境による合否ではない。また、現行runbookはcascadeに`min(timeout * 0.5, 5,000ms)`を定義している一方、migration write待ちは「maintenance windowを超えないこと」だけで具体的な数値上限が未定義である。環境同等性の承認とmigration write待ち上限の決定、または別のisolated Supabase相当環境での再計測が完了するまで、T33は進行中を維持する。

> T33 managed DB判定基準案（2026-07-18）: 追加のSupabase project・追加費用・共有DBへの再適用を行わず、ローカルbaselineをmanaged DB合格証拠へ昇格させない方針を確定した。将来のisolated managed DB再計測では、Supabaseのcompute class、PostgreSQL major version、東京region、Session pooler port 5432、対象migrationだけがpendingであること、4つのindex対象tableのrow数がproduction集計値以上であることをすべて満たした場合だけ環境同等候補とする。暫定数値gateは、30,000ms以上のprobe、`migrationDurationMs <= 5,000`、`writeProbeMaxDurationMs <= 1,000`、`probeCount >= 20`、migration/probe成功、fixture cleanup完了、最終migration status currentの全条件とする。5,000msは10,000msのplatform request timeoutの半分、1,000msは同timeoutの10%を上限候補としたproject固有の保守値であり、SupabaseのSLOや正式なmaintenance承認値ではない。いずれかを満たさない、環境同等性を確認できない、または正式なmaintenance windowが未決定の場合はT36をblockし、production適用を初回性能試験に使わない。通常`CREATE INDEX`を維持できない場合は、invalid indexの検出・除去・再試行を含む`CREATE INDEX CONCURRENTLY` runbookを別設計する。この基準案だけではT33を完了扱いにせず、managed DB証拠または正式な残余リスク承認を待つ。

> T34 ローカル参考検証記録（2026-07-18）: staging frontend/APIの配備先が未実装のため、ローカルDockerだけでsynthetic accountを使ったbrowser回帰を行った。本人退会ではpassword・同意の個別errorとfocus、同一tab・別tabの認証clear、同一email/usernameの再登録、新しいUserとして学習data 0件を確認した。管理者強制退会では不可逆な完全削除警告、削除後の一覧・focus、同一識別情報の再登録、target所有row 0件と共有Element保持を確認した。console errorはなく、synthetic User・メールfixtureは終了時0件にcleanupした。実在User、staging、productionには接続していないためT34自体は未完了とする。

> T34 staging synthetic Admin E2Eコード基盤（2026-07-20）: 配備済みVercel/Workerの固定URLだけを許可し、完全一致する予約済みsynthetic Admin/Userだけをtransactionで作成・cleanupするfixture、環境変数credential専用CLI、`develop`・staging Environment限定manual workflow、Admin login→対象User強制退会→旧credential login 401のPlaywright specをTDD実装した。識別子衝突、production・任意URL、staging DB validator不一致、明示enable flag未設定、Admin/Userの同一passwordはDB変更前に拒否する。厳格レビュー後は全dependency・browser導入後にcredentialを実行時生成・maskし、`GITHUB_OUTPUT`からprepare/Playwrightのstep環境変数だけへ渡す構造へ変更した。E2Eは5分制限とし、main jobの`always()` cleanupに加えて非成功時は`needs`・`always()`・10分制限のrecovery jobが別runnerで冪等cleanupする。強制終了時は同じreview済みSHAの再実行で回復する。PR #119 review後はPlaywright側もcredentialの前後空白を正規化し、既存password validatorを共有してbackendと同じ強度・bcrypt上限をDB接続前に検証する。対象backend 23 tests、frontend 24 testsが成功した。初回workflowは下記follow-upのとおりPlaywright未到達で失敗しており、実staging E2E成功までT34は進行中とする。

> T34 staging初回run follow-up（2026-07-20）: `develop`の`0f43610016587ed3cf7169707853f7ef1fff1239`で[run 29746415785](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/29746415785)を実行した。prepareは成功したが、固定frontendのVercel Deployment Protectionが`/login`をSSOへ302 redirectしたため、PlaywrightはAdmin login前にtimeoutし、強制退会・旧credential 401には到達しなかった。main cleanupと独立recovery cleanupは成功し、enable flagは`false`へ復旧した。保護を公開解除せず、固定Vercel originだけへautomation bypass headerを付与し、Worker API・query・job全体envへSecretを漏らさない補正をTDD実装した。production操作、migration、実メール、追加の直接DB queryは行っておらず、補正merge後の実E2E成功までT34は進行中とする。

> T34 PR #120 merge後再実行（2026-07-21）: `develop`の`e3893c95c6c842c74f22e65fb23613e0b7987947`で[run 29788242095](https://github.com/RitukoIsibasi0222/gensoko/actions/runs/29788242095)を1回だけ実行した。automation bypassにより固定frontendのAdmin login画面へ到達し、prepareはsynthetic Admin/User 2件作成・置換0件で成功した。Playwrightはlogin送信後、固定Worker APIのlogin responseを60秒以内に観測できずtimeoutし、Admin login成功・強制退会・旧credential 401には到達しなかった。main cleanupは2件削除、独立recovery cleanupは削除対象0件で成功し、fixture残存なしをworkflow結果で確認した。enable flagは`false`へ復旧した。追加の読み取り確認ではAPI health 200とCORS preflight 204だったが原因は未確定であり、同一内容を再実行せず安全な診断と必要なTDD補正を先に行う。credential値、staging DB追加直接query、手動fixture操作、production操作、migration、実メール、再配備は扱っておらず、実E2E成功までT34は進行中とする。

> T35 safety preflight TDD記録（2026-07-18）: staging cleanup前に完全一致するsynthetic legacy target 1件とactive/suspended sentinelを検証し、未知のlegacy row、fixture識別子衝突、所有row不整合、Element欠落があれば削除前に停止するfixture module・CLI・manual workflowを追加した。cleanup workflowはproject ref照合、Prisma Client生成、dry-run/execute前の`verify-isolated`、execute後の`verify-cleaned`を必須化した。cleanup済み0件かつ所有row 0件は冪等再実行として許可する。Redではmodule/workflow未実装と再実行不許可を確認し、Greenはmodule/workflow 13件とTypeScript buildが成功した。変更はPR #107で`develop`へmerge済みだが、staging workflowのdry-run/execute/再実行はBタスクとして未実施であり、T35全体は未完了とする。

> T39 Red/Green記録（2026-07-18）: `usable-admin`、auth、admin、ranking、admin-create、user serviceに旧DB列名が残れば失敗し、admin v1 route境界のdeprecated `deletedAt: null`合成は維持するsource contract testを先行追加した。Redは6 service fileの参照を検出し、route互換だけGreenだった。Greenではserviceの型・select・where・状態判定から旧列依存を除去し、現存Userだけを扱うcontract後の集計へ切り替えた。`status=deleted`の200空一覧と公開responseの`deletedAt: null`は維持した。関連151件、追加contract 7件、TypeScript buildが成功した。staging/production deployとsoakはT38完了後のBタスクとして残す。

> T43 Red/Green・専用DB記録（2026-07-18）: guard SQLを通常の`prisma/migrations`ではなく`prisma/contract-migrations`へ隔離し、`deletedAt IS NOT NULL`が1件でもあれば件数・IDを含まないgeneric errorでindex/column drop前に停止する契約testを追加した。RedはSQL未作成で失敗し、Greenは配置・guard順序2件が成功した。ローカルDocker PostgreSQLの完全一致専用DB `gensoko_account_deletion_contract_test`へ通常15 migrationsを適用し、legacy rowありでは列・index保持、0件では列・一時index dropの2件が成功した。test終了時に専用DBの列・indexとfixture 0件を復元した。共有環境の`prisma migrate deploy`、staging、productionへは適用しておらず、T44と元のrelease gateを維持する。

> 2026-07-18 follow-up品質記録: backend通常suiteは82 files・867件成功、専用DB 4 files・9件skipだった。ESLint、Prettier check、TypeScript build、Prisma schema validateが成功した。T39後のローカル専用account deletion cascade・rollback 5件と、T43専用contract migration unit/integration 4件も明示実行して成功した。性能測定は既存の合格証拠を再利用し、再実行していない。staging/production cleanup、共有環境deploy、contract適用は実施していない。

> PR #107 厳格レビューfollow-up（2026-07-18）: Userを返すPrisma write 9箇所へ明示`select`を追加し、対象serviceの`user.create/update/delete`にselect漏れがあれば失敗するAST source contractを追加した。shorthandの`{ select }`も明示指定として許容する。staging cleanup executeは完全一致synthetic fixture IDだけへ限定し、preflight後に未知legacy rowが発生しても削除せず残件として失敗させる。`deleteOnlyUserIds`の空配列はDB集計前に引数エラーとして拒否する。fixture prepare/removeは識別field完全一致と削除件数を再検証し、CLIの利用者向け文言・切断失敗を日本語の安全な一般化messageへ統一した。contract SQLはguard前に`ACCESS EXCLUSIVE` lockを取得し、専用DBで並行legacy insert確定後の中止とdrop後Prisma writeを確認した。backend変更を含む`develop`向けPRには通常品質check workflowを追加した。Redでは新規workflow不存在、synthetic限定execute未実装、lock未実装、空配列no-op、shorthand誤検知などを確認し、Greenでは通常suite 84 files・887件成功、専用DB 4 files・10件skip、account deletion 5件、contract migration unit/integration 5件、ESLint、Prettier check、TypeScript build、Prisma schema validateが成功した。staging/production cleanup、共有環境deploy、contract適用、既存性能測定の再実行は行っていない。

## 残作業の実施区分（2026-07-18）

元のタスクとrelease gateは削除せず、現在の個人開発環境で実施できる範囲と、実環境・組織判断を要する範囲を次のように区分する。下記の補助区分は元タスクの完了条件を変更せず、実施済み部分と未実施部分を区別するための記録である。

### A: 現在の環境で実施する

- T33は、stagingへのexpand migration適用、staging cascade性能、ローカルisolated初回migration baselineまでを実施済み証拠として維持する。managed DB再計測用の環境同等性条件、暫定数値gate、停止条件だけを文書化し、ローカル値をmanaged DB合格証拠へ昇格させない。managed DB固有の証拠または正式な残余リスク承認がないため、T33全体は進行中のままとし、新しいSupabase projectや追加費用は発生させない。
- T34は、配備済みCloudflare Workers/Vercelへ安全に実行するsynthetic Admin/User fixture・manual workflow・Playwright specをローカルTDD実装する。実URLへの実行はBへ残す。
- T35は、staging cleanupの対象が完全一致するsynthetic fixtureだけであることをID・識別field・対象件数で事前検証し、execute自体もfixture IDだけに限定する仕組みをTDD実装する。preflight後に未知のlegacy rowが発生しても削除せず、残件として失敗させる。
- T39は、DB列非参照codeとtestを実装できる。Userを返すPrisma writeへ明示`select`を要求するsource contractで旧列の暗黙取得も防ぐ。v1のdeprecated `deletedAt: null`はroute境界の互換値として維持する。staging/productionへdeployする前に各環境のlegacy cleanup 0件を必須とし、元のT38依存はproduction deploy gateとして維持する。
- T43は、table lock付きguard SQLのcontract testとローカル専用DBでのfail/success・並行insert確認を準備できる。ただし通常の`prisma migrate deploy`へ混入して共有環境へ早期適用される構成にはしない。安全に分離できない場合はmigration追加をBへ戻す。

### B: 実環境・前提が整った時点で実施する

- T33のmanaged DB固有write待ち検証と、正式なmaintenance windowに基づく数値gate承認。暫定候補だけでは完了扱いにしない。
- T34のstaging Admin強制退会Playwright実行。配備先と安全なsynthetic実行基盤は準備済みだが、workflow実行は直前承認を必要とする。
- T35のstaging dry-run/execute/再実行0件。fixture preflightを含む変更が`develop`へmergeされ、staging固定workflowから実行できることを前提とする。
- T36〜T38、T39の実環境deploy、T40〜T42、T44、production smoke test、production release gate。
- T43 migrationのstaging/production適用。legacy 0件、非参照code、backup、旧Artifact失効、restore drill、rollback制限を元計画どおり要求する。

### C: 現時点では対象外または決定不能

- 実在する承認者・実行者・通知先、正式なmaintenance window。
- 法務または正式なprivacy policy承認、監査内部ID保持の組織的承認。
- 実ユーザー数・契約に依存する保持期間、商用サービスとしてのSLO・SLA。

個人開発の現時点では正式な運用・法務体制がないため、架空の人物、承認日、連絡先、SLO/SLAを記録しない。これらは商用化前のrelease gateとして未完了のまま維持する。

### 依存関係の扱い

- T33の未解決部分はproduction expand migrationの判断材料であり、ローカル参考検証を妨げない。ただしT34 staging完了の前提を満たしたとは扱わない。
- T33のmanaged DB証拠がない状態でproduction migrationを初回性能試験に使わない。暫定gateを満たせる同等環境が用意できない場合はT36をblockし、通常`CREATE INDEX`以外の移行方式を別設計する。
- T39/T43は「code・test・専用DB検証」と「共有環境deploy・適用」を分離する。前者を先に準備しても、元のT38/T41/T42依存とrelease gateを完了扱いにしない。
- 共有環境へ適用され得るmigrationを安全に隔離できない場合は、T43の実migration作成を開始せずBへ残す。

## 技術的注意点

- ESM importは `.js` 拡張子を付ける。
- union例は `"USER" | "ADMIN"` のようにquoteする。
- P2034判定、usable admin条件、error message、Cookie clearを複製しない。
- 共通transaction helperはdomain messageを知らず、serviceが日本語errorへ変換する。
- batch IDをloggerへ渡さず、loggerは許可fieldを型で限定する。
- `process.env` のdefault/validationは `config.ts` に一元化する。
- integration testだけは専用DB名を厳格に要求する。
- migration guardのerrorへ件数やIDを出さない。
- frontendは `parseErrorResponse` でbackend messageを保持する。
- delete成功後のclient logout APIは不要。server token/Cookie削除とlocal clearを分離する。
- AbortErrorは通常error toastにしないが、結果不明時の再確認導線をtestする。
- 候補ファイル名は実装時に実在確認し、不要fileを作らない。

## テスト方針

TDDのRed → Green → Refactorを守り、mock unit、専用PostgreSQL、workflow contract、frontend DOM/A11Y、staging Playwrightを組み合わせる。

### backend unit / service

| ケース                             | 期待結果                                          |
| ---------------------------------- | ------------------------------------------------- |
| self 正しいpassword                | User deleteとsuccess auditを同一transactionで呼ぶ |
| self password不一致                | 400、transaction未開始                            |
| self 73byte password               | 省略せず完全値をbcrypt比較                        |
| self 初回/transaction内User不存在  | 409、削除なし                                     |
| self password hash変更             | 409、削除なし                                     |
| self USER                          | admin countなしで削除                             |
| self ADMIN、他ADMINあり            | 成功                                              |
| self 最後のADMIN                   | 409、削除/auditなし                               |
| self P2034→成功                    | 2attempt、success audit 1件                       |
| self P2034×2                       | 409、削除なし                                     |
| self audit insert失敗              | User/cascade rollback                             |
| admin 正常削除                     | target delete、success audit                      |
| admin self/target不存在/last-admin | 409/404/409、分類済みfailure audit                |
| admin actor降格/停止               | 409、削除なし                                     |
| admin P2034 retry/枯渇             | success 1件 / 409 failure 1件                     |
| audit新action                      | strict受理、actor=target必須                      |
| audit余剰/PII field                | schema拒否                                        |
| retry helper非P2034                | retryせず再throw                                  |

### route / API

| ケース                                  | 期待結果                                     |
| --------------------------------------- | -------------------------------------------- |
| self valid                              | 200、既存message、Cookie両path削除           |
| self empty/extra field                  | 400 validation形式                           |
| self wrong password/last admin/conflict | 400/409/409                                  |
| self rate limit/store障害               | 429/503                                      |
| self unexpected                         | 500 generic、stackなし                       |
| admin valid/invalid id                  | 200/400                                      |
| admin auth/role拒否                     | 401/403                                      |
| admin missing/repeat                    | 404                                          |
| admin self/last-admin/conflict          | 409                                          |
| admin rate limit                        | 429                                          |
| register after deletion                 | 201、新User ID                               |
| old credential login                    | generic 401                                  |
| forgot/refresh/access token             | 200 no-op / 401 / 401                        |
| `status=deleted` v1互換                 | 200空一覧                                    |
| admin summary/stats互換                 | `deletedAt:null`、`deleted:0`、total=current |

### 専用PostgreSQL integration

専用DB名候補は `gensoko_account_deletion_test`、専用envは `ACCOUNT_DELETION_INTEGRATION_DATABASE_URL` とする。hostは `localhost`、`127.0.0.1`、`postgres` だけを許可し、DB名完全一致前にfixture操作をしない。通常unit suiteはenv未設定時skipする。

| ケース                        | 期待結果                              |
| ----------------------------- | ------------------------------------- |
| 全所有model fixture           | User delete後に全て0件                |
| GameAnswer間接cascade         | GameSession経由で0件                  |
| 共有Element                   | 残存                                  |
| self/admin success audit      | Userなし、監査あり、PIIなし           |
| audit insert失敗              | Userと全子rowがrollback               |
| 大量fixture                   | performance gate内、orphan 0          |
| concurrent self delete        | 1commitだけ                           |
| concurrent last-admin deletes | usable ADMIN 1以上                    |
| legacy cleanup                | 対象だけ削除、active/suspended保持    |
| cleanup再実行                 | 0件success                            |
| batch途中失敗                 | 失敗batch rollback、再実行remaining 0 |

### cleanup CLI / workflow

| ケース                          | 期待結果                                                |
| ------------------------------- | ------------------------------------------------------- |
| 引数なし / flag trueだけ        | dry-run、delete未呼出し                                 |
| `--execute`だけ / confirm不一致 | DB load前に拒否                                         |
| unknown/duplicate arg           | 拒否                                                    |
| batch 0/101/小数/空             | 拒否                                                    |
| batch 1/25/100                  | 受理                                                    |
| dry-run/execute 0               | exit 0                                                  |
| execute残件あり                 | exit non-zero                                           |
| errorにsecret/ID                | stdout/stderrへ出さない                                 |
| disconnect error                | generic warningだけ                                     |
| staging workflow                | staging固定、manualのみ                                 |
| production dry-run              | executeなし                                             |
| production execute              | flag/confirm/24h backup・dry-run marker/concurrency必須 |
| schedule                        | executeを自動選択しない                                 |

### frontend / A11Y

| ケース                   | 期待結果                               |
| ------------------------ | -------------------------------------- |
| password空               | passwordだけinvalid、passwordへfocus   |
| 同意なし                 | checkboxだけinvalid、checkboxへfocus   |
| 両方invalid              | 最初のpasswordへfocus                  |
| API 400/409/429/503      | backend messageをalert表示             |
| network/Abort            | 共通message / 結果不明を誤断定しない   |
| 二重submit               | API 1回、button disabled               |
| delete中                 | form busyと読み上げ状態                |
| success                  | toast、local clear、broadcast、`/`遷移 |
| channel受信/未対応/SSR   | refresh abortとclear / 例外なし        |
| 旧 `status=deleted` URL  | dropしてcanonicalize                   |
| admin filter             | active/suspendedだけ                   |
| admin delete list        | target消失、次/前/headingへfocus       |
| admin delete detail      | detail再fetchなし、dialog close        |
| post-delete sync失敗     | successとsync errorを分離              |
| live/empty/loading/error | 支援技術へ通知                         |
| keyboard/color           | keyboard完結、文言で状態識別           |

### 品質check

```bash
cd backend
npm run lint
npm run format:check
npm run build
npm run test -- --run
npm run test:integration:account-deletion

cd ../frontend
npm run format
npm run lint
npm run check
npm run build
npm run test:run
```

- schema変更後は `npx prisma validate` と専用DB/stagingの `npx prisma migrate deploy` を実行する。
- workflow YAML parseとcontract testを実行する。
- DB変更のため、本人退会・管理者強制退会・再登録の3導線をPlaywrightで確認する。

## 手動確認

### 本人退会

1. USERでloginし、学習履歴、苦手、stats、tokenを作る。
2. keyboardだけでpassword/同意error、誤password、429/503、focusを確認する。
3. 正しいpasswordで削除し、toast、top遷移、別tab clear、旧token 401を確認する。
4. DBでUser・所有row 0、Element残存、AuditLog success 1件を確認する。ID/PIIをscreenshotへ残さない。
5. 同一email/usernameで再登録し、新ID・旧履歴なしを確認する。

### 管理者強制退会

1. 一覧起点とdetail起点で実行する。
2. focus trap、Escape、busy中close禁止を確認する。
3. success後にdetail 404を出さず、一覧から消え、focusが次/前/headingへ移ることを確認する。
4. self、最後のADMIN、既削除IDの409/404を確認する。
5. statsがcurrent semanticsで減少することを確認する。

### migration・restore

1. staging legacy fixtureでdry-run/execute/再実行0を確認する。
2. active/suspended userとElementが残ることを確認する。
3. cleanup後backupをisolated projectへrestoreし、backup後actionをreplayする。
4. legacy row 1件ではdrop guardがIDなしで失敗し、0件では成功することを確認する。
5. contract migration後に3主要導線を再確認する。

## release gate

### merge前

- [ ] 設計判断と未確認事項にowner回答がある。
- [ ] 監査内部IDの期間・目的・承認者・日付がある。
- [ ] backup/replay gapとusername再利用が承認済み。
- [ ] schema inventory/cascade/indexとv1互換がreview済み。
- [ ] unit、route、frontend、workflow testが全通過。
- [ ] 専用PostgreSQL integrationが全通過。
- [ ] log negative testでPII/secret/internal IDがない。

### staging

- [ ] expand/contract migration成功。
- [ ] cascade performanceが基準内。
- [ ] legacy dry-run/execute/再実行0成功。
- [ ] 本人・管理者・再登録Playwright成功。
- [ ] keyboard、screen reader、focus、live region確認。
- [ ] restore drillと再削除成功。
- [ ] drop guardのfail/success確認。

### production

- [ ] `BACKUP_ENCRYPTION_PASSPHRASE` とbackup実績を確認。
- [ ] 破壊的operation前24時間以内の暗号化backup成功。
- [ ] maintenance window、実行者、承認者、通知先を記録。
- [ ] 旧backend instanceをdrain。
- [ ] legacy dry-run承認、execute後0件、flag false。
- [ ] active/suspended/admin数とcurrent statsを照合。
- [ ] 非参照codeをsoak。
- [ ] cleanup後backupと旧Artifact 7日失効を確認。
- [ ] contract後rollback artifactが非参照版。
- [ ] privacy policy `/privacy` が公開済み。
- [ ] UI/privacy文言が正式承認値と一致。
- [ ] 全損時replay gapが未解決なら公開しない、または正式承認・開示がある。
- [ ] 本人・管理者・再登録smoke test成功。

## 実装完了時の更新ルール

- 対象ファイルを実変更へ合わせ、候補名を確定名へ置換する。
- 不要候補は削除または未実装理由を記録する。
- checkboxと `docs/05_progress.md` を実態へ合わせる。
- Red→Green→Refactor、test件数、integration、Playwright、run IDを記録する。
- 監査/backup/privacyの承認者・日付・正式値を秘密情報なしで記録する。
- rollout中の判断変更、互換期間、rollback制限、残余リスクを記録する。

## 実装完了

- 完了日: YYYY-MM-DD
- 実装ブランチ: feature/account-data-complete-deletion
- PR: #N
- expand migration: ...
- legacy cleanup staging run: ...
- legacy cleanup production run: ...
- contract migration run: ...
- restore drill: ...
- 監査内部ID保持承認者・承認日: ...
- backup/replay方針承認者・承認日: ...

### TDD実施記録

- Red:
- Green:
- Refactor:
- backend unit/route tests:
- frontend tests:
- PostgreSQL integration tests:
- Playwright:
- lint / format / build / check:

### 計画からの変更点

<!-- 計画時と実装が異なった箇所、理由、privacy/API/rollbackへの影響を記録する。 -->

### 実際の変更ファイル

| ファイル | 変更種別 | 内容 |
| -------- | -------- | ---- |
| `...`    | 修正     | ...  |

### 移行・運用結果

- legacy dry-run対象件数（ID/PIIなし）:
- legacy execute削除件数:
- 再dry-run残件:
- execute flag停止:
- cleanup後backup:
- 旧Artifact失効確認:
- `deletedAt` drop前guard結果:
- production smoke test:

### 承認済み残余リスク

- 監査内部ID:
- 暗号化backup:
- 現行DB全損時の削除replay:
- メール・外部log・browser:
- username再利用:

### 未実施・follow-up

- ...
