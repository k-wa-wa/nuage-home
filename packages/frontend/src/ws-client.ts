import type { ClientMessage, ServerMessage } from "@nuage-home/shared"
import type { AgentClient } from "./conversation.ts"

const CONNECT_TIMEOUT_MS = 5000

interface Pending {
  resolve: (text: string) => void
  reject: (err: Error) => void
}

export class AgentSocket implements AgentClient {
  private url: string
  private ws: WebSocket
  private pending: Pending | null = null

  constructor(url: string) {
    this.url = url
    this.ws = this.connect()
  }

  async ask(text: string): Promise<string> {
    await this.ready()
    if (this.pending) {
      throw new Error("a request is already in flight")
    }
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject }
      const msg: ClientMessage = { type: "user_text", text }
      try {
        this.ws.send(JSON.stringify(msg))
      } catch (err) {
        this.pending = null
        reject(err)
      }
    })
  }

  private connect(): WebSocket {
    const ws = new WebSocket(this.url)

    // 再接続後に古いソケットのイベントが届いても、新しいリクエストに影響させない
    ws.addEventListener("message", (event) => {
      if (ws !== this.ws) return
      try {
        const msg: ServerMessage = JSON.parse(event.data)
        if (msg.type === "assistant_text") {
          this.settle((p) => p.resolve(msg.text))
        } else {
          this.settle((p) => p.reject(new Error(msg.message)))
        }
      } catch (err) {
        this.settle((p) => p.reject(new Error(`Failed to parse server message: ${String(err)}`)))
      }
    })

    ws.addEventListener("close", () => {
      if (ws !== this.ws) return
      this.settle((p) => p.reject(new Error("WebSocket接続が切断された")))
    })

    return ws
  }

  private settle(fn: (pending: Pending) => void) {
    const pending = this.pending
    if (!pending) return
    this.pending = null
    fn(pending)
  }

  private ready(): Promise<void> {
    // 接続が閉じている、または切断中の場合は再接続
    if (this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
      this.ws = this.connect()
    }
    const ws = this.ws
    if (ws.readyState === WebSocket.OPEN) {
      return Promise.resolve()
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error("WebSocket接続がタイムアウトした"))
      }, CONNECT_TIMEOUT_MS)

      const onOpen = () => {
        cleanup()
        resolve()
      }
      const onError = () => {
        cleanup()
        reject(new Error("WebSocket connection failed"))
      }
      const cleanup = () => {
        clearTimeout(timeout)
        ws.removeEventListener("open", onOpen)
        ws.removeEventListener("error", onError)
      }

      ws.addEventListener("open", onOpen, { once: true })
      ws.addEventListener("error", onError, { once: true })
    })
  }
}
