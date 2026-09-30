import type { AppAgent } from "../types.ts";

/**
 * サンドボックス用のモック調査エージェント。
 */
export function createMockResearch(delayMs: number): AppAgent {
  return {
    name: "research",
    description: "Web 検索を使った詳しい調査・分析・比較",
    ask: (instruction, signal) => delay(delayMs, signal, () => mockResearchResult(instruction)),
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

function mockResearchResult(instruction: string): string {
  if (/失敗|エラー/.test(instruction)) {
    throw new Error("Web 検索エンジンの応答がタイムアウトした。");
  }
  if (/京都|紅葉/.test(instruction)) {
    return [
      "京都の紅葉の調査結果をまとめた。",
      "東福寺（通天橋）や永観堂は 11 月中旬から下旬に見頃を迎える見込み。",
      "混雑を避けるなら、朝 8 時台の早朝拝観や嵐山方面の郊外寺院がおすすめである。",
    ].join("\n");
  }
  if (/嵐山|昼|ご飯|ランチ/.test(instruction)) {
    return "嵐山周辺のお昼ご飯の候補を調査した。渡月橋近くの湯豆腐店や、竹林の小径手前の手打ち蕎麦処が評価が高い。人気店は事前のWEB整理券取得が推奨される。";
  }
  return `「${instruction}」について Web 検索を行い、複数の情報源から要点をまとめた。最新動向を含め問題なく確認できた。`;
}
