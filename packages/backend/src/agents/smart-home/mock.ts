import type { TaskOutput } from "@nuage-home/shared";
import { matchScenarioOutput } from "../../eval/mock-adapter.ts";
import type { AppAgent } from "../types.ts";
import type { SwitchBotClient } from "./client.ts";
import { createSmartHomeTools } from "./tools.ts";

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
    speech: "指定された家電デバイスの操作コマンドを実行しました。",
  }));
}

/**
 * 外部 API を呼び出さないモック家電操作ツール群を生成する。
 */
export function createMockSmartHomeTools() {
  const mockClient = {
    getDevices: async () => [
      { deviceId: "d-floor", deviceName: "フロアライト", deviceType: "Floor Lamp" },
      { deviceId: "d-curtain", deviceName: "カーテン", deviceType: "Curtain3" },
      { deviceId: "d-strip", deviceName: "テープライト", deviceType: "Strip Light" },
    ],
    getScenes: async () => [
      { sceneId: "s-bulbs-off", sceneName: "電球グループOFF" },
      { sceneId: "s-bulbs-on", sceneName: "電球グループON" },
    ],
    sendCommand: async () => {},
    executeScene: async () => {},
  };

  return createSmartHomeTools(mockClient as unknown as SwitchBotClient);
}
