/**
 * Live（会話層）との接続口。
 * 実 Gemini Live とモックを同じ形で差し替えるための抽象である。
 */

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LiveSetup {
  systemInstruction: string;
  tools: FunctionDeclaration[];
}

export interface LiveToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LiveToolResponse {
  id: string;
  name: string;
  response: Record<string, unknown>;
}

/** ユーザーの 1 発話。音声モードは音声（16kHz PCM）、サンドボックスはテキスト */
export type UserTurn = { text: string } | { audio: Buffer };

export type LiveEvent =
  /** Live の発話の書き起こし（断片） */
  | { type: "text"; text: string }
  /** Live の音声（base64 24kHz PCM） */
  | { type: "audio"; data: string }
  /** Live が聞き取ったユーザーの発話 */
  | { type: "user_text"; text: string }
  | { type: "turn_complete" }
  | { type: "interrupted" }
  | { type: "tool_call"; calls: LiveToolCall[] }
  | { type: "error"; message: string };

export interface LivePort {
  start(setup: LiveSetup): Promise<void>;
  /** ユーザーの発話を 1 ターンとして送る */
  sendUserTurn(turn: UserTurn): void;
  /** 応答させずに文脈を足す（turnComplete=false） */
  sendContext(text: string): void;
  /** 応答を促す入力を送る（turnComplete=true）。通知の読み上げに使う */
  sendPrompt(text: string): void;
  sendToolResponses(responses: LiveToolResponse[]): void;
  onEvent(listener: (event: LiveEvent) => void): void;
  close(): void;
}
