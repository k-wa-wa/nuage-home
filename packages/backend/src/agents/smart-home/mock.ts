import type { TaskOutput } from "@nuage-home/shared";
import { matchScenarioOutput } from "../../eval/mock-adapter.ts";
import type { AppAgent } from "../types.ts";

/**
 * サンドボックス用のモック家電操作エージェント。
 */
export function createMockSmartHome(delayMs: number): AppAgent {
  return {
    name: "smart_home",
    description: "照明（フロアライト・電球・テープライト）やカーテン等の家電操作",
    ask: (instruction, signal) => delay(delayMs, signal, () => mockSmartHomeResult(instruction)),
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

function mockSmartHomeResult(instruction: string): TaskOutput {
  if (/失敗|エラー/.test(instruction)) {
    throw new Error("SwitchBot デバイスが応答しなかった。");
  }
  return matchScenarioOutput("smart_home", instruction, () => ({
    speech: "指定された家電デバイスの操作コマンドを実行したよ。",
  }));
}
