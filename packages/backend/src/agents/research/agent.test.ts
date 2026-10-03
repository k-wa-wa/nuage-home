import { describe, expect, it, test, vi } from "vitest";
import { TUNING } from "../../constants.ts";
import type { LlmMessage, LlmResponse, ToolCall } from "../../llm/client.ts";
import { goldenIn } from "../../testing/golden.ts";
import { type ToolDefinition, ToolRegistry } from "../../tools/index.ts";
import {
  buildSystemPrompt,
  createResearchAgent,
  type ResearchDeps,
  ResearchError,
  runResearch,
} from "./agent.ts";

function toolCall(name: string, args: string, id = "call_1"): ToolCall {
  return { id, type: "function", function: { name, arguments: args } };
}

function setup(responses: LlmResponse[], tools: ToolDefinition[] = []) {
  // runResearch は messages 配列を使い回して push するため、呼び出し時点のスナップショットを残す
  const calls: LlmMessage[][] = [];
  const chat = vi.fn(async (messages: LlmMessage[]) => {
    calls.push(structuredClone(messages));
    return responses[Math.min(calls.length - 1, responses.length - 1)];
  });
  const deps: ResearchDeps = { chat, tools: new ToolRegistry(tools), logger: { info: () => {} } };
  return { deps, chat, calls };
}

const dummyTool = (execute: ToolDefinition["execute"]): ToolDefinition => ({
  name: "search",
  description: "検索",
  parameters: { type: "object", properties: {} },
  execute,
});

