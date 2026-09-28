import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ServerMessage } from "@nuage-home/shared"
import { AgentSocket } from "./ws-client.ts"

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  readyState = FakeWebSocket.CONNECTING
  sent: string[] = []

  constructor() {
    super()
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.dispatchEvent(new Event("open"))
  }

  receive(msg: ServerMessage) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(msg) }))
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
    this.dispatchEvent(new Event("close"))
  }
}

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.stubGlobal("WebSocket", FakeWebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("AgentSocket", () => {
  it("接続を待ってから送信し、応答で resolve する", async () => {
    const agent = new AgentSocket("ws://test/ws")
    const ws = FakeWebSocket.instances[0]

    const reply = agent.ask("こんにちは")
    ws.open()
    await flush()
    expect(JSON.parse(ws.sent[0])).toEqual({ type: "user_text", text: "こんにちは" })

    ws.receive({ type: "assistant_text", text: "やあ" })
    await expect(reply).resolves.toBe("やあ")
  })

  it("サーバーのエラー応答で reject する", async () => {
    const agent = new AgentSocket("ws://test/ws")
    FakeWebSocket.instances[0].open()

    const reply = agent.ask("x")
    await flush()
    FakeWebSocket.instances[0].receive({ type: "error", message: "LiteLLM request failed" })

    await expect(reply).rejects.toThrow("LiteLLM request failed")
  })

  it("応答待ちで切断されたら reject し、次の問い合わせで再接続する", async () => {
    const agent = new AgentSocket("ws://test/ws")
    FakeWebSocket.instances[0].open()

    const first = agent.ask("x")
    await flush()
    FakeWebSocket.instances[0].close()
    await expect(first).rejects.toThrow("切断")

    const second = agent.ask("y")
    const ws2 = FakeWebSocket.instances[1]
    ws2.open()
    await flush()
    ws2.receive({ type: "assistant_text", text: "再接続OK" })
    await expect(second).resolves.toBe("再接続OK")
  })

  it("再接続後に古いソケットの close が届いても新しい問い合わせは失敗しない", async () => {
    const agent = new AgentSocket("ws://test/ws")
    const ws1 = FakeWebSocket.instances[0]
    ws1.open()
    ws1.readyState = FakeWebSocket.CLOSING

    const reply = agent.ask("x")
    const ws2 = FakeWebSocket.instances[1]
    ws2.open()
    await flush()
    ws1.close()
    ws2.receive({ type: "assistant_text", text: "ok" })

    await expect(reply).resolves.toBe("ok")
  })
})
