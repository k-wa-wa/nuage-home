import type { TaskOutput } from "@nuage-home/shared";
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
  if (/カーテン/.test(instruction)) {
    return { speech: "カーテンの開閉操作を実行したよ。スムーズに動作完了したよ。" };
  }
  if (/フロアライト|テープライト|ライト|電気|照明/.test(instruction)) {
    const action = /消|オフ|off/i.test(instruction) ? "消灯" : "点灯";
    return { speech: `フロアライトおよびテープライトを${action}したよ。` };
  }
  if (/電球|グループ|シーン/.test(instruction)) {
    const action = /消|オフ|off/i.test(instruction) ? "一括消灯" : "一括点灯";
    return { speech: `スマート電球グループのシーンを実行して、${action}したよ。` };
  }
  return { speech: "指定された家電デバイスの操作コマンドを実行したよ。" };
}
