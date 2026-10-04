/**
 * 調整値の正本。環境ごとに変える必要のない値は、設定にせずここに置く。
 * 設計の根拠: docs/design/voice-task-orchestration.md
 */
export const TUNING = {
  floor: {
    /** 誰も話さなくなってから、通知を読み上げてよくなるまでの猶予 */
    graceMs: 2500,
    /** urgent 通知の猶予 */
    urgentGraceMs: 800,
    /** 最後の活動からこの時間内なら「会話中」とみなし、通知を相乗りにする */
    conversationWindowMs: 10_000,
    /** Live の応答がこの時間来なければ、待ち状態を解除して通知を配送してよい */
    awaitingTimeoutMs: 20_000,
  },
  /** 音声で配送できなかった通知を画面のみに落とすまでの時間 */
  notificationExpireMs: 10 * 60_000,
  /** 通知キューを評価する間隔 */
  tickIntervalMs: 200,
  /** LLM 要約の上限時間。超えたら LLM を使わない簡易要約に切り替える */
  summaryTimeoutMs: 15_000,
  /** これより短い発話はノイズとして捨てる（16kHz・16bit・モノラルで 0.35 秒） */
  minSpeechBytes: 11_200,
  /** 調査エージェントがツールを呼べる最大回数。自律的に検索・閲覧・再試行できるよう余裕を持たせる */
  researchMaxToolSteps: 8,
  searxng: {
    /** SearXNG 検索のタイムアウト */
    timeoutMs: 10_000,
    /** Web 検索で返す件数 */
    searchResults: 5,
  },
  bwproxy: {
    /** bwproxy のレンダリング上限（30 秒）に通信分を足した値 */
    timeoutMs: 35_000,
    /** Web 検索で返す件数 */
    searchResults: 5,
    /** ページ取得で LLM に渡す本文の最大文字数 */
    pageMaxChars: 6000,
  },
  sandbox: {
    /** サンドボックスコマンド実行のタイムアウト */
    timeoutMs: 30_000,
    /** サンドボックスエージェントがツールを呼べる最大回数 */
    maxToolSteps: 8,
  },
  mock: {
    /** モック Live が応答を返し始めるまでの遅延 */
    liveResponseDelayMs: 600,
    /** モック Live が発話の断片を送る間隔 */
    liveChunkIntervalMs: 80,
  },
} as const;

export const GEMINI_LIVE = {
  /** Gemini Live パススルーのパス */
  wsPath: "/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent",
  voice: "Aoede",
} as const;

export const TIME_ZONE = "Asia/Tokyo";
