import { describe, expect, it, test, vi } from "vitest";
import type { LlmMessage, LlmResponse, ToolCall } from "../../llm/client.ts";
import { goldenIn } from "../../testing/golden.ts";
import { type ToolDefinition, ToolRegistry } from "../../tools/index.ts";
import {
  buildSystemPrompt,
  createSandboxAgent,
  runSandbox,
  type SandboxDeps,
  SandboxError,
} from "./agent.ts";

function toolCall(name: string, args: string, id = "call_1"): ToolCall {
  return { id, type: "function", function: { name, arguments: args } };
}

function setup(responses: LlmResponse[], tools: ToolDefinition[] = []) {
  const calls: LlmMessage[][] = [];
  const chat = vi.fn(async (messages: LlmMessage[]) => {
    calls.push(structuredClone(messages));
    return responses[Math.min(calls.length - 1, responses.length - 1)];
  });
  const deps: SandboxDeps = { chat, tools: new ToolRegistry(tools), logger: { info: () => {} } };
  return { deps, chat, calls };
}

describe("runSandbox", () => {
  it("complete_task ツール呼び出しで speech と report を返す", async () => {
    const { deps, calls } = setup([
      {
        content: null,
        tool_calls: [
          toolCall(
            "complete_task",
            JSON.stringify({
              speech: "計算が完了しました。",
              report: { title: "計算結果", markdown: "結果は 42 です。" },
            }),
          ),
        ],
      },
    ]);

    const res = await runSandbox("1+1を計算して", deps);
    expect(res).toEqual({
      speech: "計算が完了しました。",
      report: { title: "計算結果", markdown: "結果は 42 です。" },
    });
    expect(calls[0].map((m) => m.role)).toEqual(["system", "user"]);
    expect(calls[0][1].content).toBe("1+1を計算して");
  });

  it("ツールを実行して得た Base64 画像を report.markdown に自動補完する", async () => {
    const dummyPython: ToolDefinition = {
      name: "execute_python",
      description: "Python 実行",
      parameters: { type: "object", properties: {} },
      execute: async () => "__IMAGE_BASE64__:iVBORw0KGgoAAAANSUhEUg==\nピーク値: 100",
    };

    const { deps } = setup(
      [
        {
          content: null,
          tool_calls: [
            toolCall("execute_python", JSON.stringify({ code: "import matplotlib..." })),
          ],
        },
        {
          content: null,
          tool_calls: [
            toolCall(
              "complete_task",
              JSON.stringify({
                speech: "グラフを作成しました。",
                report: { title: "グラフ", markdown: "分析が完了しました。" },
              }),
            ),
          ],
        },
      ],
      [dummyPython],
    );

    const res = await runSandbox("グラフを描いて", deps);
    expect(res.speech).toBe("グラフを作成しました。");
    expect(res.report?.markdown).toContain(
      "![生成グラフ 1](data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==)",
    );
  });

  it("ツールを呼ばずにテキストで直接回答された場合も TaskOutput に整形して返す", async () => {
    const { deps } = setup([
      {
        content: "簡単な計算結果は 42 です。問題なく完了しました。",
        tool_calls: [],
      },
    ]);

    const res = await runSandbox("42を返して", deps);
    expect(res.speech).toBe("簡単な計算結果は 42 です。問題なく完了しました。");
  });

  it("エージェント名と説明が正しく設定されている", () => {
    const agent = createSandboxAgent({
      chat: vi.fn(),
      tools: new ToolRegistry([]),
      logger: { info: () => {} },
    });
    expect(agent.name).toBe("sandbox");
    expect(agent.description).toContain("Python");
  });

  it("buildSystemPrompt が日本時間の日時を埋め込む", () => {
    const prompt = buildSystemPrompt(new Date("2026-09-28T16:05:00Z"));
    expect(prompt).toContain("2026年9月29日");
    expect(prompt).toContain("01:05");
  });

  test("システムプロンプトの Golden テスト", () => {
    const golden = goldenIn(import.meta.url);
    const fixedDate = new Date("2026-09-29T10:00:00+09:00");
    golden("sandbox_prompt", buildSystemPrompt(fixedDate));
  });

  it("SandboxError がインスタンス化できる", () => {
    const err = new SandboxError("テストエラー");
    expect(err.message).toBe("テストエラー");
  });
});
