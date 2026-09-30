# 音声会話とタスク・通知の統制設計

nuage-home の backend が、裏で動くタスク（アプリの専門エージェントへの依頼・自律調査）を一元管理し、完了した結果を **ユーザーの会話を遮らずに** Gemini Live へ届けるための設計である。

- ステータス: Draft（2026-09-29）
- 対象: `packages/backend`（主）、`packages/frontend`・`packages/shared`（プロトコル追加）

---

## 1. 目的と非目的

### 目的

1. 自然な会話を最優先する。**ユーザーの発話を通知で遮らない。** 会話の最中に割り込まない。
2. Live のコンテキストを小さく保つ。重い仕事は裏に委ね、Live には短い要約だけを渡す。
3. タスクは Live セッションより長生きする。セッションの再接続（15 分制限・GoAway）を跨いでも結果を取りこぼさない。
4. 人間の UI 操作と AI の操作を同じタスク管理に載せる。

### 非目的

- アプリ固有の処理（autopilot の Issue 操作など）の実装。これは各アプリの専門エージェントが持つ。
- 複数ユーザー・複数端末対応。当面は 1 ユーザー・1 端末を前提とする。

---

## 2. 前提となる検証結果（gemini-3.8-live）

2026-09-29 に LiteLLM 経由で計測した（テキスト入力、各 1 回）。設計はこの挙動を前提とし、Live 側の機能に依存しない。

| 項目 | 挙動 | 設計上の帰結 |
| :-- | :-- | :-- |
| `behavior: NON_BLOCKING` / `scheduling` | 指定の有無・種類で差が出ない。SILENT でも読み上げる | 配送タイミングは backend が自前で制御する |
| ツール呼び出し前の相槌 | 指示しても発話しない（無言ターン） | 即時 ack の toolResponse で相槌を引き出す |
| 即時 ack の toolResponse | 0.6〜1.1 秒後に「承知しました、お調べします」と発話 | ack 方式を標準とする |
| `clientContent` 差し込み（Live が無発話時） | 約 0.6 秒で読み上げ開始 | 通知の主経路とする |
| `clientContent` 差し込み（Live が発話中） | 現在の発話を遮る（`interrupted`） | 発話中は差し込まない |
| `turnComplete=false` の差し込み | 発話せず、後で尋ねれば回答に使う | 文脈のみの通知・画面状態の共有に使う |
| 軽い推論（計算） | 約 1.1 秒で正答 | 軽い思考は Live に残す |
| Extended Thinking モデル | 相槌のみで回答が来ない | 採用しない |
| ツール 40 本 | プロンプト 2.6k トークン、遅延悪化なし | アプリごとに入口ツールを置いてよい |
| 並列 6 セッション | quota エラー（1011） | Live セッションは 1 本に絞る |

---

## 3. 責務分担

| 層 | 持つもの | 持たないもの |
| :-- | :-- | :-- |
| Live（会話層） | 相槌・応答、軽い推論、指示語（「これ」「さっきの」）の解決、委任先の判断 | 複数手順の操作、結果全文の保持 |
| backend（統制層） | 発言権（Floor）管理、タスク管理、通知キューと配送、要約、Live セッション管理 | アプリ固有処理 |
| frontend（画面層） | UI コマンド実行、アプリ埋め込み、再生状態・画面状態の送信、結果全文の表示、ack までの効果音 | 判断 |
| 専門エージェント | 領域固有の重い仕事（autopilot chat 等） | 会話管理 |

原則: **声は要約、画面は詳細。** Live に渡すのは 1〜2 文の要約と参照 ID のみとし、全文は画面に出す。

---

## 4. 発言権（Floor）管理

通知を「いつ話してよいか」を決める状態機械である。backend がセッションごとに 1 つ保持する。

### 4.1 状態

| 状態 | 意味 |
| :-- | :-- |
| `IDLE` | 誰も話しておらず、応答待ちもない |
| `USER_SPEAKING` | ユーザーが発話中（frontend の VAD が検出） |
| `AWAITING_MODEL` | ユーザー発話（または差し込み）を送信し、Live の応答を待っている |
| `MODEL_SPEAKING` | Live の音声を再生中（**frontend の再生状態**で判定する） |

### 4.2 入力イベントと遷移

