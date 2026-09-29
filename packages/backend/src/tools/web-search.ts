import { TUNING } from "../constants.ts";
import { fetchViaBwproxy, parseYahooResults, yahooSearchUrl } from "./bwproxy.ts";
import type { ToolDefinition } from "./types.ts";

/**
 * Web 検索ツール。bwproxy 経由で Yahoo! JAPAN を検索し、上位の結果（タイトル・URL・抜粋）を返す。
 */
export function createWebSearchTool(bwproxyUrl: string): ToolDefinition {
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
      const results = parseYahooResults(await fetchViaBwproxy(bwproxyUrl, yahooSearchUrl(query)));
      if (results.length === 0)
        return `「${query}」の検索結果は見つからなかった。別のキーワードで試すこと。`;
      return results
        .slice(0, TUNING.bwproxy.searchResults)
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
        .join("\n");
    },
  };
}
