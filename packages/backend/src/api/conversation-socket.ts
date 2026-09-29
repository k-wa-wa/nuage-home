import type { ConversationClientMessage, ConversationModes } from "@nuage-home/shared"
import type { WebSocket } from "ws"
import type { OrchestratorOptions } from "../conversation/orchestrator.ts"
import { Orchestrator } from "../conversation/orchestrator.ts"

export interface ConversationParts extends Omit<OrchestratorOptions, "send"> {
  modes: ConversationModes
}

/**
 * WebSocket 1 本を 1 つの会話として Orchestrator につなぐ。
 * 音声モード（/ws/live）とサンドボックス（/ws/sandbox）で共通に使う。
 */
export function attachConversation(socket: WebSocket, parts: ConversationParts, onError: (err: unknown) => void): void {
  const { modes, ...options } = parts
  const orchestrator = new Orchestrator({
    ...options,
    send: (msg) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg))
    },
  })

  orchestrator
    .start()
    .then(() => socket.send(JSON.stringify({ type: "ready", modes })))
    .catch((err) => {
      onError(err)
      socket.send(JSON.stringify({ type: "error", message: String(err) }))
      socket.close()
    })

  socket.on("message", (raw: Buffer) => {
    let msg: ConversationClientMessage
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    orchestrator.handleClient(msg)
  })
  socket.on("close", () => orchestrator.close())
}