| イベント | 発生源 | 遷移 |
| :-- | :-- | :-- |
| `speech_start` | frontend VAD | 任意 → `USER_SPEAKING` |
| `speech_cancel` | frontend VAD | `USER_SPEAKING` → `IDLE` |
| `turn_complete`（ユーザー） | frontend VAD | `USER_SPEAKING` → `AWAITING_MODEL` |
| `toolCall` 受信 | Gemini | `AWAITING_MODEL` のまま（ack 送信後も応答待ち） |
| `playback_state {playing: true}` | frontend 再生器 | → `MODEL_SPEAKING` |
| `playback_state {playing: false}` かつ Gemini `turnComplete` 受信済み | frontend + Gemini | `MODEL_SPEAKING` → `IDLE` |
| Gemini `turnComplete`（音声なしのターン） | Gemini | `AWAITING_MODEL` → `IDLE` |
| 通知の差し込み送信 | backend | `IDLE` → `AWAITING_MODEL` |

Gemini の `turnComplete` は生成完了であり再生完了ではない。`MODEL_SPEAKING` の終了判定には必ず frontend の `playback_state` を使う。

### 4.3 「話してよい」条件

通知の読み上げは次のすべてを満たすときだけ行う。

1. 状態が `IDLE` である。
2. 最後の活動（いずれかの状態遷移）から **猶予時間 `grace`** が経過している。既定 2.5 秒とする。Live が話し終えた直後にユーザーが返答する余地を残すためである。
3. 配送中の通知が他にない。

### 4.4 衝突時の扱い

- 通知の読み上げ中にユーザーが話し始めた場合、既存の barge-in（`player.interrupt()`）で再生を止める。その通知は `interrupted` とし、**音声では再送しない**。画面の未読として残す。
- 差し込みを送信した直後、読み上げが始まる前に `speech_start` が来た場合も同様である。Gemini 側の生成は止められないが、再生は frontend が止める。

---

## 5. タスク管理

### 5.1 モデル

```ts
interface Task {
  id: string                 // "t-<短い連番>"。音声で言及しやすい形にする
  kind: "app_agent" | "run_agent"
  app?: string               // "autopilot" など
  instruction: string
  origin: "voice" | "ui"     // AI 経由か人の直接操作か
  status: "accepted" | "running" | "succeeded" | "failed" | "cancelled"
  createdAt: string
  finishedAt?: string
  result?: { summary: string; detailRef?: string }  // detailRef は画面で全文を開くための参照
  externalRef?: { conversationId?: string }         // autopilot chat の conversation_id など
}
```

### 5.2 ライフサイクル

1. Live が `add_task` を呼ぶ。
2. backend が Task を `accepted` で登録し、**即座に** toolResponse `{status: "accepted", message: "受け付けた。結果は終わりしだい伝える。"}` を返す。これにより Live が相槌を発話する。
3. 実行を開始して `running` にする。
4. 完了したら結果を要約し（6.4）、`succeeded` / `failed` として通知を生成する。

### 5.3 保持範囲

- TaskManager は **WebSocket 接続・Live セッションから独立** させ、backend プロセスに 1 つ置く。現在の `/ws/live` は接続ごとにレジストリを作っているので、これを分離する。
- 当面はメモリ保持とする。backend 再起動を跨ぐ永続化は後回しとする。

### 5.4 Live に渡すタスク系ツール

| ツール | 用途 |
| :-- | :-- |
| `add_task` | 時間のかかる作業や調査を依頼してタスクを開始する。結果は後で通知として届く |
| `task_status` | 「さっきのどうなった？」への回答用。進行中・直近完了タスクの一覧（要約のみ）を返す |
| `cancel_task` | 「さっきのやめて」。対象省略時は直近のタスクを対象とする |

---

## 6. 通知

### 6.1 モデル

```ts
interface Notification {
  id: string
  taskId?: string
  priority: "urgent" | "normal" | "low"
  delivery: "speak" | "context_only" | "screen_only"
  summary: string            // 1〜2 文
  createdAt: string
  state: "queued" | "delivering" | "delivered" | "interrupted" | "dropped"
}
```

### 6.2 配送方式

| 方式 | 手段 | 使いどころ |
| :-- | :-- | :-- |
| 読み上げ（speak） | Floor が話してよい状態になったら `clientContent` を `turnComplete=true` で送る。本文は `[通知] ...` の形式 | 既定 |
| 相乗り（piggyback） | 会話が続いている間は、**ユーザーの次の発話の直前**に `turnComplete=false` で差し込み、「回答の後に一言触れる」よう指示する | 会話中（最後の活動から 10 秒未満）に届いた `normal` 通知 |
| 文脈のみ（context_only） | `turnComplete=false` で差し込み、発話させない | `low`。尋ねられたら答えられればよいもの |
| 画面のみ（screen_only） | Live には送らず、frontend に表示する | 読み上げが中断された通知、ユーザー不在時 |

