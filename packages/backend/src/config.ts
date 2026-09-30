import path from "node:path";
import dotenv from "dotenv";
import { GEMINI_LIVE } from "./constants.ts";

/**
 * 環境変数から設定を読む。既定値は持たず、無ければ起動時にエラーにする。
 * 環境で変える必要のない調整値は constants.ts に置く。
 */

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface Config {
  port: number;
  llm: LlmConfig;
  /** 結果の要約に使うモデル（LiteLLM のモデル名）。応答の速いものを選ぶ */
  summaryModel: string;
  /** bare-web-proxy のベース URL（ページ取得） */
  bwproxyUrl: string;
  /** SearXNG のベース URL（Web 検索） */
  searxngUrl: string;
  geminiLive: {
    model: string;
    /** LiteLLM の Gemini Live パススルー（LITELLM_BASE_URL から導く） */
    wsUrl: string;
  };
}

export function loadConfig(): Config {
  dotenv.config();
  dotenv.config({ path: path.resolve(import.meta.dirname, "../.env") });
  const port = Number(required("PORT"));
  if (!Number.isInteger(port)) throw new Error(`PORT must be an integer: ${process.env.PORT}`);
  const llm = {
    baseUrl: required("LITELLM_BASE_URL"),
    apiKey: required("LITELLM_API_KEY"),
    model: required("LITELLM_MODEL"),
  };
  const geminiLiveBaseUrl = process.env.GEMINI_LIVE_BASE_URL?.trim() || llm.baseUrl;
  return {
    port,
    llm,
    summaryModel: required("LITELLM_SUMMARY_MODEL"),
    bwproxyUrl: required("BWPROXY_URL").replace(/\/$/, ""),
    searxngUrl: required("SEARXNG_URL").replace(/\/$/, ""),
    geminiLive: {
      model: required("GEMINI_LIVE_MODEL"),
      wsUrl: `${geminiLiveBaseUrl.replace(/^http/, "ws").replace(/\/$/, "")}${GEMINI_LIVE.wsPath}`,
    },
  };
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required (packages/backend/.env.example を参照)`);
  return value;
}
