import { createResearchAgent, createResearchTools } from "../agents/research/index.ts";
import {
  createSmartHomeAgent,
  createSmartHomeTools,
  SwitchBotClient,
} from "../agents/smart-home/index.ts";
import type { AppAgent } from "../agents/types.ts";
import type { Config } from "../config.ts";
import { createLiteLlmChat } from "../llm/client.ts";

/**
 * 実環境で動作するエージェント群を構築する。
 * - research: 実 SearXNG + bwproxy + 実 LiteLLM
 * - smart_home: SwitchBot 設定があれば実機操作、なければ実 LLM による解釈・応答
 * - autopilot: 実 LLM による状況確認・応答
 */
export function createRealAgents(config: Config): AppAgent[] {
  const chat = createLiteLlmChat(config.llm);

  const research = createResearchAgent({
    chat,
    tools: createResearchTools(config.searxngUrl, config.bwproxyUrl),
    logger: { info: () => {} },
  });

  const smartHome: AppAgent = config.switchbot
    ? createSmartHomeAgent({
        chat,
        tools: createSmartHomeTools(new SwitchBotClient(config.switchbot)),
        logger: { info: () => {} },
      })
    : {
        name: "smart_home",
        description: "照明（フロアライト・電球・テープライト）やカーテン等の家電操作",
        ask: async (instruction) => {
          const res = await chat(
            [
              {
                role: "system",
                content: [
                  "あなたはスマートホームの家電操作エージェントである。",
                  "ユーザーの家電操作指示（照明の点灯/消灯、カーテンの開閉等）を解釈し、操作を完了した旨を音声向けに報告せよ。",
                  "【要件】:",
                  "- 親しみやすい常体（〜したよ、〜完了したよ）を使うこと。敬体（です・ます）は禁止。",
                  "- 音声で読み上げるため、1文（40文字以内）で極めて簡潔にすること。",
                  "- レポートは不要。",
                ].join("\n"),
              },
              { role: "user", content: instruction },
            ],
            [],
          );
          return { speech: res.content?.trim() || "家電の操作を完了したよ。" };
        },
      };

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
              "ユーザーの指示に対して、状況や停止原因を親しみやすい常体（〜だよ、〜見込みだよ）で報告せよ。",
              "【要件】:",
              "- 1〜2文（目安60文字以内）で簡潔にまとめること。",
              "- Git コマンドそのものや長いハッシュは読み上げないこと。",
            ].join("\n"),
          },
          { role: "user", content: instruction },
        ],
        [],
      );
      return { speech: res.content?.trim() || "開発タスクの確認が完了したよ。" };
    },
  };

  return [research, smartHome, autopilot];
}
