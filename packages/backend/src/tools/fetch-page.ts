import { TUNING } from "../constants.ts";
import { fetchViaBwproxy, htmlToText } from "./bwproxy.ts";
import type { ToolDefinition } from "./types.ts";

export interface FetchPageArgs extends Record<string, unknown> {
  url?: string;
}

/**
 * ページ本文の取得ツール。bwproxy 経由でページを読み、本文テキストを返す。
 * 本文は長いため、調査エージェント専用とし、会話層（Live）には渡さない。
 */
export function createFetchPageTool(bwproxyUrl: string): ToolDefinition<FetchPageArgs> {
  return {
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
      const url = typeof args.url === "string" ? args.url.trim() : "";
      if (!/^https?:\/\//.test(url)) return "http または https の URL を指定すること。";
      const text = htmlToText(await fetchViaBwproxy(bwproxyUrl, url));
      const max = TUNING.bwproxy.pageMaxChars;
      return text.length > max ? `${text.slice(0, max)}\n（以下省略。全 ${text.length} 字）` : text;
    },
  };
}
