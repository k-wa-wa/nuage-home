import type { TaskOutput } from "@nuage-home/shared";
import { matchScenarioOutput } from "../../eval/mock-adapter.ts";
import type { AppAgent } from "../types.ts";

/**
 * サンドボックス用のモック autopilot エージェント。
 */
export function createMockAutopilot(delayMs: number): AppAgent {
  return {
    name: "autopilot",
    description: "開発タスク（GitHub の Issue と PR）の状況確認・調査・指示",
    ask: (instruction, signal) => delay(delayMs, signal, () => mockAutopilotResult(instruction)),
  };
}

function delay<T>(delayMs: number, signal: AbortSignal, fn: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        resolve(fn());
      } catch (err) {
        reject(err);
      }
    }, delayMs);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("cancelled"));
    });
  });
}

function mockAutopilotResult(instruction: string): TaskOutput {
  if (/失敗|エラー/.test(instruction)) {
    throw new Error("autopilot に接続できなかった。");
  }
  return matchScenarioOutput("autopilot", instruction, () => ({
    speech: "開発タスクの確認が完了したよ。",
  }));
}
