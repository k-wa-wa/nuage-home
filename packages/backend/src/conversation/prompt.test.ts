import { describe, test } from "vitest";
import type { AppAgent } from "../agents/types.ts";
import { goldenIn } from "../testing/golden.ts";
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

describe("Live 会話層プロンプトの Golden テスト", () => {
  const fixedDate = new Date("2026-09-29T10:00:00+09:00");

  test("buildSystemInstruction: 通常（アプリあり）", () => {
    const instruction = buildSystemInstruction(sampleApps, fixedDate);
    golden("live_instruction", instruction);
  });

  test("buildSystemInstruction: 位置情報あり", () => {
    const location = { latitude: 35.6895, longitude: 139.6917, address: "東京都 新宿区 西新宿" };
    const instruction = buildSystemInstruction(sampleApps, fixedDate, location);
    golden("live_instruction_with_location", instruction);
  });

  test("buildSystemInstruction: 最小（アプリなし）", () => {
    const instruction = buildSystemInstruction([], fixedDate);
    golden("live_instruction_minimal", instruction);
  });

  test("buildTools: ツール宣言の Golden テスト", () => {
    const decls = buildTools(sampleApps);
    golden("tools_declaration", JSON.stringify(decls, null, 2));
  });
});
