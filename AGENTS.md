# エージェント開発・検証ガイドライン

すべてのエージェントは、以下のルールと検証手順を守ること。

---

## 1. 検証・品質チェック手順（MUST）

コード変更やテスト追加を行った後は、以下を実行して成功を確認すること。

```bash
npm run check                          # typecheck, lint, test
npm run build -w @nuage-home/frontend  # frontend を変更したとき
```

会話の挙動（発言権・タスク・通知）を変えたときは、サンドボックス（`http://localhost:5173/sandbox.html`）で [docs/sandbox-scenarios.md](./docs/sandbox-scenarios.md) の該当シナリオを確認すること。

---

## 2. 操作・開発ルール

- **Git 操作の禁止**: ユーザーからの特別な指示がない限り、コミット・プッシュ・ブランチ作成などの Git 操作（`git` コマンド）は実行しないこと。
- **設計の遵守**: 会話・タスク・通知に関わる変更は、[docs/design/voice-task-orchestration.md](./docs/design/voice-task-orchestration.md) の原則（ユーザーの発話を遮らない、声は要約・画面は詳細、など）から外れていないか確認すること。
- **設定値に既定値を書かない**: 環境で変わる値は環境変数から読み、無ければ起動時にエラーにする（`packages/backend/src/config.ts`・`packages/frontend/src/config.ts`）。環境で変える必要のない調整値は `packages/backend/src/constants.ts` にハードコードする。
- **モックの置き場所**: モック実装は各層の `mock.ts` に置く（`live/mock.ts`、`agents/mock.ts`）。本番経路（`/ws/live`）はモックを使わない。サンドボックスのツール（専門エージェント）はモック固定とする。

---

## 3. 構成

| パス | 内容 |
| :-- | :-- |
| `packages/shared` | backend と frontend の間の型（会話の WebSocket メッセージ、タスク、通知） |
| `packages/backend` | 会話の統制（Gemini Live・タスク・通知）。構成は設計ドキュメント 12 章 |
| `packages/frontend` | 音声モード（`index.html`）とサンドボックス（`sandbox.html`） |
| `docs/design/` | 設計ドキュメント |
| `docs/sandbox-scenarios.md` | サンドボックスで体験・確認するシナリオ |
