/**
 * backend と frontend の間の型。
 * 会話は音声モード（/ws/live）とサンドボックス（/ws/sandbox）で同じメッセージを使う。
 * 設計: docs/design/voice-task-orchestration.md
 */

// ---------------------------------------------------------------------------
// タスクと通知
// ---------------------------------------------------------------------------

export type TaskStatus = "accepted" | "running" | "succeeded" | "failed" | "cancelled";

export interface Task {
  id: string;
  /** 仕事を引き受けた専門エージェントの名前 */
  app: string;
  instruction: string;
  origin: "voice" | "ui";
  status: TaskStatus;
  createdAt: number;
  finishedAt?: number;
  /** 音声向けの要約（ID・略語を含めない） */
  summary?: string;
  /** 画面表示用の全文 */
  detail?: string;
}

export type NotificationPriority = "urgent" | "normal" | "low";

export type NotificationState =
  | "queued"
  | "piggybacked"
  | "speaking"
  | "delivered"
  | "interrupted"
  | "screen_only";

export interface Notification {
  id: string;
  taskId?: string;
  priority: NotificationPriority;
  summary: string;
  detail?: string;
  createdAt: number;
  state: NotificationState;
}

export type FloorStateName = "idle" | "user_speaking" | "awaiting_model" | "model_speaking";

// ---------------------------------------------------------------------------
// 会話の構成
// ---------------------------------------------------------------------------

/**
 * 会話で使う部品。音声モードは本物で固定、サンドボックスは接続時のクエリで選ぶ。
 * ツール（専門エージェント・即答ツール）はサンドボックスではモック固定とする。
 */
export interface ConversationModes {
  live: "mock" | "gemini";
  llm: "mock" | "real";
  tool: "mock" | "real";
}

// ---------------------------------------------------------------------------
// WebSocket メッセージ
// ---------------------------------------------------------------------------

export type ConversationClientMessage =
  /** 発話を始めた（音声モードは VAD、サンドボックスは入力開始） */
  | { type: "speech_start" }
  /** 発話を取り消した（ノイズ） */
  | { type: "speech_cancel" }
  /** 発話中の音声（16kHz PCM の base64）。user_audio_end までまとめてから 1 ターンとして送る */
  | { type: "user_audio"; data: string }
  /** 音声の発話が終わった */
  | { type: "user_audio_end" }
  /** テキストの発話（サンドボックス） */
  | { type: "user_turn"; text: string }
  /** Live の発話の再生状態（音声モードは実際の再生、サンドボックスは擬似読み上げ） */
  | { type: "playback_state"; playing: boolean }
  /** 裏で動くアプリを経由しない通知を手動で発生させる（動作確認用） */
  | { type: "debug_notify"; priority: NotificationPriority; summary: string }
  /** タスクと通知をすべて消す（実行中のタスクは中止する） */
  | { type: "reset" };

/** Live に実際に送った内容。画面で「裏側」を見せるために使う */
export type LiveIoRecord =
  | { kind: "user_turn"; text: string }
  | { kind: "context"; text: string }
  | { kind: "prompt"; text: string }
  | { kind: "tool_call"; name: string; args: Record<string, unknown> }
  | { kind: "tool_response"; name: string; response: unknown };

export type ConversationServerMessage =
  | { type: "ready"; modes: ConversationModes }
  /** Live の音声（24kHz PCM の base64） */
  | { type: "model_audio"; data: string }
  /** Live の発話の書き起こし（断片） */
  | { type: "model_text"; text: string }
  /** Live が聞き取ったユーザーの発話 */
  | { type: "user_transcript"; text: string }
  | { type: "model_turn_complete" }
  /** Live の発話が遮られた。再生を止める */
  | { type: "interrupted" }
  | { type: "floor"; state: FloorStateName }
  | { type: "task_update"; task: Task }
  | { type: "notification_update"; notification: Notification }
  | { type: "live_io"; record: LiveIoRecord; at: number }
  | { type: "reset_done" }
  | { type: "error"; message: string };
