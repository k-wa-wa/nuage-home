export const config = {
  lang: import.meta.env.VITE_LANG ?? "ja-JP",
  backendWsUrl: import.meta.env.VITE_BACKEND_WS_URL ?? "ws://localhost:8787/ws",
}
