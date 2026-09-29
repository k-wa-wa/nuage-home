import { createFetchPageTool } from "./fetch-page.ts"
import { ToolRegistry } from "./registry.ts"
import { weatherTool } from "./weather.ts"
import { createWebSearchTool } from "./web-search.ts"
import { wikipediaTool } from "./wikipedia.ts"

export * from "./registry.ts"
export * from "./types.ts"

/** 会話層（Live）がその場で使うツール。結果が短いものに限る */
export function createLiveTools(bwproxyUrl: string): ToolRegistry {
  return new ToolRegistry([weatherTool, wikipediaTool, createWebSearchTool(bwproxyUrl)])
}

/** 調査エージェントが使うツール。ページ本文の取得を含む */
export function createResearchTools(bwproxyUrl: string): ToolRegistry {
  return new ToolRegistry([weatherTool, wikipediaTool, createWebSearchTool(bwproxyUrl), createFetchPageTool(bwproxyUrl)])
}
