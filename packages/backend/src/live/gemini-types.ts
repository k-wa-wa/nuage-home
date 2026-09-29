/** Gemini Live（BidiGenerateContent）のサーバーメッセージのうち、使う部分の型 */

export interface GeminiToolCall {
  functionCalls: {
    id: string;
    name: string;
    args?: Record<string, unknown>;
  }[];
}

export interface GeminiServerContent {
  modelTurn?: {
    parts: {
      text?: string;
      inlineData?: {
        mimeType: string;
        /** base64 24kHz PCM */
        data: string;
      };
    }[];
  };
  inputTranscription?: { text: string };
  outputTranscription?: { text: string };
  interrupted?: boolean;
  turnComplete?: boolean;
}

export interface GeminiLiveServerMessage {
  setupComplete?: Record<string, unknown>;
  serverContent?: GeminiServerContent;
  toolCall?: GeminiToolCall;
  toolCallCancellation?: { ids: string[] };
  goAway?: { timeLeft?: string };
}
