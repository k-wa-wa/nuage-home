import { createFetchPageTool } from "./fetch-page.ts";
import { ToolRegistry } from "./registry.ts";
import { createWebSearchTool } from "./web-search.ts";

export * from "./registry.ts";
export * from "./types.ts";

/** 会話層（Live）がその場で使うツール。調査などの重い処理は専門エージェントに任せるため空とする */
export function createLiveTools(): ToolRegistry {
  return new ToolRegistry([]);
}

/** 調査エージェントが使うツール。ページ本文の取得を含む */
export function createResearchTools(bwproxyUrl: string): ToolRegistry {
  return new ToolRegistry([createWebSearchTool(bwproxyUrl), createFetchPageTool(bwproxyUrl)]);
}
