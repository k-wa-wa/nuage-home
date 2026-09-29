import type { AgentEvent, LiveServerToClientMessage } from "@nuage-home/shared"
import { LiveAudioRecorder } from "./live-audio-recorder.ts"
import { LiveAudioPlayer } from "./live-audio-player.ts"

export type LiveState = "stopped" | "connecting" | "listening" | "speaking" | "thinking"

export interface LiveClientCallbacks {
  onStateChange: (state: LiveState) => void
  onTranscript?: (text: string, isFinal?: boolean) => void
  onUserTranscript?: (text: string) => void
  onToolStart?: (tools: string[], toolCalls?: { name: string; args: Record<string, unknown> }[]) => void
  onToolResult?: (tool: string, output: string) => void
  onAgentEvent?: (event: AgentEvent) => void
  onError?: (err: Error) => void
  onUserSpeaking?: (speaking: boolean) => void
}

/**
 * Gemini Live API とブラウザの音声ストリーミングを統合制御するクライアント
 */
export class GeminiLiveClient {
  private ws: WebSocket | null = null
  private recorder: LiveAudioRecorder
  private player: LiveAudioPlayer
  private isRunning = false
  private isThinking = false
  private url: string
  private callbacks: LiveClientCallbacks

  constructor(
    url: string,
    callbacks: LiveClientCallbacks,
  ) {
    this.url = url
    this.callbacks = callbacks
    this.recorder = new LiveAudioRecorder({
      onAudioChunk: (base64Chunk) => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: "audio", data: base64Chunk }))
        }
      },
      onSpeechStart: () => {
        if (!this.isRunning) return
        // ユーザーが話し始めたら、Geminiの発話を中断（Barge-in）
        this.player.interrupt()
        this.isThinking = false
        this.callbacks.onUserSpeaking?.(true)
        this.callbacks.onStateChange("listening")
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: "speech_start" }))
        }
      },
      onSpeechCancel: () => {
        if (!this.isRunning) return
        this.callbacks.onUserSpeaking?.(false)
        this.callbacks.onStateChange("listening")
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          console.log("[LiveClient] Speech canceled as noise, resetting buffer")
          this.ws.send(JSON.stringify({ type: "speech_cancel" }))
        }
      },
      onSpeechEnd: () => {
        if (!this.isRunning) return
        this.callbacks.onUserSpeaking?.(false)
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          console.log("[LiveClient] Speech finished, sending turn_complete to Gemini")
          this.ws.send(JSON.stringify({ type: "turn_complete" }))
          this.isThinking = true
          this.callbacks.onStateChange("thinking")
        }
      },
    })

    this.player = new LiveAudioPlayer((playing) => {
      if (!this.isRunning) return
      if (playing) {
        this.callbacks.onStateChange("speaking")
      } else if (!this.isThinking) {
        this.callbacks.onStateChange("listening")
      }
    })
  }

  async start(): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true
    this.callbacks.onStateChange("connecting")

    console.log("[LiveClient] Starting audio contexts and mic...")

    // 1. マイク対応チェック
    if (!navigator.mediaDevices?.getUserMedia) {
      const err = new Error(
        "お使いのブラウザまたは環境ではマイク（getUserMedia）がサポートされていないか、HTTPのため無効化されている（localhostまたはHTTPSが必要）。",
      )
      console.error("[LiveClient]", err)
      this.stop(err)
      return
    }

    // 2. ユーザージェスチャー直下でマイクと再生コンテキストを初期化
    try {
      await this.player.warmup()
      await this.recorder.start()
      console.log("[LiveClient] Microphone and AudioContext ready!")
    } catch (err) {
      console.error("[LiveClient] Audio init failed:", err)
      this.stop(new Error(`マイクの起動に失敗した: ${String(err)}`))
      return
    }

    // 3. WebSocket 接続
    console.log("[LiveClient] Connecting WebSocket to:", this.url)
    try {
      this.ws = new WebSocket(this.url)
    } catch (err) {
      console.error("[LiveClient] WebSocket create failed:", err)
      this.stop(new Error(`WebSocket接続の作成に失敗した: ${String(err)}`))
      return
    }

    this.ws.onopen = () => {
      console.log("[LiveClient] WebSocket open, waiting for Gemini ready...")
    }

    this.ws.onmessage = (event) => {
      let msg: LiveServerToClientMessage
      try {
        msg = JSON.parse(event.data) as LiveServerToClientMessage
      } catch (err) {
        console.warn("[LiveClient] Failed to parse JSON message from server:", err, event.data)
        return
      }

      if (typeof msg !== "object" || msg === null || typeof msg.type !== "string") {
        console.warn("[LiveClient] Unexpected message format from server:", msg)
        return
      }

      switch (msg.type) {
        case "ready":
          console.log("[LiveClient] Gemini Live ready received!")
          this.callbacks.onStateChange("listening")
          break

        case "audio":
          if (msg.data) {
            this.isThinking = false
            this.player.queueAudioChunk(msg.data)
          }
          break

        case "transcript":
          if (msg.text) {
            this.callbacks.onTranscript?.(msg.text, false)
          }
          break

        case "user_transcript":
          if (msg.text) {
            this.callbacks.onUserTranscript?.(msg.text)
          }
          break

        case "tool_start": {
          console.log("[LiveClient] Tool execution started:", msg.tools, msg.toolCalls)
          this.isThinking = true
          this.callbacks.onStateChange("thinking")
          this.callbacks.onToolStart?.(msg.tools, msg.toolCalls)
          break
        }

        case "tool_result": {
          console.log(`[LiveClient] Tool result received for ${msg.tool}:`, msg.output.slice(0, 80))
          this.callbacks.onToolResult?.(msg.tool, msg.output)
          break
        }

        case "agent_event": {
          console.log("[LiveClient] Agent event received:", msg.event)
          this.callbacks.onAgentEvent?.(msg.event)
          break
        }

        case "interrupted":
          console.log("[LiveClient] User interrupted Gemini speech")
          this.player.interrupt()
          this.isThinking = false
          this.callbacks.onTranscript?.("", true)
          this.callbacks.onStateChange("listening")
          break

        case "turn_complete":
          console.log("[LiveClient] Gemini turn complete")
          this.isThinking = false
          this.callbacks.onTranscript?.("", true)
          if (!this.player.playing) {
            this.callbacks.onStateChange("listening")
          }
          break

        case "error":
          console.error("[LiveClient] Server error:", msg.message)
          this.stop(new Error(msg.message ?? "Gemini Live error"))
          break

        case "closed":
          console.log("[LiveClient] Server closed session:", msg.code, msg.reason)
          this.stop()
          break

        default: {
          const _exhaustiveCheck: never = msg
          console.warn("[LiveClient] Unknown message type from server:", (_exhaustiveCheck as { type?: string }).type)
          break
        }
      }
    }

    this.ws.onerror = (event) => {
      console.error("[LiveClient] WebSocket onerror:", event)
      this.stop(new Error("Gemini Live 接続エラー（サーバーへの接続に失敗）"))
    }

    this.ws.onclose = (event) => {
      console.log("[LiveClient] WebSocket closed:", event.code, event.reason)
      if (event.code !== 1000 && event.code !== 1005) {
        this.stop(new Error(`切断された (コード: ${event.code} ${event.reason || ""})`))
      } else {
        this.stop()
      }
    }
  }

  stop(error?: Error): void {
    this.isRunning = false
    this.isThinking = false

    this.recorder.stop()
    this.player.interrupt()

    if (this.ws) {
      this.ws.close()
      this.ws = null
    }

    if (error) {
      this.callbacks.onError?.(error)
    } else {
      this.callbacks.onStateChange("stopped")
    }
  }

  toggle(): void {
    if (this.isRunning) {
      this.stop()
    } else {
      this.start().catch((err) => {
        this.stop(err)
      })
    }
  }

  get running(): boolean {
    return this.isRunning
  }
}