describe("runResearch", () => {
  it("complete_task ツール呼び出しで speech と report を返す", async () => {
    const { deps, calls } = setup([
      {
        content: null,
        tool_calls: [
          toolCall(
            "complete_task",
            JSON.stringify({
              speech: "東京は快晴だよ。",
              report: { title: "東京の天気", markdown: "# 東京の天気\n\n快晴である。" },
            }),
          ),
        ],
      },
    ]);
    const res = await runResearch("東京の天気は？", deps);
    expect(res).toEqual({
      speech: "東京は快晴だよ。",
      report: { title: "東京の天気", markdown: "# 東京の天気\n\n快晴である。" },
    });
    expect(calls[0].map((m) => m.role)).toEqual(["system", "user"]);
    expect(calls[0][1].content).toBe("東京の天気は？");
  });

  it("ツール呼び出しが無ければフォールバックとして LLM の回答を基に TaskOutput を返す", async () => {
    const { deps, calls } = setup([{ content: "晴れだよ" }]);
    const res = await runResearch("東京の天気は？", deps);
    expect(res.speech).toBe("晴れだよ");
    expect(res.report?.markdown).toBe("晴れだよ");
    expect(calls[0].map((m) => m.role)).toEqual(["system", "user"]);
    expect(calls[0][1].content).toBe("東京の天気は？");
  });

  it("ツールを実行し、その結果を LLM に渡してレポートを得る", async () => {
    const execute = vi.fn(async () => "東京: 快晴");
    const { deps, calls } = setup(
      [
        { content: null, tool_calls: [toolCall("search", '{"location":"東京"}')] },
        {
          content: null,
          tool_calls: [
            toolCall(
              "complete_task",
              JSON.stringify({
                speech: "東京は快晴だよ。",
                report: { title: "東京の天気", markdown: "# 快晴" },
              }),
            ),
          ],
        },
      ],
      [dummyTool(execute)],
    );
    const res = await runResearch("東京の天気は？", deps);
    expect(res.speech).toBe("東京は快晴だよ。");
    expect(res.report?.markdown).toBe("# 快晴");
    expect(execute).toHaveBeenCalledWith({ location: "東京" });
    expect(calls[1].slice(-2)).toEqual([
      { role: "assistant", content: null, tool_calls: [toolCall("search", '{"location":"東京"}')] },
      { role: "tool", tool_call_id: "call_1", content: "東京: 快晴" },
    ]);
  });

  it("壊れたツール引数は空オブジェクトとして扱う", async () => {
    const execute = vi.fn(async () => "ok");
    const { deps } = setup(
      [{ content: null, tool_calls: [toolCall("search", "{not json")] }, { content: "done" }],
      [dummyTool(execute)],
    );
    await runResearch("調べて", deps);
    expect(execute).toHaveBeenCalledWith({});
  });

  it("未登録ツールはエラー文を結果として LLM に返し、処理を続ける", async () => {
    const { deps, calls } = setup([
      { content: null, tool_calls: [toolCall("nope", "{}")] },
      { content: "ごめんね" },
    ]);
    const res = await runResearch("調べて", deps);
    expect(res.speech).toBe("ごめんね");
    expect(calls[1].at(-1)).toMatchObject({
      role: "tool",
      content: expect.stringContaining("登録されていない"),
    });
  });

  it(`ツール呼び出しが ${TUNING.researchMaxToolSteps} 回続いたら、ツール無しでレポートを作らせる`, async () => {
    const chat = vi.fn();
    for (let i = 0; i < TUNING.researchMaxToolSteps; i++) {
      chat.mockResolvedValueOnce({ content: null, tool_calls: [toolCall("search", "{}")] });
    }
    chat.mockResolvedValueOnce({ content: "最終調査結果レポート" });
    const deps: ResearchDeps = {
      chat,
      tools: new ToolRegistry([dummyTool(async () => "晴れ")]),
      logger: { info: () => {} },
    };
    const res = await runResearch("調べて", deps);
    expect(res.speech).toBe("最終調査結果レポート");
    expect(chat).toHaveBeenCalledTimes(TUNING.researchMaxToolSteps + 1);
  });

  it("レポートを作れなければ ResearchError を投げる（タスクを失敗にするため）", async () => {
    const { deps } = setup([{ content: null, tool_calls: [toolCall("nope", "{}")] }]);
    await expect(runResearch("調べて", deps)).rejects.toBeInstanceOf(ResearchError);
    const { deps: empty } = setup([{ content: null }]);
    await expect(runResearch("調べて", empty)).rejects.toBeInstanceOf(ResearchError);
  });

  it("中止されたら次の LLM 呼び出しをしない", async () => {
    const controller = new AbortController();
    const { deps, chat } = setup(
      [{ content: null, tool_calls: [toolCall("search", "{}")] }],
      [
        dummyTool(async () => {
          controller.abort();
          return "晴れ";
        }),
      ],
    );
    await expect(runResearch("調べて", deps, controller.signal)).rejects.toThrow();
    expect(chat).toHaveBeenCalledTimes(1);
  });
});

describe("createResearchAgent", () => {
  it("調査専門エージェントを作る", async () => {
    const { deps } = setup([{ content: "調査レポート" }]);
    const agent = createResearchAgent(deps);
    expect(agent.name).toBe("research");
    const res = await agent.ask("最新の AI 動向を調べて", new AbortController().signal);
    expect(typeof res === "object" && res.speech === "調査レポート").toBe(true);
  });
});

describe("buildSystemPrompt", () => {
  it("日本時間の日時を埋め込む", () => {
    const prompt = buildSystemPrompt(new Date("2026-09-28T16:05:00Z"));
    expect(prompt).toContain("2026年9月29日");
    expect(prompt).toContain("01:05");
  });

  test("システムプロンプトの Golden テスト（位置情報なし）", () => {
    const golden = goldenIn(import.meta.url);
    const fixedDate = new Date("2026-09-29T10:00:00+09:00");
    golden("research_prompt", buildSystemPrompt(fixedDate));
  });

  test("システムプロンプトの Golden テスト（位置情報あり）", () => {
    const golden = goldenIn(import.meta.url);
    const fixedDate = new Date("2026-09-29T10:00:00+09:00");
    const location = { latitude: 35.6895, longitude: 139.6917, address: "東京都 新宿区 西新宿" };
    golden("research_prompt_with_location", buildSystemPrompt(fixedDate, location));
  });
});
