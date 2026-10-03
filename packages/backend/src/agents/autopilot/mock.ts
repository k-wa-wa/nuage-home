import type { TaskOutput } from "@nuage-home/shared";
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
  if (/止ま|なぜ|原因|落ち/.test(instruction)) {
    return {
      speech: "プルリクエストはテストのタイムアウトで止まっているよ。再実行すれば通る見込みだよ。",
    };
  }
  if (/進め|OK|承認|マージ/.test(instruction)) {
    return {
      speech: "イシューに了解とコメントしたよ。実装ジョブがキューに入ったよ。",
    };
  }
  return {
    speech: "自分の番になっているカードが2件あるよ。仕様確認待ちとマージ判断待ちだよ。",
  };
}
