import Fastify from "fastify"
import websocketPlugin from "@fastify/websocket"
import type { ChatMessage, ClientMessage, ServerMessage } from "@nuage-home/shared"
import { config } from "./config.ts"
import { runAgent, type AgentDeps } from "./agent.ts"
import { createLiteLlmChat } from "./llm-client.ts"
import { mockChat } from "./mock-llm.ts"
import { createDefaultSkillRegistry } from "./skills/index.ts"

const app = Fastify({ logger: true })
await app.register(websocketPlugin)

const skillRegistry = createDefaultSkillRegistry()
const agentDeps: AgentDeps = {
  chat: config.useMockLlm ? mockChat : createLiteLlmChat(config.llm),
  registry: skillRegistry,
  logger: app.log,
}

if (config.useMockLlm) app.log.warn("LITELLM_MOCK active: returning canned LLM responses")

/** 不正な JSON や text の型違いは error、未知の type は null（無視）を返す */
function parseClientMessage(raw: string): ClientMessage | { error: string } | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { error: "invalid JSON" }
  }
  if (typeof data !== "object" || data === null || (data as { type?: unknown }).type !== "user_text") {
    return null
  }
  const text = (data as { text?: unknown }).text
  if (typeof text !== "string") {
    return { error: "invalid message: text must be a string" }
  }
  return { type: "user_text", text }
}

app.get("/", async () => ({
  status: "ok",
  skills: skillRegistry.list().map((s) => ({ name: s.name, description: s.description })),
}))

app.get("/ws", { websocket: true }, (socket) => {
  // 会話履歴はメモリ上に保持。ツール結果で汚染させず、user / assistant の最終文のみ蓄積する
  const history: ChatMessage[] = []

  function send(msg: ServerMessage) {
    socket.send(JSON.stringify(msg))
  }

  socket.on("message", async (raw: Buffer) => {
    const msg = parseClientMessage(raw.toString())
    if (msg === null) return
    if ("error" in msg) {
      send({ type: "error", message: msg.error })
      return
    }

    history.push({ role: "user", content: msg.text })
    try {
      const reply = await runAgent(history, agentDeps)
      history.push({ role: "assistant", content: reply })
      send({ type: "assistant_text", text: reply })
    } catch (err) {
      send({ type: "error", message: String(err) })
    }
  })
})

await app.listen({ port: config.port, host: "0.0.0.0" })
