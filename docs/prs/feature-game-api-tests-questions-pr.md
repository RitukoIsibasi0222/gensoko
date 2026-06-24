# PR: GET /game/questions のテスト補強と公開レスポンス固定

## 概要

`GET /game/questions` について、既存仕様に対するテスト不足を補強し、公開レスポンスの境界で正解情報を返さないことを固定しました。

このエンドポイントは `GET /game/questions` で10問の4択問題を生成し、`GameQuestionSet` に正誤判定用の情報を保存します。一方で、クライアントへ返すレスポンスには `correctChoiceId` や判定用 `elementId` を含めてはいけません。今回の調査で、サービス層は公開用レスポンスを返しているものの、ルート層がその結果をそのまま JSON 化していたため、将来サービス層の返却形が変わった場合に HTTP レスポンスへ内部情報が漏れる余地があることを確認しました。

そのため、ルート層でも公開フィールドだけに整形する処理を追加し、API 境界でレスポンス契約を守るようにしています。

## 調査した内容

| 調査対象 | 確認したこと | 今回の判断 |
|---|---|---|
| `docs/04_api.md` | `GET /game/questions` のレスポンス例には `questionId`, `prompt`, `choices[].choiceId`, `choices[].text` のみが公開され、正解情報は `GameQuestionSet.questions` に保存すると明記されている | 公開レスポンスに正解情報が混ざらないことをテストで固定する |
| `docs/05_progress.md` | 設計決定2で `GET /game/questions` が `GameQuestionSet` に正解情報を保存し、`POST /game/sessions` でサーバー側判定する方針になっている | DB保存用データと公開レスポンスを明確に分ける |
| `docs/plans/game-api-tests/plan.md` | `GET /game/questions` の検証観点として、mode validation、正解情報非公開、苦手不足409、ランダム10問・4択生成が挙げられている | 既存テストと重複しない境界テストを追加する |
| `backend/src/services/game.service.ts` | `toQuestionSetJson()` は `elementId` / `correctChoiceId` をDB保存し、`toPublicQuestion()` は公開用に削る設計になっている | サービス層の責務は維持し、追加修正は最小化する |
| `backend/src/routes/game/index.ts` | ルート層は service 結果を `questions: questionSet.questions` としてそのまま返していた | HTTP境界で許可フィールドだけに再整形する |
| 既存テスト | 10問4択、DB保存JSON、苦手5件未満エラー、苦手5件時の循環利用は既に概ね検証済み | 既存テストと重複する大量追加は避ける |

## なぜこの実装なのか

### 1. ルート層でも公開フィールドを固定する理由

サービス層にはすでに `toPublicQuestion()` があり、通常の実装経路では正解情報を削った問題だけが返ります。ただし、APIとして最終的に外へ出るのはルート層です。

今回の Red テストでは、サービスが誤って `correctChoiceId` / `elementId` を含む `questions` を返した場合、従来のルート実装ではそのままクライアントへ返してしまうことを確認しました。これは「サービス層を信用しない」という意味ではなく、HTTP境界で公開契約をもう一度固定するための防御です。

この実装により、将来 `CreateGameQuestionSetResult` の内部表現が広がっても、`GET /game/questions` の公開レスポンスは次の形に保たれます。

```json
{
  "questionId": "q1",
  "prompt": "H",
  "choices": [
    { "choiceId": "1", "text": "水素" }
  ]
}
```

### 2. サービス層の大きな設計変更を避けた理由

`game.service.ts` では、DB保存用の `StoredGameQuestion` と公開用の `PublicGameQuestion` がすでに分かれています。ここを大きく作り替えると、`POST /game/sessions` の正誤判定、`GameQuestionSet` の保存形式、既存テストの広い範囲に影響します。

今回の目的は `GET /game/questions` のテスト補強であり、仕様不一致が見つかった箇所も「ルートレスポンス境界」でした。そのため、本番コードの変更は `backend/src/routes/game/index.ts` の公開レスポンス整形に限定しています。

### 3. サービステストで Lv1/Lv2 候補範囲を追加した理由

既存テストでは10問生成、4択生成、正解位置のランダム化、苦手5件未満エラーは確認されていました。一方で、通常モードの難易度境界である「Lv1 は原子番号1〜20」「Lv2 は21〜118」を直接固定するテストが薄かったため追加しました。

このテストはランダム結果そのものではなく、ランダム抽選前の母集団を検証します。ゲーム難易度の仕様を守るには、生成結果より先に候補集合が正しいことが重要なためです。

### 4. API仕様書を更新しなかった理由

