/**
 * 設定。既定値は持たず、無ければ起動時にエラーにする。
 */

function required(name: keyof ImportMetaEnv): string {
  const value = import.meta.env[name]?.trim();
  if (!value) throw new Error(`${name} is required (packages/frontend/.env.example を参照)`);
  return value;
}

/** backend の WebSocket のベース URL（例: ws://localhost:8787） */
const rawBackendUrl = required("VITE_BACKEND_URL").replace(/\/$/, "");

/** 他端末（スマホ等）や HTTPS 実行時に WebSocket ホストを自動追従させる */
function resolveBackendUrl(url: string): string {
  if (typeof window === "undefined") return url;
  try {
    const isHttps = window.location.protocol === "https:";
    const proto = isHttps ? "wss:" : "ws:";

    // HTTPS 動作時は Mixed Content を防ぐため、同一オリジンの Vite プロキシ経由で接続
    if (isHttps) {
      return `${proto}//${window.location.host}`;
    }

    const parsed = new URL(url);
    if (
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1"
    ) {
      parsed.hostname = window.location.hostname;
      return parsed.toString().replace(/\/$/, "");
    }
  } catch {
    // URL パースに失敗した場合はそのまま返す
  }
  return url;
}

const backendUrl = resolveBackendUrl(rawBackendUrl);

export const config = {
  /** 音声モードの会話 */
  voiceWsUrl: `${backendUrl}/ws/live`,
  /** サンドボックスの会話 */
  sandboxWsUrl: `${backendUrl}/ws/sandbox`,
};

/** 画面・音声認識の言語。アシスタントは日本語専用 */
export const LANG = "ja-JP";
