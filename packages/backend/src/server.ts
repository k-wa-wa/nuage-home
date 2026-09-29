import Fastify from "fastify"
import websocketPlugin from "@fastify/websocket"
import type { ChatMessage, ClientMessage, ServerMessage } from "@nuage-home/shared"
import { config } from "./config.ts"
import { runAgent, type AgentDeps } from "./agent.ts"
import { createLiteLlmChat } from "./llm-client.ts"
import { mockChat } from "./mock-llm.ts"
import { createDefaultSkillRegistry, createRunAgentSkill, SkillRegistry } from "./skills/index.ts"
import { GeminiLiveSession } from "./gemini-live/session.ts"

const app = Fastify({ logger: true })
await app.register(websocketPlugin)

// 1. バックエンド自律エージェント用の基本レジストリ（web_search, weather, wikipedia など）
// run_agent スキルは含めず、自己再帰（無限ループ）を防止する
const baseSkillRegistry = createDefaultSkillRegistry()
const agentDeps: AgentDeps = {
  chat: config.useMockLlm ? mockChat : createLiteLlmChat(config.llm),
  registry: baseSkillRegistry,
  logger: app.log,
}

// 2. Gemini Live 用のスキルレジストリ（基本スキル + run_agent）
const liveSkillRegistry = new SkillRegistry()
for (const skill of baseSkillRegistry.list()) {
  liveSkillRegistry.register(skill)
}
liveSkillRegistry.register(createRunAgentSkill(agentDeps))

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
  skills: liveSkillRegistry.list().map((s) => ({ name: s.name, description: s.description })),
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

app.get("/ws/live", { websocket: true }, (socket) => {
  const sendToClient = (data: string) => {
    if (socket.readyState === socket.OPEN) {
      socket.send(data)
    }
  }

  // クライアント専用のレジストリを作成し、run_agent の進行イベントをリアルタイム中継する
  const sessionRegistry = new SkillRegistry()
  for (const skill of baseSkillRegistry.list()) {
    sessionRegistry.register(skill)
  }
  const sessionAgentDeps: AgentDeps = {
    ...agentDeps,
    onEvent: (event) => {
      sendToClient(JSON.stringify({ type: "agent_event", event }))
    },
  }
  sessionRegistry.register(createRunAgentSkill(sessionAgentDeps))

  const session = new GeminiLiveSession(
    {
      model: config.geminiLive.model,
      systemInstruction:
        "あなたは親しみやすく賢い家庭用AIアシスタントです。簡潔に分かりやすい日本語で話してください。日常的な会話や単発の事実確認（今日の天気など）は直接答えたり個別ツールを呼び出してください。多角的な調査や深い分析・比較、あるいはユーザーから「詳しく調べて」「エージェントに依頼して」などの要求があった場合は、必ず run_agent ツールを使ってバックエンドの自律エージェントに調査を委譲してください。エージェントから調査レポートが返ってきたら、その要点や結論をわかりやすくユーザーに音声で解説してください。",
      registry: sessionRegistry,
    },
    sendToClient,
  )

  session.start().catch((err) => {
    app.log.error({ err }, "Failed to start Gemini Live session")
    socket.send(JSON.stringify({ type: "error", message: String(err) }))
  })

  socket.on("message", (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString()) as { type: string; data?: string }
      if (msg.type === "audio" && typeof msg.data === "string") {
        session.appendAudioChunk(msg.data)
      } else if (msg.type === "speech_start" || msg.type === "speech_cancel") {
        session.resetSpeechBuffer()
      } else if (msg.type === "turn_complete") {
        session.sendTurnComplete()
      }
    } catch {
      // 不正なJSONは無視
    }
  })

  socket.on("close", () => {
    session.close()
  })
})

await app.listen({ port: config.port, host: "0.0.0.0" })
