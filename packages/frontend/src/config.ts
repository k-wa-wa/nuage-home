/**
 * 設定。既定値は持たず、無ければ起動時にエラーにする。
 */

function required(name: keyof ImportMetaEnv): string {
  const value = import.meta.env[name]?.trim();
  if (!value) throw new Error(`${name} is required (packages/frontend/.env.example を参照)`);
  return value;
}

/** backend の WebSocket のベース URL（例: ws://localhost:8787） */
const backendUrl = required("VITE_BACKEND_URL").replace(/\/$/, "");

export const config = {
  /** 音声モードの会話 */
  voiceWsUrl: `${backendUrl}/ws/live`,
  /** サンドボックスの会話 */
  sandboxWsUrl: `${backendUrl}/ws/sandbox`,
};

/** 画面・音声認識の言語。アシスタントは日本語専用 */
export const LANG = "ja-JP";