今回の変更は、既存仕様どおりにレスポンスを固定するものです。ステータスコード、エラーメッセージ、リクエスト形式、レスポンス形式は変えていません。そのため `docs/04_api.md` は更新不要と判断しました。

## 実装内容

| 種別 | 内容 |
|---|---|
| ルート修正 | `GET /game/questions` のレスポンスで `questionId`, `prompt`, `choices[].choiceId`, `choices[].text` のみを返すよう整形 |
| ルートテスト | mode 未指定時の400 details、正解情報非公開の回帰テストを追加 |
| サービス修正 | 通常モードの候補元素範囲を Lv1 は1〜20、Lv2 は21〜118の両端で明示 |
| サービステスト | Lv1 は原子番号1〜20、Lv2 は21〜118を候補にすることを追加検証 |
| A11Y改善 | ゲームプレイ画面のAPIエラー・不正モード・送信失敗表示に `role="alert"` を追加 |
| ドキュメント | `docs/05_progress.md` と `docs/plans/game-api-tests/plan.md` に部分完了を記録 |

## TDD 実施記録

| フェーズ | 実施内容 | 結果 |
|---|---|---|
| Red | `GET /game/questions` のレスポンスに正解情報が含まれないことを検証 | 1件失敗。`correctChoiceId` / `elementId` がレスポンスへ残ることを確認 |
| Green | ルートで公開フィールドだけに整形 | 対象テスト48件通過 |
| Refactor | backend Prettier 実行 | 変更なし |

## テストケース

| 対象 | ケース | 期待結果 |
|---|---|---|
| route | mode 未指定 | 400、`details[0].message` は `ゲームモードが正しくありません` |
| route | 正解情報を含む service 結果 | 200、レスポンスから `correctChoiceId` / `elementId` を除外 |
| route | 苦手元素が不足 | 409、`苦手モードを始めるには、苦手元素が5件以上必要です` |
| route | 想定外エラー | 500、`サーバーエラーが発生しました` |
| service | Lv1通常モード | `prisma.element.findMany` が `1 <= id <= 20` で呼ばれる |
| service | Lv2通常モード | `prisma.element.findMany` が `21 <= id <= 118` で呼ばれる |

## セキュリティ・仕様面の確認

| 観点 | 確認結果 |
|---|---|
| 正解情報の非公開 | HTTPレスポンスでは `correctChoiceId` / `elementId` を除外 |
| サーバー側判定 | `GameQuestionSet` に保存した正解情報を `POST /game/sessions` で使う既存設計を維持 |
| 入力検証 | `mode` は既存の zod schema で検証し、未指定・不正値は400 |
| エラーメッセージ | 既存どおり日本語レスポンスを維持 |
| DBアクセス | 追加のDBアクセス・生SQLなし |
| レート制限 | 既存の `gameQuestionsRateLimit` を維持 |
| A11Y | ゲームプレイ画面のエラー状態を `role="alert"` で通知 |

## 品質チェック

| コマンド | 結果 |
|---|---|
| `cd backend && npm run format` | 成功 |
| `cd backend && npm run lint` | 成功 |
| `cd backend && npm run format:check` | 成功 |
| `cd backend && npm run test -- --run src/routes/game/questions.test.ts src/services/game.service.test.ts` | 成功（48 tests） |
| `cd backend && npm run test -- --run` | 成功（231 tests） |
| `cd frontend && npm run lint` | 成功 |
| `cd frontend && npm run test:run` | 成功（221 tests） |
| `cd frontend && npm run check` | 成功（0 errors / 0 warnings） |

## 影響範囲

- `GET /game/questions` のレスポンス形状は既存API仕様どおりです。
- クライアントが受け取るデータは、これまで期待されていた公開フィールドに限定されます。
- DB schema / migration は変更していません。
- UIの見た目・導線は変更していません。エラー状態のA11Y属性のみ追加しています。
- `POST /game/sessions`、履歴一覧、結果詳細の実装は変更していません。

## 補足

- DB schema / migration は未変更のため、`prisma migrate deploy` と Playwright 確認は対象外です。
- API 仕様・ステータスコード・エラーメッセージに変更はないため、`docs/04_api.md` は更新していません。
- `.svelte-kit` は再生成し、`nobody:nogroup` 所有の古い生成物は削除済みです。
- `docs/plans/game-api-tests/plan.md` 全体のうち、今回完了したのは `GET /game/questions` 周辺です。`POST /game/sessions`、履歴、詳細、frontend API クライアントのテスト補強は未完了です。
