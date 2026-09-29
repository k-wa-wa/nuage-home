import type { FloorStateName } from "@nuage-home/shared"
import { TUNING } from "../constants.ts"

/**
 * 発言権（Floor）管理。
 * 通知を「いつ話してよいか」を判断するための純粋な状態機械である。
 * 設計: docs/design/voice-task-orchestration.md 4 章
 */

export type FloorState = FloorStateName

export type FloorEvent =
  /** frontend VAD（サンドボックスでは入力開始）がユーザー発話を検出した */
  | { type: "user_speech_start" }
  /** ノイズとして発話が取り消された */
  | { type: "user_speech_cancel" }
  /** ユーザー発話を Live へ送信した */
  | { type: "user_turn_sent" }
  /** Live に発話を促す入力（toolResponse・読み上げ通知）を送った */
  | { type: "model_prompted" }
  /** Live のターンが終わった（生成完了であり、再生完了ではない） */
  | { type: "model_turn_complete" }
  /** frontend の再生状態が変わった */
  | { type: "playback"; playing: boolean }

export interface Floor {
  state: FloorState
  /** 最後にいずれかのイベントを受けた時刻（ms） */
  lastActivityAt: number
  /**
   * Live に応答を促したが、まだ turnComplete を迎えていないターンの数。
   * ツール呼び出しでは「無言のターンの完了」と「相槌のターン」が続けて来るため、真偽値ではなく数で持つ。
   */
  pendingTurns: number
  /** frontend が音声（または擬似読み上げ）を再生中か */
  playing: boolean
}

export interface FloorTiming {
  /** idle になってから通知を話してよくなるまでの猶予 */
  graceMs: number
  /** urgent 通知の猶予 */
  urgentGraceMs: number
  /** 最後の活動からこの時間内なら「会話中」とみなす */
  conversationWindowMs: number
  /** Live の応答がこの時間来なければ、待ち状態を解除してよい */
  awaitingTimeoutMs: number
}

export const DEFAULT_FLOOR_TIMING: FloorTiming = TUNING.floor

export function initialFloor(now: number): Floor {
  return { state: "idle", lastActivityAt: now, pendingTurns: 0, playing: false }
}

/**
 * イベントを適用した次の Floor を返す。
 * Live の応答が 1 ターン遅れて届く場合があるため、想定外の順序でも状態が壊れないようにする。
 */
export function reduceFloor(floor: Floor, event: FloorEvent, now: number): Floor {
  const next: Floor = { ...floor, lastActivityAt: now }

  switch (event.type) {
    case "user_speech_start":
      next.state = "user_speaking"
      return next

    case "user_speech_cancel":
      if (floor.state === "user_speaking") next.state = settle(next)
      return next

    case "user_turn_sent":
      next.state = "awaiting_model"
      next.pendingTurns = floor.pendingTurns + 1
      return next

    case "model_prompted":
      next.pendingTurns = floor.pendingTurns + 1
      if (floor.state !== "user_speaking") next.state = settle(next)
      return next

    case "model_turn_complete":
      next.pendingTurns = Math.max(0, floor.pendingTurns - 1)
      if (floor.state !== "user_speaking") next.state = settle(next)
      return next

    case "playback":
      next.playing = event.playing
      if (floor.state !== "user_speaking") next.state = settle(next)
      return next
  }
}

/** ユーザーが話していないときの状態を、再生状態とターンの完了から決める */
function settle(floor: Floor): FloorState {
  if (floor.playing) return "model_speaking"
  if (floor.pendingTurns > 0) return "awaiting_model"
  return "idle"
}

/** 通知を読み上げてよいか */
export function canSpeak(floor: Floor, now: number, graceMs: number, timing: FloorTiming = DEFAULT_FLOOR_TIMING): boolean {
  if (floor.state === "idle") return now - floor.lastActivityAt >= graceMs
  // Live が応答しないまま固まった場合に通知が永久に止まらないようにする
  if (floor.state === "awaiting_model" && !floor.playing) return now - floor.lastActivityAt >= timing.awaitingTimeoutMs
  return false
}

/** 会話が続いているか（相乗り通知を使うかの判断に使う） */
export function isConversationActive(floor: Floor, now: number, timing: FloorTiming = DEFAULT_FLOOR_TIMING): boolean {
  if (floor.state !== "idle") return true
  return now - floor.lastActivityAt < timing.conversationWindowMs
}
