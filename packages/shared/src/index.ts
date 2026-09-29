export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export type ClientMessage = {
  type: "user_text"
  text: string
}

export type ServerMessage =
  | { type: "assistant_text"; text: string }
  | { type: "error"; message: string }

/**
 * 自律エージェントの内部進捗イベント
 */
export type AgentEvent =
  | { type: "step_start"; step: number; maxSteps: number }
  | { type: "tool_start"; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; tool: string; output: string }
  | { type: "summarizing" }
  | { type: "complete"; reportLength: number }

/**
 * Gemini Live WebSocket (/ws/live) でサーバーからクライアントへ送信するメッセージ
 */
export type LiveServerToClientMessage =
  | { type: "ready" }
  | { type: "audio"; data: string }
  | { type: "transcript"; text: string }
  | { type: "user_transcript"; text: string }
  | {
      type: "tool_start"
      tools: string[]
      toolCalls?: { name: string; args: Record<string, unknown> }[]
    }
  | { type: "tool_result"; tool: string; output: string }
  | { type: "agent_event"; event: AgentEvent }
  | { type: "interrupted" }
  | { type: "turn_complete" }
  | { type: "error"; message: string }
  | { type: "closed"; code: number; reason: string }
