import type { AgentEvent, ChatMessage } from "@nuage-home/shared"
import type { ChatFn, LlmMessage } from "./llm-client.ts"
import type { SkillArgs, SkillRegistry } from "./skills/index.ts"

export type { AgentEvent }
export const MAX_TOOL_STEPS = 3
export const FALLBACK_REPLY = "申し訳ありません、回答をうまく作成できませんでした。"

export interface AgentLogger {
  info(obj: object, msg: string): void
}

export interface AgentDeps {
  chat: ChatFn
  registry: SkillRegistry
  logger: AgentLogger
  onEvent?: (event: AgentEvent) => void
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

  return `あなたは親しみやすく賢い家庭用AIアシスタントです。簡潔に分かりやすい日本語で回答してください。音声対話のため、長すぎる回答は避け、要点を伝えてください。調査に必要な情報が集まったら、追加検索は行わず速やかに分かりやすく整理された調査レポートを作成してください。
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

  let hasExecutedTools = false

  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    deps.onEvent?.({ type: "step_start", step: step + 1, maxSteps: MAX_TOOL_STEPS })
    const res = await deps.chat(messages, tools)

    if (res.tool_calls && res.tool_calls.length > 0) {
      hasExecutedTools = true
      messages.push({ role: "assistant", content: res.content, tool_calls: res.tool_calls })

      for (const call of res.tool_calls) {
        const args = parseToolArgs(call.function.arguments)
        deps.logger.info({ tool: call.function.name, args }, "Executing skill")
        deps.onEvent?.({ type: "tool_start", tool: call.function.name, args })

        const result = await deps.registry.execute(call.function.name, args)
        deps.onEvent?.({ type: "tool_result", tool: call.function.name, output: result })
        messages.push({ role: "tool", tool_call_id: call.id, content: result })
      }
      continue
    }

    if (res.content) {
      deps.onEvent?.({ type: "complete", reportLength: res.content.length })
      return res.content
    }
    break
  }

  // ツールを呼び出したものの回答未生成で上限に達した場合、蓄積された結果をもとにツール無しで最終サマライズを行う
  if (hasExecutedTools) {
    try {
      deps.logger.info({}, "Summarizing tool execution results for final response")
      deps.onEvent?.({ type: "summarizing" })
      messages.push({
        role: "user",
        content: "これまでに得られた情報に基づいて、ユーザーへの回答または調査レポートを作成してください。",
      })
      const summaryRes = await deps.chat(messages, [])
      if (summaryRes.content) {
        deps.onEvent?.({ type: "complete", reportLength: summaryRes.content.length })
        return summaryRes.content
      }
    } catch (err) {
      deps.logger.info({ err: String(err) }, "Failed to generate final summary from tool results")
    }
  }

  return FALLBACK_REPLY
}
