import WebSocket from "ws"
import type { SkillRegistry } from "../skills/registry.ts"
import type { GeminiLiveServerMessage } from "./types.ts"

const GEMINI_LIVE_WS_URL =
  "wss://litellm.wpcapp.net/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent"
const GEMINI_LIVE_VOICE = "Aoede"
const DEFAULT_GEMINI_LIVE_MODEL = "models/gemini-3.8-live"

export interface GeminiLiveSessionOptions {
  wsUrl?: string
  apiKey?: string
  model?: string
  voiceName?: string
  systemInstruction?: string
  registry: SkillRegistry
}

/**
 * 1つのクライアント接続と Gemini Live API WebSocket を中継・管理するセッション
 */
export class GeminiLiveSession {
  private geminiWs: WebSocket | null = null
  private isSetupComplete = false
  private sendToClient: (data: string) => void
  private options: GeminiLiveSessionOptions

  constructor(
    options: GeminiLiveSessionOptions,
    sendToClient: (data: string) => void,
  ) {
    this.options = options
    this.sendToClient = sendToClient
  }

  /**
   * Gemini Live API へ接続し、初期化を行う
   */
  async start(): Promise<void> {
    const model = this.options.model || DEFAULT_GEMINI_LIVE_MODEL
    const voice = this.options.voiceName || GEMINI_LIVE_VOICE
    let uri = this.options.wsUrl || GEMINI_LIVE_WS_URL
    if (this.options.apiKey) {
      const sep = uri.includes("?") ? "&" : "?"
      uri = `${uri}${sep}key=${encodeURIComponent(this.options.apiKey)}`
    }

    this.geminiWs = new WebSocket(uri)

    this.geminiWs.on("open", () => {
      // 登録済みスキルを Gemini Function Declarations 形式に変換
      const tools = this.options.registry.toOpenAITools().map((t) => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      }))

      const now = new Date()
      const dateStr = now.toLocaleDateString("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "long",
      })
      const timeStr = now.toLocaleTimeString("ja-JP", {
        timeZone: "Asia/Tokyo",
        hour: "2-digit",
        minute: "2-digit",
      })

      const baseInstruction =
        this.options.systemInstruction ||
        "あなたは親しみやすく賢い家庭用AIアシスタントです。簡潔に分かりやすい日本語で話してください。必要に応じてツールを呼び出してください。"
      const systemInstruction = `${baseInstruction}\n現在日時: ${dateStr} ${timeStr}`

