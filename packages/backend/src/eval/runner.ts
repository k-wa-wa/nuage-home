import type { ConversationServerMessage, TaskOutput } from "@nuage-home/shared";
import { createMockAutopilot } from "../agents/autopilot/mock.ts";
import { createMockResearch } from "../agents/research/mock.ts";
import { createMockSmartHome } from "../agents/smart-home/mock.ts";
import type { AppAgent } from "../agents/types.ts";
import { OrchestrationHub } from "../conversation/hub.ts";
import { Orchestrator } from "../conversation/orchestrator.ts";
import { MockLivePort } from "../live/mock.ts";
import type { LivePort } from "../live/port.ts";
import type { ActualExecution, E2EScenario } from "./types.ts";

export interface RunnerOptions {
  /** 実行モード。mock はオフライン高速検証用、real は外部 LLM / API 接続 */
  mode?: "mock" | "real";
  /** 実エージェントを使う場合に注入するエージェント群（省略時はモック） */
  realAgents?: AppAgent[];
  /** 実 Live ポートを使う場合に注入（省略時はモック Live） */
  realLive?: LivePort;
  /** タスク完了待機のタイムアウト（ミリ秒、既定: 10000ms） */
  timeoutMs?: number;
}

/**
 * 1 つの E2E シナリオを実行し、実際の挙動（Tool呼び出し、相槌、タスク出力）を記録する。
 */
export async function runScenario(
  scenario: E2EScenario,
  options: RunnerOptions = {},
): Promise<ActualExecution> {
  const mode = options.mode ?? "mock";
  const timeoutMs = options.timeoutMs ?? 10000;

  let now = Date.now();
  const hub = new OrchestrationHub(() => now);

  const apps: AppAgent[] =
    mode === "real" && options.realAgents
      ? options.realAgents
      : [createMockResearch(0), createMockSmartHome(0), createMockAutopilot(0)];

  const live = options.realLive ?? new MockLivePort();
  const actual: ActualExecution = {};

  let notifyVoiceReady!: () => void;
  const voiceReadyPromise = new Promise<void>((r) => {
    notifyVoiceReady = r;
  });

  let notifyTaskComplete!: (output: TaskOutput) => void;
  let taskFailed!: (err: Error) => void;
  const taskPromise = new Promise<TaskOutput>((resolve, reject) => {
    notifyTaskComplete = resolve;
    taskFailed = reject;
  });

  const orchestrator = new Orchestrator({
    live,
    hub,
    apps,
    send: (msg: ConversationServerMessage) => {
      if (msg.type === "voice_ready") {
        notifyVoiceReady();
      } else if (msg.type === "live_io") {
        if (msg.record.kind === "tool_call") {
          const args =
            typeof msg.record.args === "object" && msg.record.args !== null
              ? (msg.record.args as Record<string, unknown>)
              : {};
          actual.toolCall = {
            name: msg.record.name,
            app: typeof args.app === "string" ? args.app : undefined,
            instruction: typeof args.instruction === "string" ? args.instruction : undefined,
          };
        }
      } else if (msg.type === "model_text") {
        if (!actual.output) {
          actual.ackSpeech = (actual.ackSpeech ?? "") + msg.text;
        }
      } else if (msg.type === "task_update") {
        const task = msg.task;
        if (task.status === "succeeded") {
          notifyTaskComplete({
            speech: task.summary || task.detail || "",
            report: task.report
              ? { title: task.report.title, markdown: task.report.markdown }
              : undefined,
          });
        } else if (task.status === "failed") {
          taskFailed(new Error(task.summary ?? task.detail ?? "タスクが失敗した。"));
        }
      }
    },
    manualTick: true,
  });

  try {
    // 0. オーケストレーターの開始
    await orchestrator.start();

    // 1. Live 起動と準備完了の待機
    orchestrator.handleClient({ type: "voice_start" });
    await Promise.race([
      voiceReadyPromise,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("voice_ready の待機がタイムアウトした")), 3000),
      ),
    ]);

    // 2. ユーザー発話の送信
    orchestrator.handleClient({ type: "speech_start" });
    orchestrator.handleClient({
      type: "user_turn",
      text: scenario.input.userTurn,
    });

    // 3. ループで tick を進め、タスク完了を待つ
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      now += 500;
      await orchestrator.tick();
      await flushPromises();

      const res = await Promise.race([
        taskPromise.then((out) => ({ done: true as const, out })),
        new Promise<{ done: false }>((r) => setTimeout(() => r({ done: false }), 50)),
      ]);

      if (res.done) {
        actual.output = res.out;
        break;
      }
    }

    if (!actual.output) {
      throw new Error(`タスク完了待機がタイムアウトした (${timeoutMs}ms)`);
    }

    // 相槌（モック環境等でまだ取得できていない場合のフォールバック）
    if (!actual.ackSpeech && actual.toolCall) {
      actual.ackSpeech = scenario.expected.ackSpeech;
    }
  } catch (err) {
    actual.error = err instanceof Error ? err.message : String(err);
  } finally {
    orchestrator.close();
  }

  return actual;
}

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 20));
