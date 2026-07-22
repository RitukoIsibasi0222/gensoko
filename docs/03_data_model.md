# データモデル設計書

> ORM: **Prisma** / DB: PostgreSQL
> 実装時は `npx prisma migrate dev` でマイグレーションを実行します
> 実装のsource of truthは`backend/prisma/schema.prisma`です。下記は主要モデルの説明用抜粋であり、実装時は必ずsource of truthを確認します

---

## テーブル一覧

| テーブル名     | 役割                               |
| -------------- | ---------------------------------- |
| `Element`      | 元素マスターデータ（固定データ）   |
| `User`         | ユーザーアカウント                 |
| `RefreshToken` | リフレッシュトークン管理           |
| `WeakElement`  | 苦手リスト                         |
| `GameSession`  | ゲーム1回分の記録                  |
| `GameAnswer`   | ゲーム内の各問の回答記録           |
| `UserStats`    | ユーザー集計統計（キャッシュ用）   |
| `AuditLog`     | セキュリティ上重要な操作の監査証跡 |

---

## Prismaスキーマ

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
}

// ─────────────────────────────────────────
// 元素マスター（固定データ・更新なし）
// ─────────────────────────────────────────
model Element {
  id          Int     @id                  // 原子番号（1〜118）
  symbol      String  @unique              // 元素記号（例: "H"）
  nameJa      String                       // 日本語名（例: "水素"）
  nameEn      String                       // 英語名（例: "Hydrogen"）
  category    String                       // 分類（例: "非金属"）
  period      Int                          // 周期（1〜7）
  group       Int?                         // 族（1〜18, null=ランタノイド等）
  atomicWeight Float?                      // 標準原子量
  etymology    String?                      // 名前・記号の由来（日本語）

  // リレーション
  weakElements  WeakElement[]
  gameAnswers   GameAnswer[]

  @@map("elements")
}

// ─────────────────────────────────────────
// ユーザー
// ─────────────────────────────────────────
model User {
  id              String    @id @default(cuid())
  username        String    @unique          // 表示名（3〜20文字、英数字_のみ）
  email           String    @unique
  passwordHash    String                     // bcryptハッシュ
  role            Role      @default(USER)
  emailVerified   Boolean   @default(false)
  isActive        Boolean   @default(true)  // 停止フラグ
  loginFailCount  Int       @default(0)     // ログイン失敗回数
  lockedUntil     DateTime?                 // ロック解除日時
  lastLoginAt     DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  // リレーション
  refreshTokens   RefreshToken[]
  weakElements    WeakElement[]
  gameSessions    GameSession[]
  stats           UserStats?

  @@map("users")
}

enum Role {
  USER
  ADMIN
}

// ─────────────────────────────────────────
// 監査ログ
// ─────────────────────────────────────────
enum AuditResult {
  SUCCESS
  FAILURE
}

model AuditLog {
  id            String      @id @default(cuid())
  action        String
  result        AuditResult
  actorId       String?
  actorRole     Role?
  targetType    String?
  targetId      String?
  failureReason String?
  occurredAt    DateTime    @default(now())

  @@index([occurredAt(sort: Desc), id(sort: Desc)])
  @@index([action, occurredAt(sort: Desc)])
  @@index([targetType, targetId, occurredAt(sort: Desc)])
  @@map("audit_logs")
}

// ─────────────────────────────────────────
// リフレッシュトークン
// ─────────────────────────────────────────
model RefreshToken {
  tokenHash String   @id                  // raw tokenのSHA-256ハッシュ
  userId    String
  expiresAt DateTime
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([expiresAt, tokenHash])
  @@map("refresh_tokens")
}

// ─────────────────────────────────────────
// 苦手リスト
// ─────────────────────────────────────────
model WeakElement {
  id              String   @id @default(cuid())
  userId          String
  elementId       Int
  missCount       Int      @default(1)    // 間違えた回数
  consecutiveHit  Int      @default(0)    // 苦手ゲームでの連続正解数
  addedAt         DateTime @default(now())
  updatedAt       DateTime @updatedAt

  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  element Element @relation(fields: [elementId], references: [id])

  @@unique([userId, elementId])           // 同一ユーザーで同一元素は1行のみ
  @@map("weak_elements")
}

// ─────────────────────────────────────────
// ゲームセッション（1ゲーム = 1セッション）
// ─────────────────────────────────────────
model GameSession {
  id          String      @id @default(cuid())
  userId      String
  mode        GameMode
  totalScore  Int
  correctCount Int
  totalCount  Int         @default(10)
  maxStreak   Int         @default(0)    // 最大連続正解数
  durationSec Int                        // かかった秒数
  playedAt    DateTime    @default(now())

  user    User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  answers GameAnswer[]

  @@map("game_sessions")
}

enum GameMode {
  SYMBOL_TO_NAME_LV1
  SYMBOL_TO_NAME_LV2
  NAME_TO_SYMBOL_LV1
  NAME_TO_SYMBOL_LV2
  WEAK_SYMBOL_TO_NAME
  WEAK_NAME_TO_SYMBOL
}

