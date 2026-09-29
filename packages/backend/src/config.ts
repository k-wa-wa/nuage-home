import fs from "node:fs"
import path from "node:path"
import { GEMINI_LIVE } from "./constants.ts"

/**
 * 環境変数から設定を読む。既定値は持たず、無ければ起動時にエラーにする。
 * 環境で変える必要のない調整値は constants.ts に置く。
 */

export interface LlmConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export interface Config {
  port: number
  llm: LlmConfig
  /** 結果の要約に使うモデル（LiteLLM のモデル名）。応答の速いものを選ぶ */
  summaryModel: string
  /** bare-web-proxy のベース URL（Web 検索・ページ取得） */
  bwproxyUrl: string
  geminiLive: {
    model: string
    /** LiteLLM の Gemini Live パススルー（LITELLM_BASE_URL から導く） */
    wsUrl: string
  }
}

export function loadConfig(): Config {
  loadEnvFiles()
  const port = Number(required("PORT"))
  if (!Number.isInteger(port)) throw new Error(`PORT must be an integer: ${process.env.PORT}`)
  const llm = {
    baseUrl: required("LITELLM_BASE_URL"),
    apiKey: required("LITELLM_API_KEY"),
    model: required("LITELLM_MODEL"),
  }
  return {
    port,
    llm,
    summaryModel: required("LITELLM_SUMMARY_MODEL"),
    bwproxyUrl: required("BWPROXY_URL").replace(/\/$/, ""),
    geminiLive: {
      model: required("GEMINI_LIVE_MODEL"),
      wsUrl: `${llm.baseUrl.replace(/^http/, "ws").replace(/\/$/, "")}${GEMINI_LIVE.wsPath}`,
    },
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required (packages/backend/.env.example を参照)`)
  return value
}

/** カレントディレクトリおよび上位ディレクトリの .env を読み込む */
function loadEnvFiles(): void {
  for (const rel of [".env", "../.env", "../../.env"]) {
    const full = path.resolve(process.cwd(), rel)
    if (fs.existsSync(full)) process.loadEnvFile(full)
  }
}
