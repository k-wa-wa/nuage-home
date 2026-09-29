import { describe, test } from "vitest";
import type { AppAgent } from "../agents/types.ts";
import { goldenIn } from "../testing/golden.ts";
import { ToolRegistry } from "../tools/registry.ts";
import type { ToolDefinition } from "../tools/types.ts";
import { buildSystemInstruction, buildTools } from "./prompt.ts";

const golden = goldenIn(import.meta.url);

const sampleApps: AppAgent[] = [
  {
    name: "research",
    description: "Web 検索を使った詳しい調査・分析・比較",
    ask: async () => "ok",
  },
  {
    name: "autopilot",
    description: "開発タスクの自律実行・PR の作成や進捗確認",
    ask: async () => "ok",
  },
];

const sampleTool: ToolDefinition = {
  name: "web_search",
  description: "Web 上の最新情報・ニュース・話題を検索する",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "検索キーワード" },
    },
    required: ["query"],
  },
  execute: async () => "検索結果",
};

describe("Live 会話層プロンプトの Golden テスト", () => {
  const fixedDate = new Date("2026-09-29T10:00:00+09:00");

  test("buildSystemInstruction: 通常（アプリ・ツールあり）", () => {
    const tools = new ToolRegistry([sampleTool]);
    const instruction = buildSystemInstruction(sampleApps, tools, fixedDate);
    golden("live_instruction", instruction);
  });

  test("buildSystemInstruction: 最小（アプリ・ツールなし）", () => {
    const tools = new ToolRegistry([]);
    const instruction = buildSystemInstruction([], tools, fixedDate);
    golden("live_instruction_minimal", instruction);
  });

  test("buildTools: ツール宣言の Golden テスト", () => {
    const tools = new ToolRegistry([sampleTool]);
    const decls = buildTools(sampleApps, tools);
    golden("tools_declaration", JSON.stringify(decls, null, 2));
  });
});