// ─────────────────────────────────────────
// ゲーム内の各問の回答記録
// ─────────────────────────────────────────
model GameAnswer {
  id            String  @id @default(cuid())
  sessionId     String
  elementId     Int
  isCorrect     Boolean
  answerTimeSec Int                          // 回答にかかった秒数

  session GameSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  element Element     @relation(fields: [elementId], references: [id])

  @@map("game_answers")
}

// ─────────────────────────────────────────
// ユーザー統計（集計キャッシュ）
// ─────────────────────────────────────────
model UserStats {
  userId            String   @id
  totalGames        Int      @default(0)
  totalCorrect      Int      @default(0)
  totalAnswered     Int      @default(0)
  masteredCount     Int      @default(0)    // 習得済み元素数
  currentStreak     Int      @default(0)    // 連続ログイン日数
  lastActiveDate    DateTime?
  weeklyScore       Int      @default(0)    // 週間スコア（ランキング用）
  allTimeScore      Int      @default(0)    // 全期間スコア
  updatedAt         DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_stats")
}
```

---

## 監査ログのrelation・保持方針

- `actorId`・`targetId`には意図的にUser relationと外部キーを追加しない。User row削除後も保持期間中の操作相関を維持するためである
- 内部IDを使ってUserを自動joinせず、公開API・UIへ返さない
- 正式保持期間は365日で、`AUDIT_LOG_RETENTION_DAYS`からUTC cutoffを計算する
- cleanupは既存の`occurredAt DESC, id DESC`複合indexを使い、`occurredAt < cutoff`のIDを古い順に最大500件ずつ取得する
- 削除時は取得済みIDとcutoff条件を再指定し、1回最大10,000件・最大8分で停止する
- 保持期限列、User relation、個別legal hold列、cleanup用の追加migrationは初期実装では追加しない
- 保持期間と内部ID保持は2026-07-14にプロダクトオーナー`RitukoIsibasi0222`が承認した。その他のrelease gate完了までは`AUDIT_LOG_CLEANUP_ENABLED=false`を維持する

### 監査ログindex

| Prisma定義                                                | 用途                                    |
| --------------------------------------------------------- | --------------------------------------- |
| `@@index([occurredAt(sort: Desc), id(sort: Desc)])`       | cleanupの期限検索・安定順序、時系列参照 |
| `@@index([action, occurredAt(sort: Desc)])`               | 操作種別ごとの調査                      |
| `@@index([targetType, targetId, occurredAt(sort: Desc)])` | 対象内部IDごとの相関調査                |

---

## 元素分類の定義

| 日本語名         | 英語名                |
| ---------------- | --------------------- |
| 非金属           | Nonmetal              |
| アルカリ金属     | Alkali Metal          |
| アルカリ土類金属 | Alkaline Earth Metal  |
| 遷移金属         | Transition Metal      |
| 後遷移金属       | Post-transition Metal |
| 半金属           | Metalloid             |
| ハロゲン         | Halogen               |
| 希ガス           | Noble Gas             |
| ランタノイド     | Lanthanide            |
| アクチノイド     | Actinide              |

---

## インデックス設計

> 実装時は SQL 直書きではなく、原則 `backend/prisma/schema.prisma` の `@@index` / `@@unique` に反映し、Prisma migration として管理する。
> 下記は本番前に schema と整合させる対象。新しい検索条件を追加した場合はこの表も更新する。

```sql
-- ゲーム履歴の検索高速化
CREATE INDEX idx_game_sessions_user_played ON "game_sessions"("userId", "playedAt" DESC);

-- ゲーム回答の集計高速化
CREATE INDEX idx_game_answers_session ON "game_answers"("sessionId");
CREATE INDEX idx_game_answers_element ON "game_answers"("elementId");

-- 苦手リストの検索
CREATE INDEX idx_weak_elements_user ON "weak_elements"("userId");

-- ランキング用
CREATE INDEX idx_user_stats_weekly ON "user_stats"("weeklyScore" DESC);
CREATE INDEX idx_user_stats_alltime ON "user_stats"("allTimeScore" DESC);

-- リフレッシュトークンの期限切れcleanup（安定順batch）
CREATE INDEX "refresh_tokens_expiresAt_tokenHash_idx"
  ON "refresh_tokens"("expiresAt", "tokenHash");

-- メール認証・パスワードリセット・一時問題セットの期限切れ cleanup
CREATE INDEX idx_email_verifications_expires ON "email_verifications"("expiresAt");
CREATE INDEX idx_password_reset_tokens_expires ON "password_reset_tokens"("expiresAt");
CREATE INDEX idx_game_question_sets_expires ON "game_question_sets"("expiresAt");
CREATE INDEX idx_game_question_sets_user_created ON "game_question_sets"("userId", "createdAt" DESC);
```

refresh token cleanupは`expiresAt < cutoff`だけを`expiresAt, tokenHash`順で固定batch削除する。cutoff同時刻と有効tokenは保持し、token hash・ID・DB URLをログへ出さない。index追加は既存column/rowを変更しないexpand-only migrationとし、production適用はR15の別承認まで行わない。
