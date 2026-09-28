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
