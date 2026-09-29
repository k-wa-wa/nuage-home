import WebSocket from "ws"
import type { Config } from "../config.ts"
import { GEMINI_LIVE } from "../constants.ts"
import type { GeminiLiveServerMessage } from "./gemini-types.ts"
import type { LiveEvent, LivePort, LiveSetup, LiveToolResponse, UserTurn } from "./port.ts"

/**
 * Gemini Live（LiteLLM のパススルー経由）を LivePort として扱う。
 * ユーザー発話は音声（16kHz PCM）またはテキストで 1 ターンずつ送り、
 * Live の発話は音声と書き起こしの両方で受け取る。
 */
export class GeminiLivePort implements LivePort {
  private ws: WebSocket | null = null
  private listener: (e: LiveEvent) => void = () => {}
  private readonly cfg: Config["geminiLive"]

  constructor(cfg: Config["geminiLive"]) {
    this.cfg = cfg
  }

  onEvent(listener: (e: LiveEvent) => void): void {
    this.listener = listener
  }

  start(setup: LiveSetup): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.cfg.wsUrl)
      this.ws = ws
      let ready = false

      ws.on("open", () => {
        ws.send(
          JSON.stringify({
            setup: {
              model: this.cfg.model,
              generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_LIVE.voice } } },
              },
              systemInstruction: { parts: [{ text: setup.systemInstruction }] },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              // 音声のみのセッションは 15 分が上限のため、圧縮して延ばす
              contextWindowCompression: { slidingWindow: {} },
              tools: [{ functionDeclarations: setup.tools }],
            },
          }),
        )
      })

      ws.on("message", (raw: WebSocket.Data) => {
        let msg: GeminiLiveServerMessage
        try {
          msg = JSON.parse(raw.toString())
        } catch {
          return
        }
        if (msg.setupComplete) {
          ready = true
          resolve()
          return
        }
        const sc = msg.serverContent
        if (sc) {
          for (const part of sc.modelTurn?.parts ?? []) {
            if (part.inlineData?.data) this.emit({ type: "audio", data: part.inlineData.data })
          }
          if (sc.inputTranscription?.text) this.emit({ type: "user_text", text: sc.inputTranscription.text })
          if (sc.outputTranscription?.text) this.emit({ type: "text", text: sc.outputTranscription.text })
          if (sc.interrupted) this.emit({ type: "interrupted" })
          if (sc.turnComplete) this.emit({ type: "turn_complete" })
        }
        if (msg.toolCall) {
          this.emit({
            type: "tool_call",
            calls: msg.toolCall.functionCalls.map((c) => ({ id: c.id, name: c.name, args: c.args ?? {} })),
          })
        }
      })

      ws.on("close", (code, reason) => {
        const message = `Gemini Live が切断された (${code} ${reason.toString()})`
        if (!ready) reject(new Error(message))
        else this.emit({ type: "error", message })
      })
      ws.on("error", (err) => {
        if (!ready) reject(err)
        else this.emit({ type: "error", message: String(err) })
      })
    })
  }

  sendUserTurn(turn: UserTurn): void {
    const part =
      "audio" in turn
        ? { inlineData: { mimeType: "audio/pcm;rate=16000", data: turn.audio.toString("base64") } }
        : { text: turn.text }
    this.send({ clientContent: { turns: [{ role: "user", parts: [part] }], turnComplete: true } })
  }

  sendContext(text: string): void {
    this.send({ clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: false } })
  }

  sendPrompt(text: string): void {
    this.send({ clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: true } })
  }

  sendToolResponses(responses: LiveToolResponse[]): void {
    this.send({ toolResponse: { functionResponses: responses } })
  }

  close(): void {
    this.ws?.close()
    this.ws = null
  }

  private send(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload))
  }

  private emit(e: LiveEvent): void {
    this.listener(e)
  }
}