相乗りを置く理由は、往復の会話中に猶予時間が空くのを待つと、話題の切れ目に突然報告が挟まり不自然になるためである。話題の流れに乗せて伝える。

相乗りの実装は次のとおりとする（11 章の検証に基づく）。

- ルールは system instruction に常駐させる:「`[相乗り通知]` を受け取ったらその場では話さない。ユーザーの次の発言にまず答え、その後に『ところで』と一言だけ添えて伝える。一度伝えた通知は繰り返さない。」
- 差し込む本文は `[相乗り通知] <要約>` のみとし、指示文を毎回載せない。通知 1 件あたりのコンテキスト消費を抑えるためである。
- 差し込むタイミングは、`turnComplete=false` で配送キューに積まれた時点でよい。ユーザー発話の直前まで遅らせる必要はない（差し込み時点で発話しないことを確認済み）。

### 6.3 優先度とまとめ

- `urgent`（例: 監視アラート）は猶予時間を短縮する（既定 0.8 秒）。ただし **`USER_SPEAKING` 中は待つ**。ユーザー発話を遮らない原則に例外は設けない。
- 配送待ちが複数ある場合は、1 回の差し込みにまとめる（「2 件終わった。1 つ目は…」）。

### 6.4 要約

- 専門エージェントの結果全文を、LiteLLM の `auto` モデルで 1〜2 文に要約してから通知にする。
- 全文は frontend に送って表示し、Live には送らない。
- **音声向けの要約には ID・略語を含めない。** 検証では `t-1` を「tワン」、`PR #123` を「PRナンバー一ニ三」、`e2e` を「EtoE」と読み上げ、聞き取りにくかった。「さっき頼んだ PR の調査」のような自然な指し方にし、ID は画面と `task_status` の戻り値にだけ持たせる。

### 6.5 未配送のまま時間が経った場合

- 一定時間（既定 10 分）配送できなかった `speak` 通知は `screen_only` に落とす。
- 将来、monitoring-pwa の Web Push 経路へ流す余地を残す。

---

## 7. Live セッション管理

- **1 ユーザー 1 セッション**とする。同時接続で quota に当たるためである。複数端末は当面考慮しない。
- `contextWindowCompression`（sliding window）を有効化し、15 分制限を回避する。
- `sessionResumption` のハンドルを保持し、`goAway` 受信時や切断時に再接続する。
- 再接続時は、進行中タスクの一覧と未配送通知を `turnComplete=false` で再注入し、文脈を復元する。

---

## 8. プロトコル追加（`packages/shared`）

### client → server

| type | 内容 |
| :-- | :-- |
| `playback_state` | `{ playing: boolean }`。Floor 判定に使う |
| `ui_context` | `{ app, page, selected }`。差分のみ送る |
| `client_tool_result` | `{ id, output }` |

### server → client

| type | 内容 |
| :-- | :-- |
| `client_tool_call` | `{ id, name, args }` |
| `task_update` | `{ task }`。画面のタスク一覧用 |
| `notification` | `{ notification, detail? }`。画面表示用（全文を含みうる） |

---

## 9. 実装とテストの方針

- Floor 状態機械・通知キューは **副作用のない純粋なモジュール**として実装し、時刻を注入して vitest で検証する。
  - 例: 「`USER_SPEAKING` 中に urgent 通知が来ても配送しない」「`turnComplete` を受けても再生中なら `IDLE` にならない」「会話中の normal 通知は相乗りになる」
- Gemini 接続部分は既存の `GeminiLiveSession` を拡張し、Floor への入力イベントを発行する役割に留める。
- 実装順:
  1. Floor 状態機械 + `playback_state`
  2. TaskManager（接続から分離）+ 即時 ack
  3. 通知キュー（speak / context_only）
  4. 相乗り・要約・セッション再接続

---

## 10. 決定事項と未決事項

