# Node.js セキュリティ更新（2026-10-23）

Node公式の2026-10-21セキュリティリリースに対応する。
正本はルートの `.node-version`（22.23.4）。GitHub Actionsの全setup-nodeが参照する。
Dockerは同版のalpine imageをYAML anchorで共有し、契約テストで正本との一致を確認する。
次回更新では正本とDocker imageを変更して全品質チェックを実施する。

## 確認・更新記録

- WSL Volta default: 24.12.0 → 22.23.4。プロジェクトの22系指定と統一。
- Docker hono / sveltekit: 22.22.2 → 22.23.4。DB・依存ボリュームを保持してアプリ2サービスだけ再作成。
- CI: major指定を共通version fileに変更。将来のversion file変更でもbackend/frontend品質gateを起動する。
- Vercel: repositoryはengines 22.x、adapterはnodejs22.x。公式告知は22/24系の設定変更不要、管理runtimeへ修正を展開中としている。個別production Functionの実パッチ版は未取得であり、適用完了とは断定しない。
- Cloudflare Workers: workerd上のNode互換APIで、Nodeバイナリを配備する構成ではない。今回Node用パッチの適用状況を同一視しない。build/testで使うNodeは修正版へ統一。

## 再現手順

WSL: `volta install node@$(cat .node-version)`、`node --version`。
Docker: `docker compose pull hono sveltekit`、`docker compose up -d --no-deps hono sveltekit`。
各サービスで `docker compose exec -T <service> node --version` を確認する。
CI変更はPRのマージ後に有効。古いSHAのworkflowは旧設定を使う。

## 検証結果

- 初回PR CIでfrontend npm auditが13件（High5、Moderate5、Low3）を検出。互換範囲のlock更新とVitest/UI 4.1.12への同期でHigh/Moderateを解消。cookie→SvelteKit由来のLow3件は残り、メジャー移行は行わない。
- npm 10.9.9のaudit fix/updateはedgesOut内部エラーで失敗。変更がないことを確認後、npm 11.6.2で依存解決した。生成lockはCIと同じnpm 10.9.9のnpm ciで再検証した。
- 依存更新後もfrontend716件・型・lint・format・build:preview成功、npm audit --audit-level=moderate成功。

- Node 22.23.4上でbackend 1371件、Workers 32件、frontend 716件成功。外部DB統合テスト10件は通常設定によりskip。
- backend build/lint/format、frontend check/lint/format/build:preview成功。
- 再作成したDockerのhono/sveltekit両方で22.23.4を確認し、localhost:3000/api/v1/elements/1とlocalhost:5174はHTTP 200。
- 新規契約テストはversion file欠如・旧CI設定でRedを確認し、変更後Green。

## 参考資料

- https://nodejs.org/en/blog/release/v22.23.4
- https://vercel.com/kb/bulletin/node-js-security-advisory
- https://developers.cloudflare.com/workers/runtime-apis/nodejs/
