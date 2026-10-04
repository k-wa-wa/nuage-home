import type { TaskOutput } from "@nuage-home/shared";
import { matchScenarioOutput } from "../../eval/mock-adapter.ts";
import type { AppAgent } from "../types.ts";

/**
 * サンドボックス用のモック調査エージェント。
 */
export function createMockResearch(delayMs: number): AppAgent {
  return {
    name: "research",
    description: "Web 検索を使った詳しい調査・分析・比較",
    ask: (instruction, signal) => delay(delayMs, signal, () => mockResearchResult(instruction)),
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

function mockResearchResult(instruction: string): TaskOutput {
  if (/失敗|エラー/.test(instruction)) {
    throw new Error("Web 検索エンジンの応答がタイムアウトした。");
  }

  return matchScenarioOutput("research", instruction, (inst) => {
    const markdown = [
      `# 「${inst}」の調査レポート`,
      "",
      "Web 検索を通じて最新の動向と複数ソースの情報を照合・分析した。",
      "",
      "- 主要なポイントについて確認を完了した。",
      "- 詳細情報や関連リンクは適宜参照されたい。",
    ].join("\n");

    return {
      speech: `「${inst}」の調査が完了しました。主要なポイントを画面にまとめました。`,
      report: {
        title: `「${inst}」の調査レポート`,
        markdown,
      },
    };
  });
}
