import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
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
