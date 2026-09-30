import websocketPlugin from "@fastify/websocket";
import Fastify from "fastify";
import { createResearchAgent } from "./agents/research.ts";
import { registerRoutes } from "./api/routes.ts";
import { loadConfig } from "./config.ts";
import { TUNING } from "./constants.ts";
import { OrchestrationHub } from "./conversation/hub.ts";
import { createLiteLlmChat } from "./llm/client.ts";
import { createLlmSummarizer, plainSummarizer, withFallback } from "./tasks/summarizer.ts";
import { createLiveTools, createResearchTools } from "./tools/index.ts";

const config = loadConfig();
const app = Fastify({ logger: true });
await app.register(websocketPlugin);

const chat = createLiteLlmChat(config.llm);
const summaryChat = createLiteLlmChat({ ...config.llm, model: config.summaryModel });

registerRoutes(app, {
  config,
  voiceHub: new OrchestrationHub(),
  sandboxHub: new OrchestrationHub(),
  researchAgent: createResearchAgent({
    chat,
    tools: createResearchTools(config.searxngUrl, config.bwproxyUrl),
    logger: app.log,
  }),
  liveTools: createLiveTools(),
  llmSummarizer: withFallback(
    createLlmSummarizer(summaryChat),
    plainSummarizer,
    TUNING.summaryTimeoutMs,
  ),
});

await app.listen({ port: config.port, host: "0.0.0.0" });
