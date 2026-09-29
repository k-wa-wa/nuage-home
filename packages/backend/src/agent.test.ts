import { describe, expect, it, vi } from "vitest"
import type { ChatMessage } from "@nuage-home/shared"
import { buildSystemPrompt, FALLBACK_REPLY, MAX_TOOL_STEPS, runAgent, type AgentDeps } from "./agent.ts"
import type { LlmMessage, LlmResponse, ToolCall } from "./llm-client.ts"
import { SkillRegistry, type SkillDefinition } from "./skills/index.ts"

function toolCall(name: string, args: string, id = "call_1"): ToolCall {
  return { id, type: "function", function: { name, arguments: args } }
}

function setup(responses: LlmResponse[], skills: SkillDefinition[] = []) {
  const registry = new SkillRegistry()
  for (const s of skills) registry.register(s)
  // runAgent は messages 配列を使い回して push するため、呼び出し時点のスナップショットを残す
  const calls: LlmMessage[][] = []
  const chat = vi.fn(async (messages: LlmMessage[]) => {
    calls.push(structuredClone(messages))
    return responses[Math.min(calls.length - 1, responses.length - 1)]
  })
  const deps: AgentDeps = { chat, registry, logger: { info: () => {} } }
  return { deps, chat, calls }
}

const history: ChatMessage[] = [
  { role: "user", content: "こんにちは" },
  { role: "assistant", content: "やあ" },
  { role: "user", content: "東京の天気は？" },
]

describe("runAgent", () => {
  it("ツール呼び出しが無ければ LLM の回答をそのまま返す", async () => {
    const { deps, calls } = setup([{ content: "晴れだよ" }])

    await expect(runAgent(history, deps)).resolves.toBe("晴れだよ")
    expect(calls[0][0].role).toBe("system")
    expect(calls[0].slice(1)).toEqual(history)
  })

  it("ツールを実行し、その結果を LLM に渡して最終回答を得る", async () => {
    const execute = vi.fn(async () => "東京: 快晴")
    const { deps, calls } = setup(
      [{ content: null, tool_calls: [toolCall("weather", '{"location":"東京"}')] }, { content: "東京は快晴だよ" }],
      [{ name: "weather", description: "天気", parameters: { type: "object", properties: {} }, execute }],
    )

    await expect(runAgent(history, deps)).resolves.toBe("東京は快晴だよ")
    expect(execute).toHaveBeenCalledWith({ location: "東京" })
    expect(calls[1].slice(-2)).toEqual([
      { role: "assistant", content: null, tool_calls: [toolCall("weather", '{"location":"東京"}')] },
      { role: "tool", tool_call_id: "call_1", content: "東京: 快晴" },
    ])
  })

  it("壊れたツール引数は空オブジェクトとして扱う", async () => {
    const execute = vi.fn(async () => "ok")
    const { deps } = setup(
      [{ content: null, tool_calls: [toolCall("weather", "{not json")] }, { content: "done" }],
      [{ name: "weather", description: "", parameters: { type: "object", properties: {} }, execute }],
    )

    await runAgent(history, deps)
    expect(execute).toHaveBeenCalledWith({})
  })

  it("未登録ツールはエラー文を結果として LLM に返し、処理を続ける", async () => {
    const { deps, calls } = setup([{ content: null, tool_calls: [toolCall("nope", "{}")] }, { content: "ごめんね" }])

    await expect(runAgent(history, deps)).resolves.toBe("ごめんね")
    expect(calls[1].at(-1)).toMatchObject({ role: "tool", content: expect.stringContaining("登録されていない") })
  })

  it(`ツール呼び出しが ${MAX_TOOL_STEPS} 回続いた場合、最終要約を試み、それでも回答が無ければ定型文を返す`, async () => {
    const { deps, chat } = setup([{ content: null, tool_calls: [toolCall("nope", "{}")] }])

    await expect(runAgent(history, deps)).resolves.toBe(FALLBACK_REPLY)
    expect(chat).toHaveBeenCalledTimes(MAX_TOOL_STEPS + 1)
  })

  it(`ツール呼び出しが ${MAX_TOOL_STEPS} 回続いた後、最終要約で回答が得られればその回答を返す`, async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({ content: null, tool_calls: [toolCall("weather", "{}")] })
      .mockResolvedValueOnce({ content: null, tool_calls: [toolCall("weather", "{}")] })
      .mockResolvedValueOnce({ content: null, tool_calls: [toolCall("weather", "{}")] })
      .mockResolvedValueOnce({ content: "最終調査結果レポートです。" })
    const registry = new SkillRegistry()
    registry.register({
      name: "weather",
      description: "",
      parameters: { type: "object", properties: {} },
      execute: async () => "晴れ",
    })
    const deps: AgentDeps = { chat, registry, logger: { info: () => {} } }

    await expect(runAgent(history, deps)).resolves.toBe("最終調査結果レポートです。")
    expect(chat).toHaveBeenCalledTimes(MAX_TOOL_STEPS + 1)
  })

  it("回答が空なら定型文を返す", async () => {
    const { deps } = setup([{ content: null }])
    await expect(runAgent(history, deps)).resolves.toBe(FALLBACK_REPLY)
  })
})

describe("buildSystemPrompt", () => {
  it("日本時間の日時を埋め込む", () => {
    const prompt = buildSystemPrompt(new Date("2026-09-28T16:05:00Z"))
    expect(prompt).toContain("2026年9月29日")
    expect(prompt).toContain("01:05")
  })
})
