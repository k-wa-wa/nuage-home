import type { TaskOutput } from "@nuage-home/shared";
import { matchScenarioOutput } from "../../eval/mock-adapter.ts";
import { ToolRegistry } from "../../tools/registry.ts";
import type { ToolDefinition } from "../../tools/types.ts";
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

/**
 * 外部検索を行わないモック調査ツール群を生成する。
 */
export function createMockResearchTools(): ToolRegistry {
  const mockWebSearch: ToolDefinition = {
    name: "web_search",
    description:
      "Web 上の最新情報・ニュース・話題を検索し、上位の結果（タイトル・URL・抜粋）を得る",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "検索キーワード（空白区切り）" },
      },
      required: ["query"],
    },
    execute: async (args) => {
      const q = String(args.query ?? "");
      return `1. ${q}に関する最新動向\n   https://example.com/1\n   ${q}についての概要と調査結果の抜粋である。`;
    },
  };

  const mockFetchPage: ToolDefinition = {
    name: "fetch_page",
    description:
      "Web ページを開いて本文を読む。web_search で見つけたページの詳細を確認するときに使う",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "読むページの URL（http または https）" },
      },
      required: ["url"],
    },
    execute: async (args) => {
      const url = String(args.url ?? "");
      return `${url} のページ本文: 調査に必要な詳細情報と関連データが記載されている。`;
    },
  };

  return new ToolRegistry([mockWebSearch, mockFetchPage]);
}
