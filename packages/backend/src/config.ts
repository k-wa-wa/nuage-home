import fs from "node:fs"
import path from "node:path"
import type { LlmClientOptions } from "./llm-client.ts"

// .env ファイルの自動読み込み（カレントディレクトリおよび上位ディレクトリ）
for (const envRelPath of [".env", "../../.env", "../.env"]) {
  const envFullPath = path.resolve(process.cwd(), envRelPath)
  if (fs.existsSync(envFullPath)) {
    try {
      process.loadEnvFile(envFullPath)
    } catch {
      // 構文エラー等があっても無視する
    }
  }
}

export interface Config {
  port: number
  llm: LlmClientOptions
  // LiteLLM に繋がらなくても UI を検証できるよう既定はモック。LITELLM_MOCK=false で実 LLM を使う
  useMockLlm: boolean
}

export const config: Config = {
  port: Number(process.env.PORT ?? 8787),
  llm: {
    baseUrl: process.env.LITELLM_BASE_URL ?? "https://litellm.wpcapp.net",
    apiKey: process.env.LITELLM_API_KEY ?? "dummy",
    model: process.env.LITELLM_MODEL ?? "auto",
  },
  useMockLlm: process.env.LITELLM_MOCK !== "false",
}