| 項目 | 状態 |
| :-- | :-- |
| タスクの永続化 | 後回し。当面はメモリ保持とする |
| `grace`・会話中判定の閾値 | 2.5 秒 / 10 秒で確定 |
| 相乗りの指示文 | B 方式（ルールを system instruction に置く）で確定（11 章） |
| 要約に使うモデル | 要約専用のモデルを `LITELLM_SUMMARY_MODEL` で指定する（`sakura/auto`）。上限 15 秒を超えたら LLM を使わない簡易要約に切り替える（12 章）。サンドボックスでは画面で LLM（モック / LiteLLM）を選ぶ |
| 複数端末 | 当面は考慮しない |

---

## 11. 検証記録: 相乗り通知（2026-09-29）

会話の途中（1 往復後）に `turnComplete=false` で結果を差し込み、ユーザーの次の発話（別の話題）で自然に触れるかを確認した。

- 手順: ユーザー「週末に京都へ行くんだけど、紅葉のおすすめある？」→ 回答 → 通知の差し込み → ユーザー「じゃあ嵐山に行くなら、お昼ご飯はどこがいいかな？」→ ユーザー「ありがとう、助かった。」
- 方式 A: 本文に指示文を含める。方式 B: ルールを system instruction に置き、本文は `[相乗り通知] <結果>` のみにする。
- 入力: テキスト（`clientContent` の text）と音声（macOS `say` の Kyoko で合成した 16kHz PCM を `inlineData` で送る。アプリと同じ経路）

| 方式 | 入力 | 試行 | 差し込み時に発話しない | 質問に答えた後に触れる | 次のターンで繰り返さない |
| :-- | :-- | :-- | :-- | :-- | :-- |
| A | テキスト | 3 | 3/3 | 3/3 | 3/3 |
| B | テキスト | 3 | 3/3 | 3/3 | 3/3 |
| A | 音声 | 5 | 5/5 | 4/5 | 5/5 |
| B | 音声 | 5 | 5/5 | 5/5 | 5/5 |
| 差し込みなし（対照） | テキスト | 1 | - | 触れない（正常） | - |

- A の音声 1 件の失敗は、1 ターン目への回答が 2 ターン目にずれて届いた現象によるもので、原因は特定できていない。Floor 管理は「応答が 1 ターン遅れて届く」場合でも状態が壊れないように作る。
- 発話開始までの時間は多くが 1.0〜1.8 秒で、差し込みによる明確な悪化は見られなかった（対照を含め、3〜4 秒の外れ値が散発した）。
- 実例（方式 B・音声）:「嵐山周辺なら、湯豆腐や京料理のお店が多いのでおすすめです。ところで、依頼されていた調査タスクt-1が完了しました。autopilotのPR#123はe2eテストのタイムアウトで停止しているので、再実行すれば通る見込みです。」

---

## 12. 実装状況と実装で判明した事項（2026-09-29）

### 実装済み

音声モード（`/ws/live`）とサンドボックス（`/ws/sandbox`）は、同じ Orchestrator と同じメッセージ（`packages/shared`）を使う。違いは使う部品だけである。

| 経路 | Live | LLM（要約） | 専門エージェント | 即答ツール |
| :-- | :-- | :-- | :-- | :-- |
| `/ws/live` | Gemini Live（音声） | LiteLLM の要約用モデル（15 秒で簡易要約に切り替え） | 調査エージェント（`add_task`） | なし |
| `/ws/sandbox?live=&llm=&delay=` | モック / Gemini Live（テキスト） | モック / LiteLLM | モック autopilot（固定） | なし |

backend の構成（`packages/backend/src/`）:

| ディレクトリ | 責務 |
| :-- | :-- |
| `main.ts` / `config.ts` / `constants.ts` | 起動と依存の組み立て / 環境変数（必須、既定値なし） / 調整値の正本 |
| `api/` | WebSocket と Orchestrator の中継、ルート（`/ws/live`・`/ws/sandbox`） |
| `conversation/` | Floor（`floor.ts`）、通知キュー（`notification-queue.ts`）、接続を跨ぐ共有状態（`hub.ts`）、統制本体（`orchestrator.ts`）、Live への指示とタスク系ツール宣言（`prompt.ts`） |
| `tasks/` | タスク管理（`task-manager.ts`）、要約（`summarizer.ts`） |
| `live/` | Live の接続口（`port.ts`）、Gemini 実装（`gemini.ts`）、モック（`mock.ts`） |
| `agents/` | 専門エージェント。調査（`research.ts`）、モック autopilot（`mock.ts`） |
| `tools/` | 調査エージェント用ツール（SearXNG 検索・ページ取得） |
| `llm/` | LiteLLM クライアント |

