# PR: GET /game/questions のテスト補強と公開レスポンス固定

## 概要

`GET /game/questions` について、ランダム10問・4択生成・GameQuestionSet保存・苦手5件未満チェックの既存仕様をテストで補強しました。

追加テストの Red フェーズで、サービスが余分な `correctChoiceId` / `elementId` を含む問題データを返した場合に、ルートレスポンスへそのまま漏れることを検出しました。Green フェーズでは、HTTPレスポンス直前で `questionId`, `prompt`, `choices[].choiceId`, `choices[].text` のみへ整形することで、公開レスポンスの契約を固定しています。

## 実装内容

| 種別 | 内容 |
|---|---|
| ルート修正 | `GET /game/questions` のレスポンスで公開フィールドだけを返す整形処理を追加 |
| ルートテスト | mode 未指定時の400 details、正解情報非公開の回帰テストを追加 |
| サービステスト | Lv1 は原子番号1〜20、Lv2 は21〜118を候補にすることを追加検証 |
| ドキュメント | `docs/05_progress.md` と `docs/plans/game-api-tests/plan.md` に部分完了を記録 |

## TDD 実施記録

| フェーズ | 実施内容 | 結果 |
|---|---|---|
| Red | `GET /game/questions` のレスポンスに正解情報が含まれないことを検証 | 1件失敗。`correctChoiceId` / `elementId` が残ることを確認 |
| Green | ルートで公開フィールドだけに整形 | 対象テスト48件通過 |
| Refactor | backend Prettier 実行 | 変更なし |

## テストケース

| 対象 | ケース | 期待結果 |
|---|---|---|
| route | mode 未指定 | 400、`details[0].message` は `ゲームモードが正しくありません` |
| route | 正解情報を含む service 結果 | 200、レスポンスから `correctChoiceId` / `elementId` を除外 |
| service | Lv1通常モード | `prisma.element.findMany` が `id <= 20` で呼ばれる |
| service | Lv2通常モード | `prisma.element.findMany` が `id >= 21` で呼ばれる |

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

## 補足

- DB schema / migration は未変更のため、`prisma migrate deploy` と Playwright 確認は対象外です。
- API 仕様・ステータスコード・エラーメッセージに変更はないため、`docs/04_api.md` は更新していません。
- `.svelte-kit` は再生成し、`nobody:nogroup` 所有の古い生成物は ignored 配下へ退避しました。
- `docs/plans/game-api-tests/plan.md` 全体のうち、今回完了したのは `GET /game/questions` 周辺です。`POST /game/sessions`、履歴、詳細、frontend API クライアントのテスト補強は未完了です。
