export const config = {
  lang: import.meta.env.VITE_LANG ?? "ja-JP",
  backendWsUrl: import.meta.env.VITE_BACKEND_WS_URL ?? "ws://localhost:8787/ws",
  backendLiveWsUrl: import.meta.env.VITE_BACKEND_LIVE_WS_URL ?? "ws://localhost:8787/ws/live",
  useLiveMode: import.meta.env.VITE_USE_LIVE_MODE !== "false",
}
