import type { ChatMessage } from "@nuage-home/shared"
import type { ChatFn, LlmMessage } from "./llm-client.ts"
import type { SkillArgs, SkillRegistry } from "./skills/index.ts"

export const MAX_TOOL_STEPS = 3
export const FALLBACK_REPLY = "申し訳ありません、回答をうまく作成できませんでした。"

export interface AgentLogger {
  info(obj: object, msg: string): void
}

export interface AgentDeps {
  chat: ChatFn
  registry: SkillRegistry
  logger: AgentLogger
}

/**
 * 日本の現在日時と曜日を動的に埋め込んだシステムプロンプトを生成する
 */
export function buildSystemPrompt(now: Date = new Date()): string {
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

  return `あなたは親しみやすく賢い家庭用AIアシスタントです。簡潔に分かりやすい日本語で回答してください。音声対話のため、長すぎる回答は避け、要点を伝えてください。
現在日時: ${dateStr} ${timeStr}`
}

function parseToolArgs(raw: string): SkillArgs {
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as SkillArgs) : {}
  } catch {
    return {}
  }
}

/**
 * ツール呼び出しと回答生成を行うエージェントループ。
 * history は最新のユーザー発話を末尾に含む user / assistant の会話履歴である。
 */
export async function runAgent(history: ChatMessage[], deps: AgentDeps): Promise<string> {
  const tools = deps.registry.toOpenAITools()
  const messages: LlmMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ]

  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    const res = await deps.chat(messages, tools)

    if (res.tool_calls && res.tool_calls.length > 0) {
      messages.push({ role: "assistant", content: res.content, tool_calls: res.tool_calls })

      for (const call of res.tool_calls) {
        const args = parseToolArgs(call.function.arguments)
        deps.logger.info({ tool: call.function.name, args }, "Executing skill")
        const result = await deps.registry.execute(call.function.name, args)
        messages.push({ role: "tool", tool_call_id: call.id, content: result })
      }
      continue
    }

    if (res.content) {
      return res.content
    }
    break
  }

  return FALLBACK_REPLY
}
