import { describe, expect, it, vi } from "vitest"
import { createRunAgentSkill } from "./run-agent.ts"
import type { AgentDeps } from "../../agent.ts"
import { SkillRegistry } from "../registry.ts"

describe("createRunAgentSkill", () => {
  it("指示内容を受け取ってエージェントを実行し、結果を返す", async () => {
    const chat = vi.fn(async () => ({ content: "調査レポート: AIの最新動向について", tool_calls: undefined }))
    const registry = new SkillRegistry()
    const logger = { info: vi.fn() }
    const deps: AgentDeps = { chat, registry, logger }

    const skill = createRunAgentSkill(deps)
    expect(skill.name).toBe("run_agent")

    const result = await skill.execute({ instruction: "最新のAI動向を調べて" })
    expect(result).toBe("調査レポート: AIの最新動向について")
    expect(chat).toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ instruction: "最新のAI動向を調べて" }),
      expect.any(String),
    )
  })

  it("指示内容が未指定の場合はエラーを返す", async () => {
    const chat = vi.fn()
    const registry = new SkillRegistry()
    const logger = { info: vi.fn() }
    const deps: AgentDeps = { chat, registry, logger }

    const skill = createRunAgentSkill(deps)
    const resultEmpty = await skill.execute({ instruction: "   " })
    expect(resultEmpty).toContain("指定されていない")

    const resultNone = await skill.execute({})
    expect(resultNone).toContain("指定されていない")
    expect(chat).not.toHaveBeenCalled()
  })

  it("エージェント実行中に例外が発生した場合はエラーメッセージを返す", async () => {
    const chat = vi.fn(async () => {
      throw new Error("LLM connection timeout")
    })
    const registry = new SkillRegistry()
    const logger = { info: vi.fn() }
    const deps: AgentDeps = { chat, registry, logger }

    const skill = createRunAgentSkill(deps)
    const result = await skill.execute({ instruction: "何かの調査" })
    expect(result).toContain("エラーが発生した")
    expect(result).toContain("LLM connection timeout")
  })
})
