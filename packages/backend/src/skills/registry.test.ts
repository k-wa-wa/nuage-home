import { describe, expect, it } from "vitest"
import { SkillRegistry } from "./registry.ts"
import type { SkillDefinition } from "./types.ts"

const echo: SkillDefinition = {
  name: "echo",
  description: "引数をそのまま返す",
  parameters: { type: "object", properties: { text: { type: "string", description: "文字列" } }, required: ["text"] },
  execute: async (args) => String(args.text),
}

const broken: SkillDefinition = {
  name: "broken",
  description: "常に失敗する",
  parameters: { type: "object", properties: {} },
  execute: async () => {
    throw new Error("boom")
  },
}

describe("SkillRegistry", () => {
  it("OpenAI の tools 形式に変換する", () => {
    const registry = new SkillRegistry()
    registry.register(echo)

    expect(registry.toOpenAITools()).toEqual([
      { type: "function", function: { name: "echo", description: echo.description, parameters: echo.parameters } },
    ])
  })

  it("登録済みスキルを実行する", async () => {
    const registry = new SkillRegistry()
    registry.register(echo)
    await expect(registry.execute("echo", { text: "hi" })).resolves.toBe("hi")
  })

  it("未登録スキルは例外にせずエラー文を返す", async () => {
    await expect(new SkillRegistry().execute("missing", {})).resolves.toContain("登録されていない")
  })

  it("スキル内の例外は握りつぶしてエラー文を返す", async () => {
    const registry = new SkillRegistry()
    registry.register(broken)
    await expect(registry.execute("broken", {})).resolves.toContain("boom")
  })
})
