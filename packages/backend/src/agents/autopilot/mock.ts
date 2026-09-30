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

function mockAutopilotResult(instruction: string): string {
  if (/止ま|なぜ|原因|落ち/.test(instruction)) {
    return [
      "PR #123 (feat: sandbox mode) は e2e テスト (playwright) のタイムアウトで CI が失敗して止まっている。",
      "直近 3 回のうち 2 回で同じテストが落ちており、flaky の可能性が高い。再実行すれば通る見込み。",
      "詳細: https://github.com/k-wa-wa/nuage-home/actions/runs/0000",
    ].join("\n");
  }
  if (/進め|OK|承認|マージ/.test(instruction)) {
    return "Issue #45 に「OK」とコメントした。実装ジョブがキューに入り、20 分ほどで PR が作られる見込み。";
  }
  if (/失敗|エラー/.test(instruction)) {
    throw new Error("autopilot に接続できなかった。");
  }
  return "自分の番になっているカードが 2 件ある。1 件は仕様確認待ちの Issue #45、もう 1 件はマージ判断待ちの PR #120。実行中のジョブは 1 件。";
}
