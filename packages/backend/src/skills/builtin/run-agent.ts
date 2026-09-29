import type { AgentDeps } from "../../agent.ts"
import { runAgent } from "../../agent.ts"
import type { SkillDefinition } from "../types.ts"

/**
 * 自律エージェント実行スキル (run_agent)
 * Gemini Live などの高速音声層から、多角的な調査・深い推論・分析が必要な場合に
 * バックエンドの自律エージェント（LiteLLM）を起動して詳細レポートを取得する。
 */
export function createRunAgentSkill(deps: AgentDeps): SkillDefinition {
  return {
    name: "run_agent",
    description:
      "複雑な調査、深い推論や分析、多角的な比較検討、最新動向の深掘りなど、より高度な長考や調査が必要な場合にバックエンドの自律エージェントを実行して詳細な調査レポートを取得する。",
    parameters: {
      type: "object",
      properties: {
        instruction: {
          type: "string",
          description: "自律エージェントに依頼する具体的な調査・分析・検討の指示内容",
        },
      },
      required: ["instruction"],
    },
    execute: async (args) => {
      const instruction = typeof args.instruction === "string" ? args.instruction.trim() : ""
      if (!instruction) {
        return "エージェントへの指示内容（instruction）が指定されていない。"
      }

      deps.logger.info({ instruction }, "Starting backend autonomous agent (run_agent)")

      try {
        const report = await runAgent(
          [
            {
              role: "user",
              content: instruction,
            },
          ],
          deps,
        )
        deps.logger.info({ reportLength: report.length }, "Backend autonomous agent completed")
        return report
      } catch (err) {
        deps.logger.info({ err: String(err) }, "Backend autonomous agent failed")
        return `エージェント実行中にエラーが発生した: ${String(err)}`
      }
    },
  }
}
