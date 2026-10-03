import type { TaskOutput } from "@nuage-home/shared";
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

function mockResearchResult(instruction: string): TaskOutput {
  if (/失敗|エラー/.test(instruction)) {
    throw new Error("Web 検索エンジンの応答がタイムアウトした。");
  }
  if (/京都|紅葉/.test(instruction)) {
    const markdown = [
      "# 京都の紅葉 調査レポート",
      "",
      "2026年秋の京都における紅葉の見頃と主要スポットの混雑状況を調査した。",
      "",
      "## 1. 見頃の時期と主要スポット",
      "- **東福寺（通天橋）**: 11月中旬〜下旬。渓谷一面のカエデが見事な景観。",
      "- **永観堂（禅林寺）**: 11月中旬〜11月下旬。「秋は紅葉の永観堂」と称される名所。夜間ライトアップも実施予定。",
      "- **嵐山・天龍寺**: 11月下旬〜12月上旬。渡月橋の借景と曹源池庭園のカエデが調和。",
      "",
      "## 2. 混雑対策とおすすめルート",
      "混雑を避けるなら、**朝8時台の早朝特別拝観**や、洛北（大原・貴船方面）の寺院が適している。",
      "",
      "> [!TIP]",
      "> 主要寺院の特別拝観チケットは事前のオンライン予約を活用すると待ち時間を大幅に短縮できる。",
      "",
      "詳細は [京都観光オフィシャルサイト](https://kyoto.travel/ja/) を参照のこと。",
    ].join("\n");

    return {
      speech:
        "京都の紅葉の調査が終わったよ。東福寺や永観堂は11月中旬、嵐山は11月下旬が見頃の見込みだよ。",
      report: {
        title: "京都の紅葉 調査レポート",
        markdown,
      },
    };
  }
  if (/嵐山|昼|ご飯|ランチ/.test(instruction)) {
    const markdown = [
      "# 嵐山周辺の昼食候補 調査レポート",
      "",
      "渡月橋および竹林の小径周辺で評価の高い昼食スポットを調査した。",
      "",
      "## おすすめ候補",
      "1. **湯豆腐・京料理**: 渡月橋近くの老舗料亭。桂川の眺望とともに伝統の湯豆腐を堪能できる。",
      "2. **手打ち蕎麦**: 竹林の小径手前。国産十割蕎麦と季節の天ぷらが人気。",
      "3. **和カフェ**: 天龍寺近く。抹茶スイーツと軽食（湯葉うどん等）が充実。",
      "",
      "**注意点**: 昼時は行列が予想されるため、午前中のWEB整理券取得または事前予約が推奨される。",
    ].join("\n");

    return {
      speech:
        "嵐山周辺の昼食スポットを調べたよ。渡月橋近くの湯豆腐や竹林近くの十割蕎麦が評判だよ。",
      report: {
        title: "嵐山周辺の昼食候補 調査レポート",
        markdown,
      },
    };
  }

  const markdown = [
    `# 「${instruction}」の調査レポート`,
    "",
    "Web 検索を通じて最新の動向と複数ソースの情報を照合・分析した。",
    "",
    "- 主要なポイントについて確認を完了した。",
    "- 詳細情報や関連リンクは適宜参照されたい。",
  ].join("\n");

  return {
    speech: `「${instruction}」の調査が完了したよ。主要なポイントを画面にまとめたよ。`,
    report: {
      title: `「${instruction}」の調査レポート`,
      markdown,
    },
  };
}
