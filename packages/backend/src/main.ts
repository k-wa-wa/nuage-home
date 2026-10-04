import websocketPlugin from "@fastify/websocket";
import Fastify from "fastify";
import { createResearchAgent, createResearchTools } from "./agents/research/index.ts";
import { createSandboxAgent, createSandboxTools } from "./agents/sandbox/index.ts";
import {
  createSmartHomeAgent,
  createSmartHomeTools,
  SwitchBotClient,
} from "./agents/smart-home/index.ts";
import { registerRoutes } from "./api/routes.ts";
import { loadConfig } from "./config.ts";
import { TUNING } from "./constants.ts";
import { OrchestrationHub } from "./conversation/hub.ts";
import { createLiteLlmChat } from "./llm/client.ts";
import { createLlmSummarizer, plainSummarizer, withFallback } from "./tasks/summarizer.ts";
import { createKubectlExecutor } from "./tools/sandbox.ts";

const config = loadConfig();
const app = Fastify({ logger: true });
await app.register(websocketPlugin);

const chat = createLiteLlmChat(config.llm);

registerRoutes(app, {
  config,
  voiceHub: new OrchestrationHub(),
  sandboxHub: new OrchestrationHub(),
  apps: [
    createResearchAgent({
      chat,
      tools: createResearchTools(config.searxngUrl, config.bwproxyUrl),
      logger: app.log,
    }),
    ...(config.switchbot
      ? [
          createSmartHomeAgent({
            chat,
            tools: createSmartHomeTools(new SwitchBotClient(config.switchbot)),
            logger: app.log,
          }),
        ]
      : []),
    ...(config.sandbox
      ? [
          createSandboxAgent({
            chat,
            tools: createSandboxTools(
              createKubectlExecutor(config.sandbox.target, config.sandbox.namespace),
            ),
            logger: app.log,
          }),
        ]
      : []),
  ],
  llmSummarizer: withFallback(createLlmSummarizer(chat), plainSummarizer, TUNING.summaryTimeoutMs),
});

await app.listen({ port: config.port, host: "0.0.0.0" });