      const setupMsg = {
        setup: {
          model,
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: voice,
                },
              },
            },
          },
          systemInstruction: {
            parts: [{ text: systemInstruction }],
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [
            {
              functionDeclarations: tools,
            },
          ],
        },
      }

      console.log(`[GeminiLiveSession] Connected to Gemini Live API. Sending setup for ${model}...`)
      this.geminiWs?.send(JSON.stringify(setupMsg))
    })

    this.geminiWs.on("message", async (raw: WebSocket.Data) => {
      let msg: GeminiLiveServerMessage
      try {
        msg = JSON.parse(raw.toString())
      } catch (err) {
        console.warn("[GeminiLiveSession] Failed to parse JSON message from Gemini Live:", err)
        return
      }

      if (typeof msg !== "object" || msg === null) {
        console.warn("[GeminiLiveSession] Received non-object message from Gemini Live:", msg)
        return
      }

      // 想定外のプロパティ構造の検知と warn ログ出力
      const knownKeys = ["setupComplete", "serverContent", "toolCall", "toolCallCancellation", "goAway"]
      const hasKnownKey = knownKeys.some((k) => k in msg)
      if (!hasKnownKey) {
        console.warn("[GeminiLiveSession] Unexpected message structure from Gemini Live:", msg)
      }

      if (msg.setupComplete) {
        this.isSetupComplete = true
        console.log("[GeminiLiveSession] Setup complete received from Gemini. Ready to stream!")
        this.sendToClient(JSON.stringify({ type: "ready" }))
        return
      }

      // 音声データまたは割り込み情報の転送
      if (msg.serverContent) {
        if (msg.serverContent.inputTranscription?.text) {
          console.log(`[GeminiLiveSession] User STT: ${msg.serverContent.inputTranscription.text}`)
          this.sendToClient(
            JSON.stringify({
              type: "user_transcript",
              text: msg.serverContent.inputTranscription.text,
            }),
          )
        }

        const parts = msg.serverContent.modelTurn?.parts
        if (parts) {
          for (const part of parts) {
            if (part.inlineData?.data) {
              this.sendToClient(
                JSON.stringify({
                  type: "audio",
                  data: part.inlineData.data,
                }),
              )
            }
            if (part.text && !msg.serverContent.outputTranscription?.text) {
              console.log(`[GeminiLiveSession] Model text: ${part.text}`)
              this.sendToClient(
                JSON.stringify({
                  type: "transcript",
                  text: part.text,
                }),
              )
            }
          }
        }

        if (msg.serverContent.outputTranscription?.text) {
          this.sendToClient(
            JSON.stringify({
              type: "transcript",
              text: msg.serverContent.outputTranscription.text,
            }),
          )
        }

        if (msg.serverContent.interrupted) {
          console.log("[GeminiLiveSession] Turn interrupted by user")
          this.sendToClient(JSON.stringify({ type: "interrupted" }))
        }

        if (msg.serverContent.turnComplete) {
          console.log("[GeminiLiveSession] Turn complete from Gemini")
          this.sendToClient(JSON.stringify({ type: "turn_complete" }))
        }
      }

      // ツール呼び出し（Fast Tier から Slow Tier へのディスパッチ）
      if (msg.toolCall) {
        const calls = msg.toolCall.functionCalls || []
        const toolCalls = calls.map((c) => ({ name: c.name, args: (c.args as Record<string, unknown>) ?? {} }))
        const toolNames = toolCalls.map((c) => c.name)
        console.log(`[GeminiLiveSession] Tool call received: ${toolNames.join(", ")}`)
        this.sendToClient(JSON.stringify({ type: "tool_start", tools: toolNames, toolCalls }))

        const responses: { id: string; name: string; response: { output: string } }[] = []

        for (const call of calls) {
          const result = await this.options.registry.execute(call.name, call.args ?? {})
          this.sendToClient(JSON.stringify({ type: "tool_result", tool: call.name, output: result }))
          responses.push({
            id: call.id,
            name: call.name,
            response: { output: result },
          })
        }

        const toolResponseMsg = {
          toolResponse: {
            functionResponses: responses,
          },
        }

        this.geminiWs?.send(JSON.stringify(toolResponseMsg))
      }
    })

    this.geminiWs.on("error", (err) => {
      this.sendToClient(JSON.stringify({ type: "error", message: `Gemini Live error: ${String(err)}` }))
    })

    this.geminiWs.on("close", (code, reason) => {
      this.sendToClient(
        JSON.stringify({ type: "closed", code, reason: reason.toString() }),
      )
    })
  }

  private speechChunks: Buffer[] = []

  /**
   * ユーザーの発話開始に合わせてバッファを初期化
   */
  resetSpeechBuffer(): void {
    this.speechChunks = []
  }

  /**
   * クライアントからのマイク音声データ（16kHz PCM base64）をバッファに追加
   */
  appendAudioChunk(base64Pcm: string): void {
    if (!this.geminiWs || this.geminiWs.readyState !== WebSocket.OPEN || !this.isSetupComplete) {
      return
    }

    const chunk = Buffer.from(base64Pcm, "base64")
    this.speechChunks.push(chunk)
  }

  /**
   * 互換性のためのエイリアス
   */
  sendAudioChunk(base64Pcm: string): void {
    this.appendAudioChunk(base64Pcm)
  }

  /**
   * ユーザーの発話完了（ターン終了）を受け、蓄積された音声をターンとして Gemini Live へ送信
   */
  sendTurnComplete(): void {
    if (!this.geminiWs || this.geminiWs.readyState !== WebSocket.OPEN || !this.isSetupComplete) {
      return
    }

    if (this.speechChunks.length === 0) {
      console.log("[GeminiLiveSession] turnComplete called but speech buffer is empty")
      return
    }

    const combined = Buffer.concat(this.speechChunks)
    this.speechChunks = []

    // 0.35秒（11200バイト）未満の場合は単発ノイズとして無視
    if (combined.length < 11200) {
      console.log(`[GeminiLiveSession] Speech too short (${combined.length} bytes), ignoring as noise`)
      return
    }

    const durationSec = (combined.length / 32000).toFixed(2)
    console.log(`[GeminiLiveSession] Sending user speech turn to Gemini (${combined.length} bytes, ~${durationSec}s)...`)

    const turnMsg = {
      clientContent: {
        turns: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: "audio/pcm;rate=16000",
                  data: combined.toString("base64"),
                },
              },
            ],
          },
        ],
        turnComplete: true,
      },
    }

    this.geminiWs.send(JSON.stringify(turnMsg))
  }

  /**
   * セッションを終了する
   */
  close(): void {
    if (this.geminiWs) {
      this.geminiWs.close()
      this.geminiWs = null
    }
  }
}
