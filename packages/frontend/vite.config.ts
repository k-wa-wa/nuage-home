import { globSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import qrcodeTerminal from "qrcode-terminal";
import { defineConfig, type Plugin } from "vite";

/** LAN からスマホ等でアクセスするための IPv4 アドレス */
function getLanIp(): string | null {
  for (const iface of Object.values(networkInterfaces())) {
    for (const addr of iface ?? []) {
      if (addr.family === "IPv4" && !addr.internal) return addr.address;
    }
  }
  return null;
}

function qrcodePlugin(): Plugin {
  return {
    name: "vite-plugin-terminal-qrcode",
    configureServer(server) {
      server.httpServer?.once("listening", () => {
        const lanIp = getLanIp();
        const address = server.httpServer?.address();
        const port = typeof address === "object" && address ? address.port : 5173;
        const protocol = server.config.server.https ? "https" : "http";
        if (lanIp) {
          const lanUrl = `${protocol}://${lanIp}:${port}/`;
          setTimeout(() => {
            console.log("\n  📱 スマホ等でスキャンしてアクセス（HTTPS）:");
            qrcodeTerminal.generate(lanUrl, { small: true }, (qr: string) => {
              console.log(qr);
            });
            console.log(`  LAN URL: ${lanUrl}\n`);
          }, 150);
        }
      });
    },
  };
}

// プロジェクト直下の全 HTML ファイルを動的に収集（新規 HTML 追加時も config 修正不要）
const htmlEntries = Object.fromEntries(
  globSync("*.html", { cwd: import.meta.dirname }).map((file) => {
    const name = file.replace(/\.html$/, "");
    return [name === "index" ? "main" : name, resolve(import.meta.dirname, file)];
  }),
);

export default defineConfig({
  plugins: [react(), basicSsl(), qrcodePlugin()],
  server: {
    host: true, // 0.0.0.0 でリッスンして他端末（LAN）からのアクセスを許可
    proxy: {
      // バックエンドへの WebSocket を Vite 経由でプロキシ（Mixed Content エラー防止）
      "/ws": {
        target: "ws://localhost:8787",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      input: htmlEntries,
    },
  },
});
