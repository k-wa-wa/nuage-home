export type { LiveServerToClientMessage, AgentEvent } from "@nuage-home/shared"

export interface GeminiFunctionDeclaration {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface GeminiToolCall {
  functionCalls: {
    id: string
    name: string
    args: Record<string, any>
  }[]
}

export interface GeminiServerContent {
  modelTurn?: {
    parts: {
      text?: string
      inlineData?: {
        mimeType: string
        data: string // base64 24kHz PCM
      }
    }[]
  }
  inputTranscription?: {
    text: string
  }
  outputTranscription?: {
    text: string
  }
  interrupted?: boolean
  turnComplete?: boolean
}

export interface GeminiLiveServerMessage {
  setupComplete?: Record<string, unknown>
  serverContent?: GeminiServerContent
  toolCall?: GeminiToolCall
  toolCallCancellation?: {
    ids: string[]
  }
  goAway?: {
    timeLeft?: string
  }
}
