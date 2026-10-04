import type { TaskOutput } from "@nuage-home/shared";
import { matchScenarioOutput } from "../../eval/mock-adapter.ts";
import { ToolRegistry } from "../../tools/registry.ts";
import type { ToolDefinition } from "../../tools/types.ts";
import type { AppAgent } from "../types.ts";
import { SAMPLE_WEATHER_GRAPH_BASE64 } from "./sample-graph.ts";

/**
 * サンドボックス用のモック実行エージェント。
 */
export function createMockSandbox(delayMs: number): AppAgent {
  return {
    name: "sandbox",
    description: "Python や Shell による計算・データ分析・グラフ描画・スクリプト実行",
    ask: (instruction, signal) => delay(delayMs, signal, () => mockSandboxResult(instruction)),
  };
}

function delay<T>(delayMs: number, signal: AbortSignal, fn: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        resolve(fn());
      } catch (err) {
        reject(err);
      }
    }, delayMs);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("cancelled"));
    });
  });
}

function mockSandboxResult(instruction: string): TaskOutput {
  if (/失敗|エラー/.test(instruction)) {
    throw new Error("コード実行中にエラーが発生しました（Exit code 1）。");
  }

  return matchScenarioOutput("sandbox", instruction, (inst) => {
    const isGraph = /グラフ|プロット|描画/.test(inst);
    const markdown = [
      `# 「${inst}」の実行結果`,
      "",
      "サンドボックス環境（Python / Shell）で処理を実行しました。",
      "",
      "- 実行ステータス: 成功（Exit code: 0）",
      "- 処理結果: 計算およびデータ集計が完了しました。",
      ...(isGraph
        ? [
            "",
            "### 生成されたグラフ",
            `![実行グラフ](data:image/png;base64,${SAMPLE_WEATHER_GRAPH_BASE64})`,
          ]
        : []),
    ].join("\n");

    return {
      speech: isGraph
        ? `「${inst}」のグラフを作成しました。画面に表示しています。`
        : `「${inst}」の計算が完了しました。詳細は画面をご確認ください。`,
      report: {
        title: `「${inst}」の実行結果`,
        markdown,
      },
    };
  });
}

/**
 * 実際のコンテナを実行しないモックツール群を生成する。
 */
export function createMockSandboxTools(): ToolRegistry {
  const mockPython: ToolDefinition = {
    name: "execute_python",
    description: "サンドボックス環境内で Python 3 スクリプトを実行する（モック）",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "実行する Python コード" },
      },
      required: ["code"],
    },
    execute: async (args) => {
      const code = String(args.code ?? "");
      return `[mock python executed]\nCode: ${code.slice(0, 50)}...\nResult: 42`;
    },
  };

  const mockShell: ToolDefinition = {
    name: "execute_shell",
    description: "サンドボックス環境内で bash コマンドを実行する（モック）",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "実行する bash コマンド" },
      },
      required: ["command"],
    },
    execute: async (args) => {
      const cmd = String(args.command ?? "");
      return `[mock shell executed]\nCommand: ${cmd}\nOutput: done`;
    },
  };

  return new ToolRegistry([mockPython, mockShell]);
}
