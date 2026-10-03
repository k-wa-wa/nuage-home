import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        // タスク・通知の統制をテキストで体験するサンドボックス（docs/design/voice-task-orchestration.md）
        sandbox: resolve(import.meta.dirname, "sandbox.html"),
      },
    },
  },
});