frontend は、音声モード（`main.ts`・`voice/`）とサンドボックス（`sandbox/`）が、タスク・通知の一覧（`ui/board.ts`）と見た目（`ui/theme.css`）を共用する。

未着手: 実 autopilot chat との接続、Live セッションの再接続（`sessionResumption`・`goAway`）。

### 判明した事項

- **Floor は応答待ちの数を数える必要がある**: ツール呼び出しでは「無言のターンの完了」と「相槌のターン」が続けて来る。真偽値で持つと、その間に一瞬 `idle` になる。`pendingTurns` で数える方式にした。
- **`turnComplete` は実時間に近い**: Gemini は音声をほぼ実時間で送り、`turnComplete` はその終わりに来る。長い回答では 10〜20 秒かかる。
- **要約の遅延**: LiteLLM `auto` による要約は 29〜83 秒かかった（`gemini/auto` でも 71 秒）。上限時間を設けて簡易要約に切り替える方式にした。その後、モデル別に計測し（2026-09-29、順次実行）、`sakura/auto` が 5.6〜8.1 秒で質も十分だったため要約専用モデルとした（`auto` 43 秒〜タイムアウト、`gemini/auto` 39〜51 秒）。推論を切る指定（`chat_template_kwargs.enable_thinking=false`）は推論の文章が本文に漏れ、`max_tokens` の制限は推論の途中で切れて本文が空になったため採らない。簡易要約は専門用語（e2e、flaky 等）が残るため、Live が言い換える際に内容がずれることがあった（「再実行で通る見込み」を「修正が必要そう」と伝えた例）。要約の速さと品質は今後の課題である。
- **応答が 1 ターン遅れる現象**: サンドボックス（Gemini）で 1 回、相乗り通知の直後にユーザー発話への応答が 40 秒以上来ず、次の発話で押し出される現象が起きた。同じ順序を直接再現した 3 回と、相乗りの送り方を変えた 10 回（別送・同梱 各 5 回）では再現しなかった。通知は Floor の応答待ちタイムアウト（20 秒）で止まらないが、会話自体が止まる点は未対策である。
- **音声のまとめ送りではユーザー発話の書き起こしが返らない**: 発話の音声を `clientContent` で 1 ターンにまとめて送る方式では、`inputAudioTranscription` を有効にしても Gemini の書き起こし（`inputTranscription`）が届かなかった（2026-09-29、音声モードの通し確認）。画面のユーザー発話はブラウザの音声認識の結果で表示している。
- **調査レポートは Markdown で返る**: 調査エージェントのレポートは見出し・強調付きの Markdown になる。LLM 要約が上限時間を超えて簡易要約になると記号が混ざるため、簡易要約で見出し・強調・箇条書きの記号を落とすようにした。
- **Web 検索は bare-web-proxy 経由の Yahoo! JAPAN にした**: 当初の DuckDuckGo Instant Answer は時事的な話題で空振りした（「最近の量子コンピュータの動向」）。bare-web-proxy（プログラムモード）経由で各検索エンジンを試した結果（2026-09-29）:
  - DuckDuckGo（bwproxy の `q=` の既定）: ボット判定ページが返った。原因は IP ではなく User-Agent である。bwproxy は呼び出し元の User-Agent をヘッドレス Chrome にそのまま使わせるため、curl の User-Agent では弾かれ、iPhone の Safari の User-Agent では結果が取れた（スマホから開くと問題が起きないのはこのため）。bare-web-proxy 側で、プログラムモードでは既定のデスクトップ Chrome の User-Agent を使うよう変更した（ローカル検証で、curl の User-Agent のままでも結果 10 件を取得）
  - Google: 本文が返らない
  - Bing: 結果は取れるがリンクが転送 URL
  - Brave Search: 5 回中 1 回しか成功しない（連続アクセスで 500）
  - Yahoo! JAPAN: 5 回中 5 回成功、約 0.9 秒、外部リンク 15〜17 件
  結果ページの本文は `fetch_page` で読む。サイトによっては 403 / 429 で弾かれる（経済産業省の PDF、富士通）が、エラー文として調査エージェントに返るため、別の結果を読みに行ける。ページ本文は長いため `fetch_page` は調査エージェント専用とし、会話層には渡さない。

---

## 13. 会話層の純化と SearXNG 導入（2026-09-30）

