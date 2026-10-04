import { createMockResearchTools, createResearchAgent } from "../agents/research/index.ts";
import { createMockSmartHomeTools, createSmartHomeAgent } from "../agents/smart-home/index.ts";
import type { AppAgent } from "../agents/types.ts";
import type { Config } from "../config.ts";
import { createLiteLlmChat } from "../llm/client.ts";

/**
 * 評価用のエージェント群を構築する。
 * - LLM: 実 LiteLLM チャットを使用
 * - Tools: 実機操作や外部検索等の副作用を防ぐため、モックツールを使用
 */
export function createRealAgents(config: Config): AppAgent[] {
  const chat = createLiteLlmChat(config.llm);

  const research = createResearchAgent({
    chat,
    tools: createMockResearchTools(),
    logger: { info: () => {} },
  });

  const smartHome: AppAgent = createSmartHomeAgent({
    chat,
    tools: createMockSmartHomeTools(),
    logger: { info: () => {} },
  });

  const autopilot: AppAgent = {
    name: "autopilot",
    description: "開発タスク（GitHub の Issue と PR）の状況確認・調査・指示",
    ask: async (instruction) => {
      const res = await chat(
        [
          {
            role: "system",
            content: [
              "あなたは開発タスク（GitHub の Issue と PR）の状況確認・調査を行うエージェントである。",
              "ユーザーの指示に対して、状況や停止原因を丁寧な敬語（〜です、〜見込みです）で報告せよ。",
              "【要件】:",
              "- 丁寧な敬語（です・ます調）を使うこと。常体は避けること。",
              "- 1〜2文（目安60文字以内）で簡潔にまとめること。",
              "- Git コマンドそのものや長いハッシュは読み上げないこと。",
            ].join("\n"),
          },
          { role: "user", content: instruction },
        ],
        [],
      );
      return { speech: res.content?.trim() || "開発タスクの確認が完了しました。" };
    },
  };

  return [research, smartHome, autopilot];
}
