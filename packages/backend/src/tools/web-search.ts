import { TUNING } from "../constants.ts";
import { fetchViaSearxng } from "./searxng.ts";
import type { ToolDefinition } from "./types.ts";

export interface WebSearchArgs extends Record<string, unknown> {
  query?: string;
}

/**
 * Web 検索ツール。SearXNG 経由で検索し、上位の結果（タイトル・URL・抜粋）を返す。
 */
export function createWebSearchTool(searxngUrl: string): ToolDefinition<WebSearchArgs> {
  return {
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
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) return "検索キーワードが指定されていない。";
      try {
        const results = await fetchViaSearxng(searxngUrl, query);
        if (results.length === 0)
          return `「${query}」の検索結果は見つからなかった。別のキーワードや言い換えで再検索すること。`;
        return results
          .slice(0, TUNING.searxng.searchResults)
          .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
          .join("\n");
      } catch (err) {
        return `検索中にエラーが発生した（${err instanceof Error ? err.message : String(err)}）。別のキーワードで再検索するか、別の手段を検討すること。`;
      }
    },
  };
}
