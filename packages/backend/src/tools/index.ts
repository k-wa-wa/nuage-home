import { createFetchPageTool } from "./fetch-page.ts";
import { ToolRegistry } from "./registry.ts";
import { createWebSearchTool } from "./web-search.ts";

export * from "./registry.ts";
export * from "./types.ts";

/** 調査エージェントが使うツール。Web 検索とページ本文の取得を含む */
export function createResearchTools(searxngUrl: string, bwproxyUrl: string): ToolRegistry {
  return new ToolRegistry([createWebSearchTool(searxngUrl), createFetchPageTool(bwproxyUrl)]);
}