### 課題
1. **Live API での思考・試行錯誤の限界**:
   - Gemini Live は音声対話の低遅延応答に最適化されているため、熟考（Thinking）や、ツール呼び出しが空・エラーになった際のリトライ（ReAct ループ）が回らない。
   - ツールが失敗した際に「別のキーワードで試そう」と粘らず、そのまま諦めて発話してしまう。
2. **Web 検索スクレイピングの脆弱性**:
   - bwproxy 経由での Yahoo! JAPAN HTML スクレイピングは正規表現によるパースに依存しており、構造変更や広告挿入、ボット判定で 0 件ヒット（空振り）になる脆さがあった。

### 決定と設計変更
1. **会話層（Live）の純化**:
   - Live API から即答ツールを排除し、「聞き取り・会話・相槌」「タスク受付（即 ack）」「タスク確認（`task_status`）」「タスク取消（`cancel_task`）」のみに専念させる。
   - 複雑な作業・推論・ツール駆使はすべて Backend の専門エージェント（`research` 等）に委譲する。
2. **SearXNG のセルフホストと JSON API 採用**:
   - 壊れやすい HTML スクレイピングを廃止し、セルフホストした SearXNG の JSON API（`GET /search?q=...&format=json&language=ja`）を利用する `createWebSearchTool` に刷新した。
   - DuckDuckGo / Brave / Wikipedia / Qwant などを集約し、タイトル・URL・スニペットを構造化データとして確実に取得する。
   - URL の本文取得には引き続き `bare-web-proxy`（`fetch_page`）を組み合わせる。
3. **調査エージェント（Backend）の自律化・ReAct 強化**:
   - ツール試行ステップ数（`researchMaxToolSteps`）を 3 から 8 に拡張。
   - 「0 件時のクエリ言い換え・再検索」「エラー時の別リンク閲覧」「複数ソースの比較」を自律的に繰り返すプロンプトに強化した。

---

## 14. 接続設計の最適化とアーキテクチャ・リファクタリング（2026-09-30）

### 課題
1. **Gemini Live セッションの課金・接続時間問題**:
   - 画面を開いた瞬間に `/ws/live` で Gemini Live セッションを開始すると、ユーザーが無音で画面を眺めている間も Gemini Live の接続枠・時間課金が消費され、15分上限やタイムアウト切断のリスクがあった。
   - 一方で、音声オフの間もバックエンドで実行中のタスク状態や通知は画面上でリアルタイムに把握したい。
2. **Live ツールの定義とディスパッチの分断**:
   - `prompt.ts` でツールスキーマを宣言し、`orchestrator.ts` の `handleToolCall` で `if (call.name === ...)` とハードコードして実行していたため、型安全性や保守性に課題があった。
3. **Entrypoint（main.ts）の肥大化**:
   - フロントエンドの `main.ts` にドラッグ座標計算、DOM ログ整形、音声認識配線が混在していた。

### 決定と実装
1. **WebSocket 常時接続と Gemini Live の分離**:
   - 画面を開いた時点で WebSocket を接続し、既存タスク・通知の同期を開始する。
   - オーブ押下時のみ `voice_start` を送信して Gemini Live セッションをオンデマンドに起動（`startLive()`）し、停止時は `voice_stop` で Live セッションのみを安全に閉じる（`stopLive()`）。WebSocket 自体は維持する。
   - これにより、無音時の課金消費・枠消費を防ぎつつ、タスク・通知の常時同期を実現した。
2. **`ConversationTool` による宣言・実装の一体化**:
   - スキーマ宣言と実行ハンドラをまとめた `ConversationTool` 型を新設（`conversation/tools.ts`）。
   - `add_task`、`task_status`、`cancel_task` の宣言と処理を同モジュールに集約し、`Orchestrator` は登録ツールのディスパッチのみを行う構造に純化した。
3. **`TaskManager` のインスタンス再利用と世代管理**:
   - `TaskManager.clear()` を導入し、リセット時にインスタンスを差し替えずに再利用可能にした。
   - リセットを跨いで完了した遅延タスクの通知を抑止するため、世代カウンタ（generation）で整合性を管理する。
4. **フロントエンド UI のモジュール抽出**:
   - モーダルのドラッグ移動ロジックを `ui/draggable.ts` に抽出。
   - 会話ログ・書き起こし行の管理を `ui/chat-log.ts`（`ChatLog` クラス）に抽出。


