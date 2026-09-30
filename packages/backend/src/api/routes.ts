import type { ConversationModes } from "@nuage-home/shared";
import type { FastifyInstance } from "fastify";
import { createMockAutopilot } from "../agents/mock.ts";
import type { AppAgent } from "../agents/types.ts";
import type { Config } from "../config.ts";
import type { OrchestrationHub } from "../conversation/hub.ts";
import { GeminiLivePort } from "../live/gemini.ts";
import { MockLivePort } from "../live/mock.ts";
import type { LivePort } from "../live/port.ts";
import type { Summarizer } from "../tasks/summarizer.ts";
import { plainSummarizer } from "../tasks/summarizer.ts";
import { attachConversation } from "./conversation-socket.ts";

export interface RouteDeps {
  config: Config;
  /** タスクと通知。音声モードとサンドボックスで分ける */
  voiceHub: OrchestrationHub;
  sandboxHub: OrchestrationHub;
  researchAgent: AppAgent;
  llmSummarizer: Summarizer;
}

/** サンドボックスのツール（専門エージェント）はモック固定。処理時間だけ選べる */
const SANDBOX_TASK_DELAYS_MS = [3000, 8000, 15_000, 30_000];

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get("/", async () => ({
    status: "ok",
    tools: ["add_task", "task_status", "cancel_task"],
    apps: [deps.researchAgent.name],
  }));

  // 音声モード: すべて本物
  app.get("/ws/live", { websocket: true }, (socket) => {
    attachConversation(
      socket,
      {
        modes: { live: "gemini", llm: "real", tool: "real" },
        live: new GeminiLivePort(deps.config.geminiLive),
        hub: deps.voiceHub,
        apps: [deps.researchAgent],
        summarize: deps.llmSummarizer,
      },
      (err) => app.log.error({ err }, "failed to start voice conversation"),
    );
  });

  // サンドボックス: Live と LLM は接続時のクエリで選ぶ。ツールはモック固定
  app.get("/ws/sandbox", { websocket: true }, (socket, req) => {
    const query = req.query as Record<string, string | undefined>;
    const modes: ConversationModes = {
      live: query.live === "gemini" ? "gemini" : "mock",
      llm: query.llm === "real" ? "real" : "mock",
      tool: "mock",
    };
    const delay = Number(query.delay);
    if (!SANDBOX_TASK_DELAYS_MS.includes(delay)) {
      socket.send(
        JSON.stringify({
          type: "error",
          message: `delay は ${SANDBOX_TASK_DELAYS_MS.join(" / ")} のいずれか`,
        }),
      );
      socket.close();
      return;
    }
    const live: LivePort =
      modes.live === "gemini" ? new GeminiLivePort(deps.config.geminiLive) : new MockLivePort();
    attachConversation(
      socket,
      {
        modes,
        live,
        hub: deps.sandboxHub,
        apps: [createMockAutopilot(delay)],
        summarize: modes.llm === "real" ? deps.llmSummarizer : plainSummarizer,
      },
      (err) => app.log.error({ err }, "failed to start sandbox conversation"),
    );
  });
}
